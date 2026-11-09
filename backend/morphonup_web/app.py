"""MorphoNup web API (FastAPI).

  GET  /api/health                                   status and versions
  GET  /api/datasets                                 the exported datasets, grouped by species, with their results
  GET  /api/datasets/{slug}/sequences                one page of a dataset's sequences (label, search, paging)
  GET  /api/datasets/{slug}/random?label=            one random sequence of that label
  POST /api/predict  {"dataset": slug, "sequence"}   the prediction (see predictor.py for which model answers)

Run (from website/backend):  uvicorn morphonup_web.app:app --port 8000
With frontend/dist built, the same server also serves the web page at http://localhost:8000/.
Sequences sent to /api/predict are not stored or logged.
"""
from __future__ import annotations

import os

if not os.environ.get("MORPHONUP_ALLOW_GPU"):
    os.environ["CUDA_VISIBLE_DEVICES"] = ""             # predict on the CPU; never take GPU memory from training
os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")

from functools import lru_cache  # noqa: E402
from pathlib import Path  # noqa: E402
from typing import Literal  # noqa: E402

from fastapi import FastAPI, HTTPException, Query  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import FileResponse  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from . import catalog  # noqa: E402
from .predictor import Predictor  # noqa: E402
from .shape import SequenceError  # noqa: E402

app = FastAPI(title="MorphoNup", version="0.1.0", docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get("MORPHONUP_CORS", "http://localhost:5173").split(","),
                   allow_methods=["GET", "POST"], allow_headers=["*"])


@lru_cache(maxsize=1)
def predictor() -> Predictor:
    return Predictor()


def dataset_id(slug: str) -> str:
    """The id of an available dataset. 404 for an unknown name, 409 for one of the 12 that is still training."""
    for did, info in predictor().datasets.items():
        if info["slug"] == slug:
            return did
    if any(catalog.slug(did) == slug for did, _, _ in catalog.DATASETS):
        raise HTTPException(409, catalog.NOT_READY)
    raise HTTPException(404, f"No dataset called {slug}.")


@lru_cache(maxsize=None)
def seed_accuracy(did: str) -> float:
    """Accuracy of the saved out-of-fold predictions that the site serves (one seed), from the sequence index."""
    row = predictor()._db().execute(
        "SELECT AVG(CASE WHEN (p >= 0.5) = (label = 1) THEN 1.0 ELSE 0.0 END) FROM sequences WHERE dataset = ?",
        (did,)).fetchone()
    return float(row[0])


@app.get("/api/health")
def health():
    import tensorflow as tf
    return dict(status="ok", datasets=len(predictor().datasets), tensorflow=tf.__version__,
                bundle_built=predictor().manifest.get("built"))


@app.get("/api/datasets")
def datasets():
    """All 12 datasets grouped by species; `available` is false (with a message) for those still training."""
    ready, sizes, groups = predictor().datasets, catalog.sizes(), []
    for species in catalog.SPECIES_ORDER:
        items = []
        for did, sp, region in catalog.DATASETS:
            if sp != species:
                continue
            item = dict(slug=catalog.slug(did), id=did, region=region, name=catalog.REGION_NAME[region],
                        collection=did.split("/")[0].replace("_", " "), n=sizes.get(did), available=did in ready)
            if did in ready:
                info = ready[did]
                item.update(n=info["n"], positive=info["positive"], stage=info["stage"], k=info["k"], seed=info["seed"],
                            served_accuracy=seed_accuracy(did), benchmark=info.get("benchmark"))
            else:
                item.update(message=catalog.NOT_READY)
            items.append(item)
        groups.append(dict(species=species, common_name=catalog.COMMON_NAME[species], datasets=items))
    return groups


@app.get("/api/datasets/{slug}/sequences")
def sequences(slug: str, label: Literal["all", "nucleosomal", "linker"] = "all",
              q: str = Query("", max_length=147), page: int = Query(1, ge=1), size: int = Query(20, ge=1, le=100)):
    did = dataset_id(slug)
    where, args = ["dataset = ?"], [did]
    if label != "all":
        where.append("label = ?")
        args.append(1 if label == "nucleosomal" else 0)
    q = q.strip()
    if q:
        if set(q.upper()) <= set("ACGT"):
            where.append("sequence LIKE ?")
            args.append(f"%{q.upper()}%")
        else:
            where.append("name LIKE ?")
            args.append(f"%{q}%")
    sql = " AND ".join(where)
    db = predictor()._db()
    total = db.execute(f"SELECT COUNT(*) FROM sequences WHERE {sql}", args).fetchone()[0]
    rows = db.execute(f"SELECT idx, name, sequence, label, p FROM sequences WHERE {sql} ORDER BY idx LIMIT ? OFFSET ?",
                      args + [size, (page - 1) * size]).fetchall()
    return dict(total=total, page=page, size=size, items=[
        dict(index=r["idx"], name=r["name"], sequence=r["sequence"],
             label="nucleosomal" if r["label"] == 1 else "linker", saved_probability=r["p"]) for r in rows])


@app.get("/api/datasets/{slug}/random")
def random_sequence(slug: str, label: Literal["nucleosomal", "linker"] = "nucleosomal"):
    did = dataset_id(slug)
    r = predictor()._db().execute(
        "SELECT idx, name, sequence, label, p FROM sequences WHERE dataset = ? AND label = ? ORDER BY RANDOM() LIMIT 1",
        (did, 1 if label == "nucleosomal" else 0)).fetchone()
    return dict(index=r["idx"], name=r["name"], sequence=r["sequence"], label=label, saved_probability=r["p"])


class PredictRequest(BaseModel):
    dataset: str = Field(..., description="dataset slug, from /api/datasets")
    sequence: str = Field(..., max_length=2000, description="147 bases; a FASTA header and spaces are removed")


@app.post("/api/predict")
def predict(req: PredictRequest):
    did = dataset_id(req.dataset)
    try:
        return predictor().predict(did, req.sequence)
    except SequenceError as e:
        raise HTTPException(422, str(e)) from None


# ---------------------------------------------------------------- the web page
# After `npm run build` in website/frontend, this server also serves the page, so one process runs the whole site.
# Every path that is not /api/... and not a file of the build returns index.html (the page handles its own routes).
DIST = Path(os.environ.get("MORPHONUP_FRONTEND", Path(__file__).resolve().parents[2] / "frontend" / "dist")).resolve()

if DIST.is_dir():
    @app.get("/{path:path}", include_in_schema=False)
    def frontend(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "No such API endpoint.")
        f = (DIST / path).resolve()
        if path and f.is_file() and DIST in f.parents:
            return FileResponse(f)
        return FileResponse(DIST / "index.html")

"""API tests (pytest, CPU). Need the model bundle in website/models (scripts/export_bundle.py).

Run (from website/backend):  CUDA_VISIBLE_DEVICES= python -m pytest -q tests/test_api.py
"""
import os

os.environ.setdefault("CUDA_VISIBLE_DEVICES", "")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from morphonup_web.app import app  # noqa: E402

client = TestClient(app)
HS = "DatasetNup_1-Homo_sapiens"


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["status"] == "ok"


def test_datasets_grouped_by_species():
    groups = client.get("/api/datasets").json()
    assert groups[0]["species"] == "Homo sapiens"
    hs = next(d for g in groups for d in g["datasets"] if d["slug"] == HS)
    assert hs["n"] == 4573 and 0.85 < hs["served_accuracy"] < 0.95


def test_all_twelve_listed_and_unfinished_ones_explained():
    groups = client.get("/api/datasets").json()
    items = [d for g in groups for d in g["datasets"]]
    assert len(groups) == 4 and len(items) == 12 and all(d["n"] for d in items)
    waiting = [d for d in items if not d["available"]]
    if not waiting:
        pytest.skip("every dataset is exported")
    slug = waiting[0]["slug"]
    for r in (client.post("/api/predict", json=dict(dataset=slug, sequence="A" * 147)),
              client.get(f"/api/datasets/{slug}/sequences"), client.get(f"/api/datasets/{slug}/random")):
        assert r.status_code == 409 and "still training" in r.json()["detail"]
    assert client.get("/api/datasets/no-such-dataset/sequences").status_code == 404


def test_sequences_paging_filter_search():
    page = client.get(f"/api/datasets/{HS}/sequences", params=dict(label="linker", size=5)).json()
    assert page["total"] > 0 and len(page["items"]) == 5
    assert all(i["label"] == "linker" for i in page["items"])
    first = page["items"][0]
    found = client.get(f"/api/datasets/{HS}/sequences", params=dict(q=first["sequence"][40:70])).json()
    assert any(i["index"] == first["index"] for i in found["items"])


def test_dataset_sequence_uses_held_out_model():
    item = client.get(f"/api/datasets/{HS}/random", params=dict(label="nucleosomal")).json()
    r = client.post("/api/predict", json=dict(dataset=HS, sequence=item["sequence"])).json()
    assert r["model"]["kind"] == "held-out fold model" and r["in_dataset"]["label"] == "nucleosomal"
    assert abs(r["probability"] - item["saved_probability"]) < 1e-3
    assert len(r["shape"]["MGW"]) == 147 and r["shape"]["MGW"][0] is None and len(r["shape"]["Roll"]) == 146


def test_reverse_complement_is_recognised_and_gives_the_same_answer():
    item = client.get(f"/api/datasets/{HS}/random", params=dict(label="linker")).json()
    rc = item["sequence"].translate(str.maketrans("ACGT", "TGCA"))[::-1]
    a = client.post("/api/predict", json=dict(dataset=HS, sequence=item["sequence"])).json()
    b = client.post("/api/predict", json=dict(dataset=HS, sequence=rc)).json()
    assert b["in_dataset"]["strand"] == "reverse complement"
    assert abs(a["probability"] - b["probability"]) < 1e-5     # MorphoNup is strand-symmetric


def test_new_sequence_uses_mean_of_five():
    seq = ("ACGT" * 40)[:147]
    r = client.post("/api/predict", json=dict(dataset=HS, sequence=">my sequence\n" + seq.lower())).json()
    assert r["model"]["kind"] == "mean of the five fold models" and r["in_dataset"] is None


@pytest.mark.parametrize("text, message", [
    ("ACGT" * 33, "This sequence has 132 bases. MorphoNup needs exactly 147."),
    ("A" * 57 + "N" + "A" * 89, 'Position 58 is "N". Use only A, C, G and T.'),
])
def test_bad_input_messages(text, message):
    r = client.post("/api/predict", json=dict(dataset=HS, sequence=text))
    assert r.status_code == 422 and r.json()["detail"] == message

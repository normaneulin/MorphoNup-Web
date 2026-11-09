# MorphoNup-Web

Website for **MorphoNup**, a deep learning model that predicts nucleosome positioning from DNA sequence and DNA shape
(CMSC 199.2 thesis, University of the Philippines Tacloban). Choose a species and a dataset, paste a 147-bp sequence,
and see whether MorphoNup thinks it is nucleosomal or linker DNA, and why.

Model and paper code: [github.com/normaneulin/MorphoNup](https://github.com/normaneulin/MorphoNup)

## Status

| Milestone | State |
|---|---|
| 0. Plan and brand (`docs/PLAN.md`, `design/brand-board.html`) | done |
| 1. DNA shape engine (lookup tables, no DNAshapeR at run time) | done: identical to the DNAshapeR exports for all 533,929 sequences; DNAshapeR 1.18.0 agrees on every table entry |
| 2. Prediction server (FastAPI) | done for the 6 finished datasets: same out-of-fold predictions as the saved runs, 0 class changes; API tests pass |
| 3. Web page (Vite + React + TypeScript) | done: Home, Predict (species carousel with drawn figures, dataset slides with an explanation of each dataset type, sequence box, dataset browser in a dialog, chromatin-scanning animation that lands on a nucleosome or a linker, result with sequence and DNA shape views), Datasets (with a glossary of the dataset types), About; light and dark; checked at phone and desktop width |
| 4. Explanations (attribution per position, coil view), Model page | next |
| 5. Deployment | |

## Layout

```
docs/PLAN.md                    the plan: framework, prediction flow, pages, API, decisions, demo video
design/                         brand board, logo (logo/histone-core.svg is the author's histone drawing), icons
backend/morphonup_web/
  shape.py                      14 DNAshapeR tracks of any sequence by table lookup
  data/shape_tables.json        the tables (pentamers, hexamers, end steps), in hundredths
  inputs.py                     model inputs built exactly like the training loader
  predictor.py                  which model answers (held-out fold model or mean of five) and the prediction
  app.py                        the API
backend/tests/                  golden shape test, parity with the saved runs, API tests
scripts/
  build_shape_tables.py         builds the tables from the DNAshapeR exports of the 12 datasets
  check_tables_with_dnashaper.py  compares the tables with a fresh DNAshapeR run
  export_bundle.py              copies the trained fold models and the sequence index into models/ (not in git)
  make_brand_assets.py          logo, favicon, icons and brand board (also writes them into frontend/)
  import_species.py             species silhouettes for the carousel (design/species/, credits in CREDITS.md)
  make_fly.py                   draws the fruit-fly silhouette (our own drawing)
models/                         generated model bundle (weights, preprocessing, sequences.sqlite); not in git
frontend/src/                   the page: pages/ (Home, Predict, Datasets, About), components/, styles/, api.ts
run.sh                          builds the page if needed and starts the server
```

## Run the website (on the lab workstation, from VS Code over SSH)

    bash run.sh             # builds the page the first time, then serves page and API on port 8000
    bash run.sh --build     # after changing anything in frontend/

VS Code forwards the port: click "Open in Browser", or open the PORTS tab and the globe of port 8000, then use
http://localhost:8000 on your own computer. http://localhost:8000/api/docs lists the API. Stop with Ctrl+C.

While editing the page, live reload: run `bash run.sh` in one terminal and, in a second one,
`cd frontend && PATH=../../../envs/web/bin:$PATH npm run dev`, then open http://localhost:5173.

The model bundle (`models/`) is exported from the MorphoNup workspace with the training environment:

    python scripts/export_bundle.py      # rerun when more datasets finish training

Checks:

    python backend/tests/check_shape_golden.py                 # shape engine vs the DNAshapeR exports
    python scripts/check_tables_with_dnashaper.py              # tables vs DNAshapeR 1.18.0 (envs/dnashape)
    CUDA_VISIBLE_DEVICES= python backend/tests/check_predictor_parity.py
    cd backend && python -m pytest -q tests/test_api.py

The server needs the `morphonup` package of the MorphoNup repository. Inside the workspace it is found automatically;
elsewhere set `MORPHONUP_PACKAGE` to the folder that contains `morphonup/`.

## Rebuild the brand board

    python scripts/make_brand_assets.py

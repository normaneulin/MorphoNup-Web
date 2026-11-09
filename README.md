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
| 2. Predictor (Python reference, FastAPI) | done for the 6 finished datasets: same out-of-fold predictions as the saved runs, 0 class changes; API tests pass |
| 3. Web page (Vite + React + TypeScript) | done: Home, Predict (species carousel with drawn figures, dataset slides with an explanation of each dataset type, sequence box, dataset browser in a dialog, chromatin-scanning animation that lands on a nucleosome or a linker, result with sequence and DNA shape views), Datasets (with a glossary of the dataset types), About; light and dark; checked at phone and desktop width |
| 4. Explanations (attribution per position, coil view), Model page | next |
| 5. Deployment (GitHub Pages, static) | done: the models run in the browser (`frontend/src/engine`), same probabilities as the Python predictor within 1e-6; deployed by `.github/workflows/pages.yml` |

## Layout

```
docs/PLAN.md                    the plan: framework, prediction flow, pages, API, decisions, demo video
design/                         brand board, logo (logo/histone-core.svg is the author's histone drawing), icons
backend/morphonup_web/
  shape.py                      14 DNAshapeR tracks of any sequence by table lookup
  data/shape_tables.json        the tables (pentamers, hexamers, end steps), in hundredths
  inputs.py                     model inputs built exactly like the training loader
  predictor.py                  which model answers (held-out fold model or mean of five) and the prediction
  app.py                        the API (reference for the static site; not needed to run it)
backend/tests/                  golden shape test, parity with the saved runs, API tests, browser-engine parity
scripts/
  build_shape_tables.py         builds the tables from the DNAshapeR exports of the 12 datasets
  check_tables_with_dnashaper.py  compares the tables with a fresh DNAshapeR run
  export_bundle.py              copies the trained fold models and the sequence index into models/ (not in git)
  export_static.py              turns models/ into the static files of the site (frontend/public/data, in git)
  make_brand_assets.py          logo, favicon, icons and brand board (also writes them into frontend/)
  import_species.py             species silhouettes for the carousel (design/species/, credits in CREDITS.md)
models/                         generated model bundle (weights, preprocessing, sequences.sqlite); not in git
frontend/src/                   the page: pages/ (Home, Predict, Datasets, About), components/, styles/, api.ts
frontend/src/engine/            in-browser prediction: shape lookup, inputs, the network, dataset files, Web Worker
frontend/public/data/           static data: datasets.json, shape tables, per dataset model.json/.bin and sequences.bin
.github/workflows/pages.yml     builds the site and publishes it on GitHub Pages after every push to main
run.sh                          builds the page if needed and serves it locally
```

## The site online

https://normaneulin.github.io/MorphoNup-Web/ is published by GitHub Actions after every push to `main`
(`.github/workflows/pages.yml`). One-time setup in the repository: **Settings > Pages > Build and deployment >
Source: GitHub Actions**. The site is static: the page, the datasets and the trained models are files, and the
prediction runs in the visitor's browser, so nothing is sent to a server.

## Run the website locally (on the lab workstation, from VS Code over SSH)

    bash run.sh             # builds the page, then serves it on port 8000

VS Code forwards the port: click "Open in Browser", or open the PORTS tab and the globe of port 8000, then use
http://localhost:8000 on your own computer. Stop with Ctrl+C. For live reload while editing:
`cd frontend && PATH=../../../envs/web/bin:$PATH npm run dev`, then open http://localhost:5173.

## Add datasets when they finish training

    python scripts/export_bundle.py                                   # training env: models/ (Keras bundle, not in git)
    ../../envs/web-api/bin/python scripts/export_static.py            # models/ -> frontend/public/data (in git)
    cd backend && ../../../envs/web-api/bin/python tests/check_static_parity.py   # browser engine vs Keras

Then commit `frontend/public/data` and push; the workflow redeploys the site.

## Checks

    python backend/tests/check_shape_golden.py                 # shape engine vs the DNAshapeR exports
    python scripts/check_tables_with_dnashaper.py              # tables vs DNAshapeR 1.18.0 (envs/dnashape)
    CUDA_VISIBLE_DEVICES= python backend/tests/check_predictor_parity.py   # Python predictor vs the saved runs
    python backend/tests/check_static_parity.py                # browser engine vs the Python predictor
    cd backend && python -m pytest -q tests/test_api.py

The Python predictor and the API need the `morphonup` package of the MorphoNup repository. Inside the workspace it is
found automatically; elsewhere set `MORPHONUP_PACKAGE` to the folder that contains `morphonup/`. The static site
needs neither.

## Rebuild the brand board

    python scripts/make_brand_assets.py

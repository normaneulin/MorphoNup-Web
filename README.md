# MorphoNup-Web

**Live site: [normaneulin.github.io/MorphoNup-Web](https://normaneulin.github.io/MorphoNup-Web/)**

Website for **MorphoNup**, a deep learning model that predicts nucleosome positioning from DNA sequence and DNA shape
(CMSC 199.2 thesis, University of the Philippines Tacloban). Choose a species and a dataset, paste a 147-bp sequence or
pick one from the dataset, and see whether MorphoNup predicts it to be nucleosomal or linker DNA, with the score of each
strand and the DNA shape of the sequence.

Model, datasets and paper code: [github.com/normaneulin/MorphoNup](https://github.com/normaneulin/MorphoNup)

## How it works

The site is fully static and the prediction runs in the visitor's browser, so nothing is installed and the entered
sequence is never sent anywhere.

* **DNA shape.** The 14 DNAshapeR tracks of a sequence are looked up in tables of 5- and 6-base windows built from the
  DNAshapeR outputs of the 12 benchmark datasets. The lookup reproduces the DNAshapeR values of all 533,929 sequences
  exactly, and DNAshapeR 1.18.0 gives the same values for every table entry.
* **Models.** Each dataset has the five models of its 5-fold cross-validation. A sequence of the dataset (either
  strand) is predicted by the model whose test fold contained it, which is the out-of-fold prediction behind the
  reported accuracy; any other sequence gets the mean of the five models. Each model reads both strands and averages
  them.
* **In the browser.** The network is written out in TypeScript (`frontend/src/engine`) and runs in a Web Worker with the
  exported weights. It gives the same probabilities as the Keras models within 1e-6, with no change of class.

Datasets on the site: 8 of the 12 (DatasetNup 1: human, roundworm, fruit fly; DatasetNup 3: human hg38; DatasetNup 2:
human 5′ UTRs, promoters and largest chromosome, fruit fly 5′ UTRs). The other four are added when their training
finishes.

## Run it locally

Needs Node.js 22.

    cd frontend
    npm install
    npm run dev          # http://localhost:5173, reloads on every change
    npm run build        # the static site in frontend/dist

## Project layout

```
frontend/src/                 the page: pages/ (Home, Predict, Datasets, About), components/, styles/, api.ts
frontend/src/engine/          in-browser prediction: shape lookup, model inputs, the network, dataset files, Web Worker
frontend/public/data/         datasets.json, shape tables, and per dataset model.json, model.bin and sequences.bin
backend/morphonup_web/        Python reference: shape lookup, inputs, predictor and API (used by the checks)
backend/tests/                checks: shape tables, predictor vs the saved runs, browser engine vs Keras
scripts/                      shape tables, model export, brand assets, species silhouettes
design/                       logo, icons, brand board, species silhouettes (credits in design/species/CREDITS.md)
docs/PLAN.md                  design decisions
.github/workflows/pages.yml   builds the site and publishes it on GitHub Pages after every push to main
```

## Updating the models

The weights come from the training results of the MorphoNup repository. After more datasets finish training:

    python scripts/export_bundle.py                       # trained fold models -> models/ (not in git)
    python scripts/export_static.py                       # models/ -> frontend/public/data
    python backend/tests/check_static_parity.py           # browser engine vs the Keras models

Then commit `frontend/public/data` and push; the site is rebuilt and published automatically. The export scripts and
the checks need the `morphonup` package of the MorphoNup repository (set `MORPHONUP_PACKAGE` to the folder that
contains `morphonup/` if it is not found).

Other checks:

    python backend/tests/check_shape_golden.py            # shape lookup vs the DNAshapeR exports
    python backend/tests/check_predictor_parity.py        # Python predictor vs the saved out-of-fold predictions
    python scripts/check_tables_with_dnashaper.py         # shape tables vs a fresh DNAshapeR run

## Credits

Species silhouettes: the human and the fruit fly by the author; *C. elegans* by Arcadia Science and *S. cerevisiae* by
Jon Laurent (PhyloPic, CC0). Datasets as organized by Zhou et al. (2022) for DeepNup; DNA shape from DNAshapeR
(Chiu et al., 2016; Li et al., 2017). Full references are on the site's About page.

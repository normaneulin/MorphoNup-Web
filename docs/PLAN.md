# MorphoNup-Web: plan

First draft, 8 November 2026; decisions of the same evening in section 11. Brand board: `design/brand-board.html`
(open it in a browser).

## 1. What the site does

A person picks a species, then one of its datasets, pastes a 147-bp DNA sequence (or picks an example from that
dataset), and MorphoNup says whether the sequence is likely nucleosomal or linker DNA. It shows how sure it is, what
each strand gave, the DNA shape it computed, and which positions pushed the prediction which way. Other pages explain
the datasets, the model and the paper.

Audience, in order: researchers who want a quick prediction, the thesis panel and readers of the paper, students
learning what nucleosome positioning is. The primary job is the prediction; everything else supports it.

## 2. Framework

| Option | Good | Bad for this site |
|---|---|---|
| Streamlit | Python only, fast to prototype | the whole script reruns on every click, little control over layout and mobile, looks like every other Streamlit app, one live connection per visitor |
| Gradio | made for ML demos, easy on Hugging Face | same generic look, hard to build the coil view, dataset pages and custom charts |
| **React (Vite, TypeScript) + FastAPI (Python)** | full control of design and mobile layout, custom charts, the backend imports the real `morphonup` package, so predictions match the paper | two parts to build instead of one |
| Everything in the browser (ONNX Runtime Web) | no server at all, free static hosting | preprocessing and shape must be rewritten in TypeScript and proven identical; risky for a first version |

**Choice: React + Vite + TypeScript for the site, FastAPI for the model.**

* Why not Next.js: the site is one tool plus a few content pages. It does not need server rendering, so plain Vite
  is simpler and builds to static files that any host can serve.
* Why a Python backend: the model, the saved scalers, the PLS reduction and the parity tests already exist in Python.
  The backend loads them unchanged instead of re-implementing them.
* Later option: once the backend is proven, the 134,442-parameter model is small enough to export to ONNX and run in
  the browser. That would be a speed and hosting improvement, not a requirement.

Hosting comes later. One Docker image can serve both the API and the built site (FastAPI serves the static files). It
fits a free Hugging Face Space or any container host. The model files live in a release or a model repository, not in
git.

## 3. How one prediction works

```
browser                                  backend (FastAPI)
-------                                  -----------------
species -> dataset -> sequence  ----->  1. validate: 147 letters, only A C G T (FASTA header and spaces removed)
                                        2. DNA shape: 14 tracks by table lookup (section 4), no DNAshapeR needed
                                        3. preprocess with THAT dataset's saved fitting: z-scores, PLS projection,
                                           1-4-mer frequencies (morphonup.preprocess, preprocessor.npz)
                                        4. model: forward strand and reverse complement, p = mean of the two
                                        5. explanation (optional): integrated gradients per position and input group
result card, coil, sequence, shape <---  6. JSON: p, p_forward, p_reverse, label, shape tracks, attribution,
                                           benchmark label if the sequence is in the dataset, model version
```

Sequences are not stored. Each response carries the model version (dataset, weights hash) so a result can be traced.

## 4. DNA shape without DNAshapeR

DNAshapeR does not run a simulation for each new sequence. It looks values up in tables computed once from Monte
Carlo simulations. Our training data confirms this, and `morphonup/data.py` already checks it on every load:

* the 8 base-pair tracks (MGW, ProT, EP, Buckle, Opening, Shear, Stagger, Stretch) are a fixed value for each
  5-base window (1,024 possible pentamers);
* the 6 step tracks (HelT, Rise, Roll, Shift, Slide, Tilt) are a fixed value for each 6-base window inside the
  sequence (4,096 hexamers), with their own rule at the two ends;
* the first and last two positions have no value (NA), and the model is built around that.

So the backend can compute the shape itself with a small table, and we can build that table from our own DNAshapeR
exports:

1. Read the shape files of all 12 datasets and fill one table per track (pentamer or hexamer to value).
2. Check that the 12 datasets agree on every entry. If they do not, the exports came from different DNAshapeR
   versions, and we stop and find out which one the model was trained on.
3. Check coverage: every pentamer and hexamer should appear somewhere in the 533,929 sequences of the 12 datasets. Any gap is
   filled from the DNAshapeR package's own query tables, then checked again.
4. Golden test: for every sequence of every dataset, the computed 147 x 14 values must equal the exported values.
   This is a hard pass or fail, the same idea as `tests/check_inference_parity.py`.

All of this runs on the CPU and does not touch the training queue.

## 5. Which weights the site uses (decided)

Each dataset has its own weights, and the dataset the user picks decides which weights are used. The detail is that
cross-validation does not train one model per dataset but five: with 5 folds, each model trains on four fifths of the
sequences and is tested on the fifth it never saw. The site keeps all five (refit stage, seed 151000), which is 60
small weight files for the 12 datasets. No extra training is needed.

* **A sequence from the dataset** (the normal case: every sequence of every dataset is listed on the site) is
  predicted by the one model of the five that never saw it. Its answer is exactly the out-of-fold prediction behind
  the accuracy in the paper, so the site never shows a prediction on a sequence the model was trained on.
* **Any other valid sequence** gets the mean probability of the five models, and the result says so.

The site recognises a dataset sequence by its text, so it does not matter whether the user picked it from the list
or pasted it.

## 6. Pages

| Page | Content |
|---|---|
| Home | The coil: a real sequence wrapping around the histone core (one load animation, nothing else moves). One sentence on what MorphoNup does, a "Predict a sequence" button, three short explainers: what nucleosome positioning is, what MorphoNup reads (sequence and shape), how well it works (link to Datasets). |
| Predict | The tool (section 7). |
| Datasets | Species, then datasets. Per dataset: where the sequences come from, size, share of nucleosomal sequences, our cross-validation results, and the published results as printed in the papers. All numbers generated from the result files, never typed. |
| Model | The architecture as an interactive diagram (hover a block to see its tensor shape), what DNA shape is and which of the 14 tracks the model uses, the training and evaluation protocol in plain words. |
| About | The paper, how to cite it, author and adviser, UP Tacloban, links to both repositories, licence, privacy (sequences are not stored). |

## 7. The Predict page

The steps really are a sequence, so they are numbered.

1. **Species**: four choices with their icons.
2. **Dataset**: the datasets of that species, each drawn as a microscope slide (icon on the frosted end, name, size,
   accuracy).
3. **Sequence**: a text box with a live counter (132 / 147), invalid letters highlighted where they are, FASTA headers
   and spaces removed automatically, lower case accepted. Below it, the browser of the chosen dataset: every
   sequence, with its true label, a filter (nucleosomal, linker, all), paging, search by sequence name or by a piece of
   sequence, and "a random nucleosomal one" / "a random linker one". "Use" puts the sequence in the box; copy is also
   there for people who want it. The largest dataset has 157,448 sequences, so the list is served page by page.
4. **Result**:
   * the verdict in words and the probability on a 0 to 1 bar with the 0.5 threshold marked;
   * the two strands (MorphoNup reads both and averages them; this is specific to our model);
   * the benchmark label when the sequence comes from the dataset;
   * how good the model is on this dataset (accuracy, MCC, ROC AUC from cross-validation), with a link to the details.
5. **Why**, in tabs:
   * Coil: the 147 bases wrapped around the core, each tinted by its attribution, dyad at the top.
   * Sequence: 7 rows of 21 bases (21 bp is two helical turns), tinted the same way. This is the mobile default.
   * DNA shape: the computed tracks along the sequence (MGW, Roll, EP and the others), downloadable as CSV.
   * Inputs: how much the sequence, the k-mers and each shape group contributed (feature attribution only, as in the
     paper; no motif claims).
6. **Several sequences** (second version): paste up to a few hundred in FASTA, get a table and a CSV.
7. **Longer sequences** (later, clearly marked as exploratory): slide a 147-bp window along a longer sequence and plot
   the probability along it.

Desktop:

```
+------------------------------------------------------------------------------------+
| (mark) MorphoNup          Predict   Datasets   Model   About                         |
+---------------------------------------+--------------------------------------------+
| 1 Species                              | Nucleosomal                         0.98   |
|   [human] [worm] [fly] [yeast]         | 0 [=========================|=====] 1      |
| 2 Dataset                              | strand you gave 0.98   other strand 0.99   |
|   [|| Benchmark        4,573 ]         | The benchmark labels it nucleosomal.        |
|   [|| Genome-wide hg38       ]         +--------------------------------------------+
|   [|| Largest chromosome     ]         | Coil | Sequence | DNA shape | Inputs        |
|   ...                                  |                                            |
| 3 Sequence                             |        147 bp wrapped around the core,     |
|   [ TGGAATGGAATTGAATGC...    ]         |        bases tinted by attribution         |
|   147 / 147                            |                                            |
|   Examples: nucleosomal | linker       |                                            |
|   [ Predict ]                          |                                            |
+---------------------------------------+--------------------------------------------+
```

Phone (one column, no sideways scrolling; the Predict button stays at the bottom of the screen):

```
+------------------------+
| (mark) MorphoNup   ☰   |
| 1 Species              |
| [human ] [worm  ]      |
| [fly   ] [yeast ]      |
| 2 Dataset              |
| [|| Benchmark      ]   |
| [|| Promoters      ]   |
| 3 Sequence             |
| [                  ]   |
| 132 / 147              |
| Examples               |
+------------------------+
| Nucleosomal      0.98  |
| [==============|===]   |
| Sequence | Shape | ... |
| 7 rows of 21 bases     |
+------------------------+
| [       Predict      ] |
+------------------------+
```

Messages (from the brand board): "This sequence has 132 bases. MorphoNup needs exactly 147." / "Position 58 is "N".
Use only A, C, G and T." / "Paste a sequence, or pick one of the examples from this dataset."

## 8. Brand (details in the brand board)

* **Idea**: chromatin means "coloured material"; the palette is the H&E stain (haematoxylin violet, eosin pink) on
  the pale glass of a slide. It avoids the usual generated-site looks (cream and terracotta, black and neon green,
  identical rounded cards with grey shadows).
* **Logo**: three concepts drawn from the real minor groove width of a nucleosomal benchmark sequence. Chosen:
  **A, Wrap** (the histone core with 1.65 turns of DNA): it reads as a nucleosome, survives at favicon size, and the
  ribbon width is real shape data.
* **Type**: Atkinson Hyperlegible Next for everything, Atkinson Hyperlegible Mono for DNA. Chosen because users read
  147-letter sequences where C and G must never be confused. Self-hosted, so no requests to Google.
* **Colour rules**: violet means nucleosomal, eosin is only for the dyad and keyboard focus, bases use the usual
  sequence-logo colours and always appear with their letter. The attribution scale is checked with a colour-blindness
  validator before use. Dark theme designed separately, not inverted.
* **Icons**: our own line icons for the four species and the dataset types (balanced benchmark, genome-wide,
  largest chromosome, promoters, 5′ UTRs). First drafts in `design/icons/`.
* **Motion**: one animation, the coil on the home page. Results appear with a short transition that shows what
  changed. Reduced-motion settings are respected.

## 9. API (first version)

| Method and path | Returns |
|---|---|
| `GET /api/health` | status, model version, TensorFlow version |
| `GET /api/datasets` | the 12 datasets grouped by species: names, icons, size, nucleosomal share, our metrics, published metrics |
| `GET /api/datasets/{id}/sequences?label=&page=&q=` | one page of the dataset's sequences: name, sequence, true label, saved out-of-fold probability |
| `GET /api/datasets/{id}/random?label=` | one random sequence of that label |
| `POST /api/predict` | body: `dataset_id`, `sequence`, `explain`; returns section 3, step 6 |
| `POST /api/predict/batch` | body: `dataset_id`, FASTA text; returns one row per sequence (second version) |

Limits: request size, sequences per batch, a simple rate limit. Errors use the messages of section 7.

## 10. Repository layout

```
website/                     github.com/normaneulin/MorphoNup-Web
  README.md
  docs/PLAN.md               this plan
  design/                    brand board, logo concepts, icons (generated by scripts/make_brand_assets.py)
  scripts/                   brand assets now; later: build_shape_tables.py, export_site_data.py, export_models.py
  backend/                   FastAPI app, shape engine, predictor, tests        (milestone 2)
  frontend/                  Vite + React + TypeScript                          (milestone 3)
```

The backend installs the `morphonup` package from the MorphoNup repository at a fixed commit, so the site always runs
the code of the paper. Site data (dataset facts, metrics, examples) is exported from `results/` by a script, so no
number on the site is typed by hand.

## 11. Milestones and decisions

| Milestone | Work | Needs |
|---|---|---|
| 0 | Plan, brand board, repository | done 8 Nov |
| 1 | Shape engine and its golden test on all 12 datasets | done 8 Nov: tables complete (1,024 pentamers, 4,096 hexamers, no conflicts), identical to the exports for 533,929 sequences, DNAshapeR 1.18.0 agrees |
| 2 | Predictor and API, parity with the saved predictions | done 8 Nov for the 6 finished datasets: max difference 6e-4 (GPU vs CPU), 0 class changes; 8 API tests pass. Re-export when the large sets finish |
| 3 | Frontend: tokens, layout, the Predict flow end to end | done 8 Nov: React 18 + Vite 5 + TypeScript, served by FastAPI (`run.sh`); phone and desktop screenshots checked with Playwright |
| 4 | Coil, sequence and shape views; Datasets and Model pages | |
| 5 | Phone, tablet and desktop checks (Playwright screenshots), accessibility, error states, deployment | |

The paper (due 13 November) comes first; milestones 1 and 2 can run on the CPU while the GPU trains.

Decisions (8 November 2026):

1. **Logo**: concept **A, Wrap**, with the author's histone core (four pieces, M-shaped gap; `design/logo/histone-core.svg`).
2. **Weights**: the five cross-validation models of each dataset, used as in section 5. No extra training.
3. **The paper**: the website is now Objective 5, with a Methods section (3.12), a Results section with a screenshot
   placeholder (4.9) and the link in Chapters 1 and 5 and the appendix. The link is the macro `\webapp` in
   `paper/main/thesis.tex`; it points to this repository until the site is deployed.
4. **Defense**: only a demo video of at most one minute is needed (section 12). No date pressure; the benchmark
   continues in the background.

## 12. Demo video (defense, at most 60 seconds)

| Time | On screen | Narration (short) |
|---|---|---|
| 0 to 6 s | Home page, the coil animation | "MorphoNup predicts whether a piece of DNA wraps around a histone." |
| 6 to 14 s | Predict: tap Human, then Promoters | "Choose a species and one of its 12 datasets." |
| 14 to 24 s | The dataset browser; pick a nucleosomal sequence; Use | "Pick a sequence from the dataset, or paste your own 147-bp sequence." |
| 24 to 36 s | Predict; the result card fills in | "MorphoNup reads both strands and says nucleosomal, and the benchmark label agrees." |
| 36 to 48 s | Sequence tab, then DNA shape tab | "It shows which positions pushed the prediction and the DNA shape it computed." |
| 48 to 56 s | A linker example, predicted as linker | "A linker sequence for comparison." |
| 56 to 60 s | Logo, links to the paper and code | "MorphoNup, UP Tacloban." |

Recorded at phone size and desktop size; the numbers on screen are whatever the real model returns.

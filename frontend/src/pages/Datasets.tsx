import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { SpeciesGroup } from "../api";
import { api, ApiError, percent } from "../api";
import { Icon, REGION_ICON, SPECIES_ICON } from "../components/Brand";
import { REGION_INFO } from "../datasetInfo";

export default function Datasets() {
  const [groups, setGroups] = useState<SpeciesGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.datasets().then(setGroups).catch((e: ApiError) => setError(e.message));
  }, []);
  return (
    <div className="wrap">
      <div className="page-head">
        <h1>Datasets</h1>
        <p className="muted">
          Twelve benchmark datasets from four species, used by earlier nucleosome positioning predictors. Each sequence is
          147 bp long and labelled nucleosomal or linker. MorphoNup was trained and tested on each with 5-fold
          cross-validation; the numbers below are the results reported in the paper.
        </p>
      </div>
      <section className="glossary" aria-labelledby="types">
        <h2 id="types">What the datasets are</h2>
        <div className="glossary-grid">
          {Object.entries(REGION_INFO).map(([region, info]) => (
            <div key={region} className="glossary-item">
              <span className="frost-icon"><Icon name={REGION_ICON[region]} size={22} /></span>
              <div>
                <h3>{info.title}</h3>
                <p>{info.what}</p>
                <p className="small muted">{info.source}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
      {error && <p className="problem">{error}</p>}
      {groups?.map((g) => (
        <section key={g.species} className="species-block">
          <h2 className="species-title">
            <Icon name={SPECIES_ICON[g.species]} size={30} />
            <span>
              <em>{g.species}</em>, {g.common_name}
            </span>
          </h2>
          <div className="dataset-table" role="table" aria-label={`${g.species} datasets`}>
            <div className="dt-row dt-head" role="row">
              <span role="columnheader">Dataset</span>
              <span role="columnheader">Sequences</span>
              <span role="columnheader">Nucleosomal</span>
              <span role="columnheader">Accuracy</span>
              <span role="columnheader">MCC</span>
              <span role="columnheader">ROC AUC</span>
              <span role="columnheader"><span className="visually-hidden">Action</span></span>
            </div>
            {g.datasets.map((d) => (
              <div className="dt-row" role="row" key={d.slug}>
                <span role="cell" className="dt-name">
                  <span className="frost-icon"><Icon name={REGION_ICON[d.region]} size={22} /></span>
                  <span>
                    <b>{d.name}</b>
                    <span className="muted small">{d.collection}</span>
                  </span>
                </span>
                <span role="cell" data-label="Sequences">{d.n?.toLocaleString() ?? ""}</span>
                {d.available && d.benchmark ? (
                  <>
                    <span role="cell" data-label="Nucleosomal">{percent((d.positive ?? 0) / (d.n ?? 1), 0)}</span>
                    <span role="cell" data-label="Accuracy">
                      {percent(d.benchmark.accuracy)}
                      {d.benchmark.seeds > 1 && d.benchmark.accuracy_sd !== null ? (
                        <span className="muted small"> ± {(d.benchmark.accuracy_sd * 100).toFixed(2)}</span>
                      ) : null}
                    </span>
                    <span role="cell" data-label="MCC">{d.benchmark.mcc.toFixed(3)}</span>
                    <span role="cell" data-label="ROC AUC">{d.benchmark.roc_auc.toFixed(3)}</span>
                    <span role="cell">
                      <Link className="btn-quiet" to={`/predict?dataset=${d.slug}`}>Try it</Link>
                    </span>
                  </>
                ) : (
                  <span role="cell" className="dt-waiting">
                    <span className="chip waiting">Still training</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
      <p className="muted small">
        Accuracy, MCC and ROC AUC come from the pooled out-of-fold predictions of 5-fold cross-validation; where three
        seeds are finished, the value is their mean ± standard deviation. Published models are compared in the paper with
        the numbers printed in their own papers.
      </p>
    </div>
  );
}

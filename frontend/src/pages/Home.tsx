import { Link } from "react-router-dom";
import { Logo } from "../components/Brand";
import { NucleosomeJourney } from "../components/NucleosomeJourney";

export default function Home() {
  return (
    <>
      <section className="hero wrap">
        <div className="hero-text">
          <h1>Does this DNA wrap around a histone?</h1>
          <p className="lead">
            Paste a 147-bp sequence. MorphoNup reads its bases and its predicted shape and tells you whether it is likely
            to sit on a nucleosome.
          </p>
          <div className="hero-actions">
            <Link to="/predict" className="btn">
              Predict a sequence
            </Link>
            <Link to="/datasets" className="hero-link">
              See the 12 datasets
            </Link>
          </div>
        </div>
        <div className="hero-mark">
          <Logo size={320} className="hero-logo" />
        </div>
      </section>

      <section className="wrap journey-section" id="nucleosome" aria-labelledby="journey-title">
        <h2 id="journey-title">From a cell to one nucleosome</h2>
        <NucleosomeJourney />
      </section>

      <section className="wrap explain">
        <div>
          <h2>What a nucleosome is</h2>
          <p>
            In every cell, DNA is wound around small protein spools called histones. One spool with its 147 bp of DNA is
            a nucleosome. Where nucleosomes sit decides which genes the cell can read, and part of that is written in the
            DNA itself.
          </p>
        </div>
        <div>
          <h2>What MorphoNup reads</h2>
          <p>
            The sequence, and its shape: how wide the minor groove is, how the base pairs roll and twist, and the
            electrostatic potential along the DNA. The shape is predicted from the sequence with the same tables as
            DNAshapeR, so you only need the letters.
          </p>
        </div>
        <div>
          <h2>How to use it</h2>
          <ol className="howto">
            <li>Choose a species.</li>
            <li>Choose one of its datasets; each has its own trained models.</li>
            <li>Paste a sequence, or pick one from the dataset.</li>
            <li>Read the prediction, the score of each strand and the DNA shape.</li>
          </ol>
        </div>
      </section>
    </>
  );
}

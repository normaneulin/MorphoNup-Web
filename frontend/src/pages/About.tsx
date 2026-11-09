import { SILHOUETTE_CREDITS } from "../components/SpeciesFigures";

// Sources of the datasets and tools, as in the paper (Section 3.1). DOIs only where they are in the paper's references.
const REFERENCES: { id: string; text: React.ReactNode; doi?: string }[] = [
  { id: "guo2014", text: <>Guo, S.-H., Deng, E.-Z., Xu, L.-Q., Ding, H., Lin, H., Chen, W., and Chou, K.-C. (2014). iNuc-PseKNC: a sequence-based predictor for predicting nucleosome positioning in genomes with pseudo k-tuple nucleotide composition. <i>Bioinformatics</i>, 30, 1522–1529.</> },
  { id: "liu2013", text: <>Liu, H., Zhang, R., Xiong, W., Guan, J., Zhuang, Z., and Zhou, S. (2013). A comparative evaluation on prediction methods of nucleosome positioning. <i>Briefings in Bioinformatics</i>, 15(6), 1014–1027.</>, doi: "10.1093/bib/bbt062" },
  { id: "amato2020", text: <>Amato, D., Lo Bosco, G., and Rizzo, R. (2020). CORENup: a combination of convolutional and recurrent deep neural networks for nucleosome positioning identification. <i>BMC Bioinformatics</i>, 21(8), 326.</> },
  { id: "zhao2018", text: <>Zhao, Y., Wang, J., Liang, F., et al. (2018). NucMap: a database of genome-wide nucleosome positioning map across species. <i>Nucleic Acids Research</i>, 47(D1), D163–D169.</>, doi: "10.1093/nar/gky980" },
  { id: "zhou2022", text: <>Zhou, Y., Wu, T., Jiang, Y., Li, Y., Li, K., Quan, L., and Lyu, Q. (2022). DeepNup: prediction of nucleosome positioning from DNA sequences using deep neural network. <i>Genes</i>, 13, 1983.</>, doi: "10.3390/genes13111983" },
  { id: "chiu2016", text: <>Chiu, T.-P., Comoglio, F., Zhou, T., Yang, L., Paro, R., and Rohs, R. (2016). DNAshapeR: an R/Bioconductor package for DNA shape prediction and feature encoding. <i>Bioinformatics</i>, 32(8), 1211–1213.</>, doi: "10.1093/bioinformatics/btv735" },
  { id: "li2017", text: <>Li, J., Sagendorf, J. M., Chiu, T.-P., Pasi, M., Perez, A., and Rohs, R. (2017). Expanding the repertoire of DNA shape features for genome-scale studies of transcription factor binding. <i>Nucleic Acids Research</i>, 45(22), 12877–12887.</>, doi: "10.1093/nar/gkx1145" },
];

export default function About() {
  return (
    <div className="wrap prose">
      <div className="page-head">
        <h1>About MorphoNup</h1>
        <p className="lead">
          A deep learning model for nucleosome positioning prediction using DNA sequence and DNA shape features.
        </p>
      </div>

      <h2>How a prediction is made</h2>
      <p>
        The site computes the 14 DNA shape tracks of the sequence from the lookup tables of DNAshapeR 1.18.0, applies the
        preprocessing fitted during training, and runs the models of the chosen dataset. Each model reads both strands and
        averages them, so a sequence and its reverse complement receive the same prediction.
      </p>
      <p>
        Each dataset has five models, one per fold of its 5-fold cross-validation. A sequence from the dataset is predicted
        by the model of the fold whose test set contains it (an out-of-fold prediction), which is the prediction used in
        the reported accuracy. Any other sequence receives the mean of the five models.
      </p>

      <h2>Limitations</h2>
      <p>
        MorphoNup classifies one 147-bp sequence at a time. It does not map nucleosomes along a longer region, and it does
        not model chromatin remodelers, DNA methylation or histone modifications, which also position nucleosomes in a
        living cell. Entered sequences are not stored.
      </p>

      <h2>The study</h2>
      <p>
        MorphoNup is the CMSC 199.2 thesis of Norman Enrico C. Eulin, Department of Computer Science and Mathematics,
        College of Science, University of the Philippines Tacloban. Research adviser: Asst. Prof. Ryan Rey M. Daga.
      </p>
      <p>
        The model, the datasets and the code of the paper are at{" "}
        <a href="https://github.com/normaneulin/MorphoNup">github.com/normaneulin/MorphoNup</a>, and the code of this site
        at <a href="https://github.com/normaneulin/MorphoNup-Web">github.com/normaneulin/MorphoNup-Web</a>.
      </p>

      <h2>Datasets</h2>
      <p>
        The 12 datasets are used as organized by Zhou et al. (2022) for DeepNup, in three groups named DatasetNup 1 to 3.
        DatasetNup 1 comes from Guo et al. (2014); DatasetNup 2 from Amato et al. (2020), who used the data of Liu et al.
        (2013); DatasetNup 3 from Zhou et al. (2022), compiled from the NucMap database (Zhao et al., 2018). The DNA shape
        features come from DNAshapeR (Chiu et al., 2016; Li et al., 2017).
      </p>

      <h2>References</h2>
      <ol className="references">
        {REFERENCES.map((r) => (
          <li key={r.id} id={r.id}>
            {r.text}
            {r.doi && (
              <>
                {" "}<a href={`https://doi.org/${r.doi}`}>doi.org/{r.doi}</a>
              </>
            )}
          </li>
        ))}
      </ol>

      <h2>Images</h2>
      <p className="small muted">
        Species silhouettes: the human and the fruit fly were supplied by the author;{" "}
        {SILHOUETTE_CREDITS.map((c, i) => (
          <span key={c.species}>
            <i>{c.species}</i> by {c.artist} ({c.source}, {c.licence}){i < SILHOUETTE_CREDITS.length - 1 ? "; " : "."}
          </span>
        ))}
      </p>
    </div>
  );
}

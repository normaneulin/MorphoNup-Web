// What each kind of dataset is, in plain words. Sources as in the paper (Section 3.1).
export const REGION_INFO: Record<string, { title: string; what: string; source: string }> = {
  benchmark: {
    title: "Benchmark",
    what:
      "A set built for comparing predictors. Its nucleosomal and linker sequences come from genome-wide nucleosome maps, " +
      "near-copies were removed so that no two sequences share more than 80% of their bases, and both classes have the " +
      "same size.",
    source: "DatasetNup 1, from Guo et al. (2014)",
  },
  "genome-wide": {
    title: "Genome-wide, hg38",
    what:
      "Nucleosome positions from the NucMap database, placed on hg38, the current human reference genome. The linker " +
      "sequences were drawn at random from the same chromosomes, and near-copies were removed.",
    source: "DatasetNup 3, from Zhou et al. (2022)",
  },
  "largest-chromosome": {
    title: "Largest chromosome",
    what:
      "Sequences from along the longest chromosome of the genome, not limited to one kind of region. It is the broadest " +
      "and largest sample of the genome among these datasets.",
    source: "DatasetNup 2, from Amato et al. (2020), using the data of Liu et al. (2013)",
  },
  promoter: {
    title: "Promoters",
    what:
      "A promoter is the stretch of DNA just before the start of a gene, where the cell's machinery attaches to begin " +
      "reading the gene. Nucleosomes in a promoter can block or allow that machinery, so their positions help switch genes " +
      "on and off.",
    source: "DatasetNup 2, from Amato et al. (2020), using the data of Liu et al. (2013)",
  },
  "five-prime-utr": {
    title: "5′ UTRs",
    what:
      "The 5′ untranslated region (5′ UTR) is the first part of a gene's messenger RNA, before the start codon: it is " +
      "copied from the DNA but not made into protein. These sequences come from the DNA of those regions, right where " +
      "genes begin.",
    source: "DatasetNup 2, from Amato et al. (2020), using the data of Liu et al. (2013)",
  },
  "whole-genome": {
    title: "Whole genome",
    what:
      "Sequences from across all the chromosomes of baker's yeast, a small genome of about 12 million base pairs.",
    source: "DatasetNup 2, from Amato et al. (2020), using the data of Liu et al. (2013)",
  },
};

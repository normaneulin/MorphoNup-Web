"""The 12 benchmark datasets as the site shows them: species first, then the part of the genome.

A dataset is *available* when its trained models are in the bundle (scripts/export_bundle.py). The others are still
listed, marked as training, so the page always shows all 12 and says which ones can be used yet.
"""
import json
from pathlib import Path

# (dataset id, species, region)
DATASETS = [
    ("DatasetNup_1/Homo_sapiens", "Homo sapiens", "benchmark"),
    ("DatasetNup_3/Homo_sapiens_hg38", "Homo sapiens", "genome-wide"),
    ("DatasetNup_2/Homo_sapiens/LC", "Homo sapiens", "largest-chromosome"),
    ("DatasetNup_2/Homo_sapiens/PM", "Homo sapiens", "promoter"),
    ("DatasetNup_2/Homo_sapiens/5U", "Homo sapiens", "five-prime-utr"),
    ("DatasetNup_1/Caenorhabditis_elegans", "Caenorhabditis elegans", "benchmark"),
    ("DatasetNup_1/Drosophila_melanogaster", "Drosophila melanogaster", "benchmark"),
    ("DatasetNup_2/Drosophila_melanogaster/LC", "Drosophila melanogaster", "largest-chromosome"),
    ("DatasetNup_2/Drosophila_melanogaster/PM", "Drosophila melanogaster", "promoter"),
    ("DatasetNup_2/Drosophila_melanogaster/5U", "Drosophila melanogaster", "five-prime-utr"),
    ("DatasetNup_2/Saccharomyces_cerevisiae/WG", "Saccharomyces cerevisiae", "whole-genome"),
    ("DatasetNup_2/Saccharomyces_cerevisiae/PM", "Saccharomyces cerevisiae", "promoter"),
]
SPECIES_ORDER = ["Homo sapiens", "Caenorhabditis elegans", "Drosophila melanogaster", "Saccharomyces cerevisiae"]
COMMON_NAME = {"Homo sapiens": "human", "Caenorhabditis elegans": "roundworm",
               "Drosophila melanogaster": "fruit fly", "Saccharomyces cerevisiae": "baker's yeast"}
REGION_NAME = {"benchmark": "Benchmark", "genome-wide": "Genome-wide, hg38", "largest-chromosome": "Largest chromosome",
               "promoter": "Promoters", "five-prime-utr": "5′ UTRs", "whole-genome": "Whole genome"}
NOT_READY = "This dataset is still training. Its models will be added when its 5-fold run finishes."


def slug(dataset_id: str) -> str:
    return dataset_id.replace("/", "-")


def sizes() -> dict:
    """Number of valid sequences per dataset, from the shape-table build report (read from the data, not typed)."""
    path = Path(__file__).resolve().parent / "data" / "shape_tables_report.json"
    if not path.exists():
        return {}
    out = {}
    for d in json.loads(path.read_text())["datasets"]:
        did = "DatasetNup_3/Homo_sapiens_hg38" if d["id"] == "DatasetNup_3" else d["id"]
        out[did] = d["sequences"]
    return out

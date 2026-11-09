import { SPECIES_SILHOUETTE } from "../assets/species";

// The worm and the yeast are drawn a little smaller than the human and the fly.
const SCALE: Record<string, number> = { "Caenorhabditis elegans": 0.8, "Saccharomyces cerevisiae": 0.7 };

// Silhouettes of the four species in the theme's text colour (light and dark mode). Anatomical details are cut out in
// the page colour: the fly's own (wings, eye, segments) and, computed by scripts/import_species.py, a faint gut line and
// pharynx bulb in the worm and the yeast's cell wall, nucleus, vacuole and bud scars.
// Sources: design/species/CREDITS.md and the About page.
export function Silhouette({ species }: { species: string }) {
  const s = SPECIES_SILHOUETTE[species];
  if (!s) return null;
  const scale = SCALE[species] ?? 1;
  const [x0, y0, w, h] = s.viewBox.split(/[\s,]+/).map(Number);
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  return (
    <svg viewBox={s.viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true" className="silhouette">
      <g transform={`translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})`}>
        <g transform={s.transform || undefined} fill="currentColor" stroke="none">
          {s.paths.map((p, i) => <path key={i} d={p.d} fillRule={p.rule === "evenodd" ? "evenodd" : undefined} />)}
        </g>
        {s.details.map((d, i) => (
          <path key={i} d={d.d} className={`sil-detail-${d.kind}`} strokeWidth={d.w} />
        ))}
      </g>
    </svg>
  );
}

export const SPECIES_NOTE: Record<string, string> = {
  "Homo sapiens": "Human",
  "Caenorhabditis elegans": "Roundworm, about 1 mm long",
  "Drosophila melanogaster": "Fruit fly",
  "Saccharomyces cerevisiae": "Baker's yeast, a single-celled fungus",
};

export const SILHOUETTE_CREDITS: { species: string; artist: string; source: string; licence: string }[] = [
  { species: "Caenorhabditis elegans", artist: "Arcadia Science", source: "PhyloPic", licence: "CC0" },
  { species: "Saccharomyces cerevisiae", artist: "Jon Laurent", source: "PhyloPic", licence: "CC0" },
];

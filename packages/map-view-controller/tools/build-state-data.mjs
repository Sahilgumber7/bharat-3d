#!/usr/bin/env node
/**
 * Build per-state district geometry for every Indian state and UT.
 *
 * Source: DataMeet `maps` — Census 2011 district boundaries.
 * Output: data/states/<slug>.js — one ES module per state, plus data/states/index.js
 *
 * ES modules rather than JSON so consumers can `import` a state in any
 * environment — bundler, plain <script type="module">, or CDN — with no import
 * assertions and no fetch path to configure. The registry exposes a static
 * `loaders` map so bundlers can code-split each state on its own.
 *
 * Each district is emitted as an SVG path string in a per-state pixel space,
 * matching the shape the existing Bihar map already consumes (`"M x y L x y … Z"`,
 * 1000 units wide). A MultiPolygon becomes several `M…Z` subpaths in one string.
 *
 *   node tools/build-state-data.mjs [--src <path-or-url>] [--tolerance 0.55]
 *
 * Re-run this rather than hand-editing anything under data/.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DEFAULT =
  'https://raw.githubusercontent.com/datameet/maps/master/docs/data/geojson/dists11.geojson';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'data', 'states');

/** Canvas width every state is scaled to; height follows the state's aspect. */
const VIEW_W = 1000;

/**
 * Census 2011 spells some states differently from current usage, and a few
 * UTs have since been renamed or merged. Normalise the display name only —
 * the underlying boundaries are left exactly as published.
 */
const NAME_FIXES = {
  'Andaman & Nicobar Island': 'Andaman & Nicobar Islands',
  'Arunanchal Pradesh': 'Arunachal Pradesh',
  'Dadara & Nagar Havelli': 'Dadra & Nagar Haveli',
  'NCT of Delhi': 'Delhi',
};

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/* ------------------------------------------------------------------ *
 * Geometry helpers
 * ------------------------------------------------------------------ */

/** Perpendicular distance from p to the segment a–b. */
function segDistance(p, a, b) {
  let [x, y] = a;
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx || dy) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) [x, y] = b;
    else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Ramer–Douglas–Peucker, iterative so deep rings can't blow the stack. */
function simplify(points, tolerance) {
  if (points.length < 3) return points.slice();
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];

  while (stack.length) {
    const [lo, hi] = stack.pop();
    let maxD = -1;
    let idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = segDistance(points[i], points[lo], points[hi]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([lo, idx], [idx, hi]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Signed area × 2 — used to drop slivers and to find each district's largest ring. */
function ringArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return Math.abs(a) / 2;
}

/** All outer rings of a Polygon / MultiPolygon, in lon/lat. Holes are dropped. */
function outerRings(geom) {
  if (geom.type === 'Polygon') return [geom.coordinates[0]];
  if (geom.type === 'MultiPolygon') return geom.coordinates.map((poly) => poly[0]);
  return [];
}

/* ------------------------------------------------------------------ *
 * Build
 * ------------------------------------------------------------------ */

async function loadSource(src) {
  if (/^https?:/.test(src)) {
    process.stderr.write(`fetching ${src}\n`);
    const res = await fetch(src);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${src}`);
    return res.json();
  }
  return JSON.parse(await fs.readFile(src, 'utf8'));
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (flag, dflt) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : dflt;
  };
  const src = arg('--src', SRC_DEFAULT);
  const tolerance = Number(arg('--tolerance', '0.55'));

  const geo = await loadSource(src);

  // Group districts by state.
  const byState = new Map();
  for (const f of geo.features) {
    const raw = f.properties.ST_NM;
    if (!raw) continue;
    const state = NAME_FIXES[raw] || raw;
    if (!byState.has(state)) byState.set(state, []);
    byState.get(state).push(f);
  }

  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  const index = [];

  for (const [stateName, features] of [...byState].sort((a, b) => a[0].localeCompare(b[0]))) {
    // State bbox in lon/lat, over every ring of every district.
    let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
    for (const f of features) {
      for (const ring of outerRings(f.geometry)) {
        for (const [lon, lat] of ring) {
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
      }
    }

    // Equirectangular about the state's centre. Longitude degrees shrink by
    // cos(latitude), so applying that keeps the state's aspect ratio true.
    const lat0 = (minLat + maxLat) / 2;
    const kx = Math.cos((lat0 * Math.PI) / 180);
    const spanX = (maxLon - minLon) * kx;
    const spanY = maxLat - minLat;
    const scale = VIEW_W / spanX;
    const viewH = +(spanY * scale).toFixed(1);

    // SVG y grows downward, so flip latitude to keep north at the top.
    const project = ([lon, lat]) => [
      (lon - minLon) * kx * scale,
      (maxLat - lat) * scale,
    ];

    const districts = [];
    for (const f of features.sort((a, b) =>
      a.properties.DISTRICT.localeCompare(b.properties.DISTRICT)
    )) {
      const rings = outerRings(f.geometry)
        .map((ring) => {
          const pts = ring.map(project);
          // Ring is closed in the source; drop the repeat before simplifying.
          if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) {
            pts.pop();
          }
          return simplify(pts, tolerance);
        })
        // A simplified sliver can collapse below 3 points, or to ~zero area.
        .filter((pts) => pts.length >= 3 && ringArea(pts) > 0.5)
        .sort((a, b) => ringArea(b) - ringArea(a));

      if (!rings.length) {
        process.stderr.write(`  ! dropped ${stateName} / ${f.properties.DISTRICT} (no ring survived)\n`);
        continue;
      }

      const d = rings
        .map((pts) => 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') + 'Z')
        .join('');

      // Centroid of the largest ring — the label anchor, not the bbox centre.
      const main = rings[0];
      const cx = main.reduce((s, p) => s + p[0], 0) / main.length;
      const cy = main.reduce((s, p) => s + p[1], 0) / main.length;

      districts.push({
        name: f.properties.DISTRICT,
        path: d,
        centroid: [+cx.toFixed(1), +cy.toFixed(1)],
        parts: rings.length,
      });
    }

    const slug = slugify(stateName);
    const doc = {
      name: stateName,
      slug,
      source: 'DataMeet maps — Census 2011 district boundaries',
      viewBox: [VIEW_W, viewH],
      bbox: [minLon, minLat, maxLon, maxLat].map((v) => +v.toFixed(5)),
      districtCount: districts.length,
      districts,
    };

    const file = `${slug}.js`;
    await fs.writeFile(
      path.join(OUT_DIR, file),
      `// Generated by tools/build-state-data.mjs — do not edit.\nexport default ${JSON.stringify(doc)};\n`
    );
    const bytes = (await fs.stat(path.join(OUT_DIR, file))).size;

    index.push({ name: stateName, slug, file, districtCount: districts.length, viewBox: doc.viewBox });
    process.stderr.write(
      `  ${stateName.padEnd(28)} ${String(districts.length).padStart(3)} districts  ${String(Math.round(bytes / 1024)).padStart(4)} KB\n`
    );
  }

  // Registry module. `loaders` is a static object literal so every bundler can
  // see the import sites and split each state into its own chunk.
  const registry = `// Generated by tools/build-state-data.mjs — do not edit.

/** Every Indian state and UT in this data pack, alphabetical. */
export const STATES = ${JSON.stringify(index, null, 2)};

export const SOURCE = ${JSON.stringify('DataMeet maps — Census 2011 district boundaries')};
export const STATE_COUNT = ${index.length};
export const DISTRICT_COUNT = ${index.reduce((s, e) => s + e.districtCount, 0)};

/** slug -> () => Promise<{ default: StateData }> */
export const loaders = {
${index.map((e) => `  ${JSON.stringify(e.slug)}: () => import('./${e.slug}.js'),`).join('\n')}
};

/** Look up a state's registry entry by slug. */
export const findState = (slug) => STATES.find((s) => s.slug === slug);

/**
 * Load one state's geometry.
 * @param {string} slug
 * @returns {Promise<object>} the state data document
 */
export async function loadStateData(slug) {
  const load = loaders[slug];
  if (!load) {
    throw new Error(
      \`[state-maps] Unknown state "\${slug}". Known slugs: \${Object.keys(loaders).join(', ')}\`
    );
  }
  return (await load()).default;
}
`;
  await fs.writeFile(path.join(OUT_DIR, 'index.js'), registry);

  process.stderr.write(
    `\n${index.length} states/UTs, ${index.reduce((s, e) => s + e.districtCount, 0)} districts -> ${path.relative(process.cwd(), OUT_DIR)}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Build per-state district geometry for every Indian state and UT.
 *
 * Source: bharatlas.com LGD district snapshot — Local Government Directory,
 * 2024, 785 districts across 36 states/UTs (includes Telangana and Ladakh).
 * Falls back to reading DataMeet's older Census-2011 schema too, so an older
 * --src still works.
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
  'https://pub-0429b8e3b5a946e69ea007df844a6f1c.r2.dev/admin/districts/LGD_Districts.geojson';
const SUBSRC_DEFAULT =
  'https://pub-0429b8e3b5a946e69ea007df844a6f1c.r2.dev/admin/subdistricts/LGD_Subdistricts.geojson';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'data', 'states');

/** Canvas width every state is scaled to; height follows the state's aspect. */
const VIEW_W = 1000;

/**
 * The LGD source spells state/UT names in caps and merges some UTs
 * differently from current usage. Normalise the display name only — the
 * underlying boundaries are left exactly as published.
 */
const NAME_FIXES = {
  // Keys are post-titleCase (readNames title-cases the LGD source before
  // this lookup runs).
  'Andaman & Nicobar': 'Andaman & Nicobar Islands',
  'Dadra,Nagar Haveli,Daman & Diu': 'Dadra & Nagar Haveli and Daman & Diu',
  'NCT of Delhi': 'Delhi',
  // Older Census-2011 (DataMeet) schema, kept so --src can still point at it.
  'Andaman & Nicobar Island': 'Andaman & Nicobar Islands',
  'Arunanchal Pradesh': 'Arunachal Pradesh',
  'Dadara & Nagar Havelli': 'Dadra & Nagar Haveli',
};

const titleCase = (s) =>
  s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bOf\b/g, 'of');

/** Read a district feature's state/district names across known source schemas. */
function readNames(props) {
  if (props.stname != null) return { state: titleCase(props.stname), district: props.dtname };
  return { state: props.ST_NM, district: props.DISTRICT };
}

/** LGD join code for a district feature, or null on schemas that don't have one. */
function readDistLgd(props) {
  return props.dist_lgd ?? null;
}

/** A sub-district feature's own name and its parent district's LGD code. */
function readSubdistrict(props) {
  return { name: titleCase(props.sdtname), distLgd: props.dist_lgd ?? null };
}

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

/**
 * Project, simplify and pack one feature's geometry into the shared
 * `{ name, path, centroid, parts }` shape used for both districts and
 * sub-districts.
 */
function buildShape(name, geometry, project, tolerance) {
  const rings = outerRings(geometry)
    .map((ring) => {
      const pts = ring.map(project);
      if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) {
        pts.pop();
      }
      return simplify(pts, tolerance);
    })
    // A simplified sliver can collapse below 3 points, or to ~zero area.
    .filter((pts) => pts.length >= 3 && ringArea(pts) > 0.5)
    .sort((a, b) => ringArea(b) - ringArea(a));

  if (!rings.length) return null;

  const d = rings
    .map((pts) => 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') + 'Z')
    .join('');

  // Centroid of the largest ring — the label anchor, not the bbox centre.
  const main = rings[0];
  const cx = main.reduce((s, p) => s + p[0], 0) / main.length;
  const cy = main.reduce((s, p) => s + p[1], 0) / main.length;

  return {
    name,
    path: d,
    centroid: [+cx.toFixed(1), +cy.toFixed(1)],
    parts: rings.length,
  };
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
  const subsrc = args.includes('--no-subdistricts') ? null : arg('--subsrc', SUBSRC_DEFAULT);
  const tolerance = Number(arg('--tolerance', '0.55'));
  const subTolerance = Number(arg('--sub-tolerance', String(tolerance)));

  const geo = await loadSource(src);
  const SOURCE_LABEL =
    geo.features[0]?.properties.stname != null
      ? 'bharatlas.com — LGD district snapshot, 2024'
      : 'DataMeet maps — Census 2011 district boundaries';

  // Sub-districts, grouped by their parent district's LGD code. Only the new
  // LGD source carries that code, so an old-schema --src just gets none.
  const subByDistLgd = new Map();
  if (subsrc) {
    const subGeo = await loadSource(subsrc);
    for (const f of subGeo.features) {
      const { name, distLgd } = readSubdistrict(f.properties);
      if (distLgd == null || !name) continue;
      if (!subByDistLgd.has(distLgd)) subByDistLgd.set(distLgd, []);
      subByDistLgd.get(distLgd).push(f);
    }
  }

  // Group districts by state.
  const byState = new Map();
  for (const f of geo.features) {
    const { state: raw } = readNames(f.properties);
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
    let subDistrictCount = 0;
    for (const f of features.sort((a, b) =>
      readNames(a.properties).district.localeCompare(readNames(b.properties).district)
    )) {
      const { district: districtName } = readNames(f.properties);
      const shape = buildShape(districtName, f.geometry, project, tolerance);
      if (!shape) {
        process.stderr.write(`  ! dropped ${stateName} / ${districtName} (no ring survived)\n`);
        continue;
      }

      const distLgd = readDistLgd(f.properties);
      const subFeatures = distLgd != null ? subByDistLgd.get(distLgd) : null;
      if (subFeatures?.length) {
        const subdistricts = subFeatures
          .map((sf) => buildShape(readSubdistrict(sf.properties).name, sf.geometry, project, subTolerance))
          .filter(Boolean)
          .sort((a, b) => a.name.localeCompare(b.name));
        if (subdistricts.length) {
          shape.subdistricts = subdistricts;
          subDistrictCount += subdistricts.length;
        }
      }

      districts.push(shape);
    }

    const slug = slugify(stateName);
    const doc = {
      name: stateName,
      slug,
      source: SOURCE_LABEL,
      viewBox: [VIEW_W, viewH],
      bbox: [minLon, minLat, maxLon, maxLat].map((v) => +v.toFixed(5)),
      districtCount: districts.length,
      subDistrictCount,
      districts,
    };

    const file = `${slug}.js`;
    await fs.writeFile(
      path.join(OUT_DIR, file),
      `// Generated by tools/build-state-data.mjs — do not edit.\nexport default ${JSON.stringify(doc)};\n`
    );
    const bytes = (await fs.stat(path.join(OUT_DIR, file))).size;

    index.push({
      name: stateName,
      slug,
      file,
      districtCount: districts.length,
      subDistrictCount,
      viewBox: doc.viewBox,
    });
    process.stderr.write(
      `  ${stateName.padEnd(28)} ${String(districts.length).padStart(3)} districts  ${String(subDistrictCount).padStart(4)} sub-districts  ${String(Math.round(bytes / 1024)).padStart(5)} KB\n`
    );
  }

  // Registry module. `loaders` is a static object literal so every bundler can
  // see the import sites and split each state into its own chunk.
  const registry = `// Generated by tools/build-state-data.mjs — do not edit.

/** Every Indian state and UT in this data pack, alphabetical. */
export const STATES = ${JSON.stringify(index, null, 2)};

export const SOURCE = ${JSON.stringify(SOURCE_LABEL)};
export const STATE_COUNT = ${index.length};
export const DISTRICT_COUNT = ${index.reduce((s, e) => s + e.districtCount, 0)};
export const SUB_DISTRICT_COUNT = ${index.reduce((s, e) => s + e.subDistrictCount, 0)};

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
    `\n${index.length} states/UTs, ${index.reduce((s, e) => s + e.districtCount, 0)} districts, ${index.reduce((s, e) => s + e.subDistrictCount, 0)} sub-districts -> ${path.relative(process.cwd(), OUT_DIR)}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`${err.stack}\n`);
  process.exit(1);
});

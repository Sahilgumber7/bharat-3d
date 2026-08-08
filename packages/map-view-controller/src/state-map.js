import * as THREE from 'three';
import { PALETTES, rampStep } from './palettes.js';

/**
 * Turns a `data/states/<slug>.json` document into extruded district meshes and
 * a ready-to-use `stateConfig`.
 *
 * This lives in examples/, not src/ — the library itself stays decoupled from
 * any geometry format. Swap this file out for your own loader and
 * MapViewController is unaffected.
 */

/**
 * Parse the SVG path emitted by tools/build-state-data.mjs back into rings.
 * The format is deliberately simple — `M x y L x y … Z`, one subpath per
 * island/part — so this stays a regex rather than a path parser.
 */
export function parsePath(d) {
  const rings = [];
  for (const [, body] of d.matchAll(/M([^Z]*)Z/g)) {
    const pts = [...body.matchAll(/(-?[\d.]+)\s+(-?[\d.]+)/g)].map((m) => [+m[1], +m[2]]);
    if (pts.length >= 3) rings.push(pts);
  }
  return rings;
}

/** Shoelace area of a ring, in squared source units. */
export function ringArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return Math.abs(a) / 2;
}

/**
 * @param {object} data  a parsed state JSON document
 * @param {object} [opts]
 *   @param {number} [opts.span=240]       world size of the state's longest axis
 *   @param {number} [opts.thickness=4.5]  base extrusion depth — keep this small
 *                                         relative to `span` or districts read as
 *                                         chunky blocks instead of flat pieces
 *   @param {number} [opts.relief=0.35]    0 = every piece identical thickness,
 *                                         1 = ±100% swing by district area
 *   @param {number} [opts.gap=0.01]       fraction each piece shrinks toward its
 *                                         own centre, cutting a visible seam
 *                                         between neighbours. 0 = flush.
 *   @param {string[]} [opts.ramp]      sequential ramp, light->dark; districts are
 *                                      quantised onto it by area
 * @returns {{ group, districts, stateConfig, recolor, dispose }}
 */
export function buildStateMap(data, opts = {}) {
  const { span = 240, thickness = 4.5, relief = 0.35, gap = 0.01 } = opts;
  const ramp = opts.ramp || PALETTES[0].ramp;
  const [vw, vh] = data.viewBox;

  // Source space is SVG-like: x east, y *south*. Map to a Y-up world with the
  // state centred on the origin — y stays as z, so north lands on -z, which is
  // what MapViewController's default frame expects.
  const scale = span / Math.max(vw, vh);
  const toWorld = ([x, y]) => [(x - vw / 2) * scale, (y - vh / 2) * scale];

  const parsed = data.districts.map((d) => {
    let rings = parsePath(d.path).map((r) => r.map(toWorld));

    // Shrink each district very slightly toward its own centre so neighbours
    // don't share an edge. Scaling about the centroid rather than true polygon
    // offsetting keeps this robust on concave and multi-part districts — the
    // seam width varies a little, which at these gaps reads as a hand-cut
    // jigsaw rather than an error.
    if (gap > 0) {
      const all = rings.flat();
      const cx = all.reduce((s, p) => s + p[0], 0) / all.length;
      const cy = all.reduce((s, p) => s + p[1], 0) / all.length;
      const k = 1 - gap;
      rings = rings.map((r) => r.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]));
    }

    return { name: d.name, rings, area: rings.reduce((s, r) => s + ringArea(r), 0) };
  });
  const maxArea = Math.max(...parsed.map((d) => d.area), 1);

  const group = new THREE.Group();
  const districts = [];

  parsed.forEach((d, i) => {
    // Thickness stays close to `thickness` for every piece — `relief` only
    // nudges it by area, so the map reads as a set of tiles rather than a bar
    // chart. sqrt compresses the range so one huge district doesn't dominate.
    // `t` drives both thickness and fill, so relief and colour agree.
    const t = Math.sqrt(d.area / maxArea);
    const depth = thickness * (1 + relief * (t - 0.5) * 2);

    // A district with islands (Andaman, Lakshadweep, coastal Gujarat) becomes
    // several shapes in one geometry rather than several meshes, so it explodes
    // and clips as a single unit.
    const shapes = d.rings.map((ring) => {
      const s = new THREE.Shape();
      ring.forEach(([x, y], k) => (k ? s.lineTo(x, y) : s.moveTo(x, y)));
      return s;
    });

    const geom = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false });
    geom.rotateX(-Math.PI / 2); // lay the XY shape onto the XZ ground plane

    const mesh = new THREE.Mesh(
      geom,
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(rampStep(ramp, t)),
        roughness: 0.7,
        metalness: 0.05,
        side: THREE.DoubleSide, // keeps the cross-section cut readable
      })
    );
    mesh.name = d.name;
    mesh.userData.t = t;   // kept so recolor() can re-step without rebuilding
    group.add(mesh);
    districts.push({ name: d.name, mesh, t });
  });

  const box = new THREE.Box3().setFromObject(group);

  const stateConfig = {
    name: data.name,
    bounds: { min: box.min, max: box.max },
    centroid: box.getCenter(new THREE.Vector3()),
    districts,
  };

  /** Re-step every district onto a new ramp. Geometry is untouched. */
  const recolor = (nextRamp) => {
    for (const { mesh } of districts) {
      mesh.material.color.set(rampStep(nextRamp, mesh.userData.t));
    }
  };

  const dispose = () => {
    for (const { mesh } of districts) {
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    group.clear();
  };

  return { group, districts, stateConfig, recolor, dispose };
}

export default buildStateMap;

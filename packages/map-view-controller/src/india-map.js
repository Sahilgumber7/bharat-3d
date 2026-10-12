import * as THREE from 'three';
import { parsePath } from './state-map.js';
import { PALETTES } from './palettes.js';

/**
 * Build the "India overview" — every state's districts reprojected onto one
 * shared real-geography canvas and flattened into a single merged extrusion
 * per state. Every district in a state renders the same flat colour, so one
 * merged mesh per state (rather than one per district) avoids noisy interior
 * seams along every district boundary.
 *
 * Each entry's `doc` needs the shape `@bharat3d/state-maps/data` ships:
 * `bbox` ([minLon,minLat,maxLon,maxLat]), `viewBox` ([vw,vh]), and
 * `districts: [{ path }]`.
 *
 * East maps to increasing world X, and geographic north to world -Z — the
 * same convention `buildStateMap()` uses, so both the isometric pose below
 * and MapViewController's generic presets (topDown/firstPerson/exploded)
 * read correctly against this geometry.
 *
 * @param {Array<{slug: string, name: string, doc: object}>} entries
 * @param {object} [opts]
 *   @param {number} [opts.span=320]    world size of the map's longest axis
 *   @param {number} [opts.depth=8]     extrusion depth
 *   @param {string[]} [opts.ramp]      sequential ramp; states are coloured by index
 * @returns {{
 *   group: THREE.Group,
 *   states: Array<{slug, name, group: THREE.Group, mesh: THREE.Mesh}>,
 *   box: THREE.Box3,
 *   north: THREE.Vector3,
 *   depth: number,
 *   lonLatToWorld(lon: number, lat: number, height?: number): THREE.Vector3,
 *   recolor(ramp: string[]): void,
 *   dispose(): void,
 * }}
 */
export function buildIndiaMap(entries, opts = {}) {
  const { span: NATIONAL_SPAN = 320, depth = 8 } = opts;
  const ramp = opts.ramp || PALETTES[0].ramp;

  const perState = entries.map(({ slug, name, doc }) => {
    const [vw] = doc.viewBox;
    const [minLon, minLat, maxLon, maxLat] = doc.bbox;
    const lat0 = (minLat + maxLat) / 2;
    const kx = Math.cos((lat0 * Math.PI) / 180);
    const scale = vw / ((maxLon - minLon) * kx);
    const toLonLat = ([x, y]) => [minLon + x / scale / kx, maxLat - y / scale];
    return {
      slug,
      name,
      districts: doc.districts.map((d) => ({
        rings: parsePath(d.path).map((ring) => ring.map(toLonLat)),
      })),
    };
  });

  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const s of perState) {
    for (const d of s.districts) {
      for (const ring of d.rings) {
        for (const [lon, lat] of ring) {
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
      }
    }
  }

  const lat0 = (minLat + maxLat) / 2;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const scale = NATIONAL_SPAN / ((maxLon - minLon) * kx);
  const viewH = (maxLat - minLat) * scale;

  const project = ([lon, lat]) => [
    (lon - minLon) * kx * scale - NATIONAL_SPAN / 2,
    -((maxLat - lat) * scale - viewH / 2),
  ];

  const group = new THREE.Group();
  const states = [];

  perState.forEach((s, i) => {
    const color = new THREE.Color(ramp[i % ramp.length]);
    const shapes = s.districts.flatMap((d) =>
      d.rings.map((ring) => {
        const pts = ring.map(project);
        const sh = new THREE.Shape();
        pts.forEach(([x, y], k) => (k ? sh.lineTo(x, y) : sh.moveTo(x, y)));
        return sh;
      })
    );
    const geom = new THREE.ExtrudeGeometry(shapes, { depth, bevelEnabled: false });
    geom.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(
      geom,
      new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.04, side: THREE.DoubleSide })
    );
    mesh.userData.isState = true;
    mesh.userData.stateSlug = s.slug;
    mesh.name = s.name;
    const stateGroup = new THREE.Group();
    stateGroup.add(mesh);
    group.add(stateGroup);
    states.push({ slug: s.slug, name: s.name, group: stateGroup, mesh });
  });

  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);

  const recolor = (nextRamp) => {
    states.forEach((s, i) => s.mesh.material.color.set(nextRamp[i % nextRamp.length]));
  };

  const dispose = () => {
    for (const s of states) {
      s.mesh.geometry.dispose();
      s.mesh.material.dispose();
    }
  };

  // Real lon/lat -> world position on the shared canvas (y = height above the
  // ground plane). Lets callers pin hubs, routes and labels to real places.
  const lonLatToWorld = (lon, lat, height = 0) => {
    const [x, y] = project([lon, lat]);
    return new THREE.Vector3(x, height, -y);
  };

  return { group, states, box, north: new THREE.Vector3(0, 0, -1), depth, lonLatToWorld, recolor, dispose };
}

export default buildIndiaMap;

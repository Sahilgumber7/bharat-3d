import * as THREE from 'three';
import { rampStep } from './palettes.js';

/**
 * Data overlays for the national map: bring your own numbers and draw them on
 * the geography — a per-state choropleth with optional relief, point markers
 * (hubs, warehouses, stores) and weighted arcs (routes, flows).
 *
 * Everything is keyed by real lon/lat or state slug, so it works with any
 * dataset. Nothing here knows about any particular business.
 */

/** Normalise `values` ({slug: number}) to 0–1 over `domain` (default: data min/max). */
export function normalise(values, domain) {
  const nums = Object.values(values).filter((v) => Number.isFinite(v));
  const lo = domain?.[0] ?? Math.min(...nums);
  const hi = domain?.[1] ?? Math.max(...nums);
  const span = hi - lo || 1;
  const out = {};
  for (const [k, v] of Object.entries(values)) out[k] = Number.isFinite(v) ? (v - lo) / span : null;
  return { t: out, domain: [lo, hi] };
}

export function createOverlays({ scene, built, getPalette }) {
  const layer = new THREE.Group();
  layer.name = 'overlays';
  scene.add(layer);

  let valueState = null;
  // Raised states grow up to depth * (1 + relief); keep markers and arcs above that.
  const floor = () => built.depth * (1 + (valueState?.relief || 0));
  const disposables = [];

  /**
   * Colour states by value; optionally raise them in proportion.
   * States missing from `values` keep a neutral, de-emphasised fill.
   */
  function setValues(values, { domain, relief = 0, ramp } = {}) {
    const { t, domain: d } = normalise(values, domain);
    const palette = getPalette();
    const r = ramp || palette.ramp;
    valueState = { values, domain: d, relief, ramp: r };
    for (const s of built.states) {
      const tv = t[s.slug];
      if (tv == null) {
        s.mesh.material.color.set(palette.surface).lerp(new THREE.Color(r[0]), 0.35);
        s.mesh.scale.y = 1;
      } else {
        s.mesh.material.color.set(rampStep(r, tv));
        // Relief grows the extrusion upward from the ground plane.
        s.mesh.scale.y = 1 + relief * tv;
      }
    }
    return { domain: d, ramp: r };
  }

  function clearValues() {
    valueState = null;
    for (const s of built.states) s.mesh.scale.y = 1;
    built.recolor(getPalette().ramp);
  }

  /** Markers: `[{ lon, lat, value?, color?, label? }]`. Size follows value. */
  function addPoints(points, { color = '#ffb020', size = 1.6, height = 1 } = {}) {
    const max = Math.max(...points.map((p) => p.value ?? 1), 1);
    const group = new THREE.Group();
    const placed = [];
    for (const p of points) {
      const r = size * (0.6 + 0.9 * Math.sqrt((p.value ?? 1) / max));
      const geom = new THREE.CylinderGeometry(r, r, 2.4, 20);
      const mat = new THREE.MeshStandardMaterial({
        color: p.color || color,
        emissive: p.color || color,
        emissiveIntensity: 0.35,
        roughness: 0.4,
      });
      const m = new THREE.Mesh(geom, mat);
      m.position.copy(built.lonLatToWorld(p.lon, p.lat, floor() + height + 1.2));
      m.userData.point = p;
      group.add(m);
      placed.push(m);
      disposables.push(geom, mat);
    }
    layer.add(group);
    return { group, meshes: placed };
  }

  /** Arcs: `[{ from:[lon,lat], to:[lon,lat], weight?, color? }]`. Width follows weight. */
  function addArcs(arcs, { color = '#ffb020', lift = 0.22, segments = 48, opacity = 0.75 } = {}) {
    const maxW = Math.max(...arcs.map((a) => a.weight ?? 1), 1);
    const group = new THREE.Group();
    const h0 = floor() + 2;
    for (const a of arcs) {
      const p0 = built.lonLatToWorld(a.from[0], a.from[1], h0);
      const p1 = built.lonLatToWorld(a.to[0], a.to[1], h0);
      const mid = p0.clone().add(p1).multiplyScalar(0.5);
      mid.y += p0.distanceTo(p1) * lift + 4;
      const curve = new THREE.QuadraticBezierCurve3(p0, mid, p1);
      const w = 0.18 + 0.9 * Math.sqrt((a.weight ?? 1) / maxW);
      const geom = new THREE.TubeGeometry(curve, segments, w * 0.5, 6, false);
      const mat = new THREE.MeshBasicMaterial({ color: a.color || color, transparent: true, opacity });
      const m = new THREE.Mesh(geom, mat);
      m.userData.arc = a;
      group.add(m);
      disposables.push(geom, mat);
    }
    layer.add(group);
    return { group };
  }

  function clear() {
    for (const c of [...layer.children]) layer.remove(c);
    for (const d of disposables.splice(0)) d.dispose();
  }

  /** Re-apply the choropleth after a palette change. */
  function refresh() {
    if (valueState) setValues(valueState.values, valueState);
  }

  return {
    layer,
    setValues,
    clearValues,
    addPoints,
    addArcs,
    clear,
    refresh,
    get legend() {
      return valueState && { domain: valueState.domain, ramp: valueState.ramp };
    },
    dispose() {
      clear();
      scene.remove(layer);
    },
  };
}

import * as THREE from 'three';
import outline from '../../data/india-outline.js';

export const SPAN = 320;
export const DEPTH = 2.4;

/**
 * Build the country from the lightweight national outline: one extruded mesh
 * per state, fine district-boundary lines on top, and a lon/lat -> world
 * projection shared with hubs and lanes. North is -Z, east is +X.
 */
export function buildGeo() {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const s of outline) {
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
  const kx = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const scale = SPAN / ((maxLon - minLon) * kx);
  const viewH = (maxLat - minLat) * scale;
  const px = (lon) => (lon - minLon) * kx * scale - SPAN / 2;
  const pz = (lat) => (maxLat - lat) * scale - viewH / 2;
  const lonLat = (lon, lat, h = 0) => new THREE.Vector3(px(lon), h, pz(lat));

  const group = new THREE.Group();
  const states = [];

  for (const s of outline) {
    const shapes = [];
    const segs = [];
    let sx = 0, sz = 0, n = 0;
    let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (const d of s.districts) {
      for (const ring of d.rings) {
        const sh = new THREE.Shape();
        ring.forEach(([lon, lat], k) => {
          const x = px(lon);
          const z = pz(lat);
          // Shape y = -z so that rotateX(-90°) lands geographic north on -Z.
          if (k) sh.lineTo(x, -z);
          else sh.moveTo(x, -z);
          sx += x; sz += z; n++;
          bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z);
          if (k) {
            const [plon, plat] = ring[k - 1];
            segs.push(px(plon), 0, pz(plat), x, 0, z);
          }
        });
        shapes.push(sh);
      }
    }
    const geom = new THREE.ExtrudeGeometry(shapes, { depth: DEPTH, bevelEnabled: false });
    geom.rotateX(-Math.PI / 2);

    const mat = new THREE.MeshStandardMaterial({
      color: 0x0d1115,
      roughness: 0.78,
      metalness: 0.2,
      emissive: 0x000000,
      emissiveIntensity: 1,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.userData.slug = s.slug;

    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(segs, 3));
    const lmat = new THREE.LineBasicMaterial({ color: 0x6fdad2, transparent: true, opacity: 0.1, depthWrite: false });
    const lines = new THREE.LineSegments(lg, lmat);
    lines.position.y = DEPTH + 0.02;
    lines.raycast = () => {};

    const g = new THREE.Group();
    g.add(mesh, lines);
    group.add(g);
    states.push({
      slug: s.slug,
      name: s.name,
      group: g,
      mesh,
      lines,
      centroid: new THREE.Vector3(sx / n, 0, sz / n),
      bounds: { x0: bx0, x1: bx1, z0: bz0, z1: bz1 },
      // smoothed visual state
      cur: { h: 0.001, glow: 0, hover: 0, sel: 0 },
    });
  }

  const box = new THREE.Box3().setFromObject(group);
  return { group, states, box, lonLat, bySlug: Object.fromEntries(states.map((s) => [s.slug, s])), dispose() {
    for (const s of states) { s.mesh.geometry.dispose(); s.mesh.material.dispose(); s.lines.geometry.dispose(); s.lines.material.dispose(); }
  } };
}

import * as THREE from 'three';
import { toVec } from './geometry.js';

/**
 * Offsets named district/region meshes outward from the state centroid.
 *
 * Direction resolution, in priority order:
 *   1. `district.offsetDir` — an explicit vector. Use this for archipelago
 *      states (Andaman & Nicobar, Lakshadweep) where "outward from centroid"
 *      produces a useless fan.
 *   2. The mesh's own centre minus the state centroid, flattened onto the
 *      horizontal plane so districts spread sideways, not upward.
 *   3. A deterministic radial fallback by index, for meshes that sit exactly
 *      on the centroid and would otherwise have a zero-length direction.
 */
export class Exploder {
  /**
   * @param {object} frame  result of computeFrame()
   * @param {Array}  districts  stateConfig.districts
   * @param {object} opts  { factor?: number, scene?: THREE.Scene }
   */
  constructor(frame, districts = [], opts = {}) {
    this.frame = frame;
    this.factor = opts.factor ?? 0.45;
    this.amount = 0;
    this.entries = [];

    const total = districts.length || 1;
    const boxScratch = new THREE.Box3();
    const centreScratch = new THREE.Vector3();

    districts.forEach((d, i) => {
      const mesh = resolveMesh(d.mesh, opts.scene);
      if (!mesh) return;

      let dir;
      if (d.offsetDir) {
        dir = toVec(d.offsetDir, 'district.offsetDir');
      } else {
        boxScratch.setFromObject(mesh);
        boxScratch.getCenter(centreScratch);
        dir = centreScratch.clone().sub(frame.centroid);
        // Flatten to horizontal so districts fan out rather than lift off.
        dir.addScaledVector(frame.up, -dir.dot(frame.up));
      }

      if (dir.lengthSq() < 1e-8) {
        const a = (i / total) * Math.PI * 2;
        dir = frame.east
          .clone()
          .multiplyScalar(Math.cos(a))
          .addScaledVector(frame.north, Math.sin(a));
      }
      dir.normalize();

      this.entries.push({
        name: d.name,
        mesh,
        dir,
        distance: d.offsetDistance ?? frame.span * this.factor,
        base: mesh.position.clone(),
      });
    });
  }

  /** Apply an explode amount in [0,1]. 0 restores the recorded base positions. */
  setAmount(amount) {
    this.amount = amount;
    for (const e of this.entries) {
      e.mesh.position.copy(e.base).addScaledVector(e.dir, e.distance * amount);
    }
  }

  /** Re-record base positions — call if the host app moves meshes itself. */
  syncBase() {
    for (const e of this.entries) {
      e.base.copy(e.mesh.position).addScaledVector(e.dir, -e.distance * this.amount);
    }
  }

  /** Snap everything back and forget the meshes. */
  destroy() {
    this.setAmount(0);
    this.entries.length = 0;
  }
}

function resolveMesh(mesh, scene) {
  if (!mesh) return null;
  if (typeof mesh === 'string') return scene ? scene.getObjectByName(mesh) : null;
  return mesh;
}

export default Exploder;

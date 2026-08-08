import * as THREE from 'three';
import { fromFrame, fitBox } from './geometry.js';
import ICONS from './icons.js';

/**
 * The six default view presets.
 *
 * A preset's `compute(ctx)` returns a *camera state* — a plain, interpolatable
 * description of where the camera goes and what else the scene should do.
 * Nothing here references a specific state's geometry; everything is derived
 * from the frame built out of `stateConfig.bounds` / `centroid`.
 *
 * ctx = { frame, camera, aspect, config }
 *
 * Returned camera state:
 *   position  THREE.Vector3   world position
 *   target    THREE.Vector3   look-at point
 *   up        THREE.Vector3   camera up vector
 *   fov       number          perspective FOV (ignored for ortho cameras)
 *   zoom      number          ortho zoom (ignored for perspective cameras)
 *   clip      null | { normal: Vector3, constant: number }
 *   explode   number          0 = assembled, 1 = fully exploded
 */

/**
 * Unit iso bearing, in frame-relative (east, north, up) components: equal
 * horizontal parts, raised to a high elevation. Scaling it by a fitted
 * distance lands the camera exactly that far from the look-at point.
 */
const ISO_DIR = [Math.SQRT1_2 * 0.82, -Math.SQRT1_2 * 0.82, 0.62];

/** Map frame-relative (east, north, up) components into a world unit vector. */
function dirFromFrame(frame, e, n, u) {
  return new THREE.Vector3()
    .addScaledVector(frame.east, e)
    .addScaledVector(frame.north, n)
    .addScaledVector(frame.up, u)
    .normalize();
}

/** Isometric — the default hero angle. */
const isometric = {
  id: 'isometric',
  label: 'Isometric',
  title: 'Isometric view',
  icon: ICONS.isometric,
  compute({ frame, aspect }) {
    const fov = 45;
    const dir = dirFromFrame(frame, ...ISO_DIR);
    const d = fitBox(frame.box, frame.center, dir, frame.up, fov, aspect, 1.05);
    return {
      position: frame.center.clone().addScaledVector(dir, d),
      target: frame.center.clone(),
      up: frame.up.clone(),
      fov,
      zoom: 1,
      clip: null,
      explode: 0,
    };
  },
};

/**
 * Cross-section — a real clipping plane sliced through the state, viewed from
 * slightly above the cut so the exposed interior is readable.
 */
const crossSection = {
  id: 'crossSection',
  label: 'Cross-section',
  title: 'Cross-section (clipped)',
  icon: ICONS.crossSection,
  compute({ frame, aspect, config }) {
    const opts = config.crossSection || {};
    // `normal` is the *viewing* direction — it points from the cut toward the
    // camera. The clipping plane below uses its negation, so the half between
    // the camera and the cut is what gets removed and you see into the section.
    const normal = opts.normal
      ? new THREE.Vector3().copy(opts.normal).normalize()
      : frame.north.clone().negate();
    // Where along the normal the cut sits: 0.5 = straight through the centroid.
    const t = opts.offset ?? 0.5;
    const half =
      Math.abs(frame.depth * normal.dot(frame.north)) / 2 +
      Math.abs(frame.width * normal.dot(frame.east)) / 2;
    const cutPoint = frame.centroid.clone().addScaledVector(normal, (t - 0.5) * 2 * half);
    // Keep the half *away* from the camera: p·(-normal) + cutPoint·normal ≥ 0.
    const clipNormal = normal.clone().negate();
    const constant = cutPoint.dot(normal);

    const fov = 40;
    // Raise the camera as the subject gets flatter. A near-eye-level section is
    // right for a chunky extrusion, but on a thin, tile-like map it puts the cut
    // almost edge-on and the section reads as a sliver. Tilting toward plan view
    // keeps the cut edge legible against the top surface.
    const flatness = frame.height / (frame.span || 1);
    const rise = 0.34 + 0.45 * (1 - Math.min(1, flatness / 0.3));
    const dir = normal.clone().multiplyScalar(0.9).addScaledVector(frame.up, rise).normalize();

    // Frame the half that survives the cut, not the whole state — otherwise the
    // removed half still occupies budget and the remainder sits small and high.
    // Only exact for an axis-aligned cut; an oblique one falls back to the full
    // box, which is merely conservative.
    const kept = frame.box.clone();
    const axis = ['x', 'y', 'z'].find((a) => Math.abs(normal[a]) > 0.999);
    if (axis) {
      if (normal[axis] > 0) kept.max[axis] = Math.min(kept.max[axis], cutPoint[axis]);
      else kept.min[axis] = Math.max(kept.min[axis], cutPoint[axis]);
    }
    const focus = kept.getCenter(new THREE.Vector3());
    const d = fitBox(kept, focus, dir, frame.up, fov, aspect, 1.06);
    return {
      position: focus.clone().addScaledVector(dir, d),
      target: focus,
      up: frame.up.clone(),
      fov,
      zoom: 1,
      clip: { normal: clipNormal, constant },
      explode: 0,
    };
  },
};

/** 2D top-down board view — narrow FOV from high up reads as near-orthographic. */
const topDown = {
  id: 'topDown',
  label: '2D board',
  title: 'Top-down 2D board view',
  icon: ICONS.topDown,
  compute({ frame, aspect }) {
    const fov = 18; // long lens ⇒ minimal perspective distortion
    // Looking straight down, `up` must not be parallel to the view direction.
    const up = frame.north.clone();
    const d = fitBox(frame.box, frame.center, frame.up, up, fov, aspect, 1.04);
    return {
      position: fromFrame(frame, frame.center, { up: d }),
      target: frame.center.clone(),
      up,
      fov,
      zoom: 1,
      clip: null,
      explode: 0,
    };
  },
};

/** Front elevation — orthogonal and dead-on at the state's centre. */
const frontElevation = {
  id: 'frontElevation',
  label: 'Elevation',
  title: 'Front elevation',
  icon: ICONS.frontElevation,
  compute({ frame, aspect }) {
    const fov = 24;
    const dir = frame.north.clone().negate();
    const d = fitBox(frame.box, frame.center, dir, frame.up, fov, aspect, 1.04);
    return {
      position: frame.center.clone().addScaledVector(dir, d),
      target: frame.center.clone(),
      up: frame.up.clone(),
      fov,
      zoom: 1,
      clip: null,
      explode: 0,
    };
  },
};

/** First-person / walkthrough — stands on the terrain and looks across it. */
const firstPerson = {
  id: 'firstPerson',
  label: 'Walkthrough',
  title: 'First-person walkthrough',
  icon: ICONS.firstPerson,
  compute({ frame, config }) {
    const opts = config.firstPerson || {};
    // Eye height defaults to a fraction of the terrain height so it scales with
    // whatever vertical exaggeration the state map uses.
    const eye = opts.eyeHeight ?? Math.max(frame.height * 0.8, frame.span * 0.02);
    const start = opts.start
      ? new THREE.Vector3().copy(opts.start)
      : fromFrame(frame, frame.centroid, { north: -frame.depth * 0.42, up: eye });
    const look = opts.lookAt
      ? new THREE.Vector3().copy(opts.lookAt)
      : fromFrame(frame, frame.centroid, { up: eye * 0.6 });
    return {
      position: start,
      target: look,
      up: frame.up.clone(),
      fov: opts.fov ?? 68,
      zoom: 1,
      clip: null,
      explode: 0,
    };
  },
};

/** Exploded — districts pushed outward from the centroid, viewed from above-ish. */
const exploded = {
  id: 'exploded',
  label: 'Exploded',
  title: 'Exploded district view',
  icon: ICONS.exploded,
  compute({ frame, aspect, config }) {
    const factor = config.explode?.factor ?? 0.45;
    const fov = 45;
    const dir = dirFromFrame(frame, 0.44, -0.5, 0.74);
    // Districts move up to `factor × span` outward, so fit against a grown box
    // rather than the assembled footprint. Grow it *horizontally only* — the
    // offsets are flattened onto the ground plane, and padding the (small)
    // vertical extent would push the camera much further back than needed.
    const spread = frame.span * factor;
    const grown = frame.box.clone().expandByVector(
      new THREE.Vector3(
        Math.abs(frame.east.x) + Math.abs(frame.north.x),
        Math.abs(frame.east.y) + Math.abs(frame.north.y),
        Math.abs(frame.east.z) + Math.abs(frame.north.z)
      ).multiplyScalar(spread)
    );
    const d = fitBox(grown, frame.centroid, dir, frame.up, fov, aspect, 1.02);
    return {
      position: frame.centroid.clone().addScaledVector(dir, d),
      target: frame.centroid.clone(),
      up: frame.up.clone(),
      fov,
      zoom: 1,
      clip: null,
      explode: 1,
    };
  },
};

export const DEFAULT_VIEWS = [
  isometric,
  crossSection,
  topDown,
  frontElevation,
  firstPerson,
  exploded,
];

export default DEFAULT_VIEWS;

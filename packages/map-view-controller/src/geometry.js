import * as THREE from 'three';

/**
 * Turns a `stateConfig` into an axis-aligned reference frame that every camera
 * preset is expressed in. This is what makes the controller state-agnostic:
 * presets are written as multiples of the state's own extents, never as
 * hand-tuned world coordinates.
 *
 * Frame vectors:
 *   up    — the world "up" axis ('y' by default, 'z' for Z-up scenes)
 *   east  — horizontal axis 1 (screen-right in the default top-down view)
 *   north — horizontal axis 2 (screen-up in the default top-down view)
 */
export function computeFrame(stateConfig) {
  const upAxis = (stateConfig.upAxis || 'y').toLowerCase();

  const up = upAxis === 'z' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
  const east = new THREE.Vector3(1, 0, 0);
  const north = upAxis === 'z' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, -1);

  const min = toVec(stateConfig.bounds?.min, 'stateConfig.bounds.min');
  const max = toVec(stateConfig.bounds?.max, 'stateConfig.bounds.max');

  const box = new THREE.Box3(min.clone().min(max), max.clone().max(min));
  const center = box.getCenter(new THREE.Vector3());
  const sizeVec = box.getSize(new THREE.Vector3());

  // Extents measured along the frame's own axes, so Z-up configs behave the same.
  const width = Math.abs(sizeVec.dot(east)) || 1;
  const depth = Math.abs(sizeVec.dot(north)) || 1;
  const height = Math.abs(sizeVec.dot(up)) || 1;

  const centroid = stateConfig.centroid
    ? toVec(stateConfig.centroid, 'stateConfig.centroid')
    : center.clone();

  return {
    upAxis,
    up,
    east,
    north,
    box,
    center,
    centroid,
    width,
    depth,
    height,
    /** Largest horizontal extent — the natural unit for framing distance. */
    span: Math.max(width, depth),
    /** Bounding-sphere radius; used to keep the whole state in frame. */
    radius: box.getBoundingSphere(new THREE.Sphere()).radius || 1,
    /** Ground level (bottom of the bounding box along `up`). */
    floor: box.min.clone().projectOnVector(up).dot(up) || min.clone().dot(up),
  };
}

/**
 * Build a world position from frame-relative offsets.
 * @param {object} frame  result of computeFrame()
 * @param {THREE.Vector3} origin  point to offset from
 * @param {{east?:number, north?:number, up?:number}} o  offsets in world units
 */
export function fromFrame(frame, origin, o = {}) {
  return origin
    .clone()
    .addScaledVector(frame.east, o.east || 0)
    .addScaledVector(frame.north, o.north || 0)
    .addScaledVector(frame.up, o.up || 0);
}

/** Accept `{x,y,z}`, `[x,y,z]` or a THREE.Vector3 and normalise to Vector3. */
export function toVec(v, label = 'vector') {
  if (!v) throw new Error(`[MapViewController] Missing required ${label}`);
  if (v.isVector3) return v.clone();
  if (Array.isArray(v)) return new THREE.Vector3(v[0] || 0, v[1] || 0, v[2] || 0);
  return new THREE.Vector3(v.x || 0, v.y || 0, v.z || 0);
}

/**
 * Distance a perspective camera must sit at to fit `radius` in view,
 * accounting for aspect ratio so wide states are not clipped on narrow canvases.
 *
 * @param {number} radius   bounding radius to fit
 * @param {number} fov      vertical FOV in degrees (the *target* fov, if animating)
 * @param {number} aspect   viewport aspect ratio (width / height)
 * @param {number} padding  >1 leaves margin around the subject
 */
export function fitDistance(radius, fov = 50, aspect = 1, padding = 1.15) {
  const vFov = THREE.MathUtils.degToRad(Math.max(1, fov));
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(0.01, aspect));
  return (radius * padding) / Math.sin(Math.min(vFov, hFov) / 2);
}

/**
 * Distance needed to fit a `w` × `h` rectangle that faces the camera squarely.
 *
 * Preferred over `fitDistance` for the orthogonal views (top-down, elevation):
 * states are flat and wide, so their bounding *sphere* is much larger than what
 * actually appears on screen, and sphere-fitting leaves the map tiny in frame.
 *
 * @param {number} w  rectangle width, in world units, mapped to screen-x
 * @param {number} h  rectangle height, in world units, mapped to screen-y
 */
export function fitRect(w, h, fov = 50, aspect = 1, padding = 1.08) {
  const vFov = THREE.MathUtils.degToRad(Math.max(1, fov));
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(0.01, aspect));
  return Math.max(h / 2 / Math.tan(vFov / 2), w / 2 / Math.tan(hFov / 2)) * padding;
}

const _c = new THREE.Vector3();
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();

/**
 * Exact distance along `dir` at which a perspective camera aimed at `target`
 * contains every corner of `box`.
 *
 * This is what the presets use, in preference to `fitRect` / `fitDistance`.
 * Both of those treat the subject as flat at the focal plane, which under
 * perspective under-shoots for a box with real depth along the view axis — the
 * near corners project larger than the fit assumed, and crop off-frame.
 *
 * Solves the frustum containment per corner and takes the worst case:
 *   |p·right| ≤ (D − p·dir)·tan(hFov/2)  ⇒  D ≥ |p·right|/tan(hFov/2) + p·dir
 * and likewise for the vertical axis.
 *
 * @param {THREE.Box3} box
 * @param {THREE.Vector3} target   the look-at point
 * @param {THREE.Vector3} dir      unit vector from target toward the camera
 * @param {THREE.Vector3} up       camera up vector
 */
export function fitBox(box, target, dir, up, fov = 50, aspect = 1, padding = 1.05) {
  const vFov = THREE.MathUtils.degToRad(Math.max(1, fov));
  const tanV = Math.tan(vFov / 2);
  const tanH = tanV * Math.max(0.01, aspect);

  _f.copy(dir).negate();                       // camera forward
  _r.crossVectors(_f, up);
  // Looking straight along `up` leaves no valid right vector; nudge off-axis.
  if (_r.lengthSq() < 1e-10) _r.set(1, 0, 0).cross(_f);
  _r.normalize();
  _u.crossVectors(_r, _f).normalize();

  let d = 0;
  for (let i = 0; i < 8; i++) {
    _c.set(
      i & 1 ? box.max.x : box.min.x,
      i & 2 ? box.max.y : box.min.y,
      i & 4 ? box.max.z : box.min.z
    ).sub(target);
    const along = _c.dot(dir);
    d = Math.max(
      d,
      (Math.abs(_c.dot(_r)) * padding) / tanH + along,
      (Math.abs(_c.dot(_u)) * padding) / tanV + along
    );
  }
  return d;
}

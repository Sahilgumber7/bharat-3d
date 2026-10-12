import * as THREE from 'three';
import { HUBS, LANES, hubById, laneLoad, laneStress, hubThroughput } from './data.js';

export const PLANE = 9; // height of the lane plane above the ground
const AQUA = new THREE.Color('#5ef2e6');
const CORAL = new THREE.Color('#ff5a3c');

/* ------------------------------------------------------------------ ground */

export function createGround(span) {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uFade: { value: 1 } },
    vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `
      varying vec3 vW; uniform float uFade;
      void main(){
        float d = length(vW.xz) / ${(span * 1.7).toFixed(1)};
        vec2 g = fract(vW.xz / 11.0) - 0.5;
        float dots = smoothstep(0.075, 0.02, length(g));
        float halo = exp(-pow(length(vW.xz * vec2(0.9, 0.75)) / ${(span * 0.62).toFixed(1)}, 2.0));
        vec3 base = vec3(0.0012, 0.0017, 0.0021);
        vec3 col = base + vec3(0.003, 0.014, 0.015) * halo + vec3(0.25, 0.7, 0.68) * dots * 0.02 * (1.0 - smoothstep(0.1, 1.0, d));
        float a = (1.0 - smoothstep(0.55, 1.0, d)) * uFade;
        gl_FragColor = vec4(col, a);
      }`,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(span * 4, span * 4), mat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = -0.4;
  m.raycast = () => {};
  return m;
}

/* ------------------------------------------------------------------- lanes */

function radialTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(160,255,245,.55)');
  grd.addColorStop(0.5, 'rgba(60,200,190,.12)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createNetwork(geo, { density = 1 } = {}) {
  const root = new THREE.Group();
  const NL = LANES.length;

  // Resolve hubs to world positions on the lane plane.
  const hubs = HUBS.map((h) => ({ ...h, pos: geo.lonLat(h.lon, h.lat, PLANE) }));
  const hubIdx = Object.fromEntries(hubs.map((h) => [h.id, h]));

  /* lane curves */
  const lanes = LANES.map((l) => {
    const a = hubIdx[l.from].pos;
    const b = hubIdx[l.to].pos;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const dist = a.distanceTo(b);
    mid.y += dist * 0.26 + 5;
    const curve = new THREE.QuadraticBezierCurve3(a.clone(), mid, b.clone());
    return { ...l, a, b, mid, dist, curve };
  });

  /* thin lane lines */
  const laneLines = lanes.map((l) => {
    const pts = l.curve.getPoints(56);
    const g = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.LineBasicMaterial({ color: AQUA, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false });
    const line = new THREE.Line(g, m);
    line.raycast = () => {};
    root.add(line);
    return line;
  });

  /* particles */
  const K = 85 * density;
  const lanesCap = lanes.map((l) => Math.max(18, Math.round(l.weight * K)));
  const total = lanesCap.reduce((s, v) => s + v, 0);
  const aLane = new Float32Array(total);
  const aPhase = new Float32Array(total);
  const aSpeed = new Float32Array(total);
  const aRank = new Float32Array(total);
  const aDir = new Float32Array(total);
  const aSz = new Float32Array(total);
  let o = 0;
  lanes.forEach((l, li) => {
    for (let k = 0; k < lanesCap[li]; k++, o++) {
      aLane[o] = li;
      aPhase[o] = Math.random();
      aSpeed[o] = 0.7 + Math.random() * 0.6;
      aRank[o] = (k + Math.random()) / lanesCap[li]; // evenly spread, so density thins out uniformly
      aDir[o] = Math.random() < 0.5 ? 1 : -1;
      aSz[o] = 0.7 + Math.random() * 0.9;
    }
  });
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
  pg.setAttribute('aLane', new THREE.BufferAttribute(aLane, 1));
  pg.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
  pg.setAttribute('aSpeed', new THREE.BufferAttribute(aSpeed, 1));
  pg.setAttribute('aRank', new THREE.BufferAttribute(aRank, 1));
  pg.setAttribute('aDir', new THREE.BufferAttribute(aDir, 1));
  pg.setAttribute('aSz', new THREE.BufferAttribute(aSz, 1));
  pg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

  const U = {
    uClock: { value: 0 },
    uSize: { value: 1.5 },
    uPixel: { value: 600 },
    uIntro: { value: 0 },
    uP0: { value: lanes.map((l) => l.a) },
    uP1: { value: lanes.map((l) => l.mid) },
    uP2: { value: lanes.map((l) => l.b) },
    uLen: { value: lanes.map((l) => l.dist) },
    uLoad: { value: new Array(NL).fill(0.5) },
    uStress: { value: new Array(NL).fill(0) },
    uFocus: { value: new Array(NL).fill(1) },
  };
  const pm = new THREE.ShaderMaterial({
    uniforms: U,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      #define NL ${NL}
      uniform float uClock, uSize, uPixel, uIntro;
      uniform vec3 uP0[NL]; uniform vec3 uP1[NL]; uniform vec3 uP2[NL];
      uniform float uLen[NL]; uniform float uLoad[NL]; uniform float uStress[NL]; uniform float uFocus[NL];
      attribute float aLane, aPhase, aSpeed, aRank, aDir, aSz;
      varying vec3 vCol; varying float vA;
      void main(){
        int l = int(aLane + 0.5);
        float t = fract(aPhase + uClock * aSpeed * (16.0 / uLen[l]));
        if (aDir < 0.0) t = 1.0 - t;
        vec3 p = (1.-t)*(1.-t)*uP0[l] + 2.*(1.-t)*t*uP1[l] + t*t*uP2[l];
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float fade = smoothstep(0.0, 0.07, t) * smoothstep(1.0, 0.93, t);
        float show = step(aRank, uLoad[l] * uIntro);
        vA = fade * show * (0.35 + 0.65 * uFocus[l]);
        vec3 cool = vec3(0.12, 0.85, 0.78);
        vec3 hot = vec3(1.0, 0.14, 0.06);
        vCol = mix(cool, hot, smoothstep(0.1, 0.9, uStress[l]));
        gl_PointSize = aSz * uSize * uPixel / max(1.0, -mv.z) * (0.8 + 0.4 * uFocus[l]);
      }`,
    fragmentShader: `
      varying vec3 vCol; varying float vA;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d); a *= a;
        gl_FragColor = vec4(vCol * 1.15, a * vA * 0.55);
      }`,
  });
  const points = new THREE.Points(pg, pm);
  points.frustumCulled = false;
  points.raycast = () => {};
  root.add(points);

  /* hubs */
  const tex = radialTexture();
  const beamMat = (c) => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uCol: { value: c }, uA: { value: 1 } },
    vertexShader: `varying float vY; void main(){ vY = uv.y; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying float vY; uniform vec3 uCol; uniform float uA; void main(){ float a = pow(vY, 1.8); gl_FragColor = vec4(uCol*1.4, a*0.8*uA); }`,
  });

  const hubObjs = hubs.map((h, i) => {
    const g = new THREE.Group();
    g.position.set(h.pos.x, 0, h.pos.z);
    const beamH = PLANE + 3 + h.size * 1.5;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.5, beamH, 10, 1, true), beamMat(AQUA));
    beam.position.y = beamH / 2;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    glow.position.y = PLANE;
    glow.scale.setScalar(14 + h.size * 1.8);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.9 + h.size * 0.07, 14, 10), new THREE.MeshBasicMaterial({ color: 0xeafffc }));
    core.position.y = PLANE;
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.94, 1, 64), new THREE.MeshBasicMaterial({ color: AQUA, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 2.6;
    g.add(beam, glow, core, ring);
    [beam, glow, core, ring].forEach((m) => (m.raycast = () => {}));
    root.add(g);
    return { hub: h, g, beam, glow, core, ring, phase: i * 0.37, cur: { s: 0, emph: 0 } };
  });

  /* tracer comet for the guided tour */
  const TR = 56;
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TR * 3), 3));
  const ta = new Float32Array(TR);
  const ts = new Float32Array(TR);
  for (let i = 0; i < TR; i++) { const f = 1 - i / TR; ta[i] = f * f; ts[i] = 3 + 9 * f * f; }
  tg.setAttribute('aA', new THREE.BufferAttribute(ta, 1));
  tg.setAttribute('aS', new THREE.BufferAttribute(ts, 1));
  tg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const tm = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uPixel: U.uPixel, uOn: { value: 0 } },
    vertexShader: `attribute float aA, aS; uniform float uPixel, uOn; varying float vA; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv; vA = aA*uOn; gl_PointSize = aS*uPixel/max(1.,-mv.z)*0.5; }`,
    fragmentShader: `varying float vA; void main(){ float d = length(gl_PointCoord-0.5); float a = smoothstep(0.5,0.,d); gl_FragColor = vec4(vec3(0.85,1.,0.97)*1.6, a*a*vA); }`,
  });
  const tracerPts = new THREE.Points(tg, tm);
  tracerPts.frustumCulled = false;
  tracerPts.raycast = () => {};
  tracerPts.renderOrder = 5;
  root.add(tracerPts);

  const tracer = {
    path: null,
    length: 0,
    on: false,
    u: 0,
    pos: new THREE.Vector3(),
    /** Follow the lanes through a list of hub ids. */
    setRoute(ids) {
      const pts = [];
      for (let i = 0; i < ids.length - 1; i++) {
        const lane = lanes.find((l) => (l.from === ids[i] && l.to === ids[i + 1]) || (l.to === ids[i] && l.from === ids[i + 1]));
        let seg = lane.curve.getPoints(60);
        if (lane.from !== ids[i]) seg = seg.reverse();
        pts.push(...(i ? seg.slice(1) : seg));
      }
      this.path = pts;
      const d = [0];
      for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + pts[i].distanceTo(pts[i - 1]));
      this.cum = d;
      this.length = d[d.length - 1];
    },
    at(u, out = new THREE.Vector3()) {
      const target = Math.min(1, Math.max(0, u)) * this.length;
      let i = 1;
      while (i < this.cum.length - 1 && this.cum[i] < target) i++;
      const f = (target - this.cum[i - 1]) / Math.max(1e-6, this.cum[i] - this.cum[i - 1]);
      return out.copy(this.path[i - 1]).lerp(this.path[i], f);
    },
    update(u) {
      this.u = u;
      const arr = tg.attributes.position.array;
      const p = new THREE.Vector3();
      for (let i = 0; i < TR; i++) {
        this.at(u - (i / TR) * Math.min(0.22, 90 / this.length), p);
        arr[i * 3] = p.x; arr[i * 3 + 1] = p.y; arr[i * 3 + 2] = p.z;
      }
      tg.attributes.position.needsUpdate = true;
      this.at(u, this.pos);
    },
    show(on) { this.on = on; tm.uniforms.uOn.value = on ? 1 : 0; },
  };

  /* per-frame ----------------------------------------------------- */
  const hoverHub = { id: null };
  return {
    root, hubs, lanes, hubObjs, tracer, uniforms: U, hoverHub,
    setFocus(fn) { lanes.forEach((l, i) => (U.uFocus.value[i] = fn(l))); },
    /** time: seconds, m: fractional month, intro: 0..1, emphasis: hub id → 0..1 */
    update(dt, time, m, intro, pixelScale, emphasis = {}) {
      U.uClock.value += dt * (0.8 + 0.5 * Math.sin(Math.PI * Math.min(1, Math.max(0, (m % 12) / 12))) );
      U.uPixel.value = pixelScale;
      U.uIntro.value = intro * intro * (3 - 2 * intro);
      lanes.forEach((l, i) => {
        U.uLoad.value[i] = laneLoad(i, m);
        U.uStress.value[i] = laneStress(i, m);
        laneLines[i].material.color.copy(AQUA).lerp(CORAL, Math.min(1, laneStress(i, m)));
        laneLines[i].material.opacity = (0.1 + 0.16 * laneLoad(i, m)) * U.uIntro.value * (0.35 + 0.65 * U.uFocus.value[i]);
      });
      hubObjs.forEach((o, i) => {
        const t = hubThroughput(o.hub.id, m);
        const appear = Math.min(1, Math.max(0, intro * 1.4 - 0.25 - i * 0.045));
        const eased = appear * appear * (3 - 2 * appear);
        const emph = emphasis[o.hub.id] || 0;
        o.cur.emph += (emph - o.cur.emph) * Math.min(1, dt * 7);
        const e = o.cur.emph;
        o.g.scale.set(1, 0.001 + eased, 1);
        const s = (14 + o.hub.size * 1.8) * (0.85 + (t / (o.hub.size * 9 * 1.3)) * 0.2) * (1 + e * 0.5);
        o.glow.scale.setScalar(s * eased);
        o.glow.position.y = PLANE;
        o.core.scale.setScalar((1 + e * 0.5) * eased);
        const ph = ((time * 0.45 + o.phase) % 1);
        o.ring.scale.setScalar(1 + ph * (6 + o.hub.size));
        o.ring.material.opacity = (1 - ph) * 0.42 * eased;
        // beam scale counters the group's squash so it stays full height
        o.beam.scale.y = 1;
      });
    },
  };
}

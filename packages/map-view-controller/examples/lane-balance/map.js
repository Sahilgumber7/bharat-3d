import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildGeo, SPAN } from '../logistics/geo.js';
import { HUBS, NH } from './model.js';

const PLANE = 6;
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const TEAL = new THREE.Color('#0f766e');
const BG = '#f4f5f2';

/**
 * The map: dark country, eight gateways, and for every lane pair two streams
 * of parcels-in-trailers. Aqua is a loaded leg, coral is a trailer coming back
 * empty. Heavy direction is all aqua; the light direction's coral share is the
 * open return-leg gap.
 */
export function createMap({ stage, labelsEl, onPickPair, onPickHub }) {
  const fast = new URLSearchParams(location.search).get('fast') === '1'; // test/screenshot aid: skip the intro and flights
  const small = innerWidth < 760;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  const DPR = Math.min(devicePixelRatio || 1, small ? 1.5 : 2);
  renderer.setPixelRatio(DPR);
  stage.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);
  scene.fog = new THREE.FogExp2(0xf4f5f2, 0.0006);
  const camera = new THREE.PerspectiveCamera(38, 1, 1, 6000);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfd6d2, 1.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(-180, 320, 240);
  const rim = new THREE.DirectionalLight(0xdfeeea, 0.7); rim.position.set(140, 80, -280);
  scene.add(key, rim);

  const controls = new OrbitControls(camera, renderer.domElement);
  Object.assign(controls, { enableDamping: true, dampingFactor: 0.07, minDistance: 60, maxDistance: 900, maxPolarAngle: 1.38, screenSpacePanning: false });

  /* world */
  const geo = buildGeo();
  scene.add(geo.group);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(SPAN * 4, SPAN * 4), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }',
    fragmentShader: `varying vec3 vW; void main(){
      float d = length(vW.xz) / ${(SPAN * 1.7).toFixed(1)};
      vec2 g = fract(vW.xz / 12.0) - 0.5;
      float dots = smoothstep(0.07, 0.02, length(g));
      float halo = exp(-pow(length(vW.xz * vec2(0.9, 0.75)) / ${(SPAN * 0.6).toFixed(1)}, 2.0));
      vec3 col = mix(vec3(0.957, 0.961, 0.949), vec3(1.0), halo * 0.8) - vec3(0.03, 0.02, 0.02) * dots * (1.0 - d);
      gl_FragColor = vec4(col, 1.0 - smoothstep(0.6, 1.0, d));
    }`,
  }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.4; ground.raycast = () => {};
  scene.add(ground);
  // calm the states: no per-state glow here, the lanes are the story
  for (const st of geo.states) {
    st.group.scale.y = 1.4;
    st.mesh.material.color.set('#e3e8e4');
    st.mesh.material.emissive.set(0x000000);
    st.mesh.material.roughness = 0.95; st.mesh.material.metalness = 0;
    st.lines.material.color.set('#4d6662');
    st.lines.material.opacity = 0.2;
  }

  const hubs = HUBS.map((h) => ({ ...h, pos: geo.lonLat(h.lon, h.lat, PLANE) }));
  const root = new THREE.Group();
  scene.add(root);

  /* gateways */
  const tex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(15,118,110,.55)'); gr.addColorStop(0.25, 'rgba(15,118,110,.22)'); gr.addColorStop(0.6, 'rgba(15,118,110,.06)'); gr.addColorStop(1, 'rgba(15,118,110,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const hubObjs = hubs.map((h) => {
    const g = new THREE.Group();
    g.position.set(h.pos.x, 0, h.pos.z);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false, transparent: true }));
    glow.scale.setScalar(18); glow.position.y = PLANE;
    const core = new THREE.Mesh(new THREE.SphereGeometry(1.15, 16, 12), new THREE.MeshBasicMaterial({ color: 0x0b3d38 }));
    core.position.y = PLANE;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, PLANE, 8, 1, true), new THREE.MeshBasicMaterial({ color: TEAL, transparent: true, opacity: 0.4, depthWrite: false }));
    stem.position.y = PLANE / 2;
    g.add(stem, glow, core); [stem, glow, core].forEach((m) => (m.raycast = () => {}));
    root.add(g);
    return { h, g, glow, core };
  });

  /* lane directions: for pair p = (i<j): dir 2p = i→j, dir 2p+1 = j→i */
  const pairs = [];
  for (let i = 0; i < NH; i++) for (let j = i + 1; j < NH; j++) pairs.push({ i, j, key: `${i}-${j}` });
  const ND = pairs.length * 2;
  const curves = [];
  pairs.forEach((p) => {
    const a = hubs[p.i].pos, b = hubs[p.j].pos;
    const d = a.distanceTo(b);
    const dirv = b.clone().sub(a).setY(0).normalize();
    const side = new THREE.Vector3(-dirv.z, 0, dirv.x).multiplyScalar(1.5);
    for (const sgn of [1, -1]) {
      const A = a.clone().addScaledVector(side, sgn), B = b.clone().addScaledVector(side, sgn);
      const mid = A.clone().add(B).multiplyScalar(0.5); mid.y += d * 0.22 + 4;
      curves.push({ a: sgn === 1 ? A : B, mid, b: sgn === 1 ? B : A, len: d });
    }
  });

  const baseLines = curves.map((c, d) => {
    const pts = new THREE.QuadraticBezierCurve3(c.a, c.mid, c.b).getPoints(40);
    const m = new THREE.LineBasicMaterial({ color: TEAL, transparent: true, opacity: 0.16, depthWrite: false });
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), m);
    l.raycast = () => {};
    root.add(l);
    return l;
  });

  const CAP = small ? 34 : 58;
  const total = ND * CAP;
  const aLane = new Float32Array(total), aPhase = new Float32Array(total), aSpeed = new Float32Array(total), aRank = new Float32Array(total), aRank2 = new Float32Array(total), aSz = new Float32Array(total);
  for (let d = 0, o = 0; d < ND; d++) for (let k = 0; k < CAP; k++, o++) {
    aLane[o] = d; aPhase[o] = Math.random(); aSpeed[o] = 0.75 + Math.random() * 0.5;
    aRank[o] = (k + Math.random()) / CAP; aRank2[o] = Math.random(); aSz[o] = 0.8 + Math.random() * 0.8;
  }
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
  for (const [n, a] of Object.entries({ aLane, aPhase, aSpeed, aRank, aRank2, aSz })) pg.setAttribute(n, new THREE.BufferAttribute(a, 1));
  pg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const U = {
    uClock: { value: 0 }, uPixel: { value: 800 }, uIntro: { value: 0 },
    uP0: { value: curves.map((c) => c.a) }, uP1: { value: curves.map((c) => c.mid) }, uP2: { value: curves.map((c) => c.b) },
    uLen: { value: curves.map((c) => c.len) },
    uVis: { value: new Array(ND).fill(0) }, uEmpty: { value: new Array(ND).fill(0) }, uFocus: { value: new Array(ND).fill(1) },
  };
  const pm = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false,
    vertexShader: `
      #define ND ${ND}
      uniform float uClock, uPixel, uIntro;
      uniform vec3 uP0[ND]; uniform vec3 uP1[ND]; uniform vec3 uP2[ND];
      uniform float uLen[ND]; uniform float uVis[ND]; uniform float uEmpty[ND]; uniform float uFocus[ND];
      attribute float aLane, aPhase, aSpeed, aRank, aRank2, aSz;
      varying vec3 vCol; varying float vA;
      void main(){
        int l = int(aLane + 0.5);
        float t = fract(aPhase + uClock * aSpeed * (14.0 / uLen[l]));
        vec3 p = (1.-t)*(1.-t)*uP0[l] + 2.*(1.-t)*t*uP1[l] + t*t*uP2[l];
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        float fade = smoothstep(0.0, 0.07, t) * smoothstep(1.0, 0.93, t);
        float coral = step(aRank2, uEmpty[l]);
        float show = step(aRank, uVis[l] * uIntro);
        vA = fade * show * (0.42 + 0.58 * uFocus[l]);
        vCol = mix(vec3(0.04, 0.50, 0.46), vec3(0.88, 0.20, 0.07), coral);
        gl_PointSize = aSz * (2.2 + coral * 1.8) * uPixel / max(1.0, -mv.z) * (0.75 + 0.45 * uFocus[l]);
      }`,
    fragmentShader: `varying vec3 vCol; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a *= a; gl_FragColor = vec4(vCol, min(1.0, a * vA * 1.5)); }`,
  });
  const points = new THREE.Points(pg, pm);
  points.frustumCulled = false; points.raycast = () => {};
  root.add(points);

  /* labels */
  const hubLabels = hubs.map((h, i) => {
    const b = document.createElement('button');
    b.className = 'gw'; b.textContent = h.code; b.title = h.name;
    b.setAttribute('aria-label', `${h.name} gateway`);
    b.onclick = () => onPickHub(i);
    labelsEl.appendChild(b);
    return { el: b, pos: h.pos.clone().setY(PLANE + 3) };
  });
  const chips = []; // gap chips, rebuilt on update
  const midOf = (pi) => { const c = curves[pi * 2]; return c.a.clone().multiplyScalar(0.25).addScaledVector(c.mid, 0.5).addScaledVector(c.b, 0.25); };

  /* camera rig */
  let flight = null;
  const poseOf = () => {
    const off = camera.position.clone().sub(controls.target); const dist = off.length();
    return { target: controls.target.clone(), dist, el: Math.asin(off.y / dist), az: Math.atan2(off.x, off.z) };
  };
  const place = (p) => {
    const ce = Math.cos(p.el);
    camera.position.set(p.target.x + p.dist * Math.sin(p.az) * ce, p.target.y + p.dist * Math.sin(p.el), p.target.z + p.dist * Math.cos(p.az) * ce);
    camera.lookAt(p.target);
  };
  const hero = () => {
    const a = camera.aspect;
    const dist = a >= 1.35 ? 560 : 560 * Math.pow(1.35 / a, 0.85);
    return { target: new THREE.Vector3(small ? 0 : 0, 0, small ? 34 : 24), dist, el: 0.9, az: 0 };
  };
  function flyTo(p, dur = 1.6) {
    if (fast) { place(p); controls.target.copy(p.target); controls.update(); return; }
    flight = { from: poseOf(), to: p, t: 0, dur };
    controls.enabled = false;
  }
  const poseForPair = (i, j) => {
    const a = hubs[i].pos, b = hubs[j].pos;
    const mid = a.clone().add(b).multiplyScalar(0.5); mid.y = 0;
    const dist = clamp(a.distanceTo(b) * 1.45 + 120, 170, 560);
    const p = { target: mid, dist, el: 0.95, az: 0 };
    if (camera.aspect < 1) p.target.z += dist * 0.3;
    return p;
  };

  /* data → visuals */
  let focusKey = null, focusHub = null;
  const heavyOf = {}; // pair key -> 0 if i→j is the heavy direction, else 1
  function setData(model) {
    const maxM = Math.max(...model.pairs.map((p) => p.M), 0.01);
    pairs.forEach((pp, pi) => {
      const p = model.pair(pp.key);
      const heavyDir = p.fr === pp.i ? 0 : 1; // dir 2pi = i→j
      heavyOf[pp.key] = heavyDir;
      const vis = clamp(p.M / maxM) * 0.95 + 0.04;
      for (const d of [0, 1]) {
        const idx = pi * 2 + d;
        U.uVis.value[idx] = vis;
        U.uEmpty.value[idx] = d === heavyDir ? 0 : clamp(p.gapOpen / Math.max(p.M, 0.01));
      }
    });
    // top gaps get a chip
    chips.splice(0).forEach((c) => c.el.remove());
    const top = [...model.pairs].filter((p) => p.open > 0).sort((a, b) => b.open * b.km - a.open * a.km).slice(0, 5);
    for (const p of top) {
      const pi = pairs.findIndex((x) => x.key === p.key);
      const b = document.createElement('button');
      b.className = 'chip-gap';
      b.innerHTML = `<i></i>${HUBS[p.fr].code}→${HUBS[p.to].code}<b>${p.open} open</b>`;
      b.onclick = () => onPickPair(p.key);
      labelsEl.appendChild(b);
      chips.push({ el: b, key: p.key, pos: midOf(pi).setY(PLANE + 8) });
    }
    applyFocus();
  }
  const CORAL = new THREE.Color('#d83a14');
  function applyFocus() {
    pairs.forEach((pp, pi) => {
      const sel = focusKey === pp.key;
      const near = focusHub != null && (pp.i === focusHub || pp.j === focusHub);
      const f = focusKey ? (sel ? 1 : 0.1) : focusHub != null ? (near ? 1 : 0.1) : 1;
      for (const d of [0, 1]) {
        const idx = pi * 2 + d, line = baseLines[idx];
        U.uFocus.value[idx] = f;
        const light = d !== heavyOf[pp.key];
        line.material.color.copy(sel && light ? CORAL : TEAL);
        line.material.opacity = sel ? (light ? 0.8 : 0.6) : near ? 0.35 : focusKey || focusHub != null ? 0.04 : 0.16;
      }
    });
    chips.forEach((c) => c.el.classList.toggle('on', c.key === focusKey));
    const sp = focusKey ? pairs.find((p) => p.key === focusKey) : null;
    hubLabels.forEach((l, i) => l.el.classList.toggle('on', i === focusHub || (sp && (sp.i === i || sp.j === i))));
  }
  const setFocus = ({ key: k = null, hub = null } = {}) => { focusKey = k; focusHub = hub; applyFocus(); };

  /* loop */
  const v = new THREE.Vector3();
  function project(items, w, h, spread = false) {
    const placed = [];
    for (const it of items) {
      v.copy(it.pos).project(camera);
      const vis = v.z > -1 && v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      it.el.style.display = vis ? 'block' : 'none';
      if (!vis) continue;
      const x = ((v.x + 1) / 2) * w;
      let y = ((1 - v.y) / 2) * h;
      if (spread) {
        // keep gap chips readable: nudge a chip down until it clears the ones already placed
        for (let k = 0; k < 8 && placed.some((q) => Math.abs(q.x - x) < 150 && Math.abs(q.y - y) < 26); k++) y += 27;
        placed.push({ x, y });
      }
      it.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    }
  }
  let last = performance.now(), time = 0, intro = 0, started = false;
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
    if (!started) return;
    intro = fast ? 1 : Math.min(1, intro + dt / 1.8);
    U.uIntro.value = ease(intro);
    U.uClock.value += dt;
    if (flight) {
      flight.t += dt;
      const f = ease(clamp(flight.t / flight.dur)), a = flight.from, b = flight.to;
      const p = { target: a.target.clone().lerp(b.target, f), dist: Math.exp(Math.log(a.dist) + (Math.log(b.dist) - Math.log(a.dist)) * f), el: a.el + (b.el - a.el) * f, az: a.az + Math.atan2(Math.sin(b.az - a.az), Math.cos(b.az - a.az)) * f };
      place(p);
      if (flight.t >= flight.dur) { controls.target.copy(b.target); controls.enabled = true; flight = null; controls.update(); }
    } else controls.update();
    hubObjs.forEach((o, i) => {
      const e = hubLabels[i].el.classList.contains('on') ? 1.35 : 1;
      o.glow.scale.setScalar(18 * e * (1 + 0.06 * Math.sin(time * 2 + i)));
    });
    renderer.render(scene, camera);
    const w = innerWidth, h = innerHeight;
    project(hubLabels, w, h); project(chips, w, h, true);
  }
  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix(); U.uPixel.value = h * DPR;
  }
  addEventListener('resize', resize);
  resize();
  const h0 = hero();
  place({ ...h0, dist: h0.dist * 1.5, az: 0.5, el: 1.1 });
  controls.target.copy(h0.target);
  requestAnimationFrame(frame);

  return {
    start() { started = true; flyTo(hero(), 2.2); },
    setData, setFocus,
    flyHero: () => flyTo(hero()),
    flyPair: (i, j) => flyTo(poseForPair(i, j)),
    flyHub: (i) => { const p = hubs[i].pos.clone().setY(0); if (camera.aspect < 1) p.z += 40; flyTo({ target: p, dist: 190, el: 0.9, az: 0 }); },
    get renderer() { return renderer; },
  };
}

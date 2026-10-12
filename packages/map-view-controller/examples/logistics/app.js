import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildGeo, SPAN, DEPTH } from './geo.js';
import { createNetwork, createGround, PLANE } from './network.js';
import {
  MONTHS, METRICS, HUBS, LANES, hubById, initStates, stateValue, domainOf, nationalValue, laneStress, laneLoad,
  hubThroughput, hubDwell, rankStates, fmt,
} from './data.js';
import { TOUR } from './tour.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const small = innerWidth < 760;
// Deep links: ?intro=0 skips the fly-in; ?metric=returns&m=9.5&sel=maharashtra (or hub id) opens a view; ?tour=1 starts the tour.
const Q = new URLSearchParams(location.search);

/* ------------------------------------------------------------ renderer */

const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const DPR = Math.min(devicePixelRatio || 1, small ? 1.5 : 2);
renderer.setPixelRatio(DPR);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#05070a');
scene.fog = new THREE.FogExp2(0x05070a, 0.00085);
const camera = new THREE.PerspectiveCamera(38, 1, 1, 6000);

scene.add(new THREE.HemisphereLight(0x8fd8d2, 0x040608, 0.55));
const key = new THREE.DirectionalLight(0xdff6ff, 1.5);
key.position.set(-160, 300, 260);
const rim = new THREE.DirectionalLight(0x58e6da, 1.1);
rim.position.set(120, 90, -300);
scene.add(key, rim);

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: small ? 0 : 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.55, 0.5, 0.42);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.minDistance = 45;
controls.maxDistance = 900;
controls.maxPolarAngle = 1.38;
controls.screenSpacePanning = false;

/* --------------------------------------------------------------- world */

const geo = buildGeo();
const slugs = geo.states.map((s) => s.slug);
initStates(slugs);
scene.add(geo.group);
scene.add(createGround(SPAN));
const net = createNetwork(geo, { density: small ? 0.55 : 1 });
scene.add(net.root);

const DOM = Object.fromEntries(
  Object.keys(METRICS).map((k) => [k, domainOf(k, slugs)])
);

/* ---------------------------------------------------------------- state */

const S = {
  metric: 'volume',
  mf: 9.4,
  playing: false,
  sel: null, // { type: 'state'|'hub', id }
  hover: null,
  introT: reduced || Q.get('intro') === '0' ? 99 : +Q.get('introAt') || 0,
  tour: null,
};
const INTRO_LEN = 6.4;
const RAMP = {
  aqua: ['#000000', '#041f20', '#08484a', '#12857f', '#35c9bd'].map((c) => new THREE.Color(c)),
  coral: ['#000000', '#2e0b06', '#6b1c0d', '#b53a20', '#ff6f4d'].map((c) => new THREE.Color(c)),
};
const ramp = (name, t, out) => {
  const a = RAMP[name];
  const f = clamp(t) * (a.length - 1);
  const i = Math.min(a.length - 2, Math.floor(f));
  return out.copy(a[i]).lerp(a[i + 1], f - i);
};
const tmp = new THREE.Color();
const monthIdx = () => Math.floor(((S.mf % 12) + 12) % 12);
const intensity = (metric, t) => (metric === 'volume' ? t : Math.pow(metric === 'ontime' ? 1 - t : t, 1.7)); // sharpen so hotspots stand out
const hueOf = (metric) => (metric === 'volume' ? 'aqua' : 'coral');
const RELIEF = { volume: 3.2, ontime: 1.6, returns: 1.6 };

const valStr = (metric, v) => (metric === 'volume' ? `${fmt.parcels(v)} /day` : `${v.toFixed(1)}%`);

/* ------------------------------------------------------------- camera */

const poseOf = () => {
  const off = camera.position.clone().sub(controls.target);
  const dist = off.length();
  return { target: controls.target.clone(), dist, el: Math.asin(off.y / dist), az: Math.atan2(off.x, off.z) };
};
const placeCamera = (p) => {
  const ce = Math.cos(p.el);
  camera.position.set(p.target.x + p.dist * Math.sin(p.az) * ce, p.target.y + p.dist * Math.sin(p.el), p.target.z + p.dist * Math.cos(p.az) * ce);
  camera.lookAt(p.target);
};
const heroPose = () => {
  const a = camera.aspect;
  const dist = a >= 1.35 ? 545 : 545 * Math.pow(1.35 / a, 0.85);
  return { target: new THREE.Vector3(small ? 0 : -42, 0, small ? 30 : 38), dist, el: 0.86, az: 0 };
};
let cur = null; // pose in auto mode
let want = null;
let mode = 'auto'; // 'auto' while scripted, 'free' under OrbitControls
const lerpAngle = (a, b, k) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k;

function goAuto(pose, instant = false) {
  if (mode === 'free') cur = poseOf();
  mode = 'auto';
  controls.enabled = false;
  want = pose;
  if (instant || !cur) { cur = { ...pose, target: pose.target.clone() }; placeCamera(cur); }
}
function goFree() {
  if (mode === 'free') return;
  mode = 'free';
  controls.target.copy(cur.target);
  controls.enabled = !S.tour;
  controls.update();
}

function stepCamera(dt, rate = 2.4) {
  if (mode !== 'auto' || !want) return;
  const k = 1 - Math.exp(-dt * rate);
  cur.target.lerp(want.target, k);
  cur.dist *= Math.pow(want.dist / cur.dist, k);
  cur.el += (want.el - cur.el) * k;
  cur.az = lerpAngle(cur.az, want.az, k);
  placeCamera(cur);
  const settled = cur.target.distanceTo(want.target) < 0.4 && Math.abs(cur.dist - want.dist) < 0.8 && Math.abs(cur.el - want.el) < 0.004;
  if (settled && !S.tour && S.introT >= INTRO_LEN) goFree();
}

renderer.domElement.addEventListener('pointerdown', () => {
  if (mode === 'auto' && !S.tour && S.introT >= INTRO_LEN) goFree();
});

/* ---------------------------------------------------------- selection */

const stateName = (slug) => geo.bySlug[slug]?.name || slug;
const hubsIn = (slug) => HUBS.filter((h) => h.state === slug);
const nearestHub = (slug) => {
  const c = geo.bySlug[slug].centroid;
  return [...HUBS].sort((a, b) => geo.lonLat(a.lon, a.lat).distanceTo(c) - geo.lonLat(b.lon, b.lat).distanceTo(c))[0];
};

function posePos(sel) {
  if (!sel) return heroPose();
  let p;
  if (sel.type === 'hub') {
    const h = hubById[sel.id];
    p = { target: geo.lonLat(h.lon, h.lat, 0), dist: 120, el: 0.78, az: 0.12 };
  } else {
    const b = geo.bySlug[sel.id].bounds;
    const size = Math.max(b.x1 - b.x0, (b.z1 - b.z0) * 1.15);
    const a = camera.aspect;
    const dist = clamp(size * (a < 1 ? 2.8 : 1.85) + 70, 120, 520);
    p = { target: new THREE.Vector3((b.x0 + b.x1) / 2, 0, (b.z0 + b.z1) / 2), dist, el: 0.92, az: 0.1 };
  }
  // On a portrait screen the detail sheet covers the lower half; aim south so the subject sits above it.
  if (camera.aspect < 1) p.target.z += p.dist * 0.3;
  return p;
}

function select(sel, { fly = true } = {}) {
  if (S.introT < INTRO_LEN && !S.tour) return;
  S.sel = sel;
  applyFocus();
  if (fly) goAuto(posePos(sel));
  renderDetail(true);
}

function applyFocus() {
  const sel = S.sel;
  net.setFocus((l) => {
    if (!sel) return 1;
    if (sel.type === 'hub') return l.from === sel.id || l.to === sel.id ? 1 : 0.08;
    const ids = new Set(hubsIn(sel.id).map((h) => h.id));
    return ids.has(l.from) || ids.has(l.to) ? 1 : 0.18;
  });
}

/* --------------------------------------------------------------- labels */

const labelsEl = $('labels');
const labels = HUBS.map((h) => {
  const b = document.createElement('button');
  b.className = 'hub-label';
  b.innerHTML = `${h.name}<small></small>`;
  b.setAttribute('aria-label', `${h.name} hub — open details`);
  b.addEventListener('click', () => select({ type: 'hub', id: h.id }));
  labelsEl.appendChild(b);
  return { h, el: b, small: b.querySelector('small'), pos: net.hubs.find((x) => x.id === h.id).pos.clone().setY(PLANE + 2), txt: '' };
});
const v3 = new THREE.Vector3();
function updateLabels(w, hgt) {
  const show = S.introT > INTRO_LEN * 0.8;
  for (const l of labels) {
    v3.copy(l.pos).project(camera);
    const vis = show && v3.z > -1 && v3.z < 1 && Math.abs(v3.x) < 1.1 && Math.abs(v3.y) < 1.1;
    l.el.style.display = vis ? 'block' : 'none';
    if (!vis) continue;
    l.el.style.transform = `translate(${((v3.x + 1) / 2) * w + l.h.dx}px, ${((1 - v3.y) / 2) * hgt + l.h.dy}px)`;
    const dim = S.sel && !(S.sel.type === 'hub' ? S.sel.id === l.h.id : l.h.state === S.sel.id);
    l.el.classList.toggle('dim', !!dim);
    l.el.classList.toggle('on', S.sel?.type === 'hub' && S.sel.id === l.h.id);
  }
}
let labelTick = 0;
function refreshLabelText() {
  for (const l of labels) {
    const t = `${Math.round(hubThroughput(l.h.id, S.mf))}k /day`;
    if (t !== l.txt) { l.small.textContent = t; l.txt = t; }
  }
}

/* ------------------------------------------------------------ hover/pick */

const ray = new THREE.Raycaster();
const ptr = new THREE.Vector2();
let ptrClient = null;
const tip = $('tip');
const meshes = geo.states.map((s) => s.mesh);

renderer.domElement.addEventListener('pointermove', (e) => {
  ptrClient = { x: e.clientX, y: e.clientY };
  tip.style.left = e.clientX + 'px';
  tip.style.top = e.clientY + 'px';
});
renderer.domElement.addEventListener('pointerleave', () => { ptrClient = null; S.hover = null; tip.classList.remove('on'); });

let down = null;
renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!down) return;
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const quick = performance.now() - down.t < 450;
  down = null;
  if (moved > 5 || !quick || S.tour) return;
  const hit = pick(e.clientX, e.clientY);
  if (hit) select({ type: 'state', id: hit });
  else if (S.sel) select(null);
});

function pick(cx, cy) {
  const r = renderer.domElement.getBoundingClientRect();
  ptr.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const h = ray.intersectObjects(meshes, false)[0];
  return h?.object.userData.slug || null;
}

function updateHover() {
  if (!ptrClient || S.introT < INTRO_LEN || S.tour) { S.hover = null; tip.classList.remove('on'); return; }
  const slug = pick(ptrClient.x, ptrClient.y);
  S.hover = slug;
  renderer.domElement.style.cursor = slug ? 'pointer' : 'grab';
  if (!slug) { tip.classList.remove('on'); return; }
  const v = stateValue(S.metric, slug, S.mf);
  tip.innerHTML = `<b>${stateName(slug)}</b><span>${v == null ? 'no data' : `${METRICS[S.metric].label} · ${valStr(S.metric, v)}`}</span>`;
  tip.classList.add('on');
}

/* ------------------------------------------------------------ per-frame */

function updateStates(dt) {
  const [lo, hi] = DOM[S.metric];
  const hue = hueOf(S.metric);
  const k = 1 - Math.exp(-dt * 6);
  const relief = RELIEF[S.metric];
  for (const st of geo.states) {
    const north = clamp((st.centroid.z + 190) / 380); // 0 north → 1 south
    const appear = ease(clamp((S.introT - 0.5 - north * 2.3) / 1.5));
    const v = stateValue(S.metric, st.slug, S.mf);
    const I = v == null ? 0.04 : intensity(S.metric, clamp((v - lo) / (hi - lo)));
    const selected = S.sel?.type === 'state' && S.sel.id === st.slug;
    const inSel = S.sel?.type === 'hub' && hubById[S.sel.id].state === st.slug;
    const dimmed = S.sel && !selected && !inSel;
    const tGlow = I * (dimmed ? 0.4 : 1) + (selected ? 0.12 : 0);
    const tH = appear * (1 + relief * I * (dimmed ? 0.55 : 1)) * (selected ? 1.12 : 1);
    const c = st.cur;
    c.glow += (tGlow - c.glow) * k;
    c.h += (Math.max(0.001, tH) - c.h) * (appear < 1 ? 1 : k);
    c.hover += ((S.hover === st.slug ? 1 : 0) - c.hover) * k;
    c.sel += ((selected ? 1 : 0) - c.sel) * k;
    st.group.scale.y = c.h;
    ramp(hue, c.glow * 0.92 + c.hover * 0.1, tmp);
    st.mesh.material.emissive.copy(tmp);
    st.mesh.material.emissiveIntensity = 1 + c.hover * 0.6;
    st.lines.material.opacity = (0.06 + 0.16 * c.glow + 0.38 * c.sel + 0.18 * c.hover) * appear;
    st.lines.material.color.copy(hue === 'aqua' ? RAMP.aqua[4] : RAMP.coral[4]);
  }
}

/* ---------------------------------------------------------------- UI */

const tabs = $('tabs');
for (const m of Object.values(METRICS)) {
  const b = document.createElement('button');
  b.role = 'tab';
  b.textContent = m.label;
  b.dataset.id = m.id;
  b.setAttribute('aria-selected', m.id === S.metric);
  b.onclick = () => setMetric(m.id);
  tabs.appendChild(b);
}
function setMetric(id) {
  S.metric = id;
  [...tabs.children].forEach((b) => b.setAttribute('aria-selected', b.dataset.id === id));
  drawChart();
  drawLegend();
  renderDetail(true);
}

const kpiDefs = [
  { id: 'volume', label: 'Parcels / day', fmt: (v) => ({ n: fmt.parcels(v).replace(/[kM]$/, ''), u: fmt.parcels(v).slice(-1) }), better: null },
  { id: 'ontime', label: 'On-time delivery', fmt: (v) => ({ n: v.toFixed(1), u: '%' }), better: true },
  { id: 'returns', label: 'Return rate', fmt: (v) => ({ n: v.toFixed(1), u: '%' }), better: false },
];
const kpisEl = $('kpis');
kpisEl.innerHTML = kpiDefs.map((d) => `<div class="kpi"><div class="l">${d.label}</div><div class="v" id="kv-${d.id}">–</div><div class="d" id="kd-${d.id}"></div></div>`).join('') + `<div class="legend" id="legend"></div>`;
const kShown = { volume: 0, ontime: 0, returns: 0 };
const yearAvg = Object.fromEntries(kpiDefs.map((d) => [d.id, Array.from({ length: 12 }, (_, m) => nationalValue(d.id, slugs, m + 0.5)).reduce((a, b) => a + b) / 12]));
function updateKpis(dt) {
  const k = 1 - Math.exp(-dt * 5);
  for (const d of kpiDefs) {
    const target = nationalValue(d.id, slugs, S.mf);
    kShown[d.id] = kShown[d.id] ? kShown[d.id] + (target - kShown[d.id]) * k : target * 0.2;
    const { n, u } = d.fmt(kShown[d.id]);
    $('kv-' + d.id).innerHTML = `${n}<small>${u === '%' ? '%' : u + ' parcels'}</small>`.replace('<small>% parcels', '<small>%');
    const delta = d.id === 'volume' ? ((target / yearAvg[d.id]) - 1) * 100 : target - yearAvg[d.id];
    const el = $('kd-' + d.id);
    const good = d.better === null ? delta >= 0 : d.better ? delta >= 0 : delta <= 0;
    el.className = 'd ' + (Math.abs(delta) < 0.05 ? '' : good ? 'up' : 'warn');
    const sign = delta >= 0 ? '▲' : '▼';
    el.textContent = `${sign} ${Math.abs(delta).toFixed(1)}${d.id === 'volume' ? '%' : ' pt'} vs year avg`;
  }
}
function drawLegend() {
  const hue = hueOf(S.metric);
  const stops = RAMP[hue].map((c, i, a) => `#${c.getHexString()} ${(i / (a.length - 1)) * 100}%`).join(',');
  const [lo, hi] = DOM[S.metric];
  const f = (v) => (S.metric === 'volume' ? fmt.parcels(v) : v.toFixed(1) + '%');
  const cap = { volume: 'Brighter and taller = more parcels', ontime: 'Brightest = slowest on-time', returns: 'Brighter and taller = more returns' }[S.metric];
  const [a, b] = S.metric === 'ontime' ? [hi, lo] : [lo, hi];
  $('legend').innerHTML = `<div class="bar" style="background:linear-gradient(90deg,${stops})"></div><div class="ends"><span>${f(a)}</span><span>${f(b)}</span></div><div class="cap">${cap}</div>`;
}

/* timeline chart */
const monthsEl = $('months');
monthsEl.innerHTML = MONTHS.map((m) => `<span>${m}</span>`).join('');
function series(fn, n = 48) { return Array.from({ length: n + 1 }, (_, i) => fn((i / n) * 12)); }
function pathFor(vals, w = 1000, h = 64, pad = 6) {
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * w, h - pad - ((v - lo) / (hi - lo || 1)) * (h - pad * 2)]);
  return { line: pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' '), pts, h };
}
function drawChart() {
  const vals = series((m) => nationalValue(S.metric, slugs, m));
  const { line, pts, h } = pathFor(vals);
  $('line').setAttribute('d', line);
  $('area').setAttribute('d', `${line} L${pts[pts.length - 1][0]} ${h} L0 ${h} Z`);
  $('chartCap').textContent = `National ${METRICS[S.metric].label.toLowerCase()}`;
}
function updateTimeline() {
  const m = ((S.mf % 12) + 12) % 12;
  $('cursor').style.left = (m / 12) * 100 + '%';
  $('monthName').textContent = MONTHS[monthIdx()];
  $('peakChip').classList.toggle('on', m > 8.3 && m < 10.9);
  [...monthsEl.children].forEach((s, i) => s.classList.toggle('on', i === monthIdx()));
  $('chart').setAttribute('aria-valuenow', monthIdx());
}
const chart = $('chart');
let scrubbing = false;
const scrub = (e) => { const r = chart.getBoundingClientRect(); S.mf = clamp((e.clientX - r.left) / r.width, 0, 0.9999) * 12; };
chart.addEventListener('pointerdown', (e) => { scrubbing = true; chart.setPointerCapture(e.pointerId); setPlaying(false); scrub(e); });
chart.addEventListener('pointermove', (e) => scrubbing && scrub(e));
chart.addEventListener('pointerup', () => (scrubbing = false));
chart.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight') { S.mf = (S.mf + 1) % 12; e.preventDefault(); }
  if (e.key === 'ArrowLeft') { S.mf = (S.mf + 11) % 12; e.preventDefault(); }
});
function setPlaying(on) {
  S.playing = on;
  $('playIcon').setAttribute('d', on ? 'M3.5 2.5h3.2v11H3.5zM9.3 2.5h3.2v11H9.3z' : 'M4 2.5v11l9-5.5z');
  $('play').setAttribute('aria-label', on ? 'Pause' : 'Play the year');
}
$('play').onclick = () => setPlaying(!S.playing);
addEventListener('keydown', (e) => {
  if (e.target.closest?.('input,textarea')) return;
  if (e.code === 'Space' && e.target === document.body) { e.preventDefault(); setPlaying(!S.playing); }
  if (e.key === 'Escape') { if (S.tour) endTour(); else if (S.sel) select(null); }
  if (S.tour && e.key === 'ArrowRight') tourGo(S.tour.i + 1);
  if (S.tour && e.key === 'ArrowLeft') tourGo(S.tour.i - 1);
  if (e.key.toLowerCase() === 't' && e.target === document.body) (S.tour ? endTour() : startTour());
});

/* detail panel */
const detail = $('detail');
const SPARK_W = 300, SPARK_H = 56;
function spark(fn, color) {
  const vals = series(fn, 36);
  const { line, pts } = pathFor(vals, SPARK_W, SPARK_H, 5);
  const m = ((S.mf % 12) + 12) % 12;
  const x = (m / 12) * SPARK_W;
  const i = Math.min(pts.length - 1, Math.round((m / 12) * (pts.length - 1)));
  return `<svg class="spark" viewBox="0 0 ${SPARK_W} ${SPARK_H}" preserveAspectRatio="none" aria-hidden="true"><path d="${line}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/><line x1="${x}" x2="${x}" y1="0" y2="${SPARK_H}" stroke="rgba(255,255,255,.35)" vector-effect="non-scaling-stroke"/><circle cx="${x}" cy="${pts[i][1]}" r="3.2" fill="#fff"/></svg>`;
}
const stressColor = (s) => (s < 0.25 ? '#5ef2e6' : s < 0.6 ? '#ff9a6b' : '#ff5a3c');
const laneRow = (l, hubId) => {
  const other = hubById[l.from === hubId ? l.to : l.from];
  const load = laneLoad(l.i, S.mf);
  const stress = laneStress(l.i, S.mf);
  return `<button class="row" data-hub="${other.id}"><span class="dot" style="background:${stressColor(stress)}"></span><span class="n">${l.from === hubId ? '→' : '←'} ${other.name}</span><span class="bar"><i style="width:${(load * 100).toFixed(0)}%;background:${stressColor(stress)}"></i></span><span class="m">${(load * 100).toFixed(0)}%</span></button>`;
};

let lastDetail = 0;
function renderDetail(force = false) {
  const now = performance.now();
  if (!force && now - lastDetail < 380) return;
  lastDetail = now;
  const sel = S.sel;
  if (!sel || S.tour) { detail.hidden = true; return; }
  const scroll = detail.scrollTop;
  const wasHidden = detail.hidden;
  detail.hidden = false;
  const mn = MONTHS[monthIdx()];
  const hue = hueOf(S.metric) === 'aqua' ? '#5ef2e6' : '#ff5a3c';
  if (sel.type === 'state') {
    const slug = sel.id;
    const rank = rankStates('volume', slugs, S.mf).indexOf(slug) + 1;
    const hubs = hubsIn(slug);
    const ids = new Set(hubs.map((h) => h.id));
    const lanes = LANES.filter((l) => ids.has(l.from) || ids.has(l.to)).sort((a, b) => laneLoad(b.i, S.mf) - laneLoad(a.i, S.mf)).slice(0, 5);
    const vol = stateValue('volume', slug, S.mf), ot = stateValue('ontime', slug, S.mf), rt = stateValue('returns', slug, S.mf);
    const near = hubs.length ? null : nearestHub(slug);
    detail.innerHTML = `
      <button class="back" data-back>← All of India</button>
      <h3>${stateName(slug)}</h3>
      <div class="sub">${rank ? `#${rank} of ${slugs.length} by volume · ${mn}` : mn}</div>
      <div class="grid">
        <div><div class="l">Volume</div><div class="v">${vol == null ? '–' : fmt.parcels(vol)}</div></div>
        <div><div class="l">On-time</div><div class="v">${ot == null ? '–' : ot.toFixed(1) + '%'}</div></div>
        <div><div class="l">Returns</div><div class="v">${rt == null ? '–' : rt.toFixed(1) + '%'}</div></div>
      </div>
      <h4>${METRICS[S.metric].label} · 12 months</h4>
      ${spark((m) => stateValue(S.metric, slug, m) ?? 0, hue)}
      ${hubs.length ? `<h4>Hubs</h4>${hubs.map((h) => `<button class="row" data-hub="${h.id}"><span class="n">${h.name}</span><span class="bar"><i style="width:${(h.size * 10).toFixed(0)}%"></i></span><span class="m">${Math.round(hubThroughput(h.id, S.mf))}k</span></button>`).join('')}` : `<p class="note">No hub sits in this state in the demo network. Parcels are served via <b>${near.name}</b>.</p><button class="row" data-hub="${near.id}"><span class="n">Open ${near.name}</span><span class="m">→</span></button>`}
      ${lanes.length ? `<h4>Busiest lanes</h4>${lanes.map((l) => { const h = ids.has(l.from) ? l.from : l.to; return laneRow(l, h); }).join('')}` : ''}
      <p class="note">Synthetic data. Click a hub to follow its lanes.</p>`;
  } else {
    const h = hubById[sel.id];
    const lanes = LANES.filter((l) => l.from === h.id || l.to === h.id).sort((a, b) => laneLoad(b.i, S.mf) - laneLoad(a.i, S.mf));
    detail.innerHTML = `
      <button class="back" data-state="${h.state}">← ${stateName(h.state)}</button>
      <h3>${h.name} hub</h3>
      <div class="sub">${stateName(h.state)} · ${mn}</div>
      <div class="grid">
        <div><div class="l">Throughput</div><div class="v">${Math.round(hubThroughput(h.id, S.mf))}k</div></div>
        <div><div class="l">Avg dwell</div><div class="v">${hubDwell(h.id, S.mf).toFixed(1)}h</div></div>
        <div><div class="l">Lanes</div><div class="v">${lanes.length}</div></div>
      </div>
      <h4>Throughput · 12 months</h4>
      ${spark((m) => hubThroughput(h.id, m), '#5ef2e6')}
      <h4>Lanes</h4>
      ${lanes.map((l) => laneRow(l, h.id)).join('')}
      <p class="note">Dot colour shows strain: aqua is flowing, coral is congested.</p>`;
  }
  detail.scrollTop = wasHidden ? 0 : scroll;
}
detail.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.hub) select({ type: 'hub', id: t.dataset.hub });
  else if (t.dataset.state) select({ type: 'state', id: t.dataset.state });
  else if ('back' in t.dataset) select(null);
});

/* ----------------------------------------------------------------- tour */

const tourEl = $('tour');
function startTour() {
  if (S.introT < INTRO_LEN || S.tour) return;
  S.sel = null; applyFocus(); detail.hidden = true;
  S.tour = { i: -1, t0: 0, step: null, clock: 0 };
  controls.enabled = false;
  setPlaying(false);
  tourEl.hidden = false;
  $('tourBtn').hidden = true;
  tourGo(0);
}
function tourGo(i) {
  if (!S.tour) return;
  if (i >= TOUR.length) return endTour();
  i = Math.max(0, i);
  const step = TOUR[i];
  S.tour.i = i; S.tour.step = step; S.tour.t0 = S.tour.clock;
  $('tourN').textContent = String(i + 1).padStart(2, '0');
  $('tourT').textContent = String(TOUR.length).padStart(2, '0');
  $('tourTitle').textContent = step.title;
  $('tourBody').textContent = step.body;
  tourEl.style.animation = 'none'; void tourEl.offsetWidth; tourEl.style.animation = '';
  if (step.metric && step.metric !== S.metric) setMetric(step.metric);
  if (step.mf != null) S.mf = step.mf;
  net.tracer.show(!!step.route);
  if (step.route) net.tracer.setRoute(step.route);
  net.setFocus((l) => (step.focus ? (step.focus.includes(l.from) || step.focus.includes(l.to) ? 1 : 0.1) : 1));
  S.tour.emph = Object.fromEntries((step.emph || []).map((id) => [id, 1]));
  if (!step.route) {
    const p = step.pose(geo, camera.aspect, heroPose);
    goAuto({ target: p.target, dist: p.dist, el: p.el, az: p.az });
  }
  S.tour.rate = step.rate || 1.5;
}
function endTour() {
  S.tour = null;
  tourEl.hidden = true;
  $('tourBtn').hidden = false;
  net.tracer.show(false);
  net.setFocus(() => 1);
  setPlaying(false);
  goAuto(heroPose());
  select(null, { fly: false });
}
$('tourBtn').onclick = startTour;
$('tourNext').onclick = () => tourGo(S.tour.i + 1);
$('tourPrev').onclick = () => tourGo(S.tour.i - 1);
$('tourExit').onclick = endTour;

function updateTour(dt) {
  const T = S.tour;
  if (!T) return;
  T.clock += dt;
  const step = T.step;
  const el = T.clock - T.t0;
  $('tourProg').style.width = clamp(el / step.dur) * 100 + '%';
  if (step.mfTo != null) S.mf = step.mf + (step.mfTo - step.mf) * ease(clamp((el - 1) / (step.dur - 2)));
  if (step.route) {
    const u = clamp((el - 1.2) / (step.dur - 3));
    net.tracer.update(u);
    const p = net.tracer.pos;
    const az = -0.5 + u * 1.0;
    want = { target: p.clone().setY(2), dist: 135, el: 0.62, az };
    mode = 'auto';
    controls.enabled = false;
    if (!cur) cur = poseOf();
  }
  if (el >= step.dur) tourGo(T.i + 1);
}

/* ------------------------------------------------------------- resize */

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  bloom.setSize(w * DPR * 0.5, h * DPR * 0.5);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  net.uniforms.uPixel.value = h * DPR;
  if (mode === 'auto' && S.introT >= INTRO_LEN && !S.tour && !S.sel) want = heroPose();
}
addEventListener('resize', resize);

/* ---------------------------------------------------------------- intro */

const intro = $('intro');
const SPACE = { target: new THREE.Vector3(30, 0, 8), dist: 1700, el: 1.38, az: 1.15 };
function finishIntro() {
  S.introT = Math.max(S.introT, INTRO_LEN);
  intro.classList.add('out');
  $('skip').hidden = true;
  document.body.classList.add('ready');
}
$('skip').onclick = () => { S.introT = INTRO_LEN; };

/* ---------------------------------------------------------------- loop */

let last = performance.now();
let time = 0;
let readied = false;
let frameN = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;

  if (S.introT < INTRO_LEN + 0.01) {
    if (!Q.get('freeze')) S.introT += dt;
    const f = ease(clamp(S.introT / INTRO_LEN));
    const hero = heroPose();
    cur = {
      target: SPACE.target.clone().lerp(hero.target, f),
      dist: Math.exp(Math.log(SPACE.dist) + (Math.log(hero.dist) - Math.log(SPACE.dist)) * f),
      el: SPACE.el + (hero.el - SPACE.el) * f,
      az: SPACE.az + (hero.az - SPACE.az) * f,
    };
    placeCamera(cur);
    if (S.introT > 4.4) intro.classList.add('out');
    if (S.introT >= INTRO_LEN && !readied) { readied = true; finishIntro(); want = hero; mode = 'auto'; controls.enabled = false; }
  }

  if (S.playing && !scrubbing) S.mf = (S.mf + dt / 1.15) % 12;
  updateTour(dt);
  stepCamera(dt, S.tour ? S.tour.rate || 1.5 : 2.4);
  if (mode === 'free') controls.update();

  updateStates(dt);
  const emph = {};
  if (S.sel?.type === 'hub') emph[S.sel.id] = 1;
  if (S.sel?.type === 'state') hubsIn(S.sel.id).forEach((h) => (emph[h.id] = 0.7));
  if (S.tour?.emph) Object.assign(emph, S.tour.emph);
  net.update(dt, time, S.mf, clamp((S.introT - 3.0) / 3.2), renderer.domElement.height, emph);

  updateKpis(dt);
  updateTimeline();
  if ((labelTick += dt) > 0.25) { labelTick = 0; refreshLabelText(); }
  if (S.sel && !S.tour && (S.playing || scrubbing)) renderDetail();
  if (!S.playing && !scrubbing) renderDetailLazy();

  if ((frameN = (frameN + 1) % 3) === 0) updateHover();
  composer.render();
  updateLabels(innerWidth, innerHeight);
}
let lastMf = -1;
function renderDetailLazy() { if (Math.abs(S.mf - lastMf) > 1e-6) { lastMf = S.mf; if (S.sel) renderDetail(); } }

/* ---------------------------------------------------------------- boot */

resize();
drawChart();
drawLegend();
refreshLabelText();
camera.position.set(0, 800, 800);
requestAnimationFrame(() => {
  $('loader').classList.add('gone');
  if (S.introT >= INTRO_LEN) {
    finishIntro(); readied = true; goAuto(heroPose(), true); goFree();
    updateStates(10); // land every smoothed value immediately — no ease-in on a skipped intro
    for (const d of kpiDefs) kShown[d.id] = nationalValue(d.id, slugs, S.mf);
  }
  else { intro.classList.add('show'); }
});
if (Q.get('metric') in METRICS) setMetric(Q.get('metric'));
if (Q.get('m') && Number.isFinite(+Q.get('m'))) S.mf = +Q.get('m') % 12;
{
  const q = Q.get('sel');
  const apply = () => {
    if (!q) return;
    if (hubById[q]) select({ type: 'hub', id: q });
    else if (geo.bySlug[q]) select({ type: 'state', id: q });
  };
  if (S.introT >= INTRO_LEN) setTimeout(() => { apply(); if (Q.get('tour') === '1') { startTour(); if (Q.get('step')) tourGo(+Q.get('step')); if (Q.get('tourAt')) S.tour.clock = +Q.get('tourAt'); } }, 50);
}
requestAnimationFrame(frame);
window.__app = { S, geo, net, select, startTour, camera, controls, setMetric };

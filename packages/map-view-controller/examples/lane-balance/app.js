import { createMap } from './map.js';
import { HUBS, KM, BLEND, OPTION_META, createModel, parseTrips, CSV_TEMPLATE } from './model.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmtIN = (n) => Math.round(n).toLocaleString('en-IN');
const rup = (n) => '₹' + fmtIN(n);
const rupShort = (n) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${(n / 1e5).toFixed(1)} L` : rup(n));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const model = createModel();
const S = { sel: null, hub: null, touched: false };

/* ---------------------------------------------------------------- map */

const map = createMap({
  stage: $('#stage'),
  labelsEl: $('#labels'),
  onPickPair: (k) => selectPair(k),
  onPickHub: (i) => selectHub(i),
});

/* ------------------------------------------------------------ helpers */

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2800);
}

function modal(title, html, { cls = '' } = {}) {
  const prev = document.activeElement;
  const m = document.createElement('div');
  m.className = 'modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-label', title);
  m.innerHTML = `<div class="mc ${cls}"><div class="mh"><h3>${esc(title)}</h3><button class="x" aria-label="Close">×</button></div><div class="mb">${html}</div></div>`;
  const close = () => { m.remove(); document.removeEventListener('keydown', onKey); prev?.focus?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  m.addEventListener('click', (e) => { if (e.target === m) close(); });
  $('.x', m).onclick = close;
  document.body.appendChild(m);
  $('.x', m).focus();
  return { el: m, close, $: (s) => $(s, m) };
}

const counters = {};
function countTo(id, to, fmt) {
  const el = $('#' + id);
  const from = counters[id] ?? to;
  counters[id] = to;
  if (reduced || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now(); cancelAnimationFrame(el._r);
  (function f(t) {
    const p = Math.min(1, (t - t0) / 700), e = 1 - Math.pow(1 - p, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) el._r = requestAnimationFrame(f);
  })(t0);
}

/* ------------------------------------------------------------- render */

function renderKpis() {
  const t = model.totals();
  countTo('k1', t.emptyNow, (v) => v.toFixed(1) + '%');
  countTo('k2', t.open, (v) => fmtIN(v));
  countTo('k3', t.recoverable, (v) => rupShort(v));
  countTo('k4', t.approvedValue, (v) => rupShort(v));
  $('#k1s').textContent = `vs ${t.emptyBase.toFixed(1)}% before decisions`;
  $('#k2s').textContent = `of ${fmtIN(t.predicted)} predicted in ${model.hor} h`;
  $('#k4s').textContent = `${fmtIN(t.approvedLegs)} legs · ${model.approvals.length} decision${model.approvals.length === 1 ? '' : 's'}`;
}

function sortedPairs() {
  return [...model.pairs].sort((a, b) => b.open * b.km - a.open * a.km);
}

function renderRank() {
  const l = sortedPairs().slice(0, 8);
  const mx = Math.max(...l.map((p) => p.open * p.km), 1);
  $('#rank').innerHTML = l.map((p) => `
    <button type="button" data-k="${p.key}" class="${S.sel === p.key ? 'on' : ''}">
      <span><b>${esc(model.label(p))}</b><br><small>~${fmtIN(p.km)} km · ${p.open} open leg${p.open === 1 ? '' : 's'}</small></span>
      ${p.open ? `<span class="v">${rup(p.open * p.km * BLEND)}</span>` : `<span class="done">covered</span>`}
      <span class="bar2"><i style="width:${(p.open * p.km / mx) * 100}%"></i></span>
    </button>`).join('');
  $$('#rank button').forEach((b) => (b.onclick = () => selectPair(b.dataset.k)));
}

function renderDetail() {
  const el = $('#detail');
  document.body.classList.toggle('has-sel', !!S.sel);
  if (!S.sel) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  const p = model.pair(S.sel);
  const f = HUBS[p.fr], t = HUBS[p.to];
  const opts = model.options(p);
  const mxv = Math.max(p.M, 0.1);
  const slow = p.km > 1800;
  const rows = [];
  for (let k = 0; k < Math.min(p.legs, 6); k++) {
    const id = 'TR-SIM-' + (4000 + ((p.i * 131 + p.j * 57 + k * 37) % 5000));
    const hr = Math.max(1, Math.round(((k + 0.5) * model.hor) / Math.max(p.legs, 1)));
    let m = null, c = 0;
    for (const x of p.ap) { if (k < c + x.legs) { m = x; break; } c += x.legs; }
    rows.push(`<div class="${m ? 'm' : ''}"><span><b>${id}</b><small>empty from ${esc(t.name)} in ~${hr} h</small></span>${m ? `<span class="chipx ok">${esc(OPTION_META[m.opt].title.split(' ')[0])} · matched</span>` : '<span class="chipx">Open</span>'}</div>`);
  }
  el.innerHTML = `
    <div class="dhead"><div><h3>${esc(f.name)} ⇄ ${esc(t.name)}</h3><p class="sub">~${fmtIN(p.km)} km · plan the return leg ${esc(t.code)} → ${esc(f.code)} for the next ${model.hor} h</p></div>
      <span style="display:flex;gap:8px;align-items:center"><span class="chipx ${p.open ? 'open' : 'ok'}">${p.open ? `${p.open} open` : 'covered'}</span><button class="x" id="closeDetail" type="button" aria-label="Close lane details">×</button></span></div>
    <div class="dir">
      <div><span>${f.code} → ${t.code}</span><span class="tr"><i style="width:${(p.M / mxv) * 100}%"></i></span><b>${p.M.toFixed(1)}/d</b></div>
      <div><span>${t.code} → ${f.code}</span><span class="tr"><i style="width:${(p.m / mxv) * 100}%"></i></span><b>${p.m.toFixed(1)}/d</b></div>
      <div><span>Empty return</span><span class="tr"><i class="e" style="width:${(p.gap / mxv) * 100}%"></i></span><b>${p.gap.toFixed(1)}/d</b></div>
    </div>
    <h4>Fix it · pick one, a planner approves</h4>
    ${opts.map((o) => {
      const meta = OPTION_META[o.k];
      const v = o.eff * p.km * o.rate;
      return `<div class="opt ${o.done ? 'done' : ''}">
        <h5>${esc(meta.title)} <span>${esc(meta.owner)}</span></h5><p>${esc(meta.blurb)}</p>
        <div class="nums"><div><b>${o.eff}</b><small>return legs</small></div><div><b>${rup(o.done ? o.done.rs : v)}</b><small>${meta.unit}</small></div></div>
        <span class="note">${slow ? 'Driver hours: relay needed on this length' : 'Driver hours: within limit'}</span>
        ${o.done ? `<button class="btn sm" data-undo="${o.done.id}" type="button">Approved · Undo</button>` : `<button class="btn aqua sm" data-opt="${o.k}" type="button" ${o.eff < 1 ? 'disabled' : ''}>${o.eff < 1 ? 'Nothing left to fill' : 'Review &amp; approve'}</button>`}
      </div>`;
    }).join('')}
    <h4>Trailers on this lane${p.legs > 6 ? ` (first 6 of ${p.legs})` : ''}</h4>
    <div class="tl">${rows.join('') || '<p class="empty-state">No predicted empty legs in this horizon.</p>'}</div>
    <p class="fine">${model.source === 'csv' ? 'Flows come from your file. ' : 'Illustrative numbers. '}Nothing is dispatched until you approve an option.</p>`;
  $('#closeDetail', el).onclick = clearSel;
  $$('[data-opt]', el).forEach((b) => (b.onclick = () => review(p.key, b.dataset.opt)));
  $$('[data-undo]', el).forEach((b) => (b.onclick = () => undo(+b.dataset.undo)));
}

function renderLog() {
  $('#logN').textContent = model.approvals.length;
  $('#log').innerHTML = model.approvals.length
    ? [...model.approvals].reverse().map((a) => `<li><span><b>${esc(a.label)}</b> · ${a.legs} leg${a.legs > 1 ? 's' : ''} · ${rup(a.rs)}<time>${a.t} · approved by planner</time></span><button class="btn ghost sm" data-undo="${a.id}" type="button">Undo</button></li>`).join('')
    : '<li><span class="empty-state">No decisions yet. Pick a lane, review an option and approve it.</span></li>';
  $$('#log [data-undo]').forEach((b) => (b.onclick = () => undo(+b.dataset.undo)));
  $('#exportBtn').disabled = !model.approvals.length;
}

function renderAll() {
  model.calc();
  if (S.sel && !model.pair(S.sel)) S.sel = null;
  renderKpis(); renderRank(); renderDetail(); renderLog();
  map.setData(model);
  map.setFocus({ key: S.sel, hub: S.hub });
  const real = model.source === 'csv';
  const tag = $('#dataTag');
  tag.textContent = real ? `Your file · ${fmtIN(model.csv.used)} trips · ${model.csv.days} d` : 'Illustrative data';
  tag.classList.toggle('real', real);
  $('#surge').disabled = real;
  $('#surgeCtl').style.opacity = real ? 0.4 : 1;
  $('#csvBtn').textContent = real ? 'Change file' : 'Use your trips file';
}

/* ----------------------------------------------------------- actions */

function selectPair(key, { fly = true } = {}) {
  S.touched = true; S.sel = key; S.hub = null;
  const p = model.pair(key);
  renderRank(); renderDetail();
  map.setFocus({ key });
  if (fly) map.flyPair(p.i, p.j);
}
function selectHub(i) {
  S.touched = true; S.hub = i;
  const top = sortedPairs().find((p) => (p.i === i || p.j === i) && p.open > 0) || sortedPairs().find((p) => p.i === i || p.j === i);
  S.sel = top.key;
  renderRank(); renderDetail();
  map.setFocus({ key: S.sel, hub: i });
  map.flyHub(i);
}
function clearSel() { S.sel = null; S.hub = null; renderRank(); renderDetail(); map.setFocus(); map.flyHero(); }

function review(key, optKey) {
  model.calc();
  const p = model.pair(key);
  const op = model.options(p).find((x) => x.k === optKey);
  if (!op || op.eff < 1) return;
  const ins = model.instruction(p, op);
  const meta = OPTION_META[optKey];
  const m = modal('Review before approving', `
    <p class="sub">${esc(meta.title)} · ${esc(HUBS[p.to].name)} → ${esc(HUBS[p.fr].name)}</p>
    <div class="nums"><div><b>${op.eff}</b><small>return legs</small></div><div><b>${rup(ins.rs)}</b><small>${meta.unit}${model.source === 'sim' ? ' (illustrative)' : ''}</small></div></div>
    <div class="sms"><small>Dispatch instruction preview · ${esc(HUBS[p.to].name)} control tower</small>${esc(ins.text)}</div>
    <p class="sub">${esc(ins.driverNote)}</p>
    <p class="sub">Nothing is sent. This demo only records your decision here.</p>
    <div class="acts"><button class="btn aqua" id="ok" type="button">Approve (simulated)</button><button class="btn" id="no" type="button">Cancel</button></div>`);
  $('#no', m.el).onclick = m.close;
  $('#ok', m.el).onclick = () => {
    model.approve(key, optKey);
    m.close(); renderAll();
    toast(`Approved. ${op.eff} return leg${op.eff > 1 ? 's' : ''} covered.`);
  };
  $('#ok', m.el).focus();
}
function undo(id) { if (model.undo(id)) { renderAll(); toast('Decision undone.'); } }

/* ----------------------------------------------------------- controls */

$$('#hor button').forEach((b) => (b.onclick = () => { model.hor = +b.dataset.h; $$('#hor button').forEach((x) => x.classList.toggle('on', x === b)); renderAll(); }));
$('#surge').oninput = (e) => { model.surge = +e.target.value; $('#sv').textContent = '+' + model.surge + '%'; renderAll(); };
$('#logToggle').onclick = () => { const b = $('#logBody'); b.hidden = !b.hidden; $('#logToggle').setAttribute('aria-expanded', !b.hidden); };
$('#resetBtn').onclick = () => { if (!model.approvals.length) return toast('Nothing to reset.'); model.reset(); renderAll(); toast('All decisions cleared.'); };
$('#exportBtn').onclick = () => {
  const blob = new Blob([model.exportLog()], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'lane-balance-decisions.csv'; a.click(); URL.revokeObjectURL(a.href);
};
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('.modal') && S.sel) clearSel(); });

/* ----------------------------------------------------- CSV: your trips */

$('#csvBtn').onclick = () => {
  let parsed = null;
  const m = modal('Use your trips file', `
    <p class="sub">Load a trips extract and the map recomputes empty returns from <b>your</b> flows. It is read in this browser tab only. Nothing is uploaded.</p>
    <div class="drop" id="drop">Drop a .csv here, or <button class="btn sm" id="pick" type="button">choose a file</button><input id="file" type="file" accept=".csv,text/csv" hidden></div>
    <details><summary class="sub" style="cursor:pointer">…or paste rows</summary><textarea id="paste" spellcheck="false" aria-label="Trips as CSV" placeholder="origin,destination,loaded,trips,date&#10;DEL,BOM,1,120,2026-09-01"></textarea></details>
    <div class="row2"><label for="days">Days covered by the file</label><input id="days" type="number" min="1" placeholder="auto"><button class="btn sm" id="tpl" type="button">Download template</button></div>
    <p class="sub" style="margin-top:8px">Columns: <b>origin</b>, <b>destination</b>, <b>loaded</b> (1 or 0), <b>trips</b> (optional), <b>date</b> (optional). This demo is configured for 8 gateways: ${HUBS.map((h) => h.code).join(', ')}. A pilot is configured for yours.</p>
    <div id="sum" class="sum" hidden></div>
    <div class="acts"><button class="btn aqua" id="apply" type="button" disabled>Apply to map</button>${model.source === 'csv' ? '<button class="btn" id="back" type="button">Back to illustrative data</button>' : ''}</div>`);
  const run = (text) => {
    const d = +m.$('#days').value || undefined;
    parsed = parseTrips(text, { days: d });
    const sum = m.$('#sum'); sum.hidden = false; sum.className = 'sum' + (parsed.ok ? '' : ' bad');
    if (!parsed.ok) {
      sum.innerHTML = esc(parsed.error) + (parsed.unknownPlaces?.length ? `<br>Not in the 8 gateways: ${esc(parsed.unknownPlaces.join(', '))}` : '');
      m.$('#apply').disabled = true; return;
    }
    const skipped = Object.entries(parsed.skipped).map(([r, n]) => `${n} skipped (${r})`).join(', ');
    const lanes = parsed.F.flat().filter((v) => v > 0).length;
    sum.innerHTML = `Read <b>${fmtIN(parsed.rows)}</b> rows → <b>${fmtIN(parsed.used)}</b> trips over <b>${parsed.days}</b> days, <b>${lanes}</b> active directions.` +
      (parsed.empty ? ` ${fmtIN(parsed.empty)} trips are flagged empty in your file.` : '') + (skipped ? `<br>${esc(skipped)}${parsed.unknownPlaces.length ? ': ' + esc(parsed.unknownPlaces.join(', ')) : ''}` : '');
    m.$('#apply').disabled = false;
  };
  const readFile = (f) => f.text().then((t) => { m.$('#paste').value = ''; run(t); m._last = t; });
  m.$('#pick').onclick = () => m.$('#file').click();
  m.$('#file').onchange = (e) => e.target.files[0] && readFile(e.target.files[0]);
  const drop = m.$('#drop');
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); e.dataTransfer.files[0] && readFile(e.dataTransfer.files[0]); };
  m.$('#paste').oninput = (e) => { m._last = e.target.value; if (e.target.value.trim()) run(e.target.value); };
  m.$('#days').onchange = () => m._last && run(m._last);
  m.$('#tpl').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([CSV_TEMPLATE], { type: 'text/csv' })); a.download = 'lane-balance-trips-template.csv'; a.click(); URL.revokeObjectURL(a.href); };
  m.$('#apply').onclick = () => {
    if (!parsed?.ok) return;
    model.csv = parsed; model.source = 'csv'; model.approvals = [];
    m.close(); S.sel = null; renderAll();
    const top = sortedPairs()[0]; if (top) selectPair(top.key);
    toast('Your trips are on the map.');
  };
  const back = m.$('#back');
  if (back) back.onclick = () => { model.source = 'sim'; model.csv = null; model.approvals = []; m.close(); renderAll(); toast('Back to illustrative data.'); };
};

/* ---------------------------------------------------------- the pilot */

$('#pilotBtn').onclick = () => {
  modal('A 30-day pilot on two lanes', `
    <div class="pilot">
      <p>Prove it on your numbers before anything changes in your operation. Read-only, small, and a planner approves everything.</p>
      <h4>What we do</h4>
      <ol><li>Pick the two lanes where you suspect the most empty return.</li>
        <li>Take about 90 days of historical trailer trips: read-only, trailer IDs anonymised.</li>
        <li>Rank the return-leg gaps by ₹ and compare with your planners' own sense of it.</li>
        <li>Ship one decision through your existing approval flow.</li></ol>
      <div class="g2"><div><h4>What we need</h4><p>One extract: origin, destination, loaded or empty, trips, date. About 30 minutes a week from one planner.</p></div>
        <div><h4>What you get on day 30</h4><p>A ranked gap list for the two lanes, this map on your data, one decision shipped, and a clear go or no-go on going wider.</p></div></div>
      <h4>What stays with you</h4>
      <p>Your data can stay on your own infrastructure. Nothing dispatches automatically. Every action needs an approve tap and can be undone.</p>
      <p class="sub" style="margin-top:12px">The numbers in this demo are illustrative. The pilot produces yours.</p>
      <div class="acts"><button class="btn aqua" id="tryit" type="button">Try it with a sample file</button></div>
    </div>`, { cls: 'pilot' });
  $('#tryit').onclick = () => { $('.modal .x').click(); $('#csvBtn').click(); };
};

/* --------------------------------------------------------------- boot */

renderAll();
requestAnimationFrame(() => {
  $('#loader').classList.add('gone');
  map.start();
  // Show the point straight away: open the biggest gap.
  setTimeout(() => { if (!S.touched) { const top = sortedPairs()[0]; if (top) selectPair(top.key); } }, reduced ? 100 : 2400);
});
const Q = new URLSearchParams(location.search);
if (Q.get('sel')) setTimeout(() => {
  const k = Q.get('sel');
  if (!model.pair(k)) return;
  selectPair(k);
  const o = Q.get('approve'); // deep-link / test aid: ?sel=0-2&approve=A
  if (o && model.approve(k, o)) renderAll();
}, 60);
if (Q.get('open') === 'pilot') setTimeout(() => $('#pilotBtn').click(), 80);
if (Q.get('open') === 'csv') setTimeout(() => { $('#csvBtn').click(); const t = document.querySelector('#paste'); if (t && Q.get('demo')) { t.parentElement.open = true; t.value = 'origin,destination,loaded,trips,date\nDEL,BOM,1,120,2026-09-01\nBOM,DEL,1,58,2026-09-30\nBOM,DEL,0,62,2026-09-15\nDEL,Jaipur,1,20,2026-09-02'; t.dispatchEvent(new Event('input')); } }, 80);
window.__lb = { model, selectPair, renderAll };

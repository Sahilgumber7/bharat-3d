// Lane-Balance model: which lanes between a set of gateways will run empty on
// the way back, how many legs, roughly how much money, and three ways to fix it.
//
// The simulated numbers are illustrative. With a trips CSV loaded, flows come
// from the file instead; everything else (gaps, legs, ₹, options) is computed
// the same way, so a planner sees their own network through the same lens.

export const HUBS = [
  { code: 'DEL', name: 'Delhi NCR', lat: 28.61, lon: 77.21, prod: 1.5, cons: 1.0, aliases: ['delhi', 'new delhi', 'gurgaon', 'gurugram', 'ncr', 'noida'] },
  { code: 'BOM', name: 'Mumbai', lat: 19.08, lon: 72.88, prod: 1.4, cons: 1.2, aliases: ['mumbai', 'bombay', 'bhiwandi', 'navi mumbai'] },
  { code: 'BLR', name: 'Bengaluru', lat: 12.97, lon: 77.59, prod: 0.9, cons: 1.4, aliases: ['bengaluru', 'bangalore'] },
  { code: 'HYD', name: 'Hyderabad', lat: 17.39, lon: 78.49, prod: 0.8, cons: 1.0, aliases: ['hyderabad'] },
  { code: 'CCU', name: 'Kolkata', lat: 22.57, lon: 88.36, prod: 0.6, cons: 1.3, aliases: ['kolkata', 'calcutta'] },
  { code: 'MAA', name: 'Chennai', lat: 13.08, lon: 80.27, prod: 0.8, cons: 1.2, aliases: ['chennai', 'madras'] },
  { code: 'AMD', name: 'Ahmedabad', lat: 23.02, lon: 72.57, prod: 1.2, cons: 0.8, aliases: ['ahmedabad'] },
  { code: 'PNQ', name: 'Pune', lat: 18.52, lon: 73.86, prod: 1.1, cons: 0.8, aliases: ['pune'] },
];
export const NH = HUBS.length;
export const RATE = { A: 30, B: 25, C: 17 }; // ₹ per km, illustrative
export const BLEND = 24; // blended ₹ per km on an open return leg
export const OPTION_META = {
  A: { title: 'Consolidate held PTL freight', owner: 'PTL', blurb: 'Pull held consignments heading back toward the origin gateway into the return trailers.', unit: 'revenue' },
  B: { title: 'List on the FTL marketplace', owner: 'FTL', blurb: 'Offer the return slots to partner shippers at an indicative lane rate.', unit: 'revenue' },
  C: { title: 'Release hired trailers', owner: 'Procurement', blurb: 'Stand down contracted trailers on this lane instead of running them empty. Saves hire cost.', unit: 'cost avoided' },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hav(a, b) {
  const R = 6371, r = (x) => (x * Math.PI) / 180;
  const dl = r(b.lat - a.lat), dn = r(b.lon - a.lon);
  const h = Math.sin(dl / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)) * 1.22; // road factor
}
export const KM = HUBS.map((a) => HUBS.map((b) => Math.round(hav(a, b) / 10) * 10));

export function createModel() {
  const M = {
    hor: 48,
    surge: 20,
    source: 'sim', // 'sim' | 'csv'
    csv: null, // { F, days, rows, loaded, empty, label }
    approvals: [],
    uid: 1,
    F: [],
    pairs: [],
  };

  M.calc = () => {
    const s = M.surge / 100;
    if (M.source === 'csv' && M.csv) {
      M.F = M.csv.F;
    } else {
      const w = (a) => clamp(a.prod - a.cons + 0.5, 0.2, 1.5);
      M.F = HUBS.map((a, i) => HUBS.map((b, j) => (i === j ? 0 : +((9 * a.prod * (1 + s * w(a)) * b.cons * (1 + 0.25 * s)) / (1 + KM[i][j] / 900)).toFixed(2))));
    }
    M.pairs = [];
    for (let i = 0; i < NH; i++) {
      for (let j = i + 1; j < NH; j++) {
        const a = M.F[i][j], b = M.F[j][i];
        const fr = a >= b ? i : j, to = a >= b ? j : i;
        const Mx = Math.max(a, b), mn = Math.min(a, b), gap = Mx - mn;
        const legs = Math.round((gap * M.hor) / 24);
        const key = `${i}-${j}`;
        const ap = M.approvals.filter((x) => x.key === key);
        const al = ap.reduce((t, x) => t + x.legs, 0);
        const open = Math.max(0, legs - al);
        M.pairs.push({
          key, i, j, fr, to, M: Mx, m: mn, gap, legs, km: KM[i][j], ap, al, open,
          gapOpen: legs > 0 ? (gap * open) / legs : 0,
          rs: ap.reduce((t, x) => t + x.rs, 0),
        });
      }
    }
    return M;
  };
  M.pair = (k) => M.pairs.find((p) => p.key === k);
  M.label = (p) => `${HUBS[p.fr].code} → ${HUBS[p.to].code}`;

  /** The three fill options for a lane pair. */
  M.options = (p) => {
    const r = mulberry(p.i * 17 + p.j * 5 + 3);
    const L = p.legs;
    const mk = (k, f) => {
      const cap = L >= 2 ? Math.max(1, Math.round(L * f)) : 0;
      const done = p.ap.find((x) => x.opt === k);
      return { k, cap, done, eff: done ? done.legs : Math.max(0, Math.min(cap, p.open)), rate: RATE[k] };
    };
    return [mk('A', 0.4 + r() * 0.1), mk('B', 0.28 + r() * 0.06), mk('C', 0.18 + r() * 0.04)];
  };

  M.totals = () => {
    let base = 0, now = 0, tot = 0, open = 0, ov = 0, apL = 0, apR = 0, legs = 0;
    for (const p of M.pairs) {
      base += p.gap * p.km; now += p.gapOpen * p.km; tot += 2 * p.M * p.km;
      open += p.open; ov += p.open * p.km * BLEND; apL += p.al; apR += p.rs; legs += p.legs;
    }
    return { emptyNow: tot ? (now / tot) * 100 : 0, emptyBase: tot ? (base / tot) * 100 : 0, open, recoverable: ov, approvedLegs: apL, approvedValue: apR, predicted: legs };
  };

  M.approve = (key, opt) => {
    const p = M.pair(key);
    if (p.ap.some((x) => x.opt === opt)) return null; // one decision per option per lane; undo it first
    const op = M.options(p).find((x) => x.k === opt);
    if (!op || op.eff < 1) return null;
    const rs = op.eff * p.km * op.rate;
    const entry = {
      id: M.uid++, key, opt, legs: op.eff, rs,
      t: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      label: `${HUBS[p.fr].code} ⇄ ${HUBS[p.to].code} · ${OPTION_META[opt].title}`,
    };
    M.approvals.push(entry);
    return entry;
  };
  M.undo = (id) => {
    const i = M.approvals.findIndex((a) => a.id === id);
    if (i < 0) return false;
    M.approvals.splice(i, 1);
    return true;
  };
  M.reset = () => { M.approvals = []; };

  /** The dispatch instruction a control tower would receive. Nothing is sent. */
  M.instruction = (p, op) => {
    const first = p.al;
    const ids = Array.from({ length: op.eff }, (_, k) => 'TR-' + (4000 + ((p.i * 131 + p.j * 57 + (first + k) * 37) % 5000)));
    const f = HUBS[p.fr].name, t = HUBS[p.to].name;
    const rs = op.eff * p.km * op.rate;
    return {
      ids, rs,
      text: {
        A: `Hold-list pull: move ${op.eff} held consignment group(s) bound for ${f} onto return trailers ${ids.join(', ')}. Pickup window: next ${M.hor} h.`,
        B: `Marketplace listing: ${op.eff} return slot(s) ${t} → ${f} on trailers ${ids.join(', ')}, indicative rate ₹${Math.round(op.rate * p.km).toLocaleString('en-IN')} per slot.`,
        C: `Stand-down: release ${op.eff} contracted trailer(s) on ${t} → ${f} (${ids.join(', ')}) from the next cycle.`,
      }[op.k],
      driverNote: p.km > 1800 ? 'Driver-hours check: relay or hub swap needed on this length.' : 'Driver-hours check: within limits.',
    };
  };

  M.exportLog = () => {
    const rows = [['id', 'time', 'lane', 'option', 'return_legs', 'value_inr']];
    for (const a of M.approvals) {
      const p = M.pair(a.key);
      rows.push([a.id, a.t, `${HUBS[p.fr].code}-${HUBS[p.to].code}`, OPTION_META[a.opt].title, a.legs, Math.round(a.rs)]);
    }
    return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  };

  return M;
}

/* ------------------------------------------------------------- CSV ingest */

const norm = (s) => String(s ?? '').trim().toLowerCase();
const aliasIndex = new Map();
HUBS.forEach((h, i) => {
  aliasIndex.set(h.code.toLowerCase(), i);
  aliasIndex.set(h.name.toLowerCase(), i);
  h.aliases.forEach((a) => aliasIndex.set(a, i));
});

function splitCsvLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

export const CSV_TEMPLATE =
  'origin,destination,loaded,trips,date\n' +
  'DEL,BOM,1,120,2026-09-01\nBOM,DEL,1,58,2026-09-01\nBOM,DEL,0,62,2026-09-01\n' +
  'DEL,BLR,1,64,2026-09-01\nBLR,DEL,1,31,2026-09-01\nBLR,DEL,0,33,2026-09-01\n';

/**
 * Parse a trips file. Columns (header names are matched loosely):
 *   origin, destination, loaded (1/0/yes/no/loaded/empty), trips (optional, default 1), date (optional)
 * Returns { ok, error?, F, days, rows, used, skipped:{reason:count}, unknownPlaces:[...], loaded, empty }.
 */
export function parseTrips(text, { days: daysOverride } = {}) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { ok: false, error: 'The file needs a header row and at least one trip.' };
  const head = splitCsvLine(lines[0]).map(norm);
  const find = (...names) => head.findIndex((h) => names.includes(h));
  const iO = find('origin', 'from', 'source', 'origin_hub', 'from_hub');
  const iD = find('destination', 'dest', 'to', 'destination_hub', 'to_hub');
  const iL = find('loaded', 'is_loaded', 'load', 'status', 'loaded_flag');
  const iT = find('trips', 'count', 'trailers', 'n', 'legs');
  const iDt = find('date', 'day', 'trip_date');
  if (iO < 0 || iD < 0) return { ok: false, error: 'Could not find "origin" and "destination" columns in the header row.' };

  const F = Array.from({ length: NH }, () => Array(NH).fill(0));
  const skipped = {};
  const bump = (r) => (skipped[r] = (skipped[r] || 0) + 1);
  const unknown = new Set();
  let used = 0, loaded = 0, empty = 0;
  const dates = [];
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line);
    const o = aliasIndex.get(norm(c[iO])), d = aliasIndex.get(norm(c[iD]));
    if (o == null || d == null) {
      [c[iO], c[iD]].forEach((x, k) => { if ((k === 0 ? o : d) == null && norm(x)) unknown.add(String(x).trim()); });
      bump('place not in the 8 gateways');
      continue;
    }
    if (o === d) { bump('same origin and destination'); continue; }
    const n = iT >= 0 ? Number(c[iT]) : 1;
    if (!Number.isFinite(n) || n <= 0) { bump('trip count is not a positive number'); continue; }
    let isLoaded = true;
    if (iL >= 0) {
      const v = norm(c[iL]);
      if (['0', 'n', 'no', 'false', 'empty', 'e'].includes(v)) isLoaded = false;
      else if (['1', 'y', 'yes', 'true', 'loaded', 'l'].includes(v)) isLoaded = true;
      else { bump('could not read the loaded/empty flag'); continue; }
    }
    if (iDt >= 0) { const t = Date.parse(c[iDt]); if (Number.isFinite(t)) dates.push(t); }
    used += n;
    if (isLoaded) { F[o][d] += n; loaded += n; } else empty += n;
  }
  if (!used) return { ok: false, error: 'No usable trips found. Check the gateway names and the loaded column.', skipped, unknownPlaces: [...unknown] };
  let days = daysOverride;
  if (!days) days = dates.length > 1 ? Math.max(1, Math.round((Math.max(...dates) - Math.min(...dates)) / 86400000) + 1) : 30;
  const perDay = F.map((r) => r.map((v) => +(v / days).toFixed(3)));
  return { ok: true, F: perDay, days, rows: lines.length - 1, used, loaded, empty, skipped, unknownPlaces: [...unknown].slice(0, 6) };
}

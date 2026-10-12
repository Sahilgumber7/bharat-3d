// Synthetic network data. Every number here is generated — nothing is real.
// Seeded so the demo looks the same on every load.

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Relative weight of a state in the network (drives volume). */
const WEIGHT = {
  maharashtra: 1, 'uttar-pradesh': 0.9, delhi: 0.85, 'tamil-nadu': 0.8, karnataka: 0.8, gujarat: 0.75, telangana: 0.7,
  haryana: 0.65, 'west-bengal': 0.6, rajasthan: 0.5, kerala: 0.5, 'madhya-pradesh': 0.45, bihar: 0.4, punjab: 0.4,
  odisha: 0.3, assam: 0.25, jharkhand: 0.25, chhattisgarh: 0.2, uttarakhand: 0.18, 'andhra-pradesh': 0.4, goa: 0.12,
};
const w = (s) => WEIGHT[s] ?? 0.1;

export const METRICS = {
  volume: { id: 'volume', label: 'Volume', unit: 'k/day', blurb: 'Parcels handled per day', higherIsBetter: null },
  ontime: { id: 'ontime', label: 'On-time', unit: '%', blurb: 'Delivered within promised window', higherIsBetter: true },
  returns: { id: 'returns', label: 'Returns', unit: '%', blurb: 'Returned to origin', higherIsBetter: false },
};

/** Major hubs. `state` is the registry slug the hub sits in. dx/dy nudge the label. */
export const HUBS = [
  { id: 'del', name: 'Delhi NCR', lon: 77.1, lat: 28.6, size: 10, state: 'delhi', dx: 10, dy: -16 },
  { id: 'mum', name: 'Mumbai', lon: 72.9, lat: 19.1, size: 9, state: 'maharashtra', dx: -78, dy: -4 },
  { id: 'blr', name: 'Bengaluru', lon: 77.6, lat: 12.97, size: 8, state: 'karnataka', dx: -92, dy: 4 },
  { id: 'hyd', name: 'Hyderabad', lon: 78.5, lat: 17.4, size: 6, state: 'telangana', dx: 12, dy: -8 },
  { id: 'maa', name: 'Chennai', lon: 80.27, lat: 13.08, size: 6, state: 'tamil-nadu', dx: 12, dy: 0 },
  { id: 'ccu', name: 'Kolkata', lon: 88.36, lat: 22.57, size: 5, state: 'west-bengal', dx: 12, dy: -6 },
  { id: 'amd', name: 'Ahmedabad', lon: 72.57, lat: 23.03, size: 4, state: 'gujarat', dx: -92, dy: -10 },
  { id: 'pnq', name: 'Pune', lon: 73.86, lat: 18.52, size: 4, state: 'maharashtra', dx: 10, dy: 12 },
  { id: 'jai', name: 'Jaipur', lon: 75.8, lat: 26.9, size: 3, state: 'rajasthan', dx: -66, dy: -10 },
  { id: 'lko', name: 'Lucknow', lon: 80.95, lat: 26.85, size: 3, state: 'uttar-pradesh', dx: 12, dy: -6 },
  { id: 'gau', name: 'Guwahati', lon: 91.74, lat: 26.14, size: 2, state: 'assam', dx: 10, dy: -14 },
  { id: 'cok', name: 'Kochi', lon: 76.27, lat: 9.93, size: 2, state: 'kerala', dx: -58, dy: 6 },
];
export const hubById = Object.fromEntries(HUBS.map((h) => [h.id, h]));

/** Lanes between hubs: [from, to, weight]. */
export const LANES = [
  ['del', 'mum', 10], ['del', 'blr', 6], ['del', 'ccu', 6], ['del', 'jai', 5], ['del', 'lko', 5], ['del', 'amd', 4],
  ['mum', 'blr', 7], ['mum', 'pnq', 6], ['mum', 'amd', 5], ['mum', 'hyd', 4],
  ['blr', 'hyd', 6], ['blr', 'maa', 6], ['hyd', 'maa', 4], ['blr', 'cok', 3], ['maa', 'cok', 3],
  ['ccu', 'gau', 3], ['ccu', 'hyd', 3], ['ccu', 'lko', 3], ['pnq', 'hyd', 3], ['jai', 'amd', 3],
  ['lko', 'gau', 2], ['pnq', 'blr', 4],
].map(([from, to, weight], i) => ({ i, from, to, weight, id: `${from}-${to}` }));

/** Smooth festive-season bump: peaks around mid-Oct, with a small summer dip. */
const bump = (m) => Math.exp(-(((m - 9.5) / 1.8) ** 2));
const loopM = (m) => ((m % 12) + 12) % 12;

const slugsSeen = new Set();
let PHASE = {};
let BASE = {};

/** Call once with the registry slugs to fix per-state base values. */
export function initStates(slugs) {
  for (const s of slugs) {
    if (slugsSeen.has(s)) continue;
    slugsSeen.add(s);
    PHASE[s] = rnd() * 1.2 - 0.6;
    BASE[s] = {
      volume: Math.round(w(s) * 100 + rnd() * 18),
      ontime: +(82 + rnd() * 16 - (1 - Math.min(1, w(s) * 1.4)) * 4).toFixed(1),
      returns: +(3 + rnd() * 9 + (1 - Math.min(1, w(s) * 1.4)) * 3).toFixed(1),
    };
  }
}

const season = (slug, m) => 1 + 0.3 * bump(loopM(m) + (PHASE[slug] || 0)) - 0.08 * Math.cos((loopM(m) / 12) * 2 * Math.PI);

/** Value of `metric` for a state at fractional month `m` (0 = Jan 1). */
export function stateValue(metric, slug, m) {
  const base = BASE[slug]?.[metric];
  if (base == null) return null;
  const k = (season(slug, m) - 1) / 0.3;
  if (metric === 'volume') return base * season(slug, m);
  if (metric === 'ontime') return base - 3 * k;
  return base + 3 * k;
}

/** Fixed domain per metric across the whole year, so colours keep their meaning. */
export function domainOf(metric, slugs) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of slugs) {
    for (let m = 0; m < 12; m += 0.5) {
      const v = stateValue(metric, s, m);
      if (v == null) continue;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  return [lo, hi];
}

/** National aggregate for a metric at month `m`. */
export function nationalValue(metric, slugs, m) {
  let sum = 0;
  let wsum = 0;
  for (const s of slugs) {
    const v = stateValue(metric, s, m);
    if (v == null) continue;
    const wt = BASE[s].volume;
    sum += metric === 'volume' ? v : v * wt;
    wsum += wt;
  }
  return metric === 'volume' ? sum : sum / wsum;
}

/** 0–1 "how stressed is this lane" at month m: peak season + a stable per-lane bias. */
const laneBias = LANES.map(() => 0.55 + rnd() * 0.9);
export function laneStress(i, m) {
  // Only lanes with a high bias strain at the festive peak; the rest keep flowing.
  return Math.min(1, Math.max(0, (bump(loopM(m)) * laneBias[i] - 0.55) * 1.7));
}
/** 0–1 "how busy is this lane" at month m. */
export function laneLoad(i, m) {
  const wn = LANES[i].weight / 10; // heavier lanes carry more, always
  const v = 0.22 + (0.42 + 0.4 * wn) * (0.55 + 0.45 * bump(loopM(m))) + 0.06 * Math.sin(m * 0.9 + i);
  return Math.min(1, Math.max(0.1, v));
}

/** Hub throughput (k/day) at month m. */
export function hubThroughput(hubId, m) {
  const h = hubById[hubId];
  return h.size * 9 * (1 + 0.3 * bump(loopM(m)));
}

/** Average dwell hours — rises under peak load. Cosmetic, synthetic. */
export function hubDwell(hubId, m) {
  const h = hubById[hubId];
  return 3.1 + (11 - h.size) * 0.12 + 1.9 * bump(loopM(m));
}

export function rankStates(metric, slugs, m) {
  return [...slugs]
    .filter((s) => stateValue(metric, s, m) != null)
    .sort((a, b) => stateValue(metric, b, m) - stateValue(metric, a, m));
}

export const fmt = {
  num: (v, d = 0) => v.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d }),
  parcels: (kPerDay) => (kPerDay >= 1000 ? `${(kPerDay / 1000).toFixed(2)}M` : `${Math.round(kPerDay)}k`),
};

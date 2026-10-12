// The guided tour. Each step moves the camera, can change the metric or month,
// and narrates one idea. `pose(geo, aspect, hero)` returns the camera pose.
const hero = (h, patch = {}) => ({ ...h(), ...patch });

export const TOUR = [
  {
    title: 'One country, one network',
    body: 'Thirty-six states, 785 districts. Brightness and height show how many parcels each state handles. This is a quiet April.',
    metric: 'volume', mf: 3.4, dur: 8,
    pose: (g, a, h) => { const p = h(); return { ...p, az: 0.28, dist: p.dist * 0.92 }; },
  },
  {
    title: 'Twelve hubs, twenty-two lanes',
    body: 'Every spark is a batch of parcels moving between hubs. Busier lanes carry more of them, and they run both ways.',
    metric: 'volume', mf: 3.4, dur: 9, emph: ['del', 'mum', 'blr', 'hyd', 'maa', 'ccu'],
    pose: (g, a, h) => { const p = h(); return { target: p.target.clone(), dist: p.dist * 0.72, el: 0.82, az: -0.38 }; },
  },
  {
    title: 'Follow one parcel',
    body: 'Delhi to Kochi. It hops through Bengaluru, the way a real consignment moves from one hub to the next.',
    metric: 'volume', mf: 3.4, dur: 15, route: ['del', 'blr', 'cok'], emph: ['del', 'blr', 'cok'],
    focus: ['del', 'blr', 'cok'], rate: 3.2,
  },
  {
    title: 'Then the festive rush',
    body: 'From September volume climbs. Lanes shift from aqua to coral as they strain, and the states rise.',
    metric: 'volume', mf: 7.3, mfTo: 10.9, dur: 13, rate: 1.2,
    pose: (g, a, h) => { const p = h(); return { target: p.target.clone(), dist: p.dist * 0.88, el: 1.0, az: -0.22 }; },
  },
  {
    title: 'Where the pressure builds',
    body: 'In peak weeks the west corridor, Mumbai, Pune and Ahmedabad, carries the most strain. Slower lanes mean later parcels.',
    metric: 'volume', mf: 9.8, dur: 10, focus: ['mum', 'pnq', 'amd'], emph: ['mum', 'pnq', 'amd'],
    pose: (g) => ({ target: g.lonLat(73.3, 20.7, 0), dist: 210, el: 0.8, az: 0.5 }),
  },
  {
    title: 'Your network, your numbers',
    body: 'Everything you saw is synthetic. Swap in real lanes and volumes and this becomes a living view of your own network.',
    metric: 'volume', mf: 9.4, dur: 9,
    pose: (g, a, h) => hero(h, { az: 0.05 }),
  },
];

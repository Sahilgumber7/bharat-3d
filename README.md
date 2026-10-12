# bharat-3d

3D maps of India for Three.js.

**[Open the live demo →](https://bharat3d.vercel.app)**

[![Every Indian state in 3D](packages/map-view-controller/examples/india/og.png)](https://bharat3d.vercel.app)

## Packages

| Package | What it is |
| --- | --- |
| [`packages/map-view-controller`](packages/map-view-controller) | **`@bharat3d/state-maps`** — every Indian state and UT as a 3D district map (28 states + 8 UTs, 785 districts), with six camera presets, four palettes, and an npx CLI. |

```bash
cd packages/map-view-controller
npm install
npm test
npm run demo      # gallery of all 36 states/UTs → localhost:5173/examples/india/
```

See the [package README](packages/map-view-controller/README.md) for the API.

## Data overlays

`createIndiaMap` can draw your own numbers on the map: per-state colour and
relief, markers pinned to real lon/lat, and weighted arcs between places.

```js
india.setValues({ maharashtra: 120, delhi: 95 }, { relief: 0.9 });
india.addPoints([{ lon: 77.1, lat: 28.6, value: 10 }]);
india.addArcs([{ from: [77.1, 28.6], to: [72.9, 19.1], weight: 6 }]);
```

A cinematic worked example with **synthetic** logistics data lives at
`packages/map-view-controller/examples/logistics/` (`/logistics/` once
deployed): a bloom-lit night map, GPU-driven parcel flows along hub-to-hub
lanes, a festive-season month timeline, click-through drill-down from state to
hub, and a scripted guided tour. It ships its own vendored Three.js (r160) so
the rest of the repo is unaffected. Deep links: `?metric=returns&m=9.5&sel=maharashtra`,
`?intro=0` to skip the fly-in, `?tour=1` to start the tour.

## Backhaul (return-leg planner, `examples/lane-balance`)

`packages/map-view-controller/examples/lane-balance/` (`/lane-balance/` once
deployed) turns the map into a working tool for line-haul planners: which lanes
between eight gateways will run empty on the way back, how many legs and
roughly how much money, then three ways to fix it (consolidate held PTL
freight, list on an FTL marketplace, release hired trailers). A planner reviews
a dispatch-instruction preview and approves; every decision is logged,
exportable and reversible. Nothing is ever sent.

- Loaded legs stream as aqua, empty returns as coral; approving a fix turns coral to aqua.
- Festive-surge slider and 24/48/72 h horizon.
- **Use your trips file** recomputes everything from a CSV (`origin,destination,loaded,trips,date`)
  entirely in the browser. Nothing is uploaded.
- Default numbers are illustrative simulation, labelled as such.

`model.js` has no DOM or Three.js dependency and is covered by tests.

## Data

Boundaries are bharatlas.com's 2024 LGD snapshot — 785 districts and 6,472
sub-districts across all 36 states/UTs, including Telangana and Ladakh
(CC0-1.0 / CC-BY-4.0).

Two generated, committed artifacts derive from it:

| File | Built by | Why |
| --- | --- | --- |
| `data/states/*.js` | `npm run build:data -- --src <file>` | One module per state, loaded on demand. |
| `data/india-outline.js` | `npm run build:overview` | Simplified district rings in lon/lat for the national picker — so the landing view costs ~185 KB gzipped instead of importing all 36 full-detail state modules (2.4 MB). |

CI fails if `data/india-outline.js` is out of step with the state data, so a
boundary refresh cannot silently ship a stale overview.

The social card (`examples/india/og.png`) is a real screenshot of the demo,
regenerated with `npm run build:social` — see `tools/build-social.mjs`.

## Status

Pre-release. **`@bharat3d` is not yet claimed on npm.** The CLI and the HTML
template's CDN import map both reference the scope, so `npx @bharat3d/state-maps`
only resolves once it is published. Claiming it needs a free npm org named
`bharat3d` (npmjs.com → *Add organization*), after which `npm publish` from
`packages/map-view-controller` works as-is.

## License

MIT — see [LICENSE](LICENSE). Boundary data carries its own upstream license
(CC0-1.0 / CC-BY-4.0).

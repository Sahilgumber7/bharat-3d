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

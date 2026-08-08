# bharat-3d

3D maps of India for Three.js.

## Packages

| Package | What it is |
| --- | --- |
| [`packages/map-view-controller`](packages/map-view-controller) | **`@bharat3d/state-maps`** — every Indian state and UT as a 3D district map (35 states, 641 districts), with six camera presets, four palettes, and an npx CLI. |

```bash
cd packages/map-view-controller
npm install
npm test
npm run demo      # gallery of all 35 states → localhost:5173/examples/india/
```

See the [package README](packages/map-view-controller/README.md) for the API.

## Status

Pre-release. Two things to settle before publishing:

- **`@bharat3d` is a placeholder scope** and is not claimed on npm. The CLI and the
  HTML template's CDN import map both reference it, so they only resolve once a
  real name is published.
- **Boundary data is Census 2011** (via [DataMeet](https://github.com/datameet/maps)),
  so Telangana and Ladakh are absent and district counts predate later
  reorganisations. `npm run build:data -- --src <file>` regenerates from a newer
  source without any code changes.

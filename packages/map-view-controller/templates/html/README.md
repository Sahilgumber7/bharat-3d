# __NAME__ — 3D district map

A 3D map of __NAME__ (__DISTRICTS__ districts) built with
[`__PKG__`](https://www.npmjs.com/package/__PKG__).

## Run it

```bash
npx serve .
```

No install step — `index.html` pulls `three` and `__PKG__` from a CDN via an
import map. To use your own bundler instead, `npm install __PKG__ three` and
drop the import map.

## Try

- Click the six icons, bottom-right — or press keys `1`–`6`.
- `map.setPalette('paper')` in the console — also `ember`, `aqua`.
- `map.setView('exploded')`, `map.setState('kerala')`.

## The six views

| | |
| --- | --- |
| `isometric` | The default hero angle |
| `crossSection` | A real clipping plane through the state |
| `topDown` | Flat 2D board view |
| `frontElevation` | Orthogonal, dead-on |
| `firstPerson` | Ground-level walkthrough |
| `exploded` | Districts offset outward from the centroid |

## Data

Boundaries are bharatlas.com's 2024 LGD snapshot: 785 districts across all 36
states/UTs, including Telangana and Ladakh.

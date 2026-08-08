# __NAME__ — 3D district map

__NAME__ (__DISTRICTS__ districts) with [`__PKG__`](https://www.npmjs.com/package/__PKG__),
React and Vite.

```bash
npm install
npm run dev
```

`createStateMap` owns the renderer, render loop and resize handling, so the
React side only manages lifecycle — create it in an effect, `destroy()` on
cleanup. See `App.jsx`.

Already have a Three.js scene? Skip `createStateMap` and use `buildStateMap` +
`MapViewController` against your own objects, or the `__PKG__/react` wrapper.

Boundaries are Census 2011 (via DataMeet): Telangana and Ladakh are absent from
that vintage, and district counts predate later reorganisations.

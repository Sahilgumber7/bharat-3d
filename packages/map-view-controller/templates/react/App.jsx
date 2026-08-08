import { useEffect, useRef, useState } from 'react';
import { createStateMap } from '__PKG__';
import { loadStateData } from '__PKG__/data';

const VIEWS = ['isometric', 'crossSection', 'topDown', 'frontElevation', 'firstPerson', 'exploded'];
const PALETTES = ['midnight', 'paper', 'ember', 'aqua'];

export default function App() {
  const hostRef = useRef(null);
  const mapRef = useRef(null);
  const [view, setView] = useState('isometric');
  const [palette, setPalette] = useState('midnight');

  // Create once. createStateMap owns the renderer, loop and resize handling,
  // so the effect only has to tear it down again.
  useEffect(() => {
    let map;
    let cancelled = false;

    createStateMap({
      container: hostRef.current,
      state: '__SLUG__',        // __NAME__ — __DISTRICTS__ districts
      load: loadStateData,
      palette: 'midnight',
      onViewChange: setView,
    }).then((m) => {
      if (cancelled) return m.destroy();
      mapRef.current = m;
      map = m;
    });

    return () => {
      cancelled = true;
      map?.destroy();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => { mapRef.current?.setPalette(palette); }, [palette]);

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <div ref={hostRef} style={{ width: '100%', height: '100%' }} />

      <div style={{ position: 'absolute', top: 16, left: 16, display: 'flex', gap: 6 }}>
        {PALETTES.map((p) => (
          <button key={p} onClick={() => setPalette(p)} aria-pressed={p === palette}>
            {p}
          </button>
        ))}
      </div>

      <p style={{ position: 'absolute', bottom: 16, left: 16, margin: 0, color: '#8891b5' }}>
        __NAME__ · view: {view} · {VIEWS.length} presets in the toolbar
      </p>
    </div>
  );
}

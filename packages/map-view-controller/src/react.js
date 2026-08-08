import { useEffect, useRef } from 'react';
import { MapViewController } from './MapViewController.js';

/**
 * Optional React wrapper around the framework-agnostic core.
 *
 * Renders nothing itself — the toolbar is a DOM node appended to `container`
 * (or the canvas's parent), exactly as in the vanilla version. React only owns
 * the lifecycle.
 *
 * @example
 *   <MapViewController
 *     scene={scene} camera={camera} renderer={renderer}
 *     stateConfig={biharConfig}
 *     theme={{ accent: '#E8A820' }}
 *     onViewChange={(id) => setActive(id)}
 *   />
 */
export function MapViewControllerReact({
  scene,
  camera,
  renderer,
  stateConfig,
  theme,
  position = 'bottom-right',
  orientation = 'vertical',
  duration = 700,
  easing = 'easeInOutCubic',
  views,
  container,
  controls,
  initialView = 'isometric',
  view, // optional controlled view id
  onViewChange,
  onReady,
}) {
  const ref = useRef(null);
  const onViewChangeRef = useRef(onViewChange);
  onViewChangeRef.current = onViewChange;

  // Rebuild only when the things the controller genuinely owns change.
  useEffect(() => {
    if (!scene || !camera) return undefined;

    const controller = new MapViewController(scene, camera, stateConfig, {
      renderer,
      container: container?.current ?? container,
      theme,
      position,
      orientation,
      duration,
      easing,
      views,
      controls,
      initialView: view || initialView,
      onViewChange: (id) => onViewChangeRef.current?.(id),
    });

    ref.current = controller;
    onReady?.(controller);

    return () => {
      controller.destroy();
      ref.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, camera, renderer, stateConfig, views, container, controls]);

  // Theme / layout changes restyle in place rather than rebuilding.
  useEffect(() => {
    ref.current?.setTheme(theme, position, orientation);
  }, [theme, position, orientation]);

  // Controlled mode: follow the `view` prop when it diverges.
  useEffect(() => {
    if (view && ref.current && ref.current.getView() !== view) ref.current.setView(view);
  }, [view]);

  return null;
}

export default MapViewControllerReact;

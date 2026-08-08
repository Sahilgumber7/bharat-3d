import { resolveTheme, POSITIONS } from './theme.js';

/**
 * The floating icon toolbar. Plain DOM + inline styles — no CSS file to import,
 * no class-name collisions with the host app, nothing to bundle.
 */
export class Toolbar {
  /**
   * @param {object} opts
   * @param {HTMLElement} opts.container   element the toolbar is appended to (must be positioned)
   * @param {Array} opts.views             view descriptors ({ id, label, title, icon })
   * @param {object} opts.theme            theme tokens
   * @param {string|object} opts.position  preset name or explicit CSS offsets
   * @param {'horizontal'|'vertical'} opts.orientation
   * @param {(id:string)=>void} opts.onSelect
   */
  constructor({ container, views, theme, position, orientation = 'vertical', onSelect }) {
    this.container = container;
    this.views = views;
    this.theme = resolveTheme(theme);
    this.onSelect = onSelect;
    this.buttons = new Map();

    const el = document.createElement('div');
    el.className = 'mvc-toolbar';
    el.setAttribute('role', 'toolbar');
    el.setAttribute('aria-label', 'Map view presets');
    this.el = el;

    for (const view of views) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mvc-btn';
      btn.dataset.viewId = view.id;
      btn.title = view.title || view.label || view.id;
      btn.setAttribute('aria-label', btn.title);
      btn.setAttribute('aria-pressed', 'false');
      btn.innerHTML = view.icon || '';
      btn.addEventListener('click', () => this.onSelect?.(view.id));
      el.appendChild(btn);
      this.buttons.set(view.id, btn);
    }

    this.applyStyles(position, orientation);
    container.appendChild(el);
  }

  applyStyles(position, orientation) {
    const t = this.theme;
    const pos = typeof position === 'string' ? POSITIONS[position] : position;
    const offsets = pos || POSITIONS['bottom-right'];

    Object.assign(this.el.style, {
      position: 'absolute',
      display: 'flex',
      flexDirection: orientation === 'horizontal' ? 'row' : 'column',
      gap: t.gap,
      padding: t.padding,
      background: t.surface,
      border: `1px solid ${t.border}`,
      borderRadius: t.radius,
      boxShadow: t.shadow,
      backdropFilter: t.backdropFilter,
      WebkitBackdropFilter: t.backdropFilter,
      fontFamily: t.fontFamily,
      zIndex: '10',
      pointerEvents: 'auto',
      ...offsets,
    });

    for (const btn of this.buttons.values()) {
      Object.assign(btn.style, {
        width: t.buttonSize,
        height: t.buttonSize,
        display: 'grid',
        placeItems: 'center',
        padding: '0',
        border: '0',
        borderRadius: `calc(${t.radius} - 4px)`,
        background: 'transparent',
        color: t.icon,
        cursor: 'pointer',
        transition: 'background 160ms ease, color 160ms ease, transform 160ms ease',
        WebkitTapHighlightColor: 'transparent',
      });
      const svg = btn.querySelector('svg');
      if (svg) Object.assign(svg.style, { width: '20px', height: '20px', display: 'block' });

      btn.addEventListener('pointerenter', () => {
        if (btn.dataset.active !== 'true') btn.style.background = t.surfaceHover;
      });
      btn.addEventListener('pointerleave', () => {
        if (btn.dataset.active !== 'true') btn.style.background = 'transparent';
      });
    }
  }

  /** Highlight the given view id, clearing every other button. */
  setActive(id) {
    const t = this.theme;
    for (const [viewId, btn] of this.buttons) {
      const active = viewId === id;
      btn.dataset.active = String(active);
      btn.setAttribute('aria-pressed', String(active));
      btn.style.background = active ? t.accent : 'transparent';
      btn.style.color = active ? t.iconActive : t.icon;
      btn.style.transform = active ? 'scale(1.04)' : 'none';
    }
  }

  setTheme(theme, position, orientation) {
    this.theme = resolveTheme(theme);
    this.applyStyles(position, orientation);
  }

  destroy() {
    this.el.remove();
    this.buttons.clear();
  }
}

export default Toolbar;

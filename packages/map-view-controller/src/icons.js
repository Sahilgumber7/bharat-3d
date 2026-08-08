/**
 * Inline SVG icons for the default view presets.
 * Stroke-based, `currentColor`, 24x24 — so the toolbar can theme them via CSS.
 * No icon-font or external dependency.
 */

const wrap = (body) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  isometric: wrap(`
    <path d="M12 3 21 8v8l-9 5-9-5V8z"/>
    <path d="M3 8l9 5 9-5"/>
    <path d="M12 13v8"/>`),

  crossSection: wrap(`
    <path d="M3 12h18"/>
    <path d="M5 12V7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v5"/>
    <path d="M6 16.5h3M11 16.5h3M16 16.5h2"/>`),

  topDown: wrap(`
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>`),

  frontElevation: wrap(`
    <path d="M3 20h18"/>
    <path d="M6 20V9l6-4 6 4v11"/>
    <path d="M10 20v-5h4v5"/>`),

  firstPerson: wrap(`
    <circle cx="12" cy="7" r="3"/>
    <path d="M5 21v-1a7 7 0 0 1 14 0v1"/>
    <path d="M12 10.5v3"/>`),

  exploded: wrap(`
    <rect x="9" y="9" width="6" height="6" rx="1"/>
    <path d="M12 7V3M12 17v4M7 12H3M17 12h4"/>
    <path d="M12 3.8 10.6 5.2M12 3.8l1.4 1.4"/>
    <path d="M20.2 12l-1.4-1.4M20.2 12l-1.4 1.4"/>`),
};

export default ICONS;

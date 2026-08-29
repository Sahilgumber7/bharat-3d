// Renders the social card and the apple-touch icon.
//
// og.png is a real screenshot of the live demo rather than an illustration, so
// the card can never drift from what the link actually opens into. Re-run it
// whenever the palette or the map itself changes.
//
// Playwright is deliberately not a devDependency: installing it downloads a
// browser, which would slow every CI run for the sake of an asset that changes
// a few times a year. Install it on demand instead.
//
//   npm run demo                    # in another terminal
//   npx --yes playwright install chromium
//   npm run build:social [-- --url http://localhost:5173/examples/india/]
//
// Outputs: examples/india/og.png (1200x630), examples/india/apple-touch-icon.png (180x180)
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'examples/india');

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};
const URL_ = flag('url', 'http://localhost:5173/examples/india/');

const browser = await chromium.launch();

// --- apple-touch-icon: the favicon at 180px, on its own gradient (iOS does
// --- not honour transparency or rounded corners, so the SVG's own are fine).
const icon = await browser.newPage({ viewport: { width: 180, height: 180 } });
await icon.goto(pathToFileURL(resolve(OUT, 'favicon.svg')).href);
await icon.screenshot({ path: resolve(OUT, 'apple-touch-icon.png'), omitBackground: true });
await icon.close();

// --- og.png
// 2x device scale then a 1200x630 downscale, so text and edges stay crisp on
// the retina displays most people will scroll past this on.
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
});
await page.goto(URL_, { waitUntil: 'networkidle', timeout: 60000 });
await page.click('#intro').catch(() => {});
// The camera eases into its opening pose; capturing mid-flight yields a tilted
// half-lit map. Wait for the motion to settle rather than for any one event.
await page.waitForTimeout(4000);

await page.evaluate(() => {
  // Strip the chrome — a social card wants the map and the wordmark, not a
  // screenshot of a UI the viewer cannot click.
  for (const sel of ['.panel', '.sidebarToggle', '.navTop', '#status', '#tooltip', '.mvc-toolbar']) {
    document.querySelectorAll(sel).forEach((el) => el.remove());
  }
  document.getElementById('stage')?.classList.add('sidebar-collapsed');
  // Nudge the map east so it clears the wordmark, and pull it in a little:
  // the demo's camera is framed for a tall viewport, and 630px crops Kanyakumari.
  const stage = document.getElementById('stage');
  if (stage) stage.style.transform = 'translateX(9%) scale(.88)';

  const card = document.createElement('div');
  card.style.cssText = `
    position: fixed; left: 56px; top: 50%; transform: translateY(-50%); z-index: 50;
    font-family: "Bricolage Grotesque", system-ui, sans-serif; color: var(--ink);
  `;
  card.innerHTML = `
    <div style="font: 800 68px/1 'Bricolage Grotesque', sans-serif; letter-spacing: -.04em;">bharat<span style="color: var(--accent)">3d</span></div>
    <div style="margin-top: 18px; font: 500 25px/1.35 'Space Grotesk', sans-serif; color: var(--muted); max-width: 15ch;">Every Indian state in 3D</div>
    <div style="margin-top: 26px; display: flex; gap: 26px; font: 600 15px/1 'Space Grotesk', sans-serif; letter-spacing: .06em; text-transform: uppercase; color: var(--muted);">
      <span><b style="display:block;font:800 30px/1 'Bricolage Grotesque',sans-serif;color:var(--ink);letter-spacing:-.02em;">36</b>states &amp; UTs</span>
      <span><b style="display:block;font:800 30px/1 'Bricolage Grotesque',sans-serif;color:var(--ink);letter-spacing:-.02em;">785</b>districts</span>
      <span><b style="display:block;font:800 30px/1 'Bricolage Grotesque',sans-serif;color:var(--ink);letter-spacing:-.02em;">6,472</b>sub-districts</span>
    </div>
  `;
  document.body.appendChild(card);
});
await page.waitForTimeout(400);

await page.screenshot({ path: resolve(OUT, 'og.png'), scale: 'css' });
await browser.close();
console.log('wrote examples/india/og.png and apple-touch-icon.png');

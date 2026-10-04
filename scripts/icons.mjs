// Renders the app icons from one SVG design with headless Chromium.
//   node scripts/icons.mjs
// Needs Playwright with a Chromium build (the Claude Code cloud container has
// one; on a laptop run `npx playwright install chromium` first).
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import { writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Three layouts share one drawing:
//   rounded  - transparent corners, used for icon-192/512 and the favicon
//   square   - full bleed, iOS applies its own mask (apple-touch-icon)
//   maskable - full bleed with the drawing inside the 80% safe zone (Android)
function svg(variant, size) {
  const S = 512;
  const scale = variant === 'maskable' ? 0.8 : 1;
  const bgRadius = variant === 'rounded' ? 112 : 0;
  // Court: 20 x 44 ft (portrait). Height 400 at scale 1.
  const H = 400 * scale, W = H * (20 / 44), cx = 256, cy = 256;
  const x0 = cx - W / 2, y0 = cy - H / 2, x1 = cx + W / 2, y1 = cy + H / 2;
  const kitchen = (7 / 22) * (H / 2);
  const line = 10 * scale, thin = 8 * scale, net = 15 * scale;
  const ballR = 58 * scale, bx = x1 + 2 * scale, by = y0 + 70 * scale;
  const holes = [[0, 0], [22, -12], [-22, -12], [22, 12], [-22, 12], [0, -25], [0, 25]]
    .map(([dx, dy]) => `<circle cx="${bx + dx * scale}" cy="${by + dy * scale}" r="${5.5 * scale}" fill="#A9BE2A"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${S} ${S}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2E67EC"/><stop offset="1" stop-color="#1A43B3"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.3" cy="0.2" r="0.9">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.16"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="ball" cx="0.38" cy="0.32" r="0.75">
      <stop offset="0" stop-color="#EEFB7A"/><stop offset="1" stop-color="#C9DE3C"/>
    </radialGradient>
    <filter id="shadow" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="${9 * scale}"/>
    </filter>
  </defs>
  <rect width="${S}" height="${S}" rx="${bgRadius}" fill="url(#bg)"/>
  <rect width="${S}" height="${S}" rx="${bgRadius}" fill="url(#glow)"/>
  <g stroke="#FFFFFF" stroke-linecap="round" fill="none">
    <rect x="${x0}" y="${y0}" width="${W}" height="${H}" rx="${6 * scale}" stroke-width="${line}"/>
    <line x1="${x0}" y1="${cy - kitchen}" x2="${x1}" y2="${cy - kitchen}" stroke-width="${thin}"/>
    <line x1="${x0}" y1="${cy + kitchen}" x2="${x1}" y2="${cy + kitchen}" stroke-width="${thin}"/>
    <line x1="${cx}" y1="${y0}" x2="${cx}" y2="${cy - kitchen}" stroke-width="${thin}"/>
    <line x1="${cx}" y1="${cy + kitchen}" x2="${cx}" y2="${y1}" stroke-width="${thin}"/>
    <line x1="${x0 - 10 * scale}" y1="${cy}" x2="${x1 + 10 * scale}" y2="${cy}" stroke-width="${net}" stroke-opacity="0.95"/>
  </g>
  <circle cx="${bx + 6 * scale}" cy="${by + 10 * scale}" r="${ballR}" fill="#0B1E5A" opacity="0.35" filter="url(#shadow)"/>
  <circle cx="${bx}" cy="${by}" r="${ballR}" fill="url(#ball)"/>
  ${holes}
</svg>`;
}

const out = 'public';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const jobs = [
  ['rounded', 512, 'icon-512.png', true],
  ['rounded', 192, 'icon-192.png', true],
  ['maskable', 512, 'icon-512-maskable.png', false],
  ['square', 180, 'apple-touch-icon.png', false],
  ['rounded', 48, '_fav-48.png', true],
  ['rounded', 32, '_fav-32.png', true],
  ['rounded', 16, '_fav-16.png', true],
];
for (const [variant, size, file, transparent] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:transparent}svg{display:block}</style></head><body>${svg(variant, size)}</body></html>`);
  await page.screenshot({ path: `${out}/${file}`, omitBackground: transparent, type: 'png' });
  await page.close();
  console.log('wrote', file);
}
await browser.close();
writeFileSync(`${out}/favicon.svg`, svg('rounded', 64).replace(/width="64" height="64"/, ''));
execSync(`convert ${out}/_fav-16.png ${out}/_fav-32.png ${out}/_fav-48.png ${out}/favicon.ico && rm ${out}/_fav-*.png`);
console.log('wrote favicon.svg, favicon.ico');

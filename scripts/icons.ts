/**
 * App icons (PWA, ADR-045) drawn from the myWallet mark: a neutral rounded tile with a
 * small outlined card, on the app background. Run: pnpm tsx scripts/icons.ts
 */
import sharp from "sharp";

const BG = "#0C0D0F";
const TILE = "#1A1C20";
const BORDER = "#2F333A";
const INK = "#E8E9EB";

/** `padding` keeps the mark inside the maskable safe zone (80 % circle). */
function svg(size: number, padding: number): string {
  const tile = size - padding * 2;
  const r = tile * 0.22;
  const cardW = tile * 0.5;
  const cardH = tile * 0.4;
  const stroke = Math.max(2, tile * 0.06);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <rect x="${padding}" y="${padding}" width="${tile}" height="${tile}" rx="${r}" fill="${TILE}" stroke="${BORDER}" stroke-width="${Math.max(1, tile * 0.02)}"/>
  <rect x="${(size - cardW) / 2}" y="${(size - cardH) / 2}" width="${cardW}" height="${cardH}" rx="${tile * 0.04}" fill="none" stroke="${INK}" stroke-width="${stroke}"/>
</svg>`;
}

const outputs = [
  { file: "icon-192.png", size: 192, padding: 12 },
  { file: "icon-512.png", size: 512, padding: 32 },
  { file: "icon-maskable-512.png", size: 512, padding: 96 },
  { file: "apple-touch-icon.png", size: 180, padding: 10 },
];

async function main() {
  for (const o of outputs) {
    await sharp(Buffer.from(svg(o.size, o.padding)))
      .png()
      .toFile(`public/icons/${o.file}`);
    console.log("public/icons/" + o.file);
  }
}

void main();

// Rasterize the repository-native vector mark; no external artwork or service.
import sharp from "sharp";
import { mkdir, readFile } from "node:fs/promises";
await mkdir("public/icons", { recursive: true });
const svg = await readFile("public/icon.svg");
for (const size of [192, 512]) {
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(`public/icons/icon-${size}.png`);
}
// The mark stays inside the central maskable safe area.
const maskable = svg.toString().replace('rx="112"', 'rx="0"');
await sharp(Buffer.from(maskable))
  .resize(512, 512)
  .png()
  .toFile("public/icons/maskable-512.png");

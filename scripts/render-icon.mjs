// Renders assets-src/icon.svg to assets/icon.png (512x512, transparent) with Playwright Chromium.
import { readFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const svg = await readFile(resolve(root, "assets-src/icon.svg"), "utf8");
const out = resolve(root, "assets/icon.png");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
  await page.setContent(
    `<!doctype html><html><head><style>html,body{margin:0;padding:0;background:transparent}svg{display:block;width:512px;height:512px}</style></head><body>${svg}</body></html>`,
  );
  await mkdir(dirname(out), { recursive: true });
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: 512, height: 512 } });
} finally {
  await browser.close();
}
console.log(`wrote ${out}`);

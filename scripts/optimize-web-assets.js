// scripts/optimize-web-assets.js
// Generates compressed WebP & icon derivatives strictly from existing repository assets
// (build/icon.png and docs/screenshot-*.png) for fast GitHub Pages LCP.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT_ASSETS = path.join(ROOT, 'website', 'assets');
const OUT_SHOTS = path.join(OUT_ASSETS, 'shots');

async function launchBrowser() {
  for (const channel of ['chrome', 'msedge', undefined]) {
    try {
      return await chromium.launch({ headless: true, ...(channel ? { channel } : {}) });
    } catch {}
  }
  throw new Error('Could not launch Chromium/Chrome/Edge for asset optimization.');
}

async function convertImage(page, srcPath, outPath, opts) {
  const buf = fs.readFileSync(srcPath);
  const dataUri = 'data:image/png;base64,' + buf.toString('base64');
  const outB64 = await page.evaluate(async ({ dataUri, targetW, targetH, mime, quality }) => {
    const img = new Image();
    img.src = dataUri;
    await img.decode();
    const w = targetW || img.naturalWidth;
    const h = targetH || Math.round((img.naturalHeight / img.naturalWidth) * w);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    const encoded = canvas.toDataURL(mime, quality);
    return encoded.split(',')[1];
  }, { dataUri, targetW: opts.width || 0, targetH: opts.height || 0, mime: opts.mime || 'image/webp', quality: opts.quality ?? 0.84 });

  const outBuf = Buffer.from(outB64, 'base64');
  fs.writeFileSync(outPath, outBuf);
  const savedPct = (((buf.length - outBuf.length) / buf.length) * 100).toFixed(1);
  console.log(`  ${path.relative(ROOT, outPath)}: ${(buf.length / 1024).toFixed(1)} KB -> ${(outBuf.length / 1024).toFixed(1)} KB (${savedPct}% saved)`);
}

async function main() {
  fs.mkdirSync(OUT_SHOTS, { recursive: true });
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');

    const iconSrc = path.join(ROOT, 'build', 'icon.png');
    if (fs.existsSync(iconSrc)) {
      await convertImage(page, iconSrc, path.join(OUT_ASSETS, 'icon-64.png'), { width: 64, height: 64, mime: 'image/png', quality: 1 });
      await convertImage(page, iconSrc, path.join(OUT_ASSETS, 'icon-64.webp'), { width: 64, height: 64, mime: 'image/webp', quality: 0.9 });
    }

    const docsDir = path.join(ROOT, 'docs');
    const shots = fs.readdirSync(docsDir).filter((f) => /^screenshot-.*\.png$/i.test(f)).sort();
    for (const file of shots) {
      const srcPath = path.join(docsDir, file);
      const base = file.replace(/\.png$/i, '');
      await convertImage(page, srcPath, path.join(OUT_SHOTS, `${base}.webp`), { mime: 'image/webp', quality: 0.84 });
      if (file === 'screenshot-overview.png') {
        await convertImage(page, srcPath, path.join(OUT_SHOTS, `${base}-680.webp`), { width: 680, height: 430, mime: 'image/webp', quality: 0.82 });
      }
    }
    console.log(`Done: optimized icon + ${shots.length} screenshots.`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";
import { rootDir } from "../server/config.js";
import { browserDiagnostics } from "../server/browser.js";
import { ensureDir } from "../server/lib/utils.js";

const outDir = path.join(rootDir, "assets", "brand");
ensureDir(outDir);

function html({ width, height, kind }) {
  const isProfile = kind === "profile";
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    width: ${width}px;
    height: ${height}px;
    display: grid;
    place-items: center;
    background: #09090b;
    font-family: Inter, Arial, sans-serif;
    color: #f8f2df;
  }
  .frame {
    position: relative;
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    background:
      radial-gradient(circle at 18% 22%, rgba(94,224,160,.34), transparent 24%),
      radial-gradient(circle at 82% 18%, rgba(228,195,106,.34), transparent 22%),
      linear-gradient(135deg, #09090b 0%, #14161c 48%, #0b1012 100%);
  }
  .grid {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(rgba(255,255,255,.06) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,.06) 1px, transparent 1px);
    background-size: 42px 42px;
    opacity: .32;
  }
  .tag {
    position: absolute;
    width: ${isProfile ? 610 : 360}px;
    height: ${isProfile ? 610 : 360}px;
    border-radius: ${isProfile ? 130 : 80}px;
    left: ${isProfile ? 235 : 96}px;
    top: ${isProfile ? 180 : 132}px;
    transform: rotate(-10deg);
    background: linear-gradient(145deg, #f3dc9a 0%, #e4c36a 64%, #b98d25 100%);
    box-shadow: 0 38px 90px rgba(0,0,0,.42);
  }
  .tag::before {
    content: "";
    position: absolute;
    width: ${isProfile ? 86 : 52}px;
    height: ${isProfile ? 86 : 52}px;
    border-radius: 50%;
    right: ${isProfile ? 80 : 48}px;
    top: ${isProfile ? 80 : 48}px;
    background: #0e1014;
    box-shadow: inset 0 0 0 14px rgba(255,255,255,.08);
  }
  .mark {
    position: absolute;
    left: ${isProfile ? 312 : 162}px;
    top: ${isProfile ? 402 : 244}px;
    transform: rotate(-10deg);
    font-weight: 900;
    font-size: ${isProfile ? 212 : 116}px;
    letter-spacing: 0;
    color: #16120a;
  }
  .copy {
    position: absolute;
    left: 530px;
    top: 154px;
    width: 900px;
  }
  .copy h1 {
    margin: 0;
    font-size: 92px;
    line-height: .92;
    letter-spacing: 0;
  }
  .copy h1 span { color: #e4c36a; }
  .copy p {
    width: 760px;
    margin: 30px 0 0;
    color: #d7d0c0;
    font-size: 34px;
    line-height: 1.2;
  }
  .pill {
    position: absolute;
    right: 96px;
    bottom: 74px;
    border: 1px solid rgba(255,255,255,.18);
    border-radius: 999px;
    padding: 18px 26px;
    color: #111;
    background: #5ee0a0;
    font-size: 26px;
    font-weight: 800;
  }
</style>
</head>
<body>
  <div class="frame">
    <div class="grid"></div>
    <div class="tag"></div>
    <div class="mark">AA</div>
    ${isProfile ? "" : `<div class="copy"><h1>Achado <span>Agora</span></h1><p>Ofertas verificadas e comparativos.</p></div><div class="pill">Confira no checkout</div>`}
  </div>
</body>
</html>`;
}

async function render(browser, fileName, width, height, kind) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html({ width, height, kind }), { waitUntil: "networkidle" });
  const filePath = path.join(outDir, fileName);
  await page.screenshot({ path: filePath, clip: { x: 0, y: 0, width, height } });
  await page.close();
  return filePath;
}

const executablePath = browserDiagnostics().executablePath;
if (!executablePath) {
  throw new Error("Chrome/Edge nao encontrado para gerar assets.");
}

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const profile = await render(browser, "facebook-profile.png", 1080, 1080, "profile");
  const cover = await render(browser, "facebook-cover.png", 1640, 624, "cover");
  console.log(`Perfil: ${profile}`);
  console.log(`Banner: ${cover}`);
} finally {
  await browser.close();
}

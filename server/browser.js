import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { config } from "./config.js";
import { ensureDir, nowIso, readJsonFile, writeJsonFileAtomic } from "./lib/utils.js";

const manualLoginFile = path.join(config.dataDir, "manual-login.json");

function candidateBrowserPaths() {
  const local = process.env.LOCALAPPDATA || "";
  const programFiles = process.env.ProgramFiles || "C:\\Program Files";
  const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  return [
    config.chromePath,
    path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(local, "Microsoft", "Edge", "Application", "msedge.exe")
  ].filter(Boolean);
}

export function findBrowserExecutable() {
  for (const candidate of candidateBrowserPaths()) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return "";
}

function isPidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function getManualLoginState() {
  const state = readJsonFile(manualLoginFile, null);
  if (!state) return { active: false };
  const active = isPidAlive(state.pid);
  if (!active) {
    try {
      fs.unlinkSync(manualLoginFile);
    } catch {
      // ignore stale marker cleanup
    }
    return { active: false };
  }
  return { ...state, active };
}

function targetUrl(target) {
  const normalized = String(target || "").toLowerCase();
  if (normalized === "gemini") return config.urls.gemini;
  if (normalized === "mercadolivre" || normalized === "ml") return config.urls.mercadoLivreAffiliate;
  if (normalized === "mercadolivre-gerador" || normalized === "ml-gerador") return config.urls.mercadoLivreLinkGenerator;
  if (normalized === "shopee") return config.urls.shopee;
  if (normalized === "facebook") return config.facebookPageUrl || config.urls.facebook;
  if (normalized === "meta" || normalized === "ads") return config.urls.metaAdsManager;
  if (/^https?:\/\//i.test(String(target))) return String(target);
  return "";
}

export function loginTargetsToUrls(targets = config.loginTargets) {
  const urls = targets.map(targetUrl).filter(Boolean);
  return [...new Set(urls)];
}

export function openManualLogin(targets = config.loginTargets) {
  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    throw new Error("Chrome/Edge nao encontrado. Defina AUTOBLOG_CHROME_PATH no .env.");
  }
  ensureDir(config.chromeProfileDir);
  const urls = loginTargetsToUrls(targets);
  if (!urls.length) urls.push(config.urls.gemini, config.urls.mercadoLivreAffiliate);

  const args = [
    `--user-data-dir=${config.chromeProfileDir}`,
    "--no-first-run",
    "--new-window",
    ...urls
  ];
  const child = spawn(executablePath, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref();
  const state = {
    pid: child.pid,
    executablePath,
    profileDir: config.chromeProfileDir,
    urls,
    openedAt: nowIso(),
    platform: os.platform()
  };
  writeJsonFileAtomic(manualLoginFile, state);
  return { ...state, active: true };
}

export async function withBrowser(fn, options = {}) {
  const manual = getManualLoginState();
  if (manual.active && !options.allowWhileManualLogin) {
    throw new Error("Janela de login manual ainda esta aberta. Feche essa janela antes de rodar a automacao.");
  }
  const executablePath = findBrowserExecutable();
  if (!executablePath) {
    throw new Error("Chrome/Edge nao encontrado. Defina AUTOBLOG_CHROME_PATH no .env.");
  }
  ensureDir(config.chromeProfileDir);
  const context = await chromium.launchPersistentContext(config.chromeProfileDir, {
    executablePath,
    headless: options.headless === true,
    viewport: { width: 1366, height: 900 },
    acceptDownloads: true,
    timeout: 20000,
    args: [
      "--no-first-run",
      "--disable-dev-shm-usage",
      "--disable-blink-features=AutomationControlled"
    ]
  });
  let deadline;
  try {
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(options.timeoutMs || 30000);
    const operation = fn({ context, page, executablePath });
    if (!options.deadlineMs) return await operation;
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error("A consulta a loja excedeu o tempo disponivel.")), options.deadlineMs);
      })
    ]);
  } finally {
    clearTimeout(deadline);
    await context.close().catch(() => {});
  }
}

export async function newPage(context, url = "") {
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  if (url) await page.goto(url, { waitUntil: "domcontentloaded" });
  return page;
}

export function browserDiagnostics() {
  return {
    executablePath: findBrowserExecutable(),
    profileDir: config.chromeProfileDir,
    manualLogin: getManualLoginState()
  };
}

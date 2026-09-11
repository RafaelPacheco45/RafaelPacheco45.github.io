import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { boundedInt, ensureDir } from "./lib/utils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const rootDir = path.resolve(__dirname, "..");

function loadDotEnv() {
  const envPath = path.join(rootDir, ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = value;
  }
}

loadDotEnv();

export function resolveFromRoot(value, fallback) {
  const selected = value || fallback;
  if (path.isAbsolute(selected)) return selected;
  return path.resolve(rootDir, selected);
}

function splitCsv(value, fallback) {
  const items = String(value || "").split(",").map((x) => x.trim()).filter(Boolean);
  return items.length ? items : fallback;
}

export const config = {
  host: process.env.AUTOBLOG_HOST || "127.0.0.1",
  port: boundedInt(process.env.AUTOBLOG_PORT, 4177, 1, 65535),
  dataDir: resolveFromRoot(process.env.AUTOBLOG_DATA_DIR, "./data"),
  dbPath: resolveFromRoot(process.env.AUTOBLOG_DB_PATH, "./data/autoblog.db"),
  chromeProfileDir: resolveFromRoot(process.env.AUTOBLOG_CHROME_PROFILE, "./data/chrome-profile"),
  chromePath: process.env.AUTOBLOG_CHROME_PATH || "",
  loginTargets: splitCsv(process.env.AUTOBLOG_LOGIN_TARGETS, ["mercadolivre", "shopee", "gemini", "facebook"]),
  siteUrl: process.env.AUTOBLOG_SITE_URL || "",
  defaultSearchLimit: boundedInt(process.env.AUTOBLOG_DEFAULT_SEARCH_LIMIT, 5, 1, 25),
  publicSearchLimit: boundedInt(process.env.AUTOBLOG_PUBLIC_SEARCH_LIMIT, 8, 3, 25),
  publicSearchHost: process.env.AUTOBLOG_PUBLIC_SEARCH_HOST || "127.0.0.1",
  publicSearchPort: boundedInt(process.env.AUTOBLOG_PUBLIC_SEARCH_PORT, 4178, 1, 65535),
  publicSearchAllowedOrigins: splitCsv(process.env.AUTOBLOG_PUBLIC_SEARCH_ORIGINS, []),
  publicSearchRateLimit: boundedInt(process.env.AUTOBLOG_PUBLIC_SEARCH_RATE_LIMIT, 6, 1, 120),
  publicSearchRateWindowMs: boundedInt(process.env.AUTOBLOG_PUBLIC_SEARCH_RATE_WINDOW_MS, 900000, 60000, 3600000),
  publicSearchCacheTtlMs: boundedInt(process.env.AUTOBLOG_PUBLIC_SEARCH_CACHE_TTL_MS, 900000, 60000, 86400000),
  publicSearchMaxQueue: boundedInt(process.env.AUTOBLOG_PUBLIC_SEARCH_MAX_QUEUE, 3, 0, 20),
  publicLiveSearchEnabled: process.env.AUTOBLOG_PUBLIC_LIVE_SEARCH === "1"
    || (process.env.AUTOBLOG_PUBLIC_LIVE_SEARCH == null && (process.env.AUTOBLOG_HOST || "127.0.0.1") === "127.0.0.1"),
  autoWorkerEnabled: process.env.AUTOBLOG_AUTO_WORKER !== "0",
  autoWorkerIntervalMs: boundedInt(process.env.AUTOBLOG_AUTO_WORKER_INTERVAL_MS, 15000, 3000, 300000),
  geminiRequired: process.env.AUTOBLOG_GEMINI_REQUIRED === "1",
  lomadeeApiKey: process.env.AUTOBLOG_LOMADEE_API_KEY || "",
  facebookPageUrl: process.env.AUTOBLOG_FACEBOOK_PAGE_URL || "",
  facebookAllowOrganicPublish: process.env.AUTOBLOG_FACEBOOK_ALLOW_ORGANIC_PUBLISH === "1",
  metaAllowLiveAds: process.env.AUTOBLOG_META_ALLOW_LIVE_ADS === "1",
  metaDailyBudgetCapBRL: boundedInt(process.env.AUTOBLOG_META_DAILY_BUDGET_CAP_BRL, 20, 1, 1000),
  urls: {
    gemini: "https://gemini.google.com/app",
    mercadoLivreHome: "https://www.mercadolivre.com.br/",
    mercadoLivreAffiliate: "https://www.mercadolivre.com.br/l/afiliados-home",
    mercadoLivreLinkGenerator: "https://www.mercadolivre.com.br/afiliados/linkbuilder",
    shopee: "https://shopee.com.br/",
    lomadeeApi: "https://api.lomadee.com.br",
    facebook: "https://www.facebook.com/",
    metaAdsManager: "https://adsmanager.facebook.com/"
  }
};

ensureDir(config.dataDir);
ensureDir(config.chromeProfileDir);

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { config, rootDir } from "./config.js";
import {
  createTask,
  getAdDraft,
  listCampaignMetrics,
  listAdDrafts,
  listComparisons,
  listEvents,
  listPosts,
  listProducts,
  listSettings,
  listTasks,
  logEvent,
  retryTask,
  cancelTask,
  deleteCampaignMetric,
  upsertCampaignMetric
} from "./db.js";
import { browserDiagnostics, openManualLogin } from "./browser.js";
import { queueAutoCampaign, queueCaptureToBlog, queueGenerateComparison, queueSearchToBlog, runOnce, runUntilIdle } from "./worker.js";
import { loadSiteConfig, saveSiteConfig, updateSitemapAndRobots } from "./sitePublisher.js";
import { buildPublicSite } from "./staticExport.js";
import { runShoppingSearch } from "./shoppingSearchEngine.js";
import { boundedInt, cleanText, slugify } from "./lib/utils.js";

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

function sendJson(res, status, value) {
  const body = JSON.stringify(value, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendError(res, status, message, details = null) {
  sendJson(res, status, { ok: false, error: message, details });
}

function validateOptional(name, value, pattern, hint) {
  const normalized = cleanText(value || "");
  if (normalized && !pattern.test(normalized)) {
    throw new Error(`${name} invalido. ${hint}`);
  }
  return normalized;
}

function normalizeOptionalUrl(name, value) {
  const normalized = cleanText(value || "").replace(/\/+$/, "");
  if (!normalized) return "";
  try {
    const parsed = new URL(normalized);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("protocol");
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    throw new Error(`${name} invalida. Use uma URL http(s) completa.`);
  }
}

function normalizeOptionalEmail(name, value) {
  const normalized = cleanText(value || "");
  if (normalized && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error(`${name} invalido.`);
  }
  return normalized;
}

function monetizationPayload(site) {
  return {
    brand: site.brand || "",
    tagline: site.tagline || "",
    siteUrl: site.siteUrl || "",
    contactEmail: site.contactEmail || "",
    ga4MeasurementId: site.ga4MeasurementId || "",
    metaPixelId: site.metaPixelId || "",
    adsenseClient: site.adsenseClient || "",
    adsenseAutoAds: site.adsenseAutoAds !== false,
    adsenseAdSlot: site.adsenseAdSlot || "",
    adsenseSlots: {
      display: site.adsenseSlots?.display || "",
      homeRailLeft: site.adsenseSlots?.homeRailLeft || "",
      homeTop: site.adsenseSlots?.homeTop || "",
      homeAfterTrust: site.adsenseSlots?.homeAfterTrust || "",
      homeRailRight: site.adsenseSlots?.homeRailRight || "",
      homeMobile: site.adsenseSlots?.homeMobile || "",
      homeMobileAfterTrust: site.adsenseSlots?.homeMobileAfterTrust || "",
      articleTop: site.adsenseSlots?.articleTop || "",
      offerTop: site.adsenseSlots?.offerTop || "",
      comparisonTop: site.adsenseSlots?.comparisonTop || "",
      comparisonMiddle: site.adsenseSlots?.comparisonMiddle || "",
      comparisonBottom: site.adsenseSlots?.comparisonBottom || "",
      comparativosTop: site.adsenseSlots?.comparativosTop || "",
      comparativosBottom: site.adsenseSlots?.comparativosBottom || "",
      buscaTop: site.adsenseSlots?.buscaTop || ""
    },
    affiliates: {
      mlMattTool: site.affiliates?.mlMattTool || "",
      mlMattWord: site.affiliates?.mlMattWord || "",
      amazonTag: site.affiliates?.amazonTag || ""
    }
  };
}

function ownValue(input, key, fallback) {
  return Object.prototype.hasOwnProperty.call(input, key) ? input[key] : fallback;
}

function nestedOwnValue(input, objectKey, key, fallback) {
  const object = input[objectKey];
  if (object && Object.prototype.hasOwnProperty.call(object, key)) return object[key];
  return fallback;
}

function optionalAdSlot(input, key, fallback) {
  return validateOptional(`AdSense ${key}`, nestedOwnValue(input, "adsenseSlots", key, fallback || ""), /^\d{3,30}$/, "Use somente numeros ou deixe vazio.");
}

function updateMonetizationConfig(input) {
  const site = loadSiteConfig();
  const slots = site.adsenseSlots || {};
  const next = {
    ...site,
    siteUrl: normalizeOptionalUrl("siteUrl", ownValue(input, "siteUrl", site.siteUrl || "")),
    contactEmail: normalizeOptionalEmail("contactEmail", ownValue(input, "contactEmail", site.contactEmail || "")),
    ga4MeasurementId: validateOptional("GA4", ownValue(input, "ga4MeasurementId", site.ga4MeasurementId || ""), /^G-[A-Z0-9]+$/i, "Exemplo: G-XXXXXXXXXX."),
    metaPixelId: validateOptional("Meta Pixel", ownValue(input, "metaPixelId", site.metaPixelId || ""), /^\d{5,30}$/, "Use somente o ID numerico do pixel."),
    adsenseClient: validateOptional("AdSense Client", ownValue(input, "adsenseClient", site.adsenseClient || ""), /^ca-pub-\d+$/i, "Exemplo: ca-pub-0000000000000000."),
    adsenseAutoAds: ownValue(input, "adsenseAutoAds", site.adsenseAutoAds !== false) !== false,
    adsenseAdSlot: validateOptional("AdSense Slot", ownValue(input, "adsenseAdSlot", site.adsenseAdSlot || ""), /^\d{3,30}$/, "Use somente numeros ou deixe vazio."),
    adsenseSlots: {
      ...slots,
      display: validateOptional("AdSense display", ownValue(input, "adsenseAdSlot", slots.display || site.adsenseAdSlot || ""), /^\d{3,30}$/, "Use somente numeros ou deixe vazio."),
      homeRailLeft: optionalAdSlot(input, "homeRailLeft", slots.homeRailLeft),
      homeTop: optionalAdSlot(input, "homeTop", slots.homeTop),
      homeAfterTrust: optionalAdSlot(input, "homeAfterTrust", slots.homeAfterTrust),
      homeRailRight: optionalAdSlot(input, "homeRailRight", slots.homeRailRight),
      homeMobile: optionalAdSlot(input, "homeMobile", slots.homeMobile),
      homeMobileAfterTrust: optionalAdSlot(input, "homeMobileAfterTrust", slots.homeMobileAfterTrust),
      articleTop: optionalAdSlot(input, "articleTop", slots.articleTop),
      offerTop: optionalAdSlot(input, "offerTop", slots.offerTop),
      comparisonTop: optionalAdSlot(input, "comparisonTop", slots.comparisonTop),
      comparisonMiddle: optionalAdSlot(input, "comparisonMiddle", slots.comparisonMiddle),
      comparisonBottom: optionalAdSlot(input, "comparisonBottom", slots.comparisonBottom),
      comparativosTop: optionalAdSlot(input, "comparativosTop", slots.comparativosTop),
      comparativosBottom: optionalAdSlot(input, "comparativosBottom", slots.comparativosBottom),
      buscaTop: optionalAdSlot(input, "buscaTop", slots.buscaTop)
    },
    affiliates: {
      ...(site.affiliates || {}),
      mlMattTool: validateOptional("ML matt_tool", ownValue(input, "mlMattTool", nestedOwnValue(input, "affiliates", "mlMattTool", site.affiliates?.mlMattTool || "")), /^[A-Za-z0-9_-]{2,80}$/, "Copie o valor exato do portal ou deixe vazio."),
      mlMattWord: validateOptional("ML matt_word", ownValue(input, "mlMattWord", nestedOwnValue(input, "affiliates", "mlMattWord", site.affiliates?.mlMattWord || "")), /^[A-Za-z0-9_-]{2,80}$/, "Copie o valor exato do portal."),
      amazonTag: validateOptional("Amazon tag", ownValue(input, "amazonTag", nestedOwnValue(input, "affiliates", "amazonTag", site.affiliates?.amazonTag || "")), /^[A-Za-z0-9_-]{2,100}$/, "Exemplo: suatag-20.")
    }
  };
  const changed = JSON.stringify(site) !== JSON.stringify(next);
  if (changed) saveSiteConfig(next);
  return { site: next, changed };
}

function nonNegativeNumber(name, value) {
  if (value == null || value === "") return 0;
  const parsed = Number(String(value).replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} invalido.`);
  return parsed;
}

function nonNegativeInt(name, value) {
  if (value == null || value === "") return 0;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name} invalido.`);
  return parsed;
}

function boolInput(value, fallback = false) {
  if (value == null || value === "") return fallback;
  return value === true || value === "true" || value === "1" || value === 1 || value === "on";
}

function sanitizeCampaignName(input, fallback = "campanha-automatica") {
  const name = cleanText(input || fallback).slice(0, 120);
  return name || fallback;
}

function findExistingComparisonSlug(query) {
  const target = slugify(query);
  return listComparisons(500).find((item) => slugify(item.query || "") === target || item.slug === target);
}

function hasQueuedComparisonTask(query) {
  const target = slugify(query);
  return listTasks(300).some((task) =>
    task.type === "generate_comparison" &&
    ["pending", "running"].includes(task.status) &&
    slugify(task.payload?.query || "") === target
  );
}

function sanitizeMetricInput(input) {
  const day = cleanText(input.day || new Date().toISOString().slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Data invalida. Use AAAA-MM-DD.");
  const campaign = cleanText(input.campaign || "geral").slice(0, 120) || "geral";
  return {
    day,
    campaign,
    spendBRL: nonNegativeNumber("Gasto", input.spendBRL),
    visitors: nonNegativeInt("Visitantes", input.visitors),
    affiliateClicks: nonNegativeInt("Cliques afiliados", input.affiliateClicks),
    affiliateRevenueBRL: nonNegativeNumber("Receita afiliado", input.affiliateRevenueBRL),
    displayRevenueBRL: nonNegativeNumber("Receita display", input.displayRevenueBRL),
    notes: cleanText(input.notes || "").slice(0, 500)
  };
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("Payload grande demais.");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

function cleanUrlPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const selected = decoded === "/" ? "/index.html" : decoded;
  return selected.replace(/^\/+/, "");
}

const PUBLIC_FILES = new Set([
  "index.html",
  "index-mobile.html",
  "artigo.html",
  "busca.html",
  "comparativos.html",
  "favoritos.html",
  "oferta.html",
  "privacidade.html",
  "sobre.html",
  "termos.html",
  "robots.txt",
  "sitemap.xml",
  "favicon.ico"
]);
const PUBLIC_DIRS = ["assets/", "posts/", "comparativos/", "ofertas/"];

function isPublicPath(rel) {
  const normalized = rel.replace(/\\/g, "/");
  if (PUBLIC_FILES.has(normalized)) return true;
  return PUBLIC_DIRS.some((dir) => normalized.startsWith(dir));
}

function serveStatic(req, res, url) {
  const rel = cleanUrlPath(url.pathname);
  if (!isPublicPath(rel)) {
    sendError(res, 403, "Caminho bloqueado.");
    return;
  }
  const target = path.resolve(rootDir, rel);
  const relative = path.relative(rootDir, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    sendError(res, 403, "Caminho bloqueado.");
    return;
  }
  const finalPath = fs.existsSync(target) && fs.statSync(target).isDirectory()
    ? path.join(target, "index.html")
    : target;
  if (!fs.existsSync(finalPath)) {
    sendError(res, 404, "Arquivo nao encontrado.");
    return;
  }
  const ext = path.extname(finalPath).toLowerCase();
  res.writeHead(200, {
    "content-type": contentTypes[ext] || "application/octet-stream",
    "cache-control": ext === ".html" ? "no-store" : "public, max-age=60"
  });
  fs.createReadStream(finalPath).pipe(res);
}

function taskIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/tasks\/(\d+)\/retry$/);
  return match ? Number(match[1]) : null;
}

function cancelTaskIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/tasks\/(\d+)\/cancel$/);
  return match ? Number(match[1]) : null;
}

function productActionFromPath(pathname) {
  const match = pathname.match(/^\/api\/products\/([^/]+)\/(generate-affiliate|generate-content)$/);
  if (!match) return null;
  return { id: decodeURIComponent(match[1]), action: match[2] };
}

function postActionFromPath(pathname) {
  const match = pathname.match(/^\/api\/posts\/(\d+)\/facebook$/);
  if (!match) return null;
  return Number(match[1]);
}

function adDraftActionFromPath(pathname) {
  const match = pathname.match(/^\/api\/ad-drafts\/(\d+)\/open$/);
  if (!match) return null;
  return Number(match[1]);
}

function metricIdFromPath(pathname) {
  const match = pathname.match(/^\/api\/metrics\/(\d+)$/);
  return match ? Number(match[1]) : null;
}

async function handleApi(req, res, url) {
  try {
    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        app: "Achado Agora Autoblog",
        node: process.version,
        host: config.host,
        port: config.port,
        browser: browserDiagnostics()
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      const site = loadSiteConfig();
      const siteProducts = Array.isArray(site.products) ? site.products : [];
      const mercadoLivreProducts = siteProducts.filter((product) => product.storeKey === "mercadolivre");
      const generatedMlLinks = mercadoLivreProducts.filter((product) => /^https:\/\/meli\.la\//i.test(product.affiliateUrl || ""));
      const adsenseClient = String(site.adsenseClient || "").trim();
      sendJson(res, 200, {
        ok: true,
        config: {
          siteUrl: config.siteUrl,
          geminiRequired: config.geminiRequired,
          facebookPageConfigured: Boolean(config.facebookPageUrl),
          facebookAllowOrganicPublish: config.facebookAllowOrganicPublish,
          metaAllowLiveAds: config.metaAllowLiveAds,
          metaDailyBudgetCapBRL: config.metaDailyBudgetCapBRL
        },
        monetization: {
          siteUrl: site.siteUrl || config.siteUrl,
          ga4Configured: Boolean(site.ga4MeasurementId),
          metaPixelConfigured: Boolean(site.metaPixelId),
          adsenseConfigured: Boolean(adsenseClient),
          adsenseClientValid: /^ca-pub-\d+$/i.test(adsenseClient),
          mercadoLivreProducts: mercadoLivreProducts.length,
          mercadoLivreOfficialLinks: generatedMlLinks.length,
          mlMattWordConfigured: Boolean(site.affiliates?.mlMattWord),
          mlMattToolConfigured: Boolean(site.affiliates?.mlMattTool),
          amazonTagConfigured: Boolean(site.affiliates?.amazonTag)
        },
        browser: browserDiagnostics(),
        counts: {
          products: listProducts(1000).length,
          tasks: listTasks(1000).length,
          posts: listPosts(1000).length,
          adDrafts: listAdDrafts(1000).length,
          metrics: listCampaignMetrics(1000).length
        }
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/products") {
      sendJson(res, 200, { ok: true, products: listProducts(boundedInt(url.searchParams.get("limit"), 200, 1, 1000)) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/tasks") {
      sendJson(res, 200, { ok: true, tasks: listTasks(boundedInt(url.searchParams.get("limit"), 100, 1, 1000)) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/posts") {
      sendJson(res, 200, { ok: true, posts: listPosts(boundedInt(url.searchParams.get("limit"), 100, 1, 1000)) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/ad-drafts") {
      sendJson(res, 200, { ok: true, adDrafts: listAdDrafts(boundedInt(url.searchParams.get("limit"), 100, 1, 1000)) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      sendJson(res, 200, { ok: true, events: listEvents(boundedInt(url.searchParams.get("limit"), 100, 1, 1000)) });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/settings") {
      sendJson(res, 200, { ok: true, settings: listSettings() });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/metrics") {
      sendJson(res, 200, { ok: true, metrics: listCampaignMetrics(boundedInt(url.searchParams.get("limit"), 100, 1, 1000)) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/metrics") {
      const body = await readJson(req);
      const metric = upsertCampaignMetric(sanitizeMetricInput(body));
      sendJson(res, 200, { ok: true, metric });
      return;
    }

    const metricId = metricIdFromPath(url.pathname);
    if (req.method === "DELETE" && metricId) {
      const metric = deleteCampaignMetric(metricId);
      if (!metric) {
        sendError(res, 404, "Metrica nao encontrada.");
        return;
      }
      sendJson(res, 200, { ok: true, metric });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/site-config") {
      sendJson(res, 200, { ok: true, siteConfig: monetizationPayload(loadSiteConfig()) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/site-config/monetization") {
      const body = await readJson(req);
      const { site, changed } = updateMonetizationConfig(body);
      const publicBuild = buildPublicSite({ siteUrl: site.siteUrl || "" });
      sendJson(res, 200, {
        ok: true,
        siteConfig: monetizationPayload(site),
        publicBuild,
        changed,
        deployRequired: true
      });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/login/open") {
      const body = await readJson(req);
      const state = openManualLogin(Array.isArray(body.targets) ? body.targets : config.loginTargets);
      sendJson(res, 200, { ok: true, login: state });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/tasks/search") {
      const body = await readJson(req);
      const task = createTask("search_marketplace", {
        marketplace: body.marketplace || "mercadolivre",
        query: body.query,
        limit: boundedInt(body.limit, config.defaultSearchLimit, 1, 25),
        category: body.category || "geral",
        autoPipeline: Boolean(body.autoPipeline)
      });
      sendJson(res, 201, { ok: true, task });
      return;
    }

    if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/shopping-search") {
      const body = req.method === "POST" ? await readJson(req) : Object.fromEntries(url.searchParams);
      const query = cleanText(body.query || body.q || "");
      if (!query) throw new Error("Informe o produto para buscar.");
      const liveRequested = boolInput(body.live, false) || boolInput(body.runNow, false);
      const cacheOnly = boolInput(body.cacheOnly, false);
      const live = !cacheOnly && liveRequested && config.publicLiveSearchEnabled;
      const result = await runShoppingSearch({
        query,
        category: cleanText(body.category || "geral"),
        limit: boundedInt(body.limit, config.publicSearchLimit, 3, 25),
        live,
        preferAffiliate: boolInput(body.preferAffiliate, true),
        priority: cleanText(body.priority || "balanced"),
        priceMin: body.priceMin,
        priceMax: body.priceMax,
        minRating: body.minRating,
        marketplaces: Array.isArray(body.marketplaces) ? body.marketplaces : []
      });

      if (!result.recommendation && !result.comparison && query && !findExistingComparisonSlug(query) && !hasQueuedComparisonTask(query)) {
        queueGenerateComparison({ query, category: cleanText(body.category || "geral") });
        result.queued = true;
        result.status = "queued";
        logEvent("info", "Comparativo enfileirado pelo motor de busca", { query });
      }
      if (liveRequested && !live && !cacheOnly) {
        result.liveDisabled = true;
        result.liveDisabledReason = "Busca ao vivo publica desativada. Defina AUTOBLOG_PUBLIC_LIVE_SEARCH=1 no backend Node.";
      }
      sendJson(res, 200, result);
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/tasks/capture") {
      const body = await readJson(req);
      const task = createTask("capture_product", {
        url: body.url,
        category: body.category || "geral",
        autoPipeline: Boolean(body.autoPipeline)
      });
      sendJson(res, 201, { ok: true, task });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/flow/search-to-blog") {
      const body = await readJson(req);
      const task = queueSearchToBlog({
        query: body.query,
        limit: boundedInt(body.limit, config.defaultSearchLimit, 1, 25),
        category: body.category || "geral"
      });
      sendJson(res, 201, { ok: true, task });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/flow/auto-campaign") {
      const body = await readJson(req);
      const query = cleanText(body.query || "");
      if (!query) throw new Error("Informe a busca da campanha.");
      const task = queueAutoCampaign({
        query,
        limit: boundedInt(body.limit, config.defaultSearchLimit, 1, 25),
        category: cleanText(body.category || "geral"),
        campaignName: sanitizeCampaignName(body.campaignName, query),
        dailyBudgetBRL: nonNegativeNumber("Orcamento diario", body.dailyBudgetBRL) || config.metaDailyBudgetCapBRL,
        autoFacebook: boolInput(body.autoFacebook, true),
        autoOpenMeta: boolInput(body.autoOpenMeta, false),
        autoBuildPublic: boolInput(body.autoBuildPublic, true)
      });
      const result = boolInput(body.runNow, false)
        ? await runUntilIdle(boundedInt(body.maxTasks, 50, 1, 100))
        : null;
      sendJson(res, 201, { ok: true, task, result });
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/comparisons") {
      sendJson(res, 200, { ok: true, comparisons: listComparisons(boundedInt(url.searchParams.get("limit"), 100, 1, 1000)) });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/flow/generate-comparison") {
      const body = await readJson(req);
      const query = cleanText(body.query || "");
      if (!query) throw new Error("Informe a busca do comparativo.");
      const task = queueGenerateComparison({
        query,
        category: cleanText(body.category || "geral"),
        campaignName: sanitizeCampaignName(body.campaignName, query),
        dailyBudgetBRL: nonNegativeNumber("Orcamento diario", body.dailyBudgetBRL) || config.metaDailyBudgetCapBRL,
        autoFacebook: boolInput(body.autoFacebook, false),
        autoBuildPublic: boolInput(body.autoBuildPublic, true)
      });
      const result = boolInput(body.runNow, false)
        ? await runUntilIdle(boundedInt(body.maxTasks, 50, 1, 100))
        : null;
      sendJson(res, 201, { ok: true, task, result });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/search-miss") {
      const body = await readJson(req);
      const query = cleanText(body.query || "");
      let queued = false;
      if (query) {
        logEvent("info", "Busca sem comparativo publicado", { query });
        if (!findExistingComparisonSlug(query) && !hasQueuedComparisonTask(query)) {
          queueGenerateComparison({ query, category: cleanText(body.category || "geral") });
          queued = true;
          logEvent("info", "Comparativo enfileirado automaticamente por busca de visitante", { query });
        }
      }
      sendJson(res, 200, { ok: true, queued });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/flow/seed-comparisons") {
      const body = await readJson(req);
      const queries = Array.isArray(body.queries)
        ? body.queries
        : String(body.queries || "").split(/\r?\n/);
      const category = cleanText(body.category || "geral");
      const queued = [];
      const skipped = [];
      for (const raw of queries) {
        const query = cleanText(raw);
        if (!query) continue;
        if (findExistingComparisonSlug(query) || hasQueuedComparisonTask(query)) {
          skipped.push(query);
          continue;
        }
        queueGenerateComparison({ query, category });
        queued.push(query);
      }
      sendJson(res, 201, { ok: true, queued, skipped });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/flow/capture-to-blog") {
      const body = await readJson(req);
      const task = queueCaptureToBlog({
        url: body.url,
        category: body.category || "geral"
      });
      sendJson(res, 201, { ok: true, task });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/worker/run-once") {
      const result = await runOnce();
      sendJson(res, 200, { ok: true, result });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/worker/run-until-idle") {
      const body = await readJson(req);
      const result = await runUntilIdle(boundedInt(body.maxTasks, 25, 1, 100));
      sendJson(res, 200, { ok: true, result });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/sitemap/update") {
      sendJson(res, 200, { ok: true, result: updateSitemapAndRobots() });
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/public-site/build") {
      const body = await readJson(req);
      sendJson(res, 200, { ok: true, result: buildPublicSite({ siteUrl: body.siteUrl || "" }) });
      return;
    }

    const retryId = req.method === "POST" ? taskIdFromPath(url.pathname) : null;
    if (retryId) {
      sendJson(res, 200, { ok: true, task: retryTask(retryId) });
      return;
    }

    const cancelId = req.method === "POST" ? cancelTaskIdFromPath(url.pathname) : null;
    if (cancelId) {
      sendJson(res, 200, { ok: true, task: cancelTask(cancelId) });
      return;
    }

    const productAction = req.method === "POST" ? productActionFromPath(url.pathname) : null;
    if (productAction) {
      const taskType = productAction.action === "generate-affiliate" ? "generate_affiliate_link" : "generate_content";
      const task = createTask(taskType, { productId: productAction.id, autoPipeline: productAction.action === "generate-affiliate" });
      sendJson(res, 201, { ok: true, task });
      return;
    }

    const facebookPostId = req.method === "POST" ? postActionFromPath(url.pathname) : null;
    if (facebookPostId) {
      const task = createTask("facebook_post", { postId: facebookPostId });
      sendJson(res, 201, { ok: true, task });
      return;
    }

    const adDraftId = req.method === "POST" ? adDraftActionFromPath(url.pathname) : null;
    if (adDraftId) {
      const adDraft = getAdDraft(adDraftId);
      if (!adDraft) {
        sendError(res, 404, "Rascunho de anuncio nao encontrado.");
        return;
      }
      const task = createTask("open_ad_draft", { adDraft });
      sendJson(res, 201, { ok: true, task });
      return;
    }

    sendError(res, 404, "Rota API nao encontrada.");
  } catch (error) {
    sendError(res, 500, error.message);
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || `${config.host}:${config.port}`}`);
  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url);
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendError(res, 405, "Metodo nao permitido.");
    return;
  }
  serveStatic(req, res, url);
});

server.listen(config.port, config.host, () => {
  console.log(`Achado Agora Autoblog em http://${config.host}:${config.port}`);
});

let autoWorkerBusy = false;
async function autoWorkerTick() {
  if (autoWorkerBusy) return;
  autoWorkerBusy = true;
  try {
    const result = await runUntilIdle(5);
    if (result.count) console.log(`[worker] ${result.count} tarefa(s) processada(s) automaticamente`);
  } catch (error) {
    console.error("[worker] erro no ciclo automatico:", error.message);
  } finally {
    autoWorkerBusy = false;
  }
}

if (config.autoWorkerEnabled) {
  console.log(`Worker automatico ligado (ciclo a cada ${config.autoWorkerIntervalMs}ms). Defina AUTOBLOG_AUTO_WORKER=0 para desligar.`);
  setInterval(autoWorkerTick, config.autoWorkerIntervalMs);
  autoWorkerTick();
}

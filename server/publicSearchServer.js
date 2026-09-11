import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { loadSiteConfig } from "./sitePublisher.js";
import { runShoppingSearch } from "./shoppingSearchEngine.js";
import { cleanText } from "./lib/utils.js";

const MAX_BODY_BYTES = 8 * 1024;
const SEARCH_PATH = "/api/shopping-search";

class QueueFullError extends Error {}

function normalizedOrigin(value) {
  try {
    return new URL(String(value || "")).origin;
  } catch {
    return "";
  }
}

function defaultAllowedOrigins() {
  let siteOrigin = "";
  try {
    siteOrigin = normalizedOrigin(loadSiteConfig().siteUrl);
  } catch {
    siteOrigin = "";
  }
  return new Set([
    siteOrigin,
    ...config.publicSearchAllowedOrigins.map(normalizedOrigin),
    "http://127.0.0.1:4177",
    "http://localhost:4177"
  ].filter(Boolean));
}

function requestIp(req) {
  const cloudflareIp = String(req.headers["cf-connecting-ip"] || "").trim();
  if (cloudflareIp) return cloudflareIp;
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket.remoteAddress || "unknown";
}

function responseHeaders(req, allowedOrigins) {
  const origin = normalizedOrigin(req.headers.origin);
  const headers = {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  };
  if (origin && allowedOrigins.has(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = "POST, OPTIONS";
    headers["access-control-allow-headers"] = "content-type";
    headers.vary = "Origin";
  }
  return headers;
}

function sendJson(req, res, allowedOrigins, status, value, extraHeaders = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { ...responseHeaders(req, allowedOrigins), ...extraHeaders });
  res.end(body);
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Pedido maior que 8 KB.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function normalizeRequest(body) {
  const query = cleanText(body.query || body.q || "").slice(0, 160);
  if (query.length < 2) throw new Error("Informe pelo menos 2 caracteres para buscar.");
  return {
    query,
    category: cleanText(body.category || "geral").slice(0, 60) || "geral",
    limit: Math.trunc(Math.max(3, Math.min(Number(body.limit) || config.publicSearchLimit, config.publicSearchLimit))),
    live: true,
    preferAffiliate: true,
    priority: cleanText(body.priority || "balanced"),
    priceMin: body.priceMin,
    priceMax: body.priceMax,
    minRating: body.minRating,
    marketplaces: Array.isArray(body.marketplaces) ? body.marketplaces.slice(0, 5) : [],
    headless: true
  };
}

function cacheKey(input) {
  return JSON.stringify({
    query: input.query.toLowerCase(),
    category: input.category.toLowerCase(),
    limit: input.limit,
    priority: input.priority,
    priceMin: input.priceMin ?? null,
    priceMax: input.priceMax ?? null,
    minRating: input.minRating ?? null,
    marketplaces: [...input.marketplaces].map((item) => String(item).toLowerCase()).sort()
  });
}

function publicSafeResult(result) {
  const out = structuredClone(result);
  if (out.liveError) out.liveError = "A busca ao vivo falhou temporariamente.";
  for (const item of [out.recommendation, out.cheapest, out.topRated, ...(out.alternatives || [])]) {
    if (item?.affiliateError) item.affiliateError = "Falha temporaria ao gerar o link afiliado.";
  }
  return out;
}

function serialQueue(maxWaiting) {
  let active = false;
  let waiting = 0;
  let tail = Promise.resolve();
  return {
    state: () => ({ active, waiting }),
    async run(fn) {
      if (waiting + (active ? 1 : 0) >= maxWaiting + 1) {
        throw new QueueFullError("O motor esta ocupado. Tente novamente em instantes.");
      }
      waiting += 1;
      const previous = tail;
      let release;
      tail = new Promise((resolve) => { release = resolve; });
      await previous;
      waiting -= 1;
      active = true;
      try {
        return await fn();
      } finally {
        active = false;
        release();
      }
    }
  };
}

export function createPublicSearchServer(options = {}) {
  const search = options.search || runShoppingSearch;
  const allowedOrigins = options.allowedOrigins || defaultAllowedOrigins();
  const now = options.now || Date.now;
  const resultCache = new Map();
  const inFlight = new Map();
  const rateBuckets = new Map();
  const queue = serialQueue(config.publicSearchMaxQueue);

  function consumeRateLimit(ip) {
    const cutoff = now() - config.publicSearchRateWindowMs;
    if (rateBuckets.size > 10000) {
      for (const [key, stamps] of rateBuckets) {
        if (!stamps.some((stamp) => stamp > cutoff)) rateBuckets.delete(key);
      }
    }
    const recent = (rateBuckets.get(ip) || []).filter((stamp) => stamp > cutoff);
    if (recent.length >= config.publicSearchRateLimit) return false;
    recent.push(now());
    rateBuckets.set(ip, recent);
    return true;
  }

  return http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const origin = normalizedOrigin(req.headers.origin);
    if (origin && !allowedOrigins.has(origin)) {
      sendJson(req, res, allowedOrigins, 403, { ok: false, error: "Origem nao autorizada." });
      return;
    }

    if (req.method === "OPTIONS" && url.pathname === SEARCH_PATH) {
      res.writeHead(204, responseHeaders(req, allowedOrigins));
      res.end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/healthz") {
      sendJson(req, res, allowedOrigins, 200, { ok: true, service: "achado-agora-public-search", queue: queue.state() });
      return;
    }

    if (req.method !== "POST" || url.pathname !== SEARCH_PATH) {
      sendJson(req, res, allowedOrigins, 404, { ok: false, error: "Rota nao encontrada." });
      return;
    }

    const ip = requestIp(req);
    if (!consumeRateLimit(ip)) {
      sendJson(req, res, allowedOrigins, 429, { ok: false, error: "Limite de buscas atingido. Tente novamente mais tarde." }, { "retry-after": String(Math.ceil(config.publicSearchRateWindowMs / 1000)) });
      return;
    }

    try {
      const input = normalizeRequest(await readJsonBody(req));
      const key = cacheKey(input);
      if (resultCache.size > 1000) {
        for (const [cacheEntryKey, entry] of resultCache) {
          if (entry.expiresAt <= now()) resultCache.delete(cacheEntryKey);
        }
      }
      const cached = resultCache.get(key);
      if (cached && cached.expiresAt > now()) {
        sendJson(req, res, allowedOrigins, 200, { ...cached.value, cache: "hit" });
        return;
      }

      let pending = inFlight.get(key);
      if (!pending) {
        pending = queue.run(() => search(input)).then(publicSafeResult);
        inFlight.set(key, pending);
      }
      try {
        const result = await pending;
        resultCache.set(key, { value: result, expiresAt: now() + config.publicSearchCacheTtlMs });
        sendJson(req, res, allowedOrigins, 200, { ...result, cache: "miss" });
      } finally {
        if (inFlight.get(key) === pending) inFlight.delete(key);
      }
    } catch (error) {
      const status = error instanceof QueueFullError ? 503 : error instanceof SyntaxError ? 400 : /Informe|Pedido/.test(error.message) ? 400 : 500;
      const message = status === 500 ? "Nao foi possivel concluir a busca agora." : error.message;
      sendJson(req, res, allowedOrigins, status, { ok: false, error: message });
    }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const server = createPublicSearchServer();
  server.listen(config.publicSearchPort, config.publicSearchHost, () => {
    console.log(`Busca publica protegida em http://${config.publicSearchHost}:${config.publicSearchPort}`);
  });
}

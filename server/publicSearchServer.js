import http from "node:http";
import { isIP } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { loadSiteConfig } from "./sitePublisher.js";
import { runShoppingSearch } from "./shoppingSearchEngine.js";
import { cleanText } from "./lib/utils.js";

const MAX_BODY_BYTES = 8 * 1024;
const SEARCH_PATH = "/api/shopping-search";
const SEARCH_PRIORITIES = new Set(["balanced", "lowest_price", "top_rated", "most_popular"]);
const MARKETPLACES = new Set(["mercadolivre", "amazon", "lomadee", "shopee", "magalu"]);
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1"]);

class QueueFullError extends Error {}
class RequestError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

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

function normalizeIp(value) {
  const raw = String(value || "").trim();
  const address = raw.startsWith("::ffff:") ? raw.slice(7) : raw;
  if (!isIP(address) || address.includes("%")) return "";
  // The URL parser canonicalizes equivalent IPv6 spellings for rate limiting.
  return isIP(address) === 6 ? new URL(`http://[${address}]`).hostname.slice(1, -1) : address;
}

function requestIp(req, trustedProxyAddresses) {
  const peer = normalizeIp(req.socket.remoteAddress);
  if (trustedProxyAddresses.has(peer)) {
    const cloudflareIp = normalizeIp(req.headers["cf-connecting-ip"]);
    if (cloudflareIp) return cloudflareIp;
  }
  // X-Forwarded-For can contain client-supplied values; it is never an identity.
  return peer || "unknown";
}

function responseHeaders(req, allowedOrigins) {
  const rawOrigin = String(req.headers.origin || "");
  const origin = normalizedOrigin(rawOrigin);
  const headers = {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    vary: "Origin"
  };
  if (origin && rawOrigin === origin && allowedOrigins.has(origin)) {
    headers["access-control-allow-origin"] = origin;
    headers["access-control-allow-methods"] = "POST, OPTIONS";
    headers["access-control-allow-headers"] = "content-type";
  }
  return headers;
}

function sendJson(req, res, allowedOrigins, status, value, extraHeaders = {}) {
  if (res.destroyed || res.writableEnded) return;
  const body = JSON.stringify(value);
  res.writeHead(status, { ...responseHeaders(req, allowedOrigins), ...extraHeaders });
  res.end(body);
}

async function readJsonBody(req) {
  if (Number(req.headers["content-length"]) > MAX_BODY_BYTES) {
    req.resume();
    throw new RequestError("Pedido maior que 8 KB.", 413);
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const finish = (error, value) => {
      clearTimeout(timer);
      req.removeListener("data", onData);
      req.removeListener("end", onEnd);
      req.removeListener("error", onError);
      req.removeListener("aborted", onAborted);
      if (error) {
        req.resume();
        reject(error);
      } else resolve(value);
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) finish(new RequestError("Pedido maior que 8 KB.", 413));
      else chunks.push(chunk);
    };
    const onEnd = () => {
      try {
        finish(null, JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        finish(new RequestError("Envie um objeto JSON valido."));
      }
    };
    const onError = () => finish(new RequestError("Nao foi possivel ler o pedido."));
    const onAborted = () => finish(new RequestError("Pedido interrompido."));
    const timer = setTimeout(() => finish(new RequestError("Tempo para enviar o pedido esgotado.", 408)), 15000);
    timer.unref();
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
  });
}

function normalizeRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RequestError("Envie um objeto JSON valido.");
  }
  const textField = (value, name, maxLength, fallback = "") => {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value !== "string" || value.length > maxLength) throw new RequestError(`Campo ${name} invalido.`);
    return cleanText(value);
  };
  const numberField = (value, name, max = Number.MAX_SAFE_INTEGER) => {
    if (value === undefined || value === null || value === "") return null;
    if (!["number", "string"].includes(typeof value) || !String(value).trim()) throw new RequestError(`Campo ${name} invalido.`);
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0 || number > max) throw new RequestError(`Campo ${name} invalido.`);
    return number;
  };
  const query = textField(body.query ?? body.q, "query", 160);
  if (query.length < 2) throw new RequestError("Informe pelo menos 2 caracteres para buscar.");
  const priority = textField(body.priority, "priority", 30, "balanced");
  if (!SEARCH_PRIORITIES.has(priority)) throw new RequestError("Prioridade de busca invalida.");
  if (body.marketplaces !== undefined && (!Array.isArray(body.marketplaces) || body.marketplaces.length > MARKETPLACES.size)) {
    throw new RequestError("Lista de lojas invalida.");
  }
  const marketplaces = [...new Set((body.marketplaces || []).map((value) => textField(value, "marketplaces", 30).toLowerCase()))].sort();
  if (marketplaces.some((value) => !MARKETPLACES.has(value))) throw new RequestError("Loja de busca invalida.");
  let priceMin = numberField(body.priceMin, "priceMin");
  let priceMax = numberField(body.priceMax, "priceMax");
  if (priceMin !== null && priceMax !== null && priceMin > priceMax) [priceMin, priceMax] = [priceMax, priceMin];
  return {
    query,
    category: textField(body.category, "category", 60, "geral") || "geral",
    limit: Math.trunc(Math.max(3, Math.min(numberField(body.limit, "limit") || config.publicSearchLimit, config.publicSearchLimit))),
    live: true,
    preferAffiliate: true,
    priority,
    priceMin,
    priceMax,
    minRating: numberField(body.minRating, "minRating", 5),
    marketplaces,
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
  for (const source of out.sourceStatus || []) {
    if (source.error) source.error = "Esta loja esta temporariamente indisponivel.";
  }
  for (const item of [out.recommendation, out.cheapest, out.topRated, ...(out.offers || []), ...(out.alternatives || [])]) {
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
  // Production uses cloudflared -> loopback. A public bind trusts no proxy by
  // default; other deployments must explicitly provide trusted peer addresses.
  const trustedProxyAddresses = new Set((options.trustedProxyAddresses ??
    (LOOPBACK_ADDRESSES.has(config.publicSearchHost) || config.publicSearchHost === "localhost" ? [...LOOPBACK_ADDRESSES] : []))
    .map(normalizeIp).filter(Boolean));
  const maxCacheEntries = Math.max(1, Math.min(options.maxCacheEntries ?? 1000, 1000));
  const maxRateBuckets = Math.max(1, Math.min(options.maxRateBuckets ?? 10000, 10000));
  const rateLimit = options.rateLimit ?? config.publicSearchRateLimit;
  const resultCache = new Map();
  const inFlight = new Map();
  const rateBuckets = new Map();
  const queue = serialQueue(config.publicSearchMaxQueue);

  function consumeRateLimit(ip) {
    const cutoff = now() - config.publicSearchRateWindowMs;
    if (rateBuckets.size >= maxRateBuckets) {
      for (const [key, stamps] of rateBuckets) {
        if (!stamps.some((stamp) => stamp > cutoff)) rateBuckets.delete(key);
      }
    }
    if (!rateBuckets.has(ip) && rateBuckets.size >= maxRateBuckets) return false;
    const recent = (rateBuckets.get(ip) || []).filter((stamp) => stamp > cutoff);
    if (recent.length >= rateLimit) return false;
    recent.push(now());
    rateBuckets.set(ip, recent);
    return true;
  }

  return http.createServer({ requestTimeout: 15000, headersTimeout: 10000 }, async (req, res) => {
    let url;
    try {
      url = new URL(req.url || "/", "http://localhost");
    } catch {
      sendJson(req, res, allowedOrigins, 400, { ok: false, error: "Endereco de pedido invalido." });
      return;
    }
    const origin = normalizedOrigin(req.headers.origin);
    if (req.headers.origin !== undefined && (!origin || origin !== req.headers.origin || !allowedOrigins.has(origin))) {
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

    const ip = requestIp(req, trustedProxyAddresses);
    if (!consumeRateLimit(ip)) {
      sendJson(req, res, allowedOrigins, 429, { ok: false, error: "Limite de buscas atingido. Tente novamente mais tarde." }, { "retry-after": String(Math.ceil(config.publicSearchRateWindowMs / 1000)) });
      return;
    }

    try {
      if (!/^application\/json(?:\s*;|$)/i.test(String(req.headers["content-type"] || ""))) {
        throw new RequestError("Envie o pedido como application/json.", 415);
      }
      if (req.headers["content-encoding"] && req.headers["content-encoding"] !== "identity") {
        throw new RequestError("Compressao de pedidos nao suportada.", 415);
      }
      const input = normalizeRequest(await readJsonBody(req));
      const key = cacheKey(input);
      if (resultCache.size >= maxCacheEntries) {
        for (const [cacheEntryKey, entry] of resultCache) {
          if (entry.expiresAt <= now()) resultCache.delete(cacheEntryKey);
        }
      }
      const cached = resultCache.get(key);
      if (cached && cached.expiresAt > now()) {
        sendJson(req, res, allowedOrigins, 200, { ...cached.value, cache: "hit" });
        return;
      }
      if (cached) resultCache.delete(key);

      let pending = inFlight.get(key);
      if (!pending) {
        pending = queue.run(() => search(input)).then(publicSafeResult);
        inFlight.set(key, pending);
      }
      try {
        const result = await pending;
        if (result.ok && !result.liveError && !(result.sourceStatus || []).some((source) => source.status === "error")) {
          if (!resultCache.has(key) && resultCache.size >= maxCacheEntries) resultCache.delete(resultCache.keys().next().value);
          resultCache.set(key, { value: result, expiresAt: now() + config.publicSearchCacheTtlMs });
        }
        sendJson(req, res, allowedOrigins, 200, { ...result, cache: "miss" });
      } finally {
        if (inFlight.get(key) === pending) inFlight.delete(key);
      }
    } catch (error) {
      const status = error instanceof QueueFullError ? 503 : error instanceof RequestError ? error.status : 500;
      const message = status === 500 ? "Nao foi possivel concluir a busca agora." : error.message;
      sendJson(req, res, allowedOrigins, status, { ok: false, error: message }, {
        ...(status === 503 ? { "retry-after": "5" } : {}),
        ...([408, 413, 415].includes(status) ? { connection: "close" } : {})
      });
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

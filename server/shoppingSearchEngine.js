import { config } from "./config.js";
import { getProduct, listComparisons, listProducts, logEvent, upsertProduct } from "./db.js";
import { searchMercadoLivreProducts, generateMercadoLivreAffiliateLink } from "./adapters/mercadoLivre.js";
import { searchLomadeeProducts, generateLomadeeAffiliateLink } from "./adapters/lomadee.js";
import { loadSiteConfig } from "./sitePublisher.js";
import { cleanText, slugify } from "./lib/utils.js";
import { withBrowser } from "./browser.js";
import { filterRelevantCandidates } from "./lib/searchRelevance.js";

const MAX_OFFERS = 4;
const MAX_CACHED_PRICE_AGE_MS = 24 * 60 * 60 * 1000;

function safeUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : "";
  } catch { return ""; }
}

function merchantMarketplace(candidate) {
  try {
    const hostname = new URL(candidate.sourceUrl).hostname;
    if (/(^|\.)mercadolivre\.com\.br$/.test(hostname)) return "mercadolivre";
    if (/(^|\.)amazon\.com\.br$/.test(hostname) || hostname === "amzn.to") return "amazon";
    if (/(^|\.)shopee\.com\.br$/.test(hostname)) return "shopee";
    if (/(^|\.)(magazineluiza\.com\.br|magalu\.com)$/.test(hostname)) return "magalu";
  } catch { /* invalid URLs are removed before ranking */ }
  return normalizeMarketplace(candidate.marketplace);
}

const TRUST_SCORE = {
  mercadolivre: 14,
  amazon: 12,
  lomadee: 11,
  shopee: 10,
  magalu: 10
};
const SEARCH_PRIORITIES = new Set(["balanced", "lowest_price", "top_rated", "most_popular"]);

function marketplaceLabel(key) {
  if (key === "mercadolivre") return "Mercado Livre";
  if (key === "amazon") return "Amazon";
  if (key === "shopee") return "Shopee";
  if (key === "lomadee") return "Lomadee";
  if (key === "magalu") return "Magazine Luiza";
  return key || "Loja";
}

function normalizeMarketplace(value) {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("mercado")) return "mercadolivre";
  if (raw.includes("amazon")) return "amazon";
  if (raw.includes("shopee")) return "shopee";
  if (raw.includes("lomadee")) return "lomadee";
  if (raw.includes("magalu") || raw.includes("magazine")) return "magalu";
  return raw || "marketplace";
}

function optionalNumber(value, max = Number.MAX_SAFE_INTEGER) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.min(parsed, max);
}

function normalizeSearchPreferences(input = {}) {
  let priceMin = optionalNumber(input.priceMin);
  let priceMax = optionalNumber(input.priceMax);
  if (priceMin !== null && priceMax !== null && priceMin > priceMax) {
    [priceMin, priceMax] = [priceMax, priceMin];
  }
  const rawRating = optionalNumber(input.minRating, 5);
  const minRating = rawRating && rawRating > 0 ? rawRating : null;
  const marketplaces = Array.isArray(input.marketplaces)
    ? [...new Set(input.marketplaces.map(normalizeMarketplace).filter((item) => TRUST_SCORE[item]))]
    : [];
  const priority = SEARCH_PRIORITIES.has(input.priority) ? input.priority : "balanced";
  return { priority, priceMin, priceMax, minRating, marketplaces };
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseVolume(label) {
  const raw = String(label || "").toLowerCase();
  const match = raw.match(/(\d+(?:[.,]\d+)?)\s*(mil|k)?/i);
  if (!match) return 0;
  const value = Number(match[1].replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * (match[2] ? 1000 : 1));
}

function titleMatches(product, query) {
  const needle = cleanText(query).toLowerCase();
  if (!needle) return false;
  const blob = [
    product.title,
    product.description,
    product.brand,
    product.store,
    product.marketplace,
    product.category
  ].join(" ").toLowerCase();
  return needle.split(/\s+/).filter(Boolean).every((part) => blob.includes(part));
}

function siteProductToCandidate(product) {
  const marketplace = normalizeMarketplace(product.storeKey || product.store);
  return {
    id: product.id,
    marketplace,
    store: product.store || marketplaceLabel(marketplace),
    sourceUrl: product.sourceUrl || product.affiliateUrl || "",
    affiliateUrl: product.affiliateUrl || "",
    title: product.title || "",
    brand: product.brand || "",
    category: product.category || "geral",
    badge: product.badge || "",
    description: product.description || "",
    why: product.why || "",
    price: numberOrNull(product.price),
    oldPrice: numberOrNull(product.oldPrice),
    rating: numberOrNull(product.rating),
    reviewLabel: product.reviewLabel || "",
    imageUrl: product.image || "",
    status: product.affiliateUrl ? "published" : "cached",
    source: "site_config",
    observedAt: product.priceCheckedAt || ""
  };
}

function dbProductToCandidate(product) {
  const marketplace = normalizeMarketplace(product.marketplace);
  return {
    ...product,
    store: product.store || marketplaceLabel(marketplace),
    marketplace,
    price: numberOrNull(product.price),
    oldPrice: numberOrNull(product.oldPrice),
    rating: numberOrNull(product.rating),
    source: "database"
  };
}

function canonicalProductUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    parsed.search = "";
    parsed.hash = "";
    return `${parsed.origin}${parsed.pathname}`.replace(/\/$/, "").toLowerCase();
  } catch {
    return "";
  }
}

export function dedupeCandidates(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const semanticKey = [
      cleanText(item.title).toLowerCase(),
      cleanText(item.store || marketplaceLabel(item.marketplace)).toLowerCase(),
      numberOrNull(item.price) || ""
    ].join("|");
    const keys = [
      canonicalProductUrl(item.sourceUrl),
      semanticKey !== "||" ? semanticKey : "",
      item.id ? `id:${item.id}` : ""
    ].filter(Boolean);
    if (!keys.length || keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    out.push(item);
  }
  return out;
}

export function hasAffiliateLink(candidate) {
  const url = safeUrl(candidate.affiliateUrl);
  if (!url) return false;
  const parsed = new URL(url);
  if (candidate.marketplace === "mercadolivre") return parsed.hostname === "meli.la"
    || (/(^|\.)mercadolivre\.com\.br$/.test(parsed.hostname) && Boolean(parsed.searchParams.get("matt_tool")));
  if (candidate.marketplace === "amazon") return /(^|\.)amazon\.com\.br$/.test(parsed.hostname) && Boolean(parsed.searchParams.get("tag"));
  if (candidate.marketplace === "lomadee") return /(^|\.)lmdee\.link$/.test(parsed.hostname);
  return false;
}

function canGenerateAffiliate(candidate) {
  if (!safeUrl(candidate.sourceUrl)) return false;
  if (candidate.marketplace === "mercadolivre") return /(^|\.)mercadolivre\.com\.br$/.test(new URL(candidate.sourceUrl).hostname);
  if (candidate.marketplace === "lomadee") return Boolean(candidate.organizationId);
  return false;
}

function priceScore(candidate, medianPrice) {
  const price = numberOrNull(candidate.price);
  if (!price || !medianPrice) return 0;
  const ratio = medianPrice / price;
  return Math.max(0, Math.min(22, ratio * 14));
}

function median(values) {
  const nums = values.map(numberOrNull).filter(Boolean).sort((a, b) => a - b);
  if (!nums.length) return null;
  return nums[Math.floor(nums.length / 2)];
}

function scoreCandidate(candidate, medianPrice) {
  const rating = numberOrNull(candidate.rating) || 0;
  const volume = parseVolume(candidate.reviewLabel);
  const trust = TRUST_SCORE[candidate.marketplace] || 5;
  const score =
    trust +
    Math.min(34, (rating / 5) * 34) +
    Math.min(18, Math.log10(volume + 1) * 5) +
    priceScore(candidate, medianPrice) +
    (candidate.imageUrl ? 2 : 0);
  return Math.round(score * 10) / 10;
}

function reasonsFor(candidate, medianPrice) {
  const reasons = [];
  const rating = numberOrNull(candidate.rating);
  const price = numberOrNull(candidate.price);
  const volume = parseVolume(candidate.reviewLabel);
  if (rating >= 4.7) reasons.push("nota alta");
  else if (rating >= 4.4) reasons.push("nota boa");
  if (volume >= 1000) reasons.push("muito vendido/avaliado");
  else if (volume >= 100) reasons.push("volume razoavel de prova social");
  if (price && medianPrice && price <= medianPrice) reasons.push("preco abaixo ou perto da mediana");
  if (!reasons.length) reasons.push("confira frete e disponibilidade na loja");
  return reasons;
}

export function rankShoppingCandidates(items, preferences = {}) {
  const normalized = normalizeSearchPreferences(preferences);
  const filtered = items.filter((item) => {
    const price = numberOrNull(item.price);
    const rating = numberOrNull(item.rating);
    if (normalized.priceMin !== null && (!price || price < normalized.priceMin)) return false;
    if (normalized.priceMax !== null && (!price || price > normalized.priceMax)) return false;
    if (normalized.minRating !== null && (!rating || rating < normalized.minRating)) return false;
    if (normalized.marketplaces.length && !normalized.marketplaces.includes(normalizeMarketplace(item.marketplace || item.store))
      && !normalized.marketplaces.includes(merchantMarketplace(item))) return false;
    return true;
  });
  const medianPrice = median(filtered.map((item) => item.price));
  return filtered
    .map((item) => ({
      ...item,
      score: scoreCandidate(item, medianPrice),
      qualitySignals: reasonsFor(item, medianPrice),
      affiliateReady: hasAffiliateLink(item),
      affiliateEligible: hasAffiliateLink(item) || canGenerateAffiliate(item)
    }))
    .sort((a, b) => {
      if (normalized.priority === "lowest_price") {
        return (numberOrNull(a.price) || Number.MAX_SAFE_INTEGER) - (numberOrNull(b.price) || Number.MAX_SAFE_INTEGER) || b.score - a.score;
      }
      if (normalized.priority === "top_rated") {
        return (numberOrNull(b.rating) || 0) - (numberOrNull(a.rating) || 0) || b.score - a.score;
      }
      if (normalized.priority === "most_popular") {
        return parseVolume(b.reviewLabel) - parseVolume(a.reviewLabel) || b.score - a.score;
      }
      return b.score - a.score;
    });
}

export function chooseShoppingRecommendation(ranked, preferences = {}) {
  const best = ranked[0] || null;
  if (!best) return null;
  const priority = normalizeSearchPreferences(preferences).priority;
  const priorityReasons = {
    balanced: "melhor equilibrio entre preco, avaliacao e confiabilidade",
    lowest_price: "menor preco dentro das preferencias definidas",
    top_rated: "melhor avaliacao dentro das preferencias definidas",
    most_popular: "maior volume de avaliacoes dentro das preferencias definidas"
  };
  return { ...best, selectionReason: priorityReasons[priority] };
}

function cheapestCandidate(ranked) {
  return ranked
    .filter((item) => numberOrNull(item.price))
    .sort((a, b) => Number(a.price) - Number(b.price))[0] || null;
}

function topRatedCandidate(ranked) {
  return ranked
    .filter((item) => numberOrNull(item.rating))
    .sort((a, b) => Number(b.rating) - Number(a.rating))[0] || null;
}

function publicCandidate(candidate) {
  if (!candidate) return null;
  const editorialText = (value, length) => /entrada criada|a ia deve|publicacao final|publicação final/i.test(value || "") ? "" : cleanText(value || "").slice(0, length);
  const shortDescription = editorialText(candidate.description, 420);
  const shortWhy = editorialText(candidate.why, 260);
  return {
    id: candidate.id,
    marketplace: candidate.marketplace,
    store: candidate.store || marketplaceLabel(candidate.marketplace),
    title: candidate.title,
    brand: candidate.brand || "",
    category: candidate.category || "geral",
    badge: candidate.badge || "",
    description: shortDescription,
    why: shortWhy,
    price: candidate.price,
    oldPrice: candidate.oldPrice,
    rating: candidate.rating,
    reviewLabel: candidate.reviewLabel || "",
    imageUrl: candidate.imageUrl || "",
    sourceUrl: safeUrl(candidate.sourceUrl),
    affiliateUrl: hasAffiliateLink(candidate) ? safeUrl(candidate.affiliateUrl) : "",
    checkedAt: candidate.observedAt || "",
    affiliateReady: Boolean(candidate.affiliateReady),
    affiliateEligible: Boolean(candidate.affiliateEligible),
    affiliateStatus: candidate.affiliateStatus || (candidate.affiliateReady ? "ready" : candidate.affiliateEligible ? "eligible" : "none"),
    affiliateError: candidate.affiliateError || "",
    score: candidate.score,
    qualitySignals: candidate.qualitySignals || [],
    selectionReason: candidate.selectionReason || ""
  };
}

function findCachedComparison(query) {
  const target = slugify(query);
  return listComparisons(500)
    .filter((item) => item.status === "published")
    .find((item) => item.slug === target || slugify(item.query || "") === target || titleMatches(item, query)) || null;
}

function cachedCandidates(query, category) {
  const site = loadSiteConfig();
  const siteProducts = Array.isArray(site.products) ? site.products.map(siteProductToCandidate) : [];
  const dbProducts = listProducts(500).map(dbProductToCandidate);
  const filtered = dedupeCandidates([...dbProducts, ...siteProducts]).filter((item) => {
    const categoryOk = !category || category === "geral" || item.category === category;
    const age = Date.now() - Date.parse(item.observedAt || "");
    return categoryOk && age >= 0 && age <= MAX_CACHED_PRICE_AGE_MS;
  });
  return filterRelevantCandidates(filtered, query);
}

function summarizeSources(candidates, extra = []) {
  const counts = new Map();
  for (const candidate of candidates) {
    const key = candidate.marketplace || "desconhecido";
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [
    ...[...counts.entries()].map(([marketplace, count]) => ({
      marketplace,
      label: marketplaceLabel(marketplace),
      status: "ok",
      count
    })),
    ...extra
  ];
}

export function visibleShoppingOffers(ranked) {
  const recommendation = ranked[0];
  if (!recommendation) return [];
  const cheapest = cheapestCandidate(ranked);
  return [...new Map([recommendation, cheapest, ...ranked].filter(Boolean).map((item) => [item.id, item])).values()].slice(0, MAX_OFFERS);
}

function buildResult({ query, category, mode, candidates, comparison = null, sourceStatus = [], liveAvailable = false, queued = false, preferences = {}, preferAffiliate = true }) {
  const normalizedPreferences = normalizeSearchPreferences(preferences);
  const relevant = filterRelevantCandidates(candidates, query).filter((item) => safeUrl(item.sourceUrl) && numberOrNull(item.price));
  const ranked = rankShoppingCandidates(relevant, normalizedPreferences);
  const recommendation = chooseShoppingRecommendation(ranked, normalizedPreferences);
  const cheapest = cheapestCandidate(ranked);
  const offers = visibleShoppingOffers(ranked);
  const alternatives = offers.filter((item) =>
    (!recommendation || item.id !== recommendation.id) &&
    (!cheapest || item.id !== cheapest.id)
  );
  return {
    ok: true,
    query,
    category,
    mode,
    status: recommendation ? "ready" : comparison ? "comparison_ready" : queued ? "queued" : "no_results",
    liveAvailable,
    queued,
    preferences: normalizedPreferences,
    recommendation: publicCandidate(recommendation),
    cheapest: publicCandidate(cheapest),
    topRated: publicCandidate(topRatedCandidate(offers)),
    offers: offers.map(publicCandidate),
    isCached: mode !== "live",
    checkedAt: offers.map((item) => item.observedAt).filter(Boolean).sort()[0] || "",
    alternatives: alternatives.map(publicCandidate),
    comparison: comparison ? {
      query: comparison.query,
      slug: comparison.slug,
      title: comparison.title,
      category: comparison.category,
      updatedAt: comparison.updatedAt
    } : null,
    sourceStatus: sourceStatus.length ? sourceStatus : summarizeSources(ranked),
    disclosure: "Podemos receber comissao em links afiliados, sem custo extra para o visitante. O ranking deve priorizar qualidade, preco e confiabilidade antes da monetizacao."
  };
}

async function liveMercadoLivreSearch({ query, category, limit, headless }) {
  // O Modo IA do Google (server/adapters/googleAiMode.js) fica de fora da busca
  // ao vivo de proposito: quem faz uma busca em busca.html espera resposta na
  // hora, e o Modo IA pode adicionar dezenas de segundos por causa da cobertura
  // inconsistente dele. Ele entra so no gerador de comparativos (comparisonEngine.js),
  // que ja roda em segundo plano sem ninguem esperando na tela.
  return withBrowser(async ({ page }) => {
    const found = await searchMercadoLivreProducts({ query, category, limit, page });
    const saved = found.map((candidate) => upsertProduct({
      ...candidate,
      observedAt: new Date().toISOString(),
      affiliateUrl: candidate.affiliateUrl || "",
      status: candidate.affiliateUrl ? "affiliate_ready" : "discovered"
    }));

    return {
      candidates: saved.map(dbProductToCandidate),
      sourceStatus: [{
        marketplace: "mercadolivre",
        label: "Mercado Livre",
        status: "ok",
        count: found.length
      }]
    };
  }, { timeoutMs: 15000, deadlineMs: 35000, headless });
}

async function liveLomadeeSearch({ query, limit }) {
  const found = await searchLomadeeProducts({ query, limit });
  const saved = found.map((candidate) => {
    const product = upsertProduct({ ...candidate, observedAt: new Date().toISOString(), affiliateUrl: candidate.affiliateUrl || "", status: candidate.affiliateUrl ? "affiliate_ready" : "discovered" });
    const restored = dbProductToCandidate(product);
    return { ...restored, organizationId: candidate.organizationId, store: candidate.store };
  });

  return {
    candidates: saved,
    sourceStatus: [{ marketplace: "lomadee", label: "Lomadee", status: "ok", count: found.length }]
  };
}

export async function attemptAffiliateForWinner(candidate, {
  headless = false,
  mercadoLivreGenerator,
  lomadeeGenerator
} = {}) {
  if (!candidate || hasAffiliateLink(candidate) || !canGenerateAffiliate(candidate)) return candidate;
  try {
    let affiliateUrl = "";
    if (candidate.marketplace === "mercadolivre") {
      affiliateUrl = mercadoLivreGenerator
        ? await mercadoLivreGenerator(candidate)
        : await withBrowser(
          ({ page }) => generateMercadoLivreAffiliateLink({ sourceUrl: candidate.sourceUrl, page }),
          { timeoutMs: 90000, headless }
        );
    } else if (candidate.marketplace === "lomadee") {
      affiliateUrl = lomadeeGenerator
        ? await lomadeeGenerator(candidate)
        : await generateLomadeeAffiliateLink({ organizationId: candidate.organizationId, sourceUrl: candidate.sourceUrl });
    }
    if (!hasAffiliateLink({ ...candidate, affiliateUrl })) throw new Error("A loja nao retornou um link de afiliado valido.");
    return {
      ...candidate,
      affiliateUrl,
      affiliateReady: true,
      affiliateEligible: true,
      affiliateStatus: "generated",
      affiliateError: ""
    };
  } catch (error) {
    return {
      ...candidate,
      affiliateStatus: "failed",
      affiliateError: error?.message || String(error)
    };
  }
}

export async function affiliateShoppingOffers(candidates, options = {}) {
  const output = new Map();
  const savedCandidate = (candidate) => {
    const previous = getProduct(candidate.id);
    return previous && previous.sourceUrl === candidate.sourceUrl && hasAffiliateLink(previous)
      ? { ...candidate, affiliateUrl: previous.affiliateUrl, affiliateStatus: "ready" } : candidate;
  };
  const selected = candidates.map(savedCandidate);
  const collect = async (candidate, overrides = {}) => {
    const result = await attemptAffiliateForWinner(candidate, { ...options, ...overrides });
    output.set(candidate.id, result);
    if (hasAffiliateLink(result)) upsertProduct({ ...result, status: "affiliate_ready" });
  };
  const needsMl = selected.filter((item) => item.marketplace === "mercadolivre" && !hasAffiliateLink(item) && canGenerateAffiliate(item));
  const jobs = selected.filter((item) => !needsMl.includes(item)).map((item) => collect(item));
  if (needsMl.length) {
    if (options.mercadoLivreGenerator) {
      jobs.push((async () => { for (const item of needsMl) await collect(item); })());
    } else {
      jobs.push(withBrowser(async ({ page }) => {
        for (const item of needsMl) {
          await collect(item, { mercadoLivreGenerator: (candidate) => generateMercadoLivreAffiliateLink({ sourceUrl: candidate.sourceUrl, page }) });
        }
      }, { headless: options.headless === true, timeoutMs: 10000, deadlineMs: 35000 }).catch(() => {
        for (const item of needsMl) if (!output.has(item.id)) output.set(item.id, { ...item, affiliateStatus: "failed", affiliateError: "Nao foi possivel gerar o link agora." });
      }));
    }
  }
  await Promise.all(jobs);
  return candidates.map((item) => output.get(item.id) || item);
}

export async function runShoppingSearch({
  query,
  category = "geral",
  limit = config.publicSearchLimit,
  live = false,
  preferAffiliate = true,
  priority = "balanced",
  priceMin = null,
  priceMax = null,
  minRating = null,
  marketplaces = [],
  headless = false
}, dependencies = {}) {
  const cleanQuery = cleanText(query || "");
  if (!cleanQuery) throw new Error("Informe o produto para buscar.");
  const preferences = normalizeSearchPreferences({ priority, priceMin, priceMax, minRating, marketplaces });

  const comparison = null;
  const cached = dependencies.cachedCandidates ? dependencies.cachedCandidates(cleanQuery, category) : cachedCandidates(cleanQuery, category);
  if (!live) {
    return buildResult({
      query: cleanQuery,
      category,
      mode: "cache",
      candidates: cached,
      comparison,
      liveAvailable: config.publicLiveSearchEnabled,
      preferences,
      preferAffiliate
    });
  }

  const acceptsMarketplace = (marketplace) => !preferences.marketplaces.length || preferences.marketplaces.includes(marketplace);
  const sources = [];
  if (acceptsMarketplace("mercadolivre")) {
    sources.push({ marketplace: "mercadolivre", label: "Mercado Livre", run: () => (dependencies.mercadoLivreSearch || liveMercadoLivreSearch)({ query: cleanQuery, category, limit: Math.max(24, limit), headless }) });
  }
  if ((config.lomadeeApiKey || dependencies.lomadeeSearch) && (!preferences.marketplaces.length || preferences.marketplaces.some((key) => key !== "mercadolivre"))) {
    sources.push({ marketplace: "lomadee", label: "Lojas parceiras", run: () => (dependencies.lomadeeSearch || liveLomadeeSearch)({ query: cleanQuery, limit: 100 }) });
  }
  if (!sources.length) {
    return buildResult({
      query: cleanQuery,
      category,
      mode: "cache",
      candidates: cached,
      comparison,
      liveAvailable: config.publicLiveSearchEnabled,
      preferences,
      preferAffiliate
    });
  }

  const settled = await Promise.allSettled(sources.map((source) => source.run()));
  const candidates = [];
  const sourceStatus = [];
  let anyOk = false;
  settled.forEach((outcome, index) => {
    const source = sources[index];
    if (outcome.status === "fulfilled") {
      anyOk = true;
      candidates.push(...outcome.value.candidates);
      const matching = filterRelevantCandidates(outcome.value.candidates, cleanQuery);
      sourceStatus.push({ marketplace: source.marketplace, label: source.label, status: matching.length ? "ok" : "empty", count: matching.length });
      logEvent("info", "Motor de busca ao vivo concluido", { query: cleanQuery, marketplace: source.marketplace, count: outcome.value.candidates.length });
    } else {
      sourceStatus.push({ marketplace: source.marketplace, label: source.label, status: "error", count: 0, error: outcome.reason?.message || String(outcome.reason) });
      logEvent("error", "Motor de busca ao vivo falhou", { query: cleanQuery, marketplace: source.marketplace, error: outcome.reason?.message });
    }
  });

  if (!anyOk) {
    return {
      ...buildResult({
        query: cleanQuery,
        category,
        mode: "cache_after_live_error",
        candidates: cached,
        comparison,
        sourceStatus,
        liveAvailable: config.publicLiveSearchEnabled,
        preferences,
        preferAffiliate
      }),
      liveError: sourceStatus.map((item) => item.error).filter(Boolean).join("; ")
    };
  }

  // Never let an old cached price outrank a newly observed offer. Cache is only
  // a dated fallback if all live sources failed.
  let combinedCandidates = dedupeCandidates(filterRelevantCandidates(candidates, cleanQuery))
    .filter((item) => numberOrNull(item.price) && safeUrl(item.sourceUrl));
  combinedCandidates = visibleShoppingOffers(rankShoppingCandidates(combinedCandidates, preferences));
  if (preferAffiliate) {
    combinedCandidates = await affiliateShoppingOffers(combinedCandidates, { headless, ...dependencies.affiliateOptions });
  }

  return buildResult({
    query: cleanQuery,
    category,
    mode: "live",
    candidates: combinedCandidates,
    comparison,
    sourceStatus,
    liveAvailable: config.publicLiveSearchEnabled,
    preferences,
    preferAffiliate
  });
}

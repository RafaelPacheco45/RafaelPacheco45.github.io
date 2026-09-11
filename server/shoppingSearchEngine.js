import { config } from "./config.js";
import { listComparisons, listProducts, logEvent, upsertProduct } from "./db.js";
import { searchMercadoLivreProducts, generateMercadoLivreAffiliateLink } from "./adapters/mercadoLivre.js";
import { searchLomadeeProducts, generateLomadeeAffiliateLink } from "./adapters/lomadee.js";
import { searchGoogleAiMode } from "./adapters/googleAiMode.js";
import { loadSiteConfig } from "./sitePublisher.js";
import { cleanText, slugify } from "./lib/utils.js";
import { withBrowser } from "./browser.js";

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
    sourceUrl: product.affiliateUrl || "",
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
    source: "site_config"
  };
}

function dbProductToCandidate(product) {
  const marketplace = normalizeMarketplace(product.marketplace);
  return {
    ...product,
    store: marketplaceLabel(marketplace),
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

function hasAffiliateLink(candidate) {
  const url = String(candidate.affiliateUrl || "");
  if (!url) return false;
  if (candidate.marketplace === "mercadolivre") return /^https:\/\/meli\.la\//i.test(url) || /[?&]matt_(?:tool|word)=/i.test(url);
  if (candidate.marketplace === "amazon") return /[?&]tag=/i.test(url);
  if (candidate.marketplace === "lomadee") return /^https:\/\/[^/]*lmdee\.link\//i.test(url) || /^https:\/\/[^/]*lomadee/i.test(url);
  return true;
}

function canGenerateAffiliate(candidate) {
  if (candidate.marketplace === "mercadolivre") return /^https?:\/\//i.test(String(candidate.sourceUrl || ""));
  if (candidate.marketplace === "lomadee") return Boolean(candidate.organizationId) && /^https?:\/\//i.test(String(candidate.sourceUrl || ""));
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
  reasons.push(`loja confiavel: ${marketplaceLabel(candidate.marketplace)}`);
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
    if (normalized.marketplaces.length && !normalized.marketplaces.includes(normalizeMarketplace(item.marketplace || item.store))) return false;
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
  const shortDescription = cleanText(candidate.description || "").slice(0, 420);
  const shortWhy = cleanText(candidate.why || "").slice(0, 260);
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
    sourceUrl: candidate.sourceUrl || "",
    affiliateUrl: candidate.affiliateUrl || "",
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
  const filtered = dedupeCandidates([...siteProducts, ...dbProducts]).filter((item) => {
    const categoryOk = !category || category === "geral" || item.category === category;
    return categoryOk && titleMatches(item, query);
  });
  return filtered;
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

function buildResult({ query, category, mode, candidates, comparison = null, sourceStatus = [], liveAvailable = false, queued = false, preferences = {}, preferAffiliate = true }) {
  const normalizedPreferences = normalizeSearchPreferences(preferences);
  const ranked = rankShoppingCandidates(candidates, normalizedPreferences);
  const recommendation = chooseShoppingRecommendation(ranked, normalizedPreferences);
  const cheapest = cheapestCandidate(ranked);
  const alternatives = ranked.filter((item) =>
    (!recommendation || item.id !== recommendation.id) &&
    (!cheapest || item.id !== cheapest.id)
  ).slice(0, 5);
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
    topRated: publicCandidate(topRatedCandidate(ranked)),
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
  }, { timeoutMs: 90000, headless });
}

async function liveLomadeeSearch({ query, limit }) {
  const found = await searchLomadeeProducts({ query, limit });
  const saved = found.map((candidate) => {
    const product = upsertProduct({ ...candidate, affiliateUrl: candidate.affiliateUrl || "", status: candidate.affiliateUrl ? "affiliate_ready" : "discovered" });
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
    if (!affiliateUrl) return candidate;
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
}) {
  const cleanQuery = cleanText(query || "");
  if (!cleanQuery) throw new Error("Informe o produto para buscar.");
  const preferences = normalizeSearchPreferences({ priority, priceMin, priceMax, minRating, marketplaces });

  const comparison = findCachedComparison(cleanQuery);
  const cached = cachedCandidates(cleanQuery, category);
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
    sources.push({ marketplace: "mercadolivre", label: "Mercado Livre", run: () => liveMercadoLivreSearch({ query: cleanQuery, category, limit, headless }) });
  }
  if (config.lomadeeApiKey && acceptsMarketplace("lomadee")) {
    sources.push({ marketplace: "lomadee", label: "Lojas parceiras", run: () => liveLomadeeSearch({ query: cleanQuery, limit }) });
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
      sourceStatus.push(...outcome.value.sourceStatus);
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

  let combinedCandidates = dedupeCandidates([...candidates, ...cached]);
  if (preferAffiliate) {
    const ranked = rankShoppingCandidates(combinedCandidates, preferences);
    const winner = chooseShoppingRecommendation(ranked, preferences);
    const affiliatedWinner = await attemptAffiliateForWinner(winner, { headless });
    if (affiliatedWinner && winner && affiliatedWinner.id === winner.id) {
      if (affiliatedWinner.affiliateUrl) {
        upsertProduct({ ...affiliatedWinner, status: "affiliate_ready" });
      }
      combinedCandidates = combinedCandidates.map((item) => item.id === winner.id ? affiliatedWinner : item);
    }
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

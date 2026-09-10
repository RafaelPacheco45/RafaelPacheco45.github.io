import { config } from "../config.js";
import { cleanText, stableId } from "../lib/utils.js";

function apiHeaders() {
  if (!config.lomadeeApiKey) throw new Error("AUTOBLOG_LOMADEE_API_KEY nao configurada.");
  return { "x-api-key": config.lomadeeApiKey, "content-type": "application/json" };
}

async function lomadeeFetch(path, options = {}) {
  const url = `${config.urls.lomadeeApi}${path}`;
  const res = await fetch(url, { ...options, headers: { ...apiHeaders(), ...(options.headers || {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body?.message || `Lomadee API retornou ${res.status}`;
    throw new Error(message);
  }
  return body;
}

function priceFromProduct(product) {
  const option = (product.options || [])[0];
  const cents = option?.pricing?.[0]?.price;
  return Number.isFinite(cents) ? cents / 100 : null;
}

function availableFromProduct(product) {
  const option = (product.options || [])[0];
  return product.available !== false && option?.available !== false;
}

function imageFromProduct(product) {
  return product.images?.[0]?.url || product.options?.[0]?.images?.[0]?.url || "";
}

export async function searchLomadeeProducts({ query, limit = 8 }) {
  if (!query || !String(query).trim()) throw new Error("Informe uma busca da Lomadee.");
  const params = new URLSearchParams({
    search: query,
    limit: String(Math.min(Math.max(limit, 1), 100)),
    isAvailable: "true"
  });
  const result = await lomadeeFetch(`/affiliate/products?${params.toString()}`);
  const products = Array.isArray(result?.data) ? result.data : [];

  return products
    .filter((product) => availableFromProduct(product) && /^https?:\/\//i.test(product.url || ""))
    .map((product) => {
      const title = cleanText(product.name || "");
      const store = cleanText(product.options?.[0]?.seller || "Lomadee");
      const price = priceFromProduct(product);
      return {
        id: stableId([title, product.url], "lmd-"),
        marketplace: "lomadee",
        store,
        organizationId: product.organizationId,
        sourceUrl: product.url,
        affiliateUrl: "",
        title,
        brand: "",
        category: "geral",
        badge: "Achado automatico",
        description: title ? `${title}. Produto encontrado na rede Lomadee (loja ${store}); confirme preco, frete e estoque no checkout.` : "",
        why: "Entrada criada pela busca automatica na Lomadee. A IA deve revisar antes da publicacao final.",
        price,
        oldPrice: null,
        rating: null,
        reviewLabel: "",
        imageUrl: imageFromProduct(product),
        status: "discovered"
      };
    })
    .filter((item) => item.title && item.sourceUrl);
}

export async function generateLomadeeAffiliateLink({ organizationId, sourceUrl }) {
  if (!organizationId) throw new Error("Produto Lomadee sem organizationId.");
  if (!/^https?:\/\//i.test(String(sourceUrl || ""))) throw new Error("URL de produto invalida.");
  const result = await lomadeeFetch("/affiliate/shortener/url", {
    method: "POST",
    body: JSON.stringify({ organizationId, type: "Custom", url: sourceUrl })
  });
  const entry = Array.isArray(result) ? result[0] : result?.[0];
  const shortUrl = entry?.shortUrls?.[0];
  if (!shortUrl) {
    throw new Error(entry?.message || "A Lomadee nao retornou um link encurtado para esse produto.");
  }
  return shortUrl;
}

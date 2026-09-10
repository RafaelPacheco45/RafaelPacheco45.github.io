import { withBrowser } from "../browser.js";
import { cleanText, parsePriceBR, stableId } from "../lib/utils.js";

function shopeeSearchUrl(query) {
  return `https://shopee.com.br/search?keyword=${encodeURIComponent(String(query || "").trim())}`;
}

function looksLikeGenericAsset(url) {
  return /sprite|placeholder|logo/i.test(String(url || ""));
}

async function evaluateWithRetry(page, fn, arg) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await page.evaluate(fn, arg);
    } catch (error) {
      lastError = error;
      if (!/Execution context was destroyed|navigation/i.test(error.message)) throw error;
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1000);
    }
  }
  throw lastError;
}

export async function searchShopeeProducts({ query, limit = 8, category = "geral" }) {
  if (!query || !String(query).trim()) throw new Error("Informe uma busca do Shopee.");
  return withBrowser(async ({ page }) => {
    await page.goto(shopeeSearchUrl(query), { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await page.mouse.wheel(0, 1600).catch(() => {});
    await page.waitForTimeout(1000);

    const rawItems = await evaluateWithRetry(page, (maxItems) => {
      const anchors = [...document.querySelectorAll("a[href*='-i.']")];
      const seen = new Set();
      const items = [];
      for (const anchor of anchors) {
        const href = anchor.href || "";
        if (!href || seen.has(href)) continue;
        const card = anchor.closest("li, div[class*='item'], div[class*='card']") || anchor;
        const title =
          card.querySelector("[class*='name']")?.textContent ||
          anchor.getAttribute("aria-label") ||
          anchor.querySelector("img[alt]")?.getAttribute("alt") ||
          "";
        const price =
          card.querySelector("[class*='price']")?.textContent ||
          "";
        const image =
          card.querySelector("img[src]")?.getAttribute("src") ||
          card.querySelector("img[data-src]")?.getAttribute("data-src") ||
          "";
        const rating =
          card.querySelector("[class*='rating']")?.textContent ||
          card.querySelector("[class*='star'] + *")?.textContent ||
          "";
        const sold =
          card.textContent?.match(/[\d.,]+\s?(vendidos?|sold)/i)?.[0] ||
          "";
        if (!title.trim()) continue;
        seen.add(href);
        items.push({ title, href, price, image, rating, sold });
        if (items.length >= maxItems) break;
      }
      return items;
    }, limit);

    return rawItems
      .map((item) => {
        const title = cleanText(item.title);
        const sourceUrl = item.href;
        return {
          id: stableId([title, sourceUrl], "sh-"),
          marketplace: "shopee",
          sourceUrl,
          title,
          brand: "",
          category,
          badge: "Achado automatico",
          description: title ? `${title}. Produto importado automaticamente do Shopee; confirme preco, frete e estoque no checkout.` : "",
          why: "Entrada criada pela busca automatica no Shopee para comparacao.",
          price: parsePriceBR(item.price),
          oldPrice: null,
          rating: parsePriceBR(item.rating),
          reviewLabel: cleanText(item.sold || item.rating || ""),
          imageUrl: looksLikeGenericAsset(item.image) ? "" : (item.image || ""),
          specs: [],
          pros: [],
          cons: [],
          status: "discovered"
        };
      })
      .filter((item) => item.title && item.sourceUrl);
  });
}

export async function captureShopeeProduct({ url, category = "geral" }) {
  if (!/^https?:\/\//i.test(String(url || ""))) throw new Error("URL de produto Shopee invalida.");
  return withBrowser(async ({ page }) => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1800);
    const data = await evaluateWithRetry(page, () => {
      const meta = (name) =>
        document.querySelector(`meta[property="${name}"]`)?.getAttribute("content") ||
        document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ||
        "";
      const title =
        meta("og:title") ||
        document.querySelector("[class*='product'][class*='name']")?.textContent ||
        document.querySelector("h1")?.textContent ||
        document.title ||
        "";
      const priceEl = document.querySelector("[class*='price'] [class*='value'], [class*='price']");
      const rawPrice = priceEl?.textContent || meta("product:price:amount") || "";
      const image = meta("og:image") || document.querySelector("img[src*='http']")?.getAttribute("src") || "";
      const rating =
        document.querySelector("[class*='rating'] [class*='value']")?.textContent ||
        document.querySelector("[class*='rating']")?.textContent ||
        "";
      const description =
        document.querySelector("[class*='product'][class*='description']")?.textContent ||
        meta("description") ||
        "";
      return { title, price: rawPrice, image, rating, description };
    });
    const title = cleanText(data.title).replace(/\s+\|.+$/, "");
    return {
      id: stableId([title, url], "sh-"),
      marketplace: "shopee",
      sourceUrl: url,
      title,
      brand: "",
      category,
      badge: "Capturado automaticamente",
      description: cleanText(data.description) || `${title}. Confira preco, frete e estoque no checkout.`,
      why: "Produto capturado automaticamente do Shopee para comparacao.",
      price: parsePriceBR(data.price),
      oldPrice: null,
      rating: parsePriceBR(data.rating),
      reviewLabel: cleanText(data.rating),
      imageUrl: looksLikeGenericAsset(data.image) ? "" : (data.image || ""),
      specs: [],
      pros: [],
      cons: [],
      status: "captured"
    };
  });
}

export async function captureShopeeReviews({ url, limit = 6 }) {
  if (!/^https?:\/\//i.test(String(url || ""))) throw new Error("URL de produto Shopee invalida.");
  return withBrowser(async ({ page }) => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await page.mouse.wheel(0, 2600).catch(() => {});
    await page.waitForTimeout(1200);
    await page.mouse.wheel(0, 2600).catch(() => {});
    await page.waitForTimeout(1200);

    const rawReviews = await evaluateWithRetry(page, (maxItems) => {
      const containers = [
        ...document.querySelectorAll("[class*='product-rating'] [class*='item']"),
        ...document.querySelectorAll("[class*='review'][class*='item']"),
        ...document.querySelectorAll("[class*='comment']")
      ];
      const seen = new Set();
      const items = [];
      const noisePattern = /^(avalia[cç][aã]o|nota|rating|classifica[cç][aã]o)\b.*\d|^\(?\d+([.,]\d+)?\)?\s*(de|\/|out of|estrelas?)\b|h[áa]\s*\d+\s*(dia|dias|semanas?|mes|meses|anos?)\b|^variante|^variation/i;
      for (const container of containers) {
        const text =
          container.querySelector("[class*='content']")?.textContent ||
          container.querySelector("p")?.textContent ||
          "";
        const clean = text.replace(/\s+/g, " ").trim();
        const wordCount = clean.split(" ").filter(Boolean).length;
        if (!clean || clean.length < 12 || clean.length > 700 || seen.has(clean) || noisePattern.test(clean) || wordCount < 4) continue;
        seen.add(clean);
        items.push({ text: clean, rating: "" });
        if (items.length >= maxItems) break;
      }
      return items;
    }, limit);

    return rawReviews
      .map((item) => ({ text: cleanText(item.text).slice(0, 500), rating: null }))
      .filter((item) => item.text);
  }, { timeoutMs: 45000 });
}

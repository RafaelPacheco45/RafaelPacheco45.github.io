import { config } from "../config.js";
import { withBrowser } from "../browser.js";
import { cleanText, parsePriceBR, stableId } from "../lib/utils.js";

function mercadoLivreSearchUrl(query) {
  const slug = encodeURIComponent(String(query || "").trim()).replace(/%20/g, "-");
  return `https://lista.mercadolivre.com.br/${slug}`;
}

function looksLikeGenericAsset(url) {
  return /frontend-assets|logo_homecom|\/sprite|placeholder/i.test(String(url || ""));
}

function normalizeMercadoLivreUrl(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function looksLikeAffiliateUrl(url, sourceUrl) {
  const lower = String(url || "").toLowerCase();
  if (!lower.includes("mercadolivre.com") && !lower.includes("meli.la")) return false;
  if (normalizeMercadoLivreUrl(url) === normalizeMercadoLivreUrl(sourceUrl)) return false;
  if (lower.includes("meli.la/")) return true;
  if (/\/afiliados\/(?:dashboard|hub|linkbuilder|tools)\b/.test(lower)) return false;
  return /[?&]matt_(?:tool|word)=|[?&]utm_|[?&]tracking_id=|[?&]source=/.test(lower);
}

export async function searchMercadoLivreProducts({ query, limit = config.defaultSearchLimit, category = "geral", page: sharedPage }) {
  if (!query || !String(query).trim()) throw new Error("Informe uma busca do Mercado Livre.");
  const run = async ({ page }) => {
    await page.goto(mercadoLivreSearchUrl(query), { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const rawItems = await evaluateWithRetry(page, (maxItems) => {
      const containers = [
        ...document.querySelectorAll("li.ui-search-layout__item"),
        ...document.querySelectorAll(".ui-search-result__wrapper"),
        ...document.querySelectorAll("[class*='ui-search-result']")
      ];
      const seen = new Set();
      const items = [];
      for (const container of containers) {
        const anchor = container.querySelector("a[href*='/MLB-'], a[href*='/p/MLB'], a[href*='produto.mercadolivre'], a[href*='mercadolivre.com.br']");
        const href = anchor?.href || "";
        if (!href || seen.has(href)) continue;
        const title =
          container.querySelector(".poly-component__title")?.textContent ||
          container.querySelector(".ui-search-item__title")?.textContent ||
          container.querySelector("h2")?.textContent ||
          anchor.textContent ||
          "";
        const rawPrice =
          container.querySelector(".andes-money-amount__fraction")?.textContent ||
          container.querySelector("[class*='price']")?.textContent ||
          "";
        const cents = container.querySelector(".andes-money-amount__cents")?.textContent || "";
        // Sem centavos separados, o ponto no preco e separador de milhar, nao decimal.
        const price = cents ? `${rawPrice},${cents}` : rawPrice.replace(/\./g, "");
        const image =
          container.querySelector("img[data-src]")?.getAttribute("data-src") ||
          container.querySelector("img[src]")?.getAttribute("src") ||
          "";
        const rating =
          container.querySelector(".poly-component__review-compacted .polylabel-label")?.textContent ||
          container.querySelector(".ui-search-reviews__rating-number")?.textContent ||
          container.querySelector("[class*='rating']")?.textContent ||
          "";
        const sold =
          container.querySelector(".ui-search-item__group__element")?.textContent ||
          container.textContent?.match(/\+\s?\d+.*vendid[oa]s?/i)?.[0] ||
          "";
        seen.add(href);
        items.push({ title, href, price, image, rating, sold });
        if (items.length >= maxItems) break;
      }
      return items;
    }, limit);

    return rawItems
      .map((item) => {
        const title = cleanText(item.title);
        // Guarda o link real da busca (mesmo que seja um redirect de rastreamento
        // click1.mercadolivre.com.br) em vez de reconstruir uma URL "canonica" a partir
        // do ID: a reconstrucao pode apontar pra um anuncio ja expirado. Navegar nesse
        // link segue o mesmo caminho que um visitante real seguiria.
        const sourceUrl = normalizeMercadoLivreUrl(item.href);
        const price = parsePriceBR(item.price);
        const rating = parsePriceBR(item.rating);
        return {
          id: stableId([title, sourceUrl], "ml-"),
          marketplace: "mercadolivre",
          sourceUrl,
          title,
          brand: "",
          category,
          badge: "Achado automatico",
          description: title ? `${title}. Produto importado automaticamente do Mercado Livre; confirme preco, frete e estoque no checkout.` : "",
          why: "Entrada criada pela busca automatica. A IA deve revisar antes da publicacao final.",
          price,
          oldPrice: null,
          rating,
          reviewLabel: cleanText(item.sold || item.rating || ""),
          imageUrl: item.image || "",
          specs: [],
          pros: [],
          cons: [],
          status: "discovered"
        };
      })
      .filter((item) => item.title && item.sourceUrl);
  };
  if (sharedPage) return run({ page: sharedPage });
  return withBrowser(run);
}

export async function captureMercadoLivreProduct({ url, category = "geral", page: sharedPage }) {
  if (!/^https?:\/\//i.test(String(url || ""))) throw new Error("URL de produto invalida.");
  const run = async ({ page }) => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const data = await evaluateWithRetry(page, () => {
      const meta = (name) =>
        document.querySelector(`meta[property="${name}"]`)?.getAttribute("content") ||
        document.querySelector(`meta[name="${name}"]`)?.getAttribute("content") ||
        "";
      const title =
        document.querySelector(".ui-pdp-title")?.textContent ||
        document.querySelector("h1")?.textContent ||
        meta("og:title") ||
        document.title ||
        "";
      const priceFraction =
        document.querySelector(".ui-pdp-price__second-line .andes-money-amount__fraction")?.textContent ||
        document.querySelector("[data-testid='price-part'] .andes-money-amount__fraction")?.textContent ||
        document.querySelector(".ui-pdp-price .andes-money-amount__fraction")?.textContent ||
        "";
      const priceCents =
        document.querySelector(".ui-pdp-price__second-line .andes-money-amount__cents")?.textContent ||
        document.querySelector("[data-testid='price-part'] .andes-money-amount__cents")?.textContent ||
        document.querySelector(".ui-pdp-price .andes-money-amount__cents")?.textContent ||
        "";
      const metaPrice = meta("product:price:amount");
      // Sem centavos separados, um ponto no preco e sempre separador de milhar (ex: "4.899" = 4899),
      // nunca decimal - a interface do Mercado Livre so mostra decimal via o span de centavos.
      const price = priceFraction
        ? (priceCents ? `${priceFraction},${priceCents}` : priceFraction.replace(/\./g, ""))
        : metaPrice || document.querySelector(".andes-money-amount__fraction")?.textContent?.replace(/\./g, "") || "";
      const image =
        meta("og:image") ||
        document.querySelector(".ui-pdp-gallery img[src]")?.getAttribute("src") ||
        document.querySelector("img[src*='http']")?.getAttribute("src") ||
        "";
      const rating =
        document.querySelector(".ui-pdp-review__rating")?.textContent ||
        document.querySelector("[class*='rating']")?.textContent ||
        "";
      const reviewCount =
        document.querySelector(".ui-pdp-review__amount")?.textContent ||
        "";
      const sold =
        document.querySelector(".ui-pdp-subtitle")?.textContent ||
        "";
      const brand =
        document.querySelector("[itemprop='brand']")?.textContent ||
        "";
      const description =
        document.querySelector(".ui-pdp-description__content")?.textContent ||
        meta("description") ||
        "";
      return { title, price, image, rating, reviewCount, sold, brand, description };
    });
    const title = cleanText(data.title).replace(/\s+\|.+$/, "");
    const reviewCountMatch = cleanText(data.reviewCount).match(/(\d[\d.,]*)/);
    const soldMatch = cleanText(data.sold).match(/(\+?\d[\d.,]*)\s*vendid[oa]s?/i);
    // reviewLabel e um rotulo complementar (quantidade de avaliacoes ou vendas), nao a
    // mesma nota ja mostrada como estrela - duplicar o numero da nota nos dois lugares
    // confundia o layout ("★4.9 4.9").
    const reviewLabel = reviewCountMatch
      ? `${reviewCountMatch[1]} avaliações`
      : soldMatch
        ? `${soldMatch[1]} vendidos`
        : "";
    // Usa a URL onde o navegador realmente aterrissou (page.url()), nao uma URL
    // reconstruida a partir do ID do link de busca: anuncios expiram e o Mercado Livre
    // redireciona para um substituto - reconstruir a URL original captura dado (preco,
    // titulo) de um produto que nao e mais o que esta na tela.
    const sourceUrl = normalizeMercadoLivreUrl(page.url());
    return {
      id: stableId([title, sourceUrl], "ml-"),
      marketplace: "mercadolivre",
      sourceUrl,
      title,
      brand: cleanText(data.brand),
      category,
      badge: "Capturado automaticamente",
      description: cleanText(data.description) || `${title}. Confira preco, frete e estoque no checkout.`,
      why: "Preço e avaliação verificados diretamente no anúncio do Mercado Livre.",
      price: parsePriceBR(data.price),
      oldPrice: null,
      rating: parsePriceBR(data.rating),
      reviewLabel,
      imageUrl: looksLikeGenericAsset(data.image) ? "" : (data.image || ""),
      specs: [],
      pros: [],
      cons: [],
      status: "captured"
    };
  };
  if (sharedPage) return run({ page: sharedPage });
  return withBrowser(run);
}

export async function captureMercadoLivreReviews({ url, limit = 6, page: sharedPage, alreadyOnPage = false }) {
  if (!/^https?:\/\//i.test(String(url || ""))) throw new Error("URL de produto invalida.");
  const run = async ({ page }) => {
    if (!alreadyOnPage) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }

    const reviewsLink = page.locator("a", { hasText: /opini(a|õ)o|avalia/i }).first();
    if (await reviewsLink.isVisible().catch(() => false)) {
      await reviewsLink.click().catch(() => {});
      await page.waitForTimeout(1200);
    }
    await page.mouse.wheel(0, 2400).catch(() => {});
    await page.waitForTimeout(1000);
    await page.mouse.wheel(0, 2400).catch(() => {});
    await page.waitForTimeout(1000);

    const rawReviews = await evaluateWithRetry(page, (maxItems) => {
      const containers = [
        ...document.querySelectorAll("[class*='review-capability-comments__comment']"),
        ...document.querySelectorAll("article[class*='review']"),
        ...document.querySelectorAll("[data-testid*='review']"),
        ...document.querySelectorAll("[class*='review'][class*='comment']")
      ];
      const seen = new Set();
      const items = [];
      // Rejeita texto que e so metadado (resumo de nota, local/data da compra),
      // nao um comentario real de comprador.
      const noisePattern = /^(avalia[cç][aã]o|nota|rating|classifica[cç][aã]o)\b.*\d|^\(?\d+([.,]\d+)?\)?\s*(de|\/|out of|estrelas?)\b|h[áa]\s*\d+\s*(dia|dias|semanas?|mes|meses|anos?)\b/i;
      // O texto de fallback (container inteiro) pode vir com o nome do pais colado sem
      // espaco no "Ha X tempo" (ex: "BrasilHa mais de 1 ano") - isso nao bate com o
      // noisePattern normal porque nao esta ancorado no inicio nem cobre "mais de".
      const metaOnlyPattern = /^[a-zà-ú]{0,20}h[áa]\s*(mais de\s*)?\d+\s*(dia|dias|semanas?|mes|meses|anos?)\b/i;
      for (const container of containers) {
        // So usa o texto solto do container (com metadado misturado) como ultimo recurso,
        // e so aceita se parecer frase de verdade (varias palavras), nao um rotulo curto.
        const text =
          container.querySelector("[class*='comment-content']")?.textContent ||
          container.querySelector("p")?.textContent ||
          "";
        const usedFallback = !text;
        const fallbackText = usedFallback ? (container.textContent || "") : "";
        const clean = (text || fallbackText).replace(/\s+/g, " ").trim();
        const wordCount = clean.split(" ").filter(Boolean).length;
        if (!clean || clean.length < 12 || clean.length > 700 || seen.has(clean) || noisePattern.test(clean)) continue;
        if (usedFallback && (wordCount < 8 || metaOnlyPattern.test(clean))) continue;
        const ratingEl = container.querySelector("[class*='rating'] [style*='width'], meta[itemprop='ratingValue']");
        const ratingRaw = ratingEl?.getAttribute("content") || ratingEl?.getAttribute("aria-label") || ratingEl?.getAttribute("style") || "";
        const ratingMatch = ratingRaw.match(/(\d+([.,]\d+)?)/);
        seen.add(clean);
        items.push({ text: clean, rating: ratingMatch ? ratingMatch[1] : "" });
        if (items.length >= maxItems) break;
      }
      return items;
    }, limit);

    return rawReviews
      .map((item) => ({ text: cleanText(item.text).slice(0, 500), rating: parsePriceBR(item.rating) }))
      .filter((item) => item.text);
  };
  if (sharedPage) return run({ page: sharedPage });
  return withBrowser(run, { timeoutMs: 45000 });
}

// page.evaluate() nao tem timeout proprio - se a pagina tiver script pesado rodando
// (ex: verificacao anti-bot), o evaluate pode ficar preso ate o timeout padrao do
// Playwright (120s). Um teto curto aqui evita que uma unica chamada trave o fluxo
// inteiro por minutos.
function withEvalTimeout(promise, ms = 10000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("Timeout esperando o evaluate() da pagina.")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function evaluateWithRetry(page, fn, arg) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await withEvalTimeout(page.evaluate(fn, arg));
    } catch (error) {
      lastError = error;
      if (!/Execution context was destroyed|navigation|Timeout esperando/i.test(error.message)) throw error;
      await page.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1000);
    }
  }
  throw lastError;
}

async function findVisibleInput(page) {
  const selectors = [
    "input[type='url']",
    "input[placeholder*='URL' i]",
    "input[aria-label*='URL' i]",
    "textarea[placeholder*='URL' i]",
    "textarea",
    "input[type='text']"
  ];
  for (const selector of selectors) {
    const locators = await page.locator(selector).all();
    for (const locator of locators) {
      if (await locator.isVisible().catch(() => false)) return locator;
    }
  }
  return null;
}

async function clickGenerateButton(page) {
  const names = [/gerar/i, /criar/i, /encurtar/i, /continuar/i];
  for (const name of names) {
    const button = page.getByRole("button", { name }).first();
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      return true;
    }
  }
  const textButton = page.locator("button, [role='button']").filter({ hasText: /gerar|criar|encurtar|continuar/i }).first();
  if (await textButton.isVisible().catch(() => false)) {
    await textButton.click();
    return true;
  }
  return false;
}

async function extractAffiliateLinkFromPage(page, sourceUrl) {
  const links = await page.evaluate(() => {
    const fromAnchors = [...document.querySelectorAll("a[href]")].map((a) => a.href);
    const text = document.body?.innerText || "";
    const fromText = text.match(/https?:\/\/[^\s"'<>]+/g) || [];
    const fromInputs = [...document.querySelectorAll("input, textarea")]
      .map((el) => el.value || el.getAttribute("value") || "")
      .filter(Boolean);
    return [...fromAnchors, ...fromText, ...fromInputs];
  });
  return links.find((link) => looksLikeAffiliateUrl(link, sourceUrl)) || "";
}

async function resolveCanonicalProductUrl(page, sourceUrl) {
  // O link de busca costuma ser um redirect de rastreamento (click1.mercadolivre.com.br/mclics/...),
  // e o Gerador de Links recusa esse formato ("Este URL nao e permitido pelo Programa"). Segue o
  // redirect de verdade e usa page.url() (a URL canonica /p/MLBxxxx onde o navegador aterrissou).
  if (!/click1\.mercadolivre\.com\.br|\/mclics\//i.test(sourceUrl)) return sourceUrl;
  await page.goto(sourceUrl, { waitUntil: "domcontentloaded" }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  const landed = normalizeMercadoLivreUrl(page.url());
  try {
    const parsed = new URL(landed);
    parsed.search = "";
    return parsed.toString();
  } catch {
    return landed;
  }
}

export async function generateMercadoLivreAffiliateLink({ sourceUrl, page: sharedPage }) {
  if (!/^https?:\/\//i.test(String(sourceUrl || ""))) throw new Error("URL de produto invalida.");
  const run = async ({ context, page }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://www.mercadolivre.com.br" }).catch(() => {});
    const canonicalUrl = await resolveCanonicalProductUrl(page, sourceUrl);
    await page.goto(config.urls.mercadoLivreLinkGenerator, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);

    const bodyText = cleanText(await page.locator("body").innerText().catch(() => ""));
    if (/entrar|login|iniciar sess/i.test(bodyText) && !/gerar|url|link/i.test(bodyText)) {
      throw new Error("Mercado Livre parece nao estar logado no perfil do navegador. Rode npm run login e entre no Portal do Afiliado.");
    }

    const input = await findVisibleInput(page);
    if (!input) {
      throw new Error("Nao encontrei o campo de URL do Gerador de Links do Mercado Livre. Abra o login, confirme que o perfil afiliado esta aprovado e tente novamente.");
    }

    await input.fill(canonicalUrl);
    const clicked = await clickGenerateButton(page);
    if (!clicked) {
      await input.press("Enter").catch(() => {});
    }

    await page.waitForTimeout(4000);
    let affiliateUrl = await extractAffiliateLinkFromPage(page, canonicalUrl);

    if (!affiliateUrl) {
      const copyButton = page.getByRole("button", { name: /copiar/i }).first();
      if (await copyButton.isVisible().catch(() => false)) {
        await copyButton.click();
        await page.waitForTimeout(500);
        const clip = await page.evaluate(() => navigator.clipboard?.readText?.()).catch(() => "");
        if (looksLikeAffiliateUrl(clip, canonicalUrl)) affiliateUrl = clip;
      }
    }

    if (!affiliateUrl) {
      throw new Error("O gerador nao retornou um link de afiliado detectavel. Talvez a tela tenha mudado ou a conta ainda nao esteja aprovada.");
    }

    return normalizeMercadoLivreUrl(affiliateUrl);
  };
  if (sharedPage) return run({ context: sharedPage.context(), page: sharedPage });
  return withBrowser(run);
}

import { cleanText, stableId } from "../lib/utils.js";

const TRUSTED_STORES = [
  { match: /mercado ?livre/i, marketplace: "mercadolivre", label: "Mercado Livre" },
  { match: /amazon/i, marketplace: "amazon", label: "Amazon" },
  { match: /magazine ?luiza|magalu/i, marketplace: "magalu", label: "Magazine Luiza" }
];

function withTimeout(promise, ms, fallback) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function canonicalUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function matchStore(label) {
  return TRUSTED_STORES.find((store) => store.match.test(label || ""));
}

/**
 * Abre o Modo IA do Google (udm=50) pra uma busca, e pra cada card de produto
 * recomendado abre o painel de "onde comprar" e extrai o link direto (nao de
 * rastreamento) de lojas confiaveis (Mercado Livre, Amazon, Magalu). A ideia:
 * a IA do Google faz a pesquisa/curadoria de forma independente do nosso proprio
 * afiliado - so depois de achar um produto bom tentamos nos afiliar a ele.
 */
export async function searchGoogleAiMode({ query, page, maxProducts = 3 }) {
  if (!query || !String(query).trim()) throw new Error("Informe uma busca para o Modo IA do Google.");
  const prompt = `${query}, com opcoes de lojas confiaveis e conhecidas no Brasil como Mercado Livre, Amazon e Magazine Luiza`;
  const url = `https://www.google.com/search?q=${encodeURIComponent(prompt)}&udm=50&hl=pt-BR`;

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});

  // "Modo IA" pesquisa em varias fontes antes de responder (mostra "Pesquisando...")
  // e o tempo varia bastante por query - espera ativamente ate aparecer card de
  // produto ou o texto da resposta, em vez de um tempo fixo que falha em queries
  // mais lentas.
  const productCards = page.locator('button[href*="ibp=oshop"], a[href*="ibp=oshop"]');
  await withTimeout(
    productCards.first().waitFor({ state: "attached", timeout: 25000 }),
    26000,
    null
  ).catch(() => {});
  await page.waitForTimeout(1200);

  const productButtons = await withTimeout(productCards.all(), 8000, []).catch(() => []);

  const results = [];
  const seenTitles = new Set();

  for (const button of productButtons) {
    if (results.length >= maxProducts) break;
    const title = cleanText(await button.textContent().catch(() => "") || "");
    if (!title || seenTitles.has(title)) continue;
    seenTitles.add(title);

    const opened = await withTimeout(
      button.click({ timeout: 5000 }).then(() => true).catch(() => false),
      6000,
      false
    );
    if (!opened) continue;
    await page.waitForTimeout(1800);

    // A lista "Acesse o site de X" (comparativo de precos por loja) so existe pra
    // produtos com bastante presenca no Shopping Graph do Google - pra produtos de
    // nicho o painel pode nao ter esse comparativo (so uma loja direta). Rola aos
    // poucos checando a cada passo em vez de um scroll fixo, que tanto pode nao
    // alcancar a lista quanto pode passar direto por ela.
    await page.mouse.move(1080, 500).catch(() => {});
    let storeLinks = [];
    for (let i = 0; i < 10; i += 1) {
      storeLinks = await withTimeout(
        page.evaluate(() => {
          const anchors = [...document.querySelectorAll('a[aria-label^="Acesse o site de"]')];
          return anchors.map((a) => ({ label: a.getAttribute("aria-label") || "", href: a.href }));
        }),
        5000,
        []
      ).catch(() => []);
      if (storeLinks.length > 0) break;
      await page.mouse.wheel(0, 500).catch(() => {});
      await page.waitForTimeout(600);
    }

    for (const link of storeLinks) {
      const store = matchStore(link.label);
      if (!store) continue;
      const sourceUrl = canonicalUrl(link.href);
      if (!/^https?:\/\//i.test(sourceUrl)) continue;
      results.push({
        id: stableId([title, sourceUrl], "gai-"),
        marketplace: store.marketplace,
        store: store.label,
        sourceUrl,
        affiliateUrl: "",
        title,
        badge: "Achado automatico (Modo IA Google)",
        description: title ? `${title}. Recomendado pela pesquisa do Modo IA do Google; confirme preco, frete e estoque no checkout.` : "",
        why: "Entrada encontrada via Modo IA do Google (pesquisa independente, fora do nosso catalogo de afiliados). A IA deve revisar antes da publicacao final.",
        status: "discovered"
      });
      break; // uma loja confiavel por produto ja basta
    }

    // volta pra tela principal do Modo IA antes do proximo card
    const backButton = page.getByRole("button", { name: /voltar/i }).first();
    if (await backButton.isVisible().catch(() => false)) {
      await backButton.click().catch(() => {});
      await page.waitForTimeout(800);
    }
  }

  return results;
}

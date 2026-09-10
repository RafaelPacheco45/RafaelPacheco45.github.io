import { withBrowser } from "./browser.js";
import { logEvent, upsertProduct } from "./db.js";
import {
  captureMercadoLivreProduct,
  captureMercadoLivreReviews,
  generateMercadoLivreAffiliateLink,
  searchMercadoLivreProducts
} from "./adapters/mercadoLivre.js";
import { searchWebReviews } from "./adapters/webReview.js";
import { searchGoogleAiMode } from "./adapters/googleAiMode.js";

function median(values) {
  const nums = values.map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!nums.length) return null;
  return nums[Math.floor(nums.length / 2)];
}

/**
 * Bonus por preco abaixo da mediana do grupo - sem isso, a nota/volume de venda
 * sozinhos podiam colocar em 1o lugar um item mais caro que uma alternativa quase
 * tao bem avaliada e mais barata. Capado pra nao deixar um preco baixo isolado
 * atropelar um item com nota/venda muito superior.
 */
function priceScore(candidate, medianPrice) {
  const price = Number(candidate.price);
  if (!price || !medianPrice) return 0;
  return Math.max(0, Math.min(400, (medianPrice / price) * 300));
}

function candidateScore(candidate, medianPrice) {
  const rating = Number(candidate.rating) || 0;
  const soldMatch = String(candidate.reviewLabel || "").match(/(\d+)/);
  const sold = soldMatch ? Number(soldMatch[1]) : 0;
  return rating * 1000 + Math.min(sold, 5000) + priceScore(candidate, medianPrice);
}

/**
 * Soma o sinal de opiniao externa (Bing: reclame aqui, review, opiniao) ao score de
 * marketplace, como desempate - nao pode derrubar um item com preco e nota
 * objetivamente melhores. Peso baixo e clamp evitam que um punhado de trechos de
 * busca (nem sempre sobre o anuncio exato) vire mais decisivo que dado real do
 * marketplace (preco, nota, volume de vendas).
 */
function combinedScore(candidate, medianPrice) {
  const webSignal = Math.max(-3, Math.min(3, candidate.webReviewScore || 0));
  return candidateScore(candidate, medianPrice) + webSignal * 15;
}

/**
 * A pagina de busca e a pagina do produto sao raspagens independentes. Se o preco
 * capturado na pagina do produto for muito diferente do preco visto na listagem de
 * busca (por causa de um elemento errado pego na tela, ex: parcelamento ou item
 * relacionado), confia no preco da busca em vez de publicar um valor absurdo.
 */
function plausiblePrice(scrapedPrice, seedPrice) {
  const scraped = Number(scrapedPrice);
  const seed = Number(seedPrice);
  if (!Number.isFinite(seed) || seed <= 0) return Number.isFinite(scraped) ? scraped : null;
  if (!Number.isFinite(scraped) || scraped <= 0) return seed;
  const ratio = scraped / seed;
  return ratio < 0.3 || ratio > 3 ? seed : scraped;
}

async function enrichCandidate({ sourceUrl, category, withAffiliate, seedPrice, page, webReviews }) {
  const captured = await captureMercadoLivreProduct({ url: sourceUrl, category, page });
  const product = { ...captured, price: plausiblePrice(captured.price, seedPrice) };
  const saved = upsertProduct(product);
  // Ja estamos na pagina do produto (captureMercadoLivreProduct acabou de navegar ate ela);
  // reaproveita a mesma pagina em vez de recarregar do zero so pra ler as reviews.
  const reviews = await captureMercadoLivreReviews({ url: saved.sourceUrl, page, alreadyOnPage: true }).catch(() => []);
  if (!withAffiliate) return { product: saved, reviews, webReviews: webReviews || [] };

  // Link de afiliado e um bonus, nao um requisito: se o gerador falhar (sessao
  // deslogada, tela mudou), a comparacao ainda e publicada com o link direto do
  // anuncio em vez de travar tudo por causa de monetizacao.
  let affiliateUrl = "";
  try {
    affiliateUrl = await generateMercadoLivreAffiliateLink({ sourceUrl: saved.sourceUrl, page });
  } catch {
    affiliateUrl = "";
  }
  const withLink = affiliateUrl ? upsertProduct({ ...saved, affiliateUrl, status: "affiliate_ready" }) : saved;
  return { product: withLink, reviews, webReviews: webReviews || [], affiliateMissing: !affiliateUrl };
}

/**
 * Monta os 3 candidatos de um comparativo, todos do Mercado Livre (raspar outra
 * loja sem API oficial esbarra em bloqueio anti-bot - ver Shopee). O vencedor e
 * escolhido por merito real: nota e volume de venda no Mercado Livre, mais opiniao
 * externa (Bing) sobre o modelo especifico - nao existe mais uma regra que force o
 * primeiro colocado a ser o item de afiliado independente da qualidade real.
 */
export async function pickComparisonCandidates({ query, category = "geral", limit = 20 }) {
  if (!query || !String(query).trim()) throw new Error("Informe uma busca para o comparativo.");
  // Uma unica janela de navegador pra todo o fluxo (busca + pesquisa de opiniao + 3
  // produtos + 3 reviews + link de afiliado) em vez de abrir/fechar o Chrome a cada
  // etapa - isso sozinho cortava a maior parte do tempo de geracao de um comparativo.
  return withBrowser(async ({ page }) => {
    const found = await searchMercadoLivreProducts({ query, limit, category, page });

    // Fonte extra: Modo IA do Google faz pesquisa independente e pode indicar um
    // anuncio do Mercado Livre que a busca direta nao trouxe. So entram no pool os
    // que apontam pro Mercado Livre - o resto do pipeline (captura, reviews, link
    // de afiliado) e especifico do ML. Cobertura inconsistente, entao e so um
    // extra: nunca pode ser a unica fonte nem travar a comparacao.
    const googleAiFound = await searchGoogleAiMode({ query, page, maxProducts: 3 })
      .then((items) => items.filter((item) => item.marketplace === "mercadolivre"))
      .catch((error) => {
        logEvent("error", "Modo IA do Google falhou no comparativo", { query, error: error.message });
        return [];
      });
    const combinedFound = [...found, ...googleAiFound].filter(
      (item, index, all) => all.findIndex((other) => other.sourceUrl === item.sourceUrl) === index
    );

    if (combinedFound.length < 3) {
      throw new Error(`Busca "${query}" trouxe so ${combinedFound.length} resultado(s) no Mercado Livre; preciso de pelo menos 3 para montar o comparativo.`);
    }

    const medianPrice = median(combinedFound.map((item) => item.price));
    const shortlist = [...combinedFound].sort((a, b) => candidateScore(b, medianPrice) - candidateScore(a, medianPrice)).slice(0, 6);
    for (const candidate of shortlist) {
      const research = await searchWebReviews({ query: candidate.title, page });
      candidate.webReviews = research.snippets;
      candidate.webReviewScore = research.score;
    }

    const shortlistMedianPrice = median(shortlist.map((item) => item.price));
    const ranked = [...shortlist].sort((a, b) => combinedScore(b, shortlistMedianPrice) - combinedScore(a, shortlistMedianPrice));
    const [winnerSeed, ...rest] = ranked;
    const challengerSeeds = rest.slice(0, 2);

    const winner = await enrichCandidate({
      sourceUrl: winnerSeed.sourceUrl,
      category,
      withAffiliate: true,
      seedPrice: winnerSeed.price,
      page,
      webReviews: winnerSeed.webReviews
    });
    if (winner.product.marketplace !== "mercadolivre") {
      throw new Error("O item #1 do comparativo precisa ser um produto do Mercado Livre.");
    }

    const challengers = [];
    for (const seed of challengerSeeds) {
      challengers.push(await enrichCandidate({
        sourceUrl: seed.sourceUrl,
        category,
        withAffiliate: false,
        seedPrice: seed.price,
        page,
        webReviews: seed.webReviews
      }));
    }

    return { winner, challengers };
  }, { timeoutMs: 120000 });
}

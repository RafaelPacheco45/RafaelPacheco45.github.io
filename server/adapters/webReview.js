import { cleanText } from "../lib/utils.js";

const POSITIVE_WORDS = [
  "recomendo", "recomendado", "excelente", "otimo", "ótimo", "vale a pena",
  "melhor custo beneficio", "confiavel", "confiável", "adorei", "satisfeito",
  "satisfeita", "superou", "muito bom", "muito boa"
];

const NEGATIVE_WORDS = [
  "nao recomendo", "não recomendo", "pessimo", "péssimo", "quebrou", "defeito",
  "problema", "ruim", "decepcionado", "decepcionada", "evite", "cuidado",
  "reclame aqui", "nao funciona", "não funciona", "veio com defeito"
];

function scoreSnippet(text) {
  const lower = String(text || "").toLowerCase();
  let score = 0;
  for (const word of POSITIVE_WORDS) if (lower.includes(word)) score += 1;
  for (const word of NEGATIVE_WORDS) if (lower.includes(word)) score -= 2;
  return score;
}

/**
 * Pesquisa opiniao real sobre um produto fora do Mercado Livre (Bing, mais tolerante
 * a automacao que Google). E so um sinal de apoio para o ranking e para o texto final -
 * nao substitui os dados reais capturados na pagina do produto/reviews do marketplace.
 */
function withTimeout(promise, ms, fallback) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function searchWebReviews({ query, page, limit = 5 }) {
  if (!query || !String(query).trim()) return { snippets: [], score: 0 };
  const searchQuery = `${query} opiniao reclame aqui review`;
  try {
    await page.goto(`https://www.bing.com/search?q=${encodeURIComponent(searchQuery)}`, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(1200);
  } catch {
    return { snippets: [], score: 0 };
  }

  // page.evaluate() nao tem timeout proprio - se o Bing mostrar um interstitial/captcha
  // com script pesado rodando, o evaluate pode ficar preso ate o timeout padrao do
  // Playwright (120s) *por candidato*. Com ate 6 candidatos isso pode travar o
  // comparativo inteiro por mais de 10 minutos. Um teto curto aqui garante que, na
  // pior das hipoteses, essa pesquisa (que e so um sinal de apoio) e pulada rapido.
  const rawResults = await withTimeout(
    page.evaluate((maxItems) => {
      const items = [];
      const nodes = document.querySelectorAll("li.b_algo");
      for (const node of nodes) {
        const title = node.querySelector("h2")?.textContent || "";
        const snippet =
          node.querySelector(".b_caption p")?.textContent ||
          node.querySelector("[class*='lineclamp']")?.textContent ||
          "";
        const link = node.querySelector("h2 a")?.href || "";
        if (!title.trim()) continue;
        items.push({ title, snippet, link });
        if (items.length >= maxItems) break;
      }
      return items;
    }, limit).catch(() => []),
    8000,
    []
  );

  const snippets = rawResults
    .map((item) => ({ title: cleanText(item.title), text: cleanText(item.snippet), source: item.link }))
    .filter((item) => item.text || item.title);

  const score = snippets.reduce((sum, item) => sum + scoreSnippet(`${item.title} ${item.text}`), 0);
  return { snippets, score };
}

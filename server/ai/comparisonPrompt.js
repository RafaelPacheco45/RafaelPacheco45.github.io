import { config } from "../config.js";
import { askGeminiForJson } from "./geminiBrowser.js";
import { cleanText, slugify } from "../lib/utils.js";

function itemSnapshot(entry, rank) {
  const product = entry.product;
  return {
    rank,
    title: product.title,
    price: product.price,
    rating: product.rating,
    reviewLabel: product.reviewLabel,
    specs: product.specs,
    description: product.description,
    reviews: (entry.reviews || []).map((review) => ({ rating: review.rating, text: review.text })),
    webOpinions: (entry.webReviews || []).map((item) => ({ title: item.title, text: item.text }))
  };
}

export function buildComparisonPrompt({ winner, challengers }) {
  const items = [itemSnapshot(winner, 1), ...challengers.map((entry, index) => itemSnapshot(entry, index + 2))];
  return `
Voce e o editor de um blog brasileiro de comparativos de produtos chamado Achado Agora.
Nao use API. Responda somente JSON valido, sem markdown.

Itens do comparativo (dados reais: reviews sao trechos de compradores no proprio anuncio;
webOpinions sao resultados de busca externa - reclame aqui, blogs, foruns - sobre esse
modelo especifico):
${JSON.stringify(items, null, 2)}

Regras obrigatorias:
- Isto e uma ferramenta de utilidade publica: o rank 1 e o item que realmente parece
  melhor pelos dados fornecidos (nota, reviews, opiniao externa), nao um lugar garantido.
  Se "webOpinions" do rank 1 trouxer reclamacao real e relevante, pode incluir 1 "cons"
  honesto para ele tambem - nao esconda defeito real so porque e a recomendacao principal.
- Os "cons" de qualquer item so podem vir do texto de "reviews" ou "webOpinions" fornecido
  para aquele item - nunca invente um defeito que nao esteja no texto.
- Se um item nao tiver "reviews" nem "webOpinions" no JSON de entrada, nao invente citacao
  de comprador; baseie o texto so em specs/descricao.
- Nao invente desconto, garantia, estoque ou frete gratis. Preco e estoque devem ser confirmados no checkout.
- Linguagem pt-BR direta, sem exagero.

Formato exato:
{
  "title": "titulo SEO curto do comparativo",
  "slug": "slug-url",
  "intro": "1-2 frases introduzindo a comparacao",
  "items": [
    { "rank": 1, "summary": "1-2 frases", "pros": ["item","item","item"], "cons": [], "reviewQuote": "trecho real de review ou vazio" },
    { "rank": 2, "summary": "1-2 frases", "pros": ["item","item"], "cons": ["item","item"], "reviewQuote": "trecho real de review ou vazio" },
    { "rank": 3, "summary": "1-2 frases", "pros": ["item","item"], "cons": ["item","item"], "reviewQuote": "trecho real de review ou vazio" }
  ],
  "conclusion": "1-2 frases fechando a recomendacao",
  "socialCopy": "post organico curto para Facebook com aviso de afiliado"
}
`.trim();
}

export function normalizeComparisonPackage({ winner, challengers }, raw, source) {
  const title = cleanText(raw?.title || `${winner.product.title}: comparamos 3 opcoes`);
  const slug = slugify(raw?.slug || title || winner.product.id);
  const rawItems = Array.isArray(raw?.items) ? raw.items : [];
  const byRank = (rank) => rawItems.find((item) => Number(item?.rank) === rank) || {};

  const candidates = [
    { rank: 1, entry: winner },
    { rank: 2, entry: challengers[0] },
    { rank: 3, entry: challengers[1] }
  ];

  const items = candidates.map(({ rank, entry }) => {
    const rawItem = byRank(rank);
    const reviewsCaptured = (entry.reviews || []).length > 0;
    const pros = Array.isArray(rawItem.pros) ? rawItem.pros.map(cleanText).filter(Boolean).slice(0, 6) : [];
    let cons = Array.isArray(rawItem.cons) ? rawItem.cons.map(cleanText).filter(Boolean).slice(0, 6) : [];
    if (rank !== 1 && !reviewsCaptured) {
      cons = ["Ainda nao capturamos reviews suficientes deste anuncio - confirme vendedor, prazo e condicao no checkout antes de comprar."];
    }
    return {
      rank,
      productId: entry.product.id,
      marketplace: entry.product.marketplace,
      title: entry.product.title,
      price: entry.product.price,
      imageUrl: entry.product.imageUrl,
      rating: entry.product.rating,
      reviewLabel: entry.product.reviewLabel,
      sourceUrl: entry.product.sourceUrl,
      affiliateUrl: rank === 1 ? (entry.product.affiliateUrl || "") : "",
      summary: cleanText(rawItem.summary || entry.product.why || entry.product.description || ""),
      pros: pros.length ? pros : (entry.product.specs || []).slice(0, 3),
      cons,
      reviewQuote: cleanText(rawItem.reviewQuote || (entry.reviews?.[0]?.text || "")).slice(0, 400),
      reviewsCaptured
    };
  });

  return {
    source,
    title,
    slug,
    category: winner.product.category || "geral",
    intro: cleanText(raw?.intro || `Comparamos ${items.length} opcoes de ${winner.product.title} com preco e reviews reais.`),
    conclusion: cleanText(raw?.conclusion || "A opcao 1 e a recomendacao principal pelo custo-beneficio e reputacao no Mercado Livre."),
    socialCopy: cleanText(raw?.socialCopy || `Comparamos ${winner.product.title} com outras opcoes. Confira preco e reviews reais. Link de afiliado/publicidade.`),
    items,
    aiError: raw?.aiError || ""
  };
}

// So usada sem IA (fallback burro): nao ha julgamento de sentimento real, entao so
// classifica como "con" um review que contem linguagem claramente negativa - caso
// contrario a citacao aparece so como reviewQuote, sem virar "ponto de atencao" falso.
const NEGATIVE_REVIEW_HINTS = /nao recomendo|não recomendo|pessimo|péssimo|quebrou|defeito|problema|ruim|decepcionad|evite|cuidado|nao funciona|não funciona|veio com defeito/i;

export function generateLocalComparisonFallback({ winner, challengers }, reason = "") {
  const candidates = [winner, ...challengers];
  const fallbackRaw = {
    title: `${winner.product.title}: comparamos 3 opcoes`,
    slug: slugify(winner.product.title),
    intro: `Reunimos ${winner.product.title} e outras duas opcoes do Mercado Livre para comparar preco e avaliacoes reais.`,
    items: candidates.map((entry, index) => {
      const rank = index + 1;
      const review = entry.reviews?.[0];
      const isNegative = Boolean(review && NEGATIVE_REVIEW_HINTS.test(review.text));
      return {
        rank,
        summary: "",
        pros: [],
        cons: rank !== 1 && isNegative ? [`Um comprador relatou: "${review.text}"`] : [],
        reviewQuote: review?.text || ""
      };
    }),
    conclusion: "A opcao 1 e a recomendacao principal pelo historico de vendas e avaliacao no Mercado Livre.",
    socialCopy: `Comparamos ${winner.product.title} com outras opcoes. Link de afiliado/publicidade.`,
    aiError: reason
  };
  return normalizeComparisonPackage({ winner, challengers }, fallbackRaw, "fallback");
}

/**
 * askGeminiForJson tem varias esperas internas (ate 120s so no networkidle) sem um
 * teto geral - se a UI do Gemini mudar ou a pagina nunca "assentar", a chamada pode
 * empilhar varias esperas de 120s e travar o comparativo inteiro por 5-10+ minutos.
 * Um teto duro aqui garante que, na pior das hipoteses, cai pro fallback local.
 */
function withHardTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function generateComparisonContentPackage(candidates) {
  try {
    const prompt = buildComparisonPrompt(candidates);
    const parsed = await withHardTimeout(askGeminiForJson(prompt), 100000, "Gemini demorou demais pra responder (timeout de 100s).");
    return normalizeComparisonPackage(candidates, parsed, "gemini");
  } catch (error) {
    if (config.geminiRequired) throw error;
    return generateLocalComparisonFallback(candidates, error.message);
  }
}

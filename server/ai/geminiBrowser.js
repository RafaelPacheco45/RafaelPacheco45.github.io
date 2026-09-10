import { config } from "../config.js";
import { withBrowser } from "../browser.js";
import { cleanText, escapeHtml, extractJsonObject, slugify } from "../lib/utils.js";

function safeHtml(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/\son\w+="[^"]*"/gi, "")
    .replace(/\son\w+='[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}

function productSnapshot(product) {
  return {
    id: product.id,
    title: product.title,
    brand: product.brand,
    category: product.category,
    marketplace: product.marketplace,
    price: product.price,
    rating: product.rating,
    reviewLabel: product.reviewLabel,
    sourceUrl: product.sourceUrl,
    affiliateUrl: product.affiliateUrl,
    description: product.description,
    why: product.why
  };
}

export function buildGeminiPrompt(product) {
  return `
Voce e o editor e copywriter de um blog brasileiro de afiliados chamado Achado Agora.
Nao use API. Responda somente JSON valido, sem markdown.

Produto:
${JSON.stringify(productSnapshot(product), null, 2)}

Crie um pacote editorial para publicar no blog e promover no Facebook.
Regras:
- Nao invente desconto, garantia, estoque, cupom, frete gratis ou teste proprio.
- Sempre diga que preco/frete/estoque devem ser confirmados no checkout.
- Inclua um aviso discreto quando houver link de afiliado.
- Foco em conversao honesta: custo-beneficio, para quem serve, quando evitar.
- Linguagem pt-BR direta.

Formato exato:
{
  "title": "titulo SEO curto",
  "slug": "slug-url",
  "badge": "selo curto",
  "description": "descricao curta para card",
  "why": "argumento principal de compra",
  "specs": ["item", "item", "item"],
  "pros": ["item", "item", "item"],
  "cons": ["item", "item"],
  "articleHtml": "<h1>...</h1><p>...</p><h2>...</h2><p>...</p>",
  "socialCopy": "post organico para Facebook com aviso de afiliado",
  "adCopy": {
    "headlines": ["ate 5 opcoes curtas"],
    "primaryTexts": ["ate 5 textos curtos"],
    "descriptions": ["ate 3 descricoes"],
    "cta": "Learn More"
  }
}
`.trim();
}

async function findGeminiInput(page) {
  const selectors = [
    "rich-textarea div[contenteditable='true']",
    "div[contenteditable='true'][role='textbox']",
    "div[contenteditable='true']",
    "textarea"
  ];
  for (const selector of selectors) {
    const locators = await page.locator(selector).all();
    for (const locator of locators) {
      if (await locator.isVisible().catch(() => false)) return locator;
    }
  }
  return null;
}

async function clickGeminiSend(page) {
  const buttons = [
    page.getByRole("button", { name: /send/i }).first(),
    page.getByRole("button", { name: /enviar/i }).first(),
    page.locator("button[aria-label*='Send' i]").first(),
    page.locator("button[aria-label*='Enviar' i]").first(),
    page.locator("button").filter({ hasText: /send|enviar/i }).first()
  ];
  for (const button of buttons) {
    if (await button.isVisible().catch(() => false)) {
      const disabled = await button.isDisabled().catch(() => false);
      if (!disabled) {
        await button.click();
        return true;
      }
    }
  }
  return false;
}

async function extractGeminiAnswer(page) {
  await page.waitForTimeout(3000);
  // Tenta cada seletor especifico ate achar UM que realmente bateu, e so entao pega a
  // ultima ocorrencia dele. Antes, os matches de todos os seletores eram misturados
  // numa lista so e o ultimo (quase sempre vindo do fallback generico "main", que casa
  // com a pagina inteira) vencia - isso jogava fora a resposta de verdade do modelo.
  return page.evaluate(() => {
    const selectors = ["message-content", "[data-response-index]", ".model-response-text", ".markdown"];
    for (const selector of selectors) {
      const nodes = [...document.querySelectorAll(selector)].filter(
        (el) => (el.innerText || el.textContent || "").trim().length > 80
      );
      if (nodes.length) {
        const last = nodes[nodes.length - 1];
        return (last.innerText || last.textContent || "").trim();
      }
    }
    const main = document.querySelector("main");
    const mainText = main ? (main.innerText || main.textContent || "").trim() : "";
    return mainText.length > 80 ? mainText : "";
  });
}

export async function askGeminiForJson(prompt) {
  return withBrowser(async ({ page }) => {
    await page.goto(config.urls.gemini, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    const body = cleanText(await page.locator("body").innerText().catch(() => ""));
    // A pagina do Gemini sempre contem a palavra "Gemini", entao um teste que exigia
    // ausencia dela pra confirmar login nunca disparava. O sinal confiavel de deslogado
    // e o proprio botao "Fazer login"/"Sign in" que so aparece pra quem nao autenticou.
    if (/\bfazer login\b|\bsign in\b/i.test(body)) {
      throw new Error("Gemini nao esta logado no perfil do navegador. Rode npm run login, entre no Gemini e feche a janela antes de automatizar.");
    }

    const input = await findGeminiInput(page);
    if (!input) {
      throw new Error("Nao encontrei o campo de prompt do Gemini. A interface pode ter mudado ou o login nao esta pronto.");
    }

    await input.click();
    await input.fill(prompt).catch(async () => {
      await page.keyboard.insertText(prompt);
    });

    const sent = await clickGeminiSend(page);
    if (!sent) await page.keyboard.press("Enter");

    await page.waitForTimeout(6000);
    await page.waitForLoadState("networkidle", { timeout: 120000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const answer = await extractGeminiAnswer(page);
    const parsed = extractJsonObject(answer);
    if (!parsed) throw new Error("Gemini respondeu, mas nao consegui extrair JSON valido.");
    return parsed;
  }, { timeoutMs: 120000 });
}

export async function generateWithGemini(product) {
  const prompt = buildGeminiPrompt(product);
  const parsed = await askGeminiForJson(prompt);
  return normalizePackage(product, parsed, "gemini");
}

function fallbackArticle(product) {
  const title = escapeHtml(product.title);
  const priceText = product.price ? ` por volta de R$ ${Number(product.price).toFixed(2).replace(".", ",")}` : "";
  return `
    <h1>${title}: vale clicar?</h1>
    <p>${escapeHtml(product.description || `${product.title} apareceu na nossa busca automatica${priceText}.`)}</p>
    <h2>Para quem faz sentido</h2>
    <p>Faz sentido se voce procura uma compra objetiva e quer comparar preco, avaliacao e reputacao antes de sair para o marketplace.</p>
    <h2>Antes de comprar</h2>
    <p>Confirme preco final, frete, prazo, garantia, vendedor e estoque no checkout. O valor do blog e apenas referencia da captura automatica.</p>
    <p>Aviso: este conteudo pode conter link de afiliado. Uma compra elegivel pode gerar comissao para o Achado Agora sem custo extra para voce.</p>
  `.trim();
}

export function generateLocalFallback(product, reason = "") {
  return normalizePackage(product, {
    title: `${product.title}: preco e pontos de atencao`,
    slug: slugify(product.title),
    badge: product.badge || "Achado automatico",
    description: product.description || `${product.title}. Confira preco e estoque no marketplace.`,
    why: product.why || "Boa opcao para comparar preco antes de fechar a compra.",
    specs: product.specs?.length ? product.specs : ["Preco capturado automaticamente", "Link para marketplace", "Revisao recomendada antes de escalar trafego"],
    pros: product.pros?.length ? product.pros : ["Facil de comparar", "Compra fechada no marketplace", "Pode render conteudo de afiliado rapido"],
    cons: product.cons?.length ? product.cons : ["Preco e estoque podem mudar", "Texto ainda precisa validacao humana", "Nao substitui leitura do anuncio final"],
    articleHtml: fallbackArticle(product),
    socialCopy: `Achado no radar: ${product.title}. Confira preco, frete e estoque no checkout. Link de afiliado/publicidade.`,
    adCopy: {
      headlines: [`${product.title}`.slice(0, 40), "Confira antes de comprar"],
      primaryTexts: [`Veja detalhes, pontos fortes e atencoes antes de abrir a oferta. Preco e estoque podem mudar.`, `Link de afiliado: podemos receber comissao sem custo extra.`],
      descriptions: ["Compra final no marketplace."],
      cta: "Learn More"
    },
    aiError: reason
  }, "fallback");
}

export async function generateContentPackage(product) {
  try {
    return await generateWithGemini(product);
  } catch (error) {
    if (config.geminiRequired) throw error;
    return generateLocalFallback(product, error.message);
  }
}

export function normalizePackage(product, raw, source) {
  const title = cleanText(raw.title || product.title);
  const slug = slugify(raw.slug || title || product.id);
  return {
    source,
    title,
    slug,
    badge: cleanText(raw.badge || product.badge || "Achado"),
    description: cleanText(raw.description || product.description || ""),
    why: cleanText(raw.why || product.why || ""),
    specs: Array.isArray(raw.specs) ? raw.specs.map(cleanText).filter(Boolean).slice(0, 8) : [],
    pros: Array.isArray(raw.pros) ? raw.pros.map(cleanText).filter(Boolean).slice(0, 8) : [],
    cons: Array.isArray(raw.cons) ? raw.cons.map(cleanText).filter(Boolean).slice(0, 8) : [],
    articleHtml: safeHtml(raw.articleHtml || fallbackArticle(product)),
    socialCopy: cleanText(raw.socialCopy || ""),
    adCopy: {
      headlines: Array.isArray(raw.adCopy?.headlines) ? raw.adCopy.headlines.map(cleanText).filter(Boolean).slice(0, 5) : [],
      primaryTexts: Array.isArray(raw.adCopy?.primaryTexts) ? raw.adCopy.primaryTexts.map(cleanText).filter(Boolean).slice(0, 5) : [],
      descriptions: Array.isArray(raw.adCopy?.descriptions) ? raw.adCopy.descriptions.map(cleanText).filter(Boolean).slice(0, 3) : [],
      cta: cleanText(raw.adCopy?.cta || "Learn More")
    },
    aiError: raw.aiError || ""
  };
}

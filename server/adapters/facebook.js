import { config } from "../config.js";
import { withBrowser } from "../browser.js";
import { cleanText } from "../lib/utils.js";

function budgetBRL(value) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(parsed) || parsed <= 0) return Math.min(config.metaDailyBudgetCapBRL, 20);
  return Math.min(parsed, config.metaDailyBudgetCapBRL);
}

export function buildMetaAdDraft({ product, post, contentPackage, destinationUrl, campaignName, dailyBudgetBRL }) {
  const adCopy = contentPackage?.adCopy || post?.adCopy || {};
  const finalCampaignName = cleanText(campaignName || `AA - ${product.category || "geral"} - ${product.title}`).slice(0, 120);
  return {
    platform: "meta",
    productId: product.id,
    postId: post?.id || null,
    campaignName: finalCampaignName,
    destinationUrl,
    dailyBudgetBRL: budgetBRL(dailyBudgetBRL),
    status: config.metaAllowLiveAds ? "ready_for_live_review" : "draft",
    copy: {
      headlines: adCopy.headlines?.length ? adCopy.headlines : [product.title],
      primaryTexts: adCopy.primaryTexts?.length ? adCopy.primaryTexts : [
        `${product.title}. Confira preco, frete e estoque no checkout.`
      ],
      descriptions: adCopy.descriptions?.length ? adCopy.descriptions : ["Compra final no marketplace."],
      cta: adCopy.cta || "Learn More",
      disclosure: "",
      creative: {
        title: product.title,
        imageUrl: product.localImagePath || product.imageUrl || "",
        landingUrl: destinationUrl,
        note: "Use a imagem do produto ou um criativo aprovado antes de publicar anuncio pago."
      }
    }
  };
}

async function findComposer(page) {
  const selectors = [
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

export async function openFacebookOrganicDraft({ text, destinationUrl }) {
  if (!config.facebookPageUrl) {
    throw new Error("Configure AUTOBLOG_FACEBOOK_PAGE_URL para automatizar postagens organicas.");
  }
  const finalText = `${cleanText(text)}\n\n${destinationUrl}`.trim();
  return withBrowser(async ({ page }) => {
    await page.goto(config.facebookPageUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(5000);
    const body = cleanText(await page.locator("body").innerText().catch(() => ""));
    if (/log in|entrar|email or phone|senha/i.test(body)) {
      throw new Error("Facebook nao parece estar logado no perfil do navegador. Rode npm run login.");
    }

    const createButtons = [
      page.getByRole("button", { name: /criar|create|post/i }).first(),
      page.getByText(/no que voce esta pensando|what's on your mind|criar publicacao|create post/i).first()
    ];
    for (const button of createButtons) {
      if (await button.isVisible().catch(() => false)) {
        await button.click();
        await page.waitForTimeout(2000);
        break;
      }
    }

    const composer = await findComposer(page);
    if (!composer) throw new Error("Nao encontrei o compositor do Facebook. A interface pode ter mudado.");
    await composer.click();
    await composer.fill(finalText).catch(async () => {
      await page.keyboard.insertText(finalText);
    });

    if (config.facebookAllowOrganicPublish) {
      const publish = page.getByRole("button", { name: /publicar|post/i }).last();
      if (await publish.isVisible().catch(() => false)) {
        await publish.click();
        await page.waitForTimeout(3000);
        return { status: "published_or_submitted", mode: "organic" };
      }
      throw new Error("Texto preenchido, mas nao encontrei o botao de publicar.");
    }

    return { status: "draft_opened", mode: "organic", note: "Texto preenchido; publicacao automatica desativada por AUTOBLOG_FACEBOOK_ALLOW_ORGANIC_PUBLISH=0." };
  }, { timeoutMs: 90000 });
}

export async function openMetaAdsManagerDraft(adDraft) {
  return withBrowser(async ({ page }) => {
    await page.goto(config.urls.metaAdsManager, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    const body = cleanText(await page.locator("body").innerText().catch(() => ""));
    if (/log in|entrar|email or phone|senha/i.test(body)) {
      throw new Error("Meta Ads Manager nao parece estar logado. Rode npm run login.");
    }
    return {
      status: "ads_manager_opened",
      note: config.metaAllowLiveAds
        ? "AUTOBLOG_META_ALLOW_LIVE_ADS esta ligado; ainda assim revise conta, pixel e orcamento antes de publicar."
        : "Anuncios pagos ficam como rascunho local. Use o rascunho para montar a campanha com seguranca.",
      draft: adDraft
    };
  }, { timeoutMs: 90000 });
}

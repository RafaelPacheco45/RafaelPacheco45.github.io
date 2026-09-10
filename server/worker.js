import { config } from "./config.js";
import {
  completeTask,
  createAdDraft,
  createTask,
  failTask,
  getPost,
  getProduct,
  listTasks,
  logEvent,
  nextPendingTask,
  startTask,
  upsertProduct
} from "./db.js";
import {
  captureMercadoLivreProduct,
  generateMercadoLivreAffiliateLink,
  searchMercadoLivreProducts
} from "./adapters/mercadoLivre.js";
import { generateContentPackage } from "./ai/geminiBrowser.js";
import { generateComparisonContentPackage } from "./ai/comparisonPrompt.js";
import { pickComparisonCandidates } from "./comparisonEngine.js";
import { publishComparison } from "./comparisonPublisher.js";
import { buildMetaAdDraft, openFacebookOrganicDraft, openMetaAdsManagerDraft } from "./adapters/facebook.js";
import { loadSiteConfig, publishContentPackage, updateSitemapAndRobots } from "./sitePublisher.js";
import { buildPublicSite } from "./staticExport.js";
import { cleanText, publicUrl, sleep, slugify } from "./lib/utils.js";

function boolOption(value, fallback = false) {
  if (value == null) return fallback;
  return value === true || value === "true" || value === "1" || value === 1;
}

function numberOption(value, fallback) {
  const parsed = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function pipelineOptions(payload = {}) {
  return {
    autoPipeline: true,
    campaignName: cleanText(payload.campaignName || payload.query || "campanha-automatica").slice(0, 120),
    dailyBudgetBRL: numberOption(payload.dailyBudgetBRL, config.metaDailyBudgetCapBRL),
    autoFacebook: boolOption(payload.autoFacebook),
    autoOpenMeta: boolOption(payload.autoOpenMeta),
    autoBuildPublic: payload.autoBuildPublic !== false
  };
}

function addTrackingParams(destinationUrl, { campaignName, productId, medium = "cpc", content = "" } = {}) {
  try {
    const url = new URL(destinationUrl);
    url.searchParams.set("utm_source", "meta");
    url.searchParams.set("utm_medium", medium);
    url.searchParams.set("utm_campaign", slugify(campaignName || productId || "campanha"));
    if (productId) url.searchParams.set("utm_content", slugify(content || productId));
    return url.toString();
  } catch {
    return destinationUrl;
  }
}

function createPipelineTasks(products, payload) {
  if (!payload.autoPipeline) return [];
  const options = pipelineOptions(payload);
  return products.map((product) => createTask("generate_affiliate_link", {
    ...options,
    productId: product.id
  }));
}

async function handleSearchMarketplace(task) {
  const payload = task.payload || {};
  const marketplace = payload.marketplace || "mercadolivre";
  if (marketplace !== "mercadolivre") throw new Error(`Marketplace ainda nao suportado: ${marketplace}`);
  const found = await searchMercadoLivreProducts({
    query: payload.query,
    limit: payload.limit || config.defaultSearchLimit,
    category: payload.category || "geral"
  });
  const saved = found.map((product) => upsertProduct(product));
  const nextTasks = createPipelineTasks(saved, payload);
  logEvent("info", "Busca Mercado Livre concluida", { query: payload.query, count: saved.length });
  return { products: saved, queued: nextTasks.map((item) => item.id) };
}

async function handleCaptureProduct(task) {
  const payload = task.payload || {};
  const product = await captureMercadoLivreProduct({
    url: payload.url,
    category: payload.category || "geral"
  });
  const saved = upsertProduct(product);
  const queued = payload.autoPipeline
    ? [createTask("generate_affiliate_link", { ...pipelineOptions(payload), productId: saved.id }).id]
    : [];
  logEvent("info", "Produto capturado", { productId: saved.id, title: saved.title });
  return { product: saved, queued };
}

async function handleGenerateAffiliate(task) {
  const payload = task.payload || {};
  const product = getProduct(payload.productId);
  if (!product) throw new Error(`Produto nao encontrado: ${payload.productId}`);
  const affiliateUrl = await generateMercadoLivreAffiliateLink({ sourceUrl: product.sourceUrl });
  const saved = upsertProduct({
    ...product,
    affiliateUrl,
    status: "affiliate_ready"
  });
  const queued = payload.autoPipeline
    ? [createTask("generate_content", { ...pipelineOptions(payload), productId: saved.id }).id]
    : [];
  logEvent("info", "Link de afiliado gerado", { productId: saved.id });
  return { product: saved, queued };
}

async function handleGenerateContent(task) {
  const payload = task.payload || {};
  const product = getProduct(payload.productId);
  if (!product) throw new Error(`Produto nao encontrado: ${payload.productId}`);
  if (!product.affiliateUrl) {
    throw new Error("Produto ainda nao tem link de afiliado. Rode generate_affiliate_link antes de gerar conteudo.");
  }
  const contentPackage = await generateContentPackage(product);
  const published = await publishContentPackage(product, contentPackage);
  const cfg = loadSiteConfig();
  const campaignName = cleanText(payload.campaignName || `${product.category || "geral"} ${product.title}`);
  const destinationUrl = addTrackingParams(
    publicUrl(cfg.siteUrl || config.siteUrl, published.postPath),
    {
      campaignName,
      productId: product.id,
      content: published.post.slug
    }
  );
  const adDraftInput = buildMetaAdDraft({
    product,
    post: published.post,
    contentPackage,
    destinationUrl,
    campaignName,
    dailyBudgetBRL: payload.dailyBudgetBRL
  });
  const adDraft = createAdDraft(adDraftInput);
  let publicBuild = null;
  if (payload.autoBuildPublic !== false) {
    updateSitemapAndRobots();
    publicBuild = buildPublicSite({ siteUrl: cfg.siteUrl || config.siteUrl || "" });
  }
  const queued = [];
  if (boolOption(payload.autoFacebook)) {
    queued.push(createTask("facebook_post", {
      postId: published.post.id,
      campaignName,
      productId: product.id
    }).id);
  }
  if (boolOption(payload.autoOpenMeta)) {
    queued.push(createTask("open_ad_draft", { adDraft }).id);
  }
  logEvent(
    contentPackage.source === "gemini" ? "info" : "warn",
    contentPackage.source === "gemini" ? "Conteudo gerado com Gemini e publicado" : "Conteudo fallback publicado porque Gemini nao concluiu",
    { productId: product.id, postPath: published.postPath, adDraftId: adDraft.id, queued, aiError: contentPackage.aiError || "" }
  );
  return {
    contentSource: contentPackage.source,
    aiError: contentPackage.aiError || "",
    post: published.post,
    postPath: published.postPath,
    adDraft,
    publicBuild,
    queued
  };
}

async function handleGenerateComparison(task) {
  const payload = task.payload || {};
  const query = cleanText(payload.query || "");
  if (!query) throw new Error("Informe a busca do comparativo.");
  const category = cleanText(payload.category || "geral");
  const candidates = await pickComparisonCandidates({ query, category });
  const contentPackage = await generateComparisonContentPackage(candidates);
  const { comparison, comparisonPath } = publishComparison({ query, category, contentPackage });
  const cfg = loadSiteConfig();
  const campaignName = cleanText(payload.campaignName || `${category} ${comparison.title}`);
  const destinationUrl = addTrackingParams(
    publicUrl(cfg.siteUrl || config.siteUrl, comparisonPath),
    { campaignName, productId: comparison.slug, content: comparison.slug }
  );
  let publicBuild = null;
  if (payload.autoBuildPublic !== false) {
    updateSitemapAndRobots();
    publicBuild = buildPublicSite({ siteUrl: cfg.siteUrl || config.siteUrl || "" });
  }
  let adDraft = null;
  if (boolOption(payload.autoFacebook)) {
    const winnerItem = comparison.items.find((item) => item.rank === 1);
    adDraft = createAdDraft(buildMetaAdDraft({
      product: { id: winnerItem?.productId || comparison.slug, category, title: comparison.title },
      post: null,
      contentPackage: {},
      destinationUrl,
      campaignName,
      dailyBudgetBRL: payload.dailyBudgetBRL
    }));
  }
  logEvent(
    contentPackage.source === "gemini" ? "info" : "warn",
    contentPackage.source === "gemini" ? "Comparativo gerado com Gemini e publicado" : "Comparativo fallback publicado porque Gemini nao concluiu",
    { query, slug: comparison.slug, comparisonPath, adDraftId: adDraft?.id || null, aiError: contentPackage.aiError || "" }
  );
  return {
    contentSource: contentPackage.source,
    aiError: contentPackage.aiError || "",
    comparison,
    comparisonPath,
    destinationUrl,
    adDraft,
    publicBuild
  };
}

async function handleUpdateSitemap() {
  const result = updateSitemapAndRobots();
  logEvent("info", "Sitemap e robots atualizados", result);
  return result;
}

async function handleFacebookPost(task) {
  const payload = task.payload || {};
  const post = getPost(payload.postId);
  if (!post) throw new Error(`Post nao encontrado: ${payload.postId}`);
  const cfg = loadSiteConfig();
  const destinationUrl = addTrackingParams(
    publicUrl(cfg.siteUrl || config.siteUrl, `posts/${post.slug}.html`),
    {
      campaignName: payload.campaignName || post.slug,
      productId: payload.productId || post.productId,
      medium: "social",
      content: "facebook-post"
    }
  );
  const result = await openFacebookOrganicDraft({
    text: post.socialCopy,
    destinationUrl
  });
  logEvent("info", "Facebook organic processado", { postId: post.id, status: result.status });
  return result;
}

async function handleOpenAdDraft(task) {
  const payload = task.payload || {};
  const result = await openMetaAdsManagerDraft(payload.adDraft || {});
  logEvent("info", "Meta Ads Manager aberto", { status: result.status });
  return result;
}

async function runTask(task) {
  switch (task.type) {
    case "search_marketplace":
      return handleSearchMarketplace(task);
    case "capture_product":
      return handleCaptureProduct(task);
    case "generate_affiliate_link":
      return handleGenerateAffiliate(task);
    case "generate_content":
      return handleGenerateContent(task);
    case "generate_comparison":
      return handleGenerateComparison(task);
    case "update_sitemap":
      return handleUpdateSitemap(task);
    case "facebook_post":
      return handleFacebookPost(task);
    case "open_ad_draft":
      return handleOpenAdDraft(task);
    default:
      throw new Error(`Tipo de tarefa desconhecido: ${task.type}`);
  }
}

export async function runOnce() {
  const pending = nextPendingTask();
  if (!pending) return { ran: false, task: null };
  const task = startTask(pending.id);
  try {
    const result = await runTask(task);
    const done = completeTask(task.id, result);
    return { ran: true, task: done };
  } catch (error) {
    const failed = failTask(task.id, error.message);
    logEvent("error", `Tarefa falhou: ${task.type}`, { taskId: task.id, error: error.message });
    return { ran: true, task: failed };
  }
}

export async function runUntilIdle(maxTasks = 25) {
  const results = [];
  for (let i = 0; i < maxTasks; i += 1) {
    const result = await runOnce();
    if (!result.ran) break;
    results.push(result.task);
  }
  return { count: results.length, tasks: results };
}

export function queueGenerateComparison({ query, category, campaignName, dailyBudgetBRL, autoFacebook = false, autoBuildPublic = true }) {
  return createTask("generate_comparison", {
    query,
    category: category || "geral",
    campaignName: campaignName || query,
    dailyBudgetBRL,
    autoFacebook,
    autoBuildPublic
  });
}

export function queueSearchToBlog({ query, limit, category }) {
  return createTask("search_marketplace", {
    marketplace: "mercadolivre",
    query,
    limit: limit || config.defaultSearchLimit,
    category: category || "geral",
    autoPipeline: true
  });
}

export function queueAutoCampaign({
  query,
  limit,
  category,
  campaignName,
  dailyBudgetBRL,
  autoFacebook = true,
  autoOpenMeta = false,
  autoBuildPublic = true
}) {
  return createTask("search_marketplace", {
    marketplace: "mercadolivre",
    query,
    limit: limit || config.defaultSearchLimit,
    category: category || "geral",
    ...pipelineOptions({
      query,
      campaignName,
      dailyBudgetBRL,
      autoFacebook,
      autoOpenMeta,
      autoBuildPublic
    })
  });
}

export function queueCaptureToBlog({ url, category }) {
  return createTask("capture_product", {
    url,
    category: category || "geral",
    autoPipeline: true
  });
}

async function loop() {
  logEvent("info", "Worker iniciado", { mode: "loop" });
  for (;;) {
    const result = await runOnce();
    if (!result.ran) await sleep(10000);
  }
}

if (process.argv[1] && process.argv[1].endsWith("worker.js")) {
  if (process.argv.includes("--once")) {
    const result = await runOnce();
    console.log(JSON.stringify(result, null, 2));
  } else if (process.argv.includes("--idle")) {
    const result = await runUntilIdle();
    console.log(JSON.stringify(result, null, 2));
  } else if (process.argv.includes("--list")) {
    console.log(JSON.stringify(listTasks(50), null, 2));
  } else {
    await loop();
  }
}

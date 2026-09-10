import fs from "node:fs";
import path from "node:path";
import { config, rootDir } from "../server/config.js";
import { browserDiagnostics } from "../server/browser.js";
import { listAdDrafts, listCampaignMetrics, listPosts, listProducts, listTasks } from "../server/db.js";
import { loadSiteConfig } from "../server/sitePublisher.js";

function check(name, ok, details = "") {
  const status = ok ? "ok" : "falha";
  console.log(`${status.padEnd(5)} ${name}${details ? ` - ${details}` : ""}`);
  return ok;
}

let failed = 0;
function assertCheck(name, ok, details = "") {
  if (!check(name, ok, details)) failed += 1;
}

function warnCheck(name, ok, details = "") {
  if (ok) return check(name, true, details);
  console.log(`${"aviso".padEnd(5)} ${name}${details ? ` - ${details}` : ""}`);
  return false;
}

console.log("Achado Agora Autoblog diagnostics");
console.log(`Node: ${process.version}`);
console.log("");

const dbProducts = listProducts(1000);
const dbTasks = listTasks(1000);
const dbPosts = listPosts(1000);
const dbAdDrafts = listAdDrafts(1000);
const dbMetrics = listCampaignMetrics(1000);
assertCheck("Node sqlite", true, "node:sqlite carregado pelo banco local");
assertCheck("Banco", Array.isArray(listProducts(1)) && Array.isArray(listTasks(1)), config.dbPath);
warnCheck("Produtos no painel", dbProducts.length > 0, dbProducts.length ? `${dbProducts.length} produtos` : "rode npm run sync:products");

const browser = browserDiagnostics();
assertCheck("Chrome/Edge", Boolean(browser.executablePath), browser.executablePath || "defina AUTOBLOG_CHROME_PATH");
assertCheck("Perfil do navegador", fs.existsSync(config.chromeProfileDir), config.chromeProfileDir);

const site = loadSiteConfig();
const products = Array.isArray(site.products) ? site.products : [];
const mercadoLivreProducts = products.filter((product) => product.storeKey === "mercadolivre");
const generatedMlLinks = mercadoLivreProducts.filter((product) => /^https:\/\/meli\.la\//i.test(product.affiliateUrl || ""));
const amazonProducts = products.filter((product) => product.storeKey === "amazon");
const shopeeProducts = products.filter((product) => product.storeKey === "shopee");
const shopeeSearchLinks = shopeeProducts.filter((product) => /shopee\.com\.br\/search/i.test(product.affiliateUrl || ""));
assertCheck("assets/config.js", Boolean(site && Array.isArray(site.products)), `${site.products?.length || 0} produtos`);
check("siteUrl", Boolean(site.siteUrl || config.siteUrl), site.siteUrl || config.siteUrl || "vazio");
check("Facebook Page", Boolean(config.facebookPageUrl), config.facebookPageUrl ? "configurada" : "vazio");
check(
  "ML links oficiais",
  mercadoLivreProducts.length > 0 && generatedMlLinks.length === mercadoLivreProducts.length,
  `${generatedMlLinks.length}/${mercadoLivreProducts.length} produtos Mercado Livre com meli.la`
);
warnCheck("GA4", Boolean(site.ga4MeasurementId), site.ga4MeasurementId ? "configurado" : "vazio");
warnCheck("Meta Pixel", Boolean(site.metaPixelId), site.metaPixelId ? "configurado" : "vazio");
const adsenseClient = String(site.adsenseClient || "").trim();
const adsenseOk = /^ca-pub-\d+$/i.test(adsenseClient);
warnCheck("AdSense display", Boolean(adsenseClient), adsenseClient ? (adsenseOk ? "cliente configurado" : "formato invalido") : "vazio");
check("AdSense Auto Ads", Boolean(site.adsenseAutoAds), site.adsenseAutoAds ? "ativo quando houver cliente aprovado" : "desligado");
check("ML etiqueta", Boolean(site.affiliates?.mlMattWord), site.affiliates?.mlMattWord ? site.affiliates.mlMattWord : "vazio");
warnCheck("ML matt_tool manual", Boolean(site.affiliates?.mlMattTool), site.affiliates?.mlMattTool ? "configurado" : "nao necessario para links meli.la gerados");
warnCheck("Amazon tag", !amazonProducts.length || Boolean(site.affiliates?.amazonTag), site.affiliates?.amazonTag ? "configurado" : `${amazonProducts.length} produto(s) Amazon sem tag`);
warnCheck("Shopee monetizacao", !shopeeSearchLinks.length, shopeeSearchLinks.length ? `${shopeeSearchLinks.length} link(s) de busca comum; evite trafego pago ate ter afiliado/link rastreavel` : "sem link de busca comum");
const offerPagesDir = path.join(rootDir, "public-site", "ofertas");
const offerPageCount = fs.existsSync(offerPagesDir)
  ? fs.readdirSync(offerPagesDir).filter((name) => name.endsWith(".html")).length
  : 0;
warnCheck("Paginas estaticas de oferta", offerPageCount >= products.length && products.length > 0, `${offerPageCount}/${products.length} geradas em public-site`);
warnCheck("Posts autoblog", dbPosts.length > 0, dbPosts.length ? `${dbPosts.length} post(s)` : "nenhum post gerado ainda");
warnCheck("Rascunhos Meta", dbAdDrafts.length > 0, dbAdDrafts.length ? `${dbAdDrafts.length} rascunho(s)` : "nenhum rascunho criado");
warnCheck("Metricas de teste", dbMetrics.length > 0, dbMetrics.length ? `${dbMetrics.length} registro(s)` : "nenhum dado real de campanha");
warnCheck("Fila", dbTasks.some((task) => task.status === "pending"), dbTasks.length ? `${dbTasks.length} tarefa(s), ${dbTasks.filter((task) => task.status === "pending").length} pendente(s)` : "fila vazia");
warnCheck(
  "Gate trafego pago",
  Boolean(site.ga4MeasurementId && site.metaPixelId && generatedMlLinks.length),
  site.ga4MeasurementId && site.metaPixelId
    ? "medicao basica configurada"
    : "nao compre/escale trafego sem GA4 e Meta Pixel"
);

console.log("");
if (failed) {
  console.log(`${failed} bloqueio(s) para automacao completa.`);
  process.exitCode = 1;
} else {
  console.log("Base local pronta. Avisos comerciais acima ainda precisam ser resolvidos antes de escalar.");
  console.log("Logins e contas externas ainda precisam ser validados no navegador.");
}

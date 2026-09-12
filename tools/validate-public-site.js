import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public-site");

let errors = 0;
let warnings = 0;

function line(kind, label, details = "") {
  console.log(`${kind.padEnd(5)} ${label}${details ? ` - ${details}` : ""}`);
}

function ok(label, details = "") {
  line("ok", label, details);
}

function warn(label, details = "") {
  warnings += 1;
  line("aviso", label, details);
}

function fail(label, details = "") {
  errors += 1;
  line("erro", label, details);
}

function publicPath(rel) {
  return path.join(publicDir, rel);
}

function exists(rel) {
  return fs.existsSync(publicPath(rel));
}

function read(rel) {
  return fs.readFileSync(publicPath(rel), "utf8");
}

function listFilesRecursive(dir, extension = "") {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFilesRecursive(fullPath, extension));
    else if (entry.isFile() && (!extension || entry.name.toLowerCase().endsWith(extension))) files.push(fullPath);
  }
  return files;
}

function loadPublicConfig() {
  const rel = path.join("assets", "config.js");
  if (!exists(rel)) {
    fail("Config publica", "public-site/assets/config.js ausente");
    return null;
  }
  try {
    const sandbox = { window: {} };
    vm.runInNewContext(read(rel), sandbox, { timeout: 1000, filename: rel });
    if (!sandbox.window.SITE_CONFIG) throw new Error("window.SITE_CONFIG ausente");
    return sandbox.window.SITE_CONFIG;
  } catch (error) {
    fail("Config publica", error.message);
    return null;
  }
}

function normalizeBaseUrl(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function publicUrl(baseUrl, rel) {
  return `${baseUrl}/${String(rel || "").replace(/^\/+/, "")}`;
}

function productPagePath(product) {
  return `ofertas/${encodeURIComponent(product.id)}.html`;
}

function daysSince(dateText) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateText || ""))) return null;
  const then = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(then.getTime())) return null;
  return Math.floor((Date.now() - then.getTime()) / 86400000);
}

function requireFile(rel) {
  if (exists(rel)) ok(rel);
  else fail(rel, "arquivo obrigatorio ausente");
}

function assertNoPrivateFiles() {
  const before = errors;
  const blocked = [
    ".env",
    "data",
    "node_modules",
    "package-lock.json",
    "package.json",
    "server",
    "tools"
  ];
  for (const rel of blocked) {
    if (exists(rel)) fail("Arquivo privado publicado", rel);
  }
  if (errors === before) ok("Arquivos privados", "nenhum item bloqueado em public-site");
}

function validateHeaders() {
  if (!exists("_headers")) {
    warn("Headers", "_headers ausente; headers dependem do host");
    return;
  }
  const headers = read("_headers");
  const required = ["X-Content-Type-Options", "Referrer-Policy", "Permissions-Policy"];
  const missing = required.filter((item) => !headers.includes(item));
  if (missing.length) warn("Headers", `faltando ${missing.join(", ")}`);
  else ok("Headers", "basicos configurados");
}

function validateSitemapAndRobots(siteUrl, products) {
  if (!exists("sitemap.xml")) {
    fail("Sitemap", "ausente");
    return;
  }
  const sitemap = read("sitemap.xml");
  const before = errors;
  const expected = [
    "index.html",
    "artigo.html",
    "busca.html",
    "comparativo-do-dia.html",
    "sobre.html",
    "privacidade.html",
    "termos.html",
    ...products.map(productPagePath)
  ];

  for (const rel of expected) {
    const needle = siteUrl ? publicUrl(siteUrl, rel) : rel;
    if (!sitemap.includes(needle)) fail("Sitemap", `${needle} nao encontrado`);
  }
  if (errors === before) ok("Sitemap", `${expected.length} URL(s) esperadas`);

  if (!exists("robots.txt")) {
    fail("Robots", "ausente");
    return;
  }
  const robots = read("robots.txt");
  const sitemapUrl = siteUrl ? publicUrl(siteUrl, "sitemap.xml") : "sitemap.xml";
  if (!robots.includes(sitemapUrl)) warn("Robots", `Sitemap esperado: ${sitemapUrl}`);
  else ok("Robots", "sitemap informado");
}

function validateRootPages() {
  for (const rel of [
    "index.html",
    "artigo.html",
    "busca.html",
    "sobre.html",
    "privacidade.html",
    "termos.html",
    "404.html",
    "assets/app.js",
    "assets/config.js"
  ]) {
    requireFile(rel);
  }

  if (exists("index.html")) {
    const html = read("index.html");
    if (!html.includes("assets/config.js") || !html.includes("assets/app.js")) {
      fail("Home", "scripts publicos nao encontrados");
    } else {
      ok("Home", "scripts publicos conectados");
    }
    if (!html.includes("6 escolhas para começar") || !html.includes('id="comparativosGrid"')) {
      fail("Home", "secao com 6 comparativos ausente");
    } else {
      ok("Home", "6 comparativos preparados na pagina inicial");
    }
    if (html.includes("+2 milhões") || !html.includes('data-aa-jsonld="site"')) {
      fail("Home", html.includes("+2 milhões") ? "promessa de audiencia sem evidencia" : "dados estruturados do site ausentes");
    } else {
      ok("Home", "promessas verificaveis e dados estruturados presentes");
    }
  }

  if (exists("404.html") && !read("404.html").includes('name="robots" content="noindex"')) {
    fail("404", "pagina precisa usar noindex");
  }

  if (exists("busca.html") && exists("assets/app.js")) {
    const searchHtml = read("busca.html");
    const appJs = read("assets/app.js");
    const controls = ["filterPrioridade", "filterPrecoMin", "filterPrecoMax", "filterNotaMin", "filterSaveBtn", "buscaStatus"];
    const missingControls = controls.filter((id) => !searchHtml.includes(`id="${id}"`));
    if (missingControls.length || !appJs.includes("aa_search_preferences_v2")) {
      fail("Busca personalizada", missingControls.length ? `controles ausentes: ${missingControls.join(", ")}` : "persistencia das preferencias ausente");
    } else {
      ok("Busca personalizada", "prioridade, preco, nota, lojas e estado da consulta conectados");
    }
  }
}

function validateCanonicalPages(siteUrl) {
  if (!siteUrl) return;
  const pages = ["index.html", "index-mobile.html", "artigo.html", "oferta.html", "busca.html", "comparativos.html",
    "comparativo-do-dia.html", "favoritos.html", "sobre.html", "privacidade.html", "termos.html", "404.html"];
  const before = errors;
  for (const rel of pages) {
    if (!exists(rel)) continue;
    const canonicalRel = rel === "index-mobile.html" ? "index.html" : rel;
    const expected = `<link rel="canonical" href="${publicUrl(siteUrl, canonicalRel)}" />`;
    if (!read(rel).includes(expected)) fail("Canonical", `${rel} sem ${publicUrl(siteUrl, canonicalRel)}`);
  }
  if (errors === before) ok("Canonical", `${pages.length} pagina(s) principais conferidas`);
}

function validateProducts(cfg, siteUrl) {
  const products = Array.isArray(cfg.products) ? cfg.products : [];
  if (!products.length) {
    fail("Produtos", "nenhum produto na config publica");
    return [];
  }
  ok("Produtos", `${products.length} produto(s)`);

  if (cfg.staticProductPages !== true) {
    fail("Paginas estaticas", "staticProductPages deve ser true no public-site");
  }

  const mlProducts = products.filter((product) => product.storeKey === "mercadolivre");
  const mlReady = mlProducts.filter((product) => /^https:\/\/meli\.la\//i.test(product.affiliateUrl || ""));
  if (mlProducts.length && mlReady.length !== mlProducts.length) {
    fail("Mercado Livre", `${mlReady.length}/${mlProducts.length} produto(s) com link meli.la`);
  } else {
    ok("Mercado Livre", `${mlReady.length}/${mlProducts.length} link(s) meli.la`);
  }

  const beforePages = errors;
  for (const product of products) {
    const rel = productPagePath(product);
    if (!exists(rel)) {
      fail("Pagina de oferta", `${rel} ausente`);
      continue;
    }
    const html = read(rel);
    if (!html.includes(`data-product-id="${product.id}"`)) {
      fail("Pagina de oferta", `${rel} sem data-product-id correto`);
    }
    if (!html.includes(product.title)) {
      fail("Pagina de oferta", `${rel} sem titulo do produto`);
    }
    if (siteUrl && !html.includes(publicUrl(siteUrl, rel))) {
      fail("Canonical", `${rel} sem URL canonica esperada`);
    }
  }
  if (errors === beforePages) ok("Paginas de oferta", `${products.length} pagina(s) conferidas`);

  const stale = products
    .map((product) => ({ product, age: daysSince(product.updatedAt || cfg.priceCheckedOn) }))
    .filter((item) => item.age != null && item.age > 14);
  if (stale.length) {
    warn("Precos", `${stale.length} produto(s) com preco consultado ha mais de 14 dias`);
  }

  const amazonProducts = products.filter((product) => product.storeKey === "amazon");
  if (amazonProducts.length && !cfg.affiliates?.amazonTag) {
    warn("Amazon", `${amazonProducts.length} produto(s) sem amazonTag`);
  }

  const shopeeSearchLinks = products.filter((product) =>
    product.storeKey === "shopee" && /shopee\.com\.br\/search/i.test(product.affiliateUrl || "")
  );
  if (shopeeSearchLinks.length) {
    warn("Shopee", `${shopeeSearchLinks.length} produto(s) usando link de busca comum`);
  }

  return products;
}

function validateComparisons() {
  const dir = publicPath("comparativos");
  if (!fs.existsSync(dir)) {
    ok("Comparativos", "nenhum comparativo publicado ainda");
    return;
  }
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".html"));
  if (!files.length) {
    ok("Comparativos", "nenhum comparativo publicado ainda");
    return;
  }
  if (!exists("comparativos.html")) fail("Comparativos", "comparativos.html (indice) ausente apesar de haver comparativos publicados");

  const before = errors;
  for (const file of files) {
    const html = read(path.join("comparativos", file));
    const match = html.match(/<script type="application\/json" data-aa-comparison="1">([\s\S]*?)<\/script>/);
    if (!match) {
      fail("Comparativo", `${file} sem bloco de dados data-aa-comparison`);
      continue;
    }
    let items;
    try {
      items = JSON.parse(match[1]);
    } catch (error) {
      fail("Comparativo", `${file} bloco de dados invalido: ${error.message}`);
      continue;
    }
    if (!Array.isArray(items) || items.length !== 3) {
      fail("Comparativo", `${file} deveria ter exatamente 3 itens, tem ${Array.isArray(items) ? items.length : 0}`);
      continue;
    }
    // O vencedor e escolhido por merito real (nota + venda + opiniao externa), nao por
    // uma regra fixa de preco/afiliado - por isso os itens #2/#3 podem custar menos que
    // o #1, e um item so tem "cons" quando a evidencia real (review/opiniao) sustenta
    // isso. Link de afiliado e um bonus (depende de sessao logada), nao requisito.
    const winner = items.find((item) => item.rank === 1);
    if (!winner) {
      fail("Comparativo", `${file} sem item rank 1`);
    } else {
      if (winner.marketplace !== "mercadolivre") fail("Comparativo", `${file} item #1 nao e mercadolivre`);
      if (!/^https:\/\/meli\.la\//i.test(winner.affiliateUrl || "")) {
        warn("Comparativo", `${file} item #1 ainda sem link meli.la de afiliado - gerar quando o login do Mercado Livre estiver ativo`);
      }
    }
    for (const item of items.filter((entry) => entry.rank !== 1)) {
      if (item.affiliateUrl) fail("Comparativo", `${file} item #${item.rank} nao deveria ter link de afiliado`);
    }
  }
  if (errors === before) ok("Comparativos", `${files.length} comparativo(s) conferido(s)`);
}

function validateMonetization(cfg) {
  const searchApiBase = String(cfg.searchApiBase || "").trim();
  if (!searchApiBase) {
    warn("Busca ao vivo", "searchApiBase vazio; o site publicado usa somente resultados salvos");
  } else {
    try {
      const searchApiUrl = new URL(searchApiBase);
      if (searchApiUrl.protocol !== "https:") fail("Busca ao vivo", "searchApiBase precisa usar HTTPS em producao");
      else ok("Busca ao vivo", "endpoint publico configurado com HTTPS");
    } catch {
      fail("Busca ao vivo", "searchApiBase invalido");
    }
  }

  if (!cfg.ga4MeasurementId) warn("GA4", "vazio; campanhas ficam sem medicao adequada");
  else ok("GA4", "configurado");

  if (!cfg.metaPixelId) warn("Meta Pixel", "vazio; nao escale anuncios pagos");
  else ok("Meta Pixel", "configurado");

  if (!cfg.adsenseClient) {
    warn("AdSense", "vazio; display ainda nao monetiza");
  } else if (!/^ca-pub-\d+$/i.test(cfg.adsenseClient)) {
    fail("AdSense", "adsenseClient invalido");
  } else if (!exists("ads.txt")) {
    fail("AdSense", "ads.txt ausente apesar de adsenseClient configurado");
  } else {
    ok("AdSense", "cliente e ads.txt encontrados");

    const htmlFiles = listFilesRecursive(publicDir, ".html");
    const missingCode = htmlFiles.filter((file) => {
      const html = fs.readFileSync(file, "utf8");
      return !html.includes('name="google-adsense-account"')
        || !html.includes("pagead2.googlesyndication.com/pagead/js/adsbygoogle.js");
    });
    if (missingCode.length) {
      const relFiles = missingCode
        .slice(0, 8)
        .map((file) => path.relative(publicDir, file).replace(/\\/g, "/"));
      const suffix = missingCode.length > relFiles.length ? ` (+${missingCode.length - relFiles.length})` : "";
      fail("AdSense em paginas", `${missingCode.length} HTML sem codigo estatico: ${relFiles.join(", ")}${suffix}`);
    } else {
      ok("AdSense em paginas", `${htmlFiles.length} pagina(s) com codigo estatico`);
    }

    const legacyDomainFiles = htmlFiles.filter((file) =>
      fs.readFileSync(file, "utf8").includes("achado-agora.rafylsck.chatgpt.site")
    );
    if (legacyDomainFiles.length) {
      fail("Dominio antigo", `${legacyDomainFiles.length} HTML ainda apontam para o endereco anterior`);
    } else {
      ok("Dominio antigo", "nenhuma referencia no HTML publicado");
    }
  }

  if (!cfg.affiliates?.mlMattWord) warn("ML matt_word", "vazio");
  else ok("ML matt_word", "configurado");

  if (!cfg.contactEmail) warn("Contato", "contactEmail vazio");
  else ok("Contato", cfg.contactEmail);
}

console.log("Validacao do public-site");
console.log("");

if (!fs.existsSync(publicDir)) {
  fail("public-site", "pasta ausente; rode npm run build:public");
} else {
  validateRootPages();
  assertNoPrivateFiles();
  validateHeaders();

  const cfg = loadPublicConfig();
  if (cfg) {
    const siteUrl = normalizeBaseUrl(cfg.siteUrl);
    if (!siteUrl) warn("siteUrl", "vazio ou invalido; sitemap/canonical podem ficar incorretos");
    else ok("siteUrl", siteUrl);

    const products = validateProducts(cfg, siteUrl);
    validateCanonicalPages(siteUrl);
    validateSitemapAndRobots(siteUrl, products);
    validateComparisons();
    validateMonetization(cfg);
  }
}

console.log("");
if (errors) {
  console.log(`${errors} erro(s), ${warnings} aviso(s). Corrija antes de publicar.`);
  process.exitCode = 1;
} else {
  console.log(`Public-site valido com ${warnings} aviso(s).`);
}

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { escapeHtml, ensureDir, publicUrl, xmlEscape } from "../server/lib/utils.js";
import { affiliateUrl } from "../server/lib/affiliate.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const UI = {
  en: {
    skipLink: "Skip to offer",
    nav: { offers: "Deals", comparisons: "Comparisons", search: "Search", method: "Method" },
    menu: "Menu",
    referencePrice: (date) => `Reference price checked on ${date}. The final price is set by the store at checkout.`,
    viewDealOn: (store) => `View deal on ${store}`,
    ad: "Advertisement",
    adSpace: "Space for display network.",
    whyItMadeTheCut: "Why it made the cut",
    specs: "Specs",
    worthItIf: "Worth it if",
    thinkTwiceIf: "Think twice if",
    otherDeals: "Other deals",
    refPrice: "Ref. price",
    openDeal: "Open deal",
    footerTagline: "Reference price. The purchase is completed at the destination store.",
    legal: { privacy: "Privacy", terms: "Terms" },
    cookieText: 'We use cookies to measure campaigns. See our',
    cookieLink: "privacy policy",
    cookieOk: "Ok"
  },
  es: {
    skipLink: "Ir a la oferta",
    nav: { offers: "Ofertas", comparisons: "Comparativos", search: "Buscar", method: "Método" },
    menu: "Menú",
    referencePrice: (date) => `Precio de referencia consultado el ${date}. El valor final es el de la tienda al finalizar la compra.`,
    viewDealOn: (store) => `Ver oferta en ${store}`,
    ad: "Publicidad",
    adSpace: "Espacio para red de display.",
    whyItMadeTheCut: "Por qué entró en la vitrina",
    specs: "Ficha técnica",
    worthItIf: "Vale la pena si",
    thinkTwiceIf: "Piénsalo dos veces si",
    otherDeals: "Otras ofertas",
    refPrice: "Precio ref.",
    openDeal: "Abrir oferta",
    footerTagline: "Precio de referencia. La compra se concreta en la tienda de destino.",
    legal: { privacy: "Privacidad", terms: "Términos" },
    cookieText: "Usamos cookies para medir campañas. Consulta nuestra",
    cookieLink: "política de privacidad",
    cookieOk: "Ok"
  }
};

function loadLocaleConfig(locale) {
  const configPath = path.join(rootDir, "assets", `config.${locale}.js`);
  const source = fs.readFileSync(configPath, "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { timeout: 1000, filename: `assets/config.${locale}.js` });
  if (!sandbox.window.SITE_CONFIG) throw new Error(`assets/config.${locale}.js nao define window.SITE_CONFIG.`);
  return sandbox.window.SITE_CONFIG;
}

function validAdsenseClient(client) {
  return /^ca-pub-\d+$/i.test(String(client || "").trim());
}

function adsenseHeadCode(client) {
  const safeClient = String(client || "").trim();
  if (!validAdsenseClient(safeClient)) return "";
  return `  <meta name="google-adsense-account" content="${safeClient}" />\n  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${safeClient}" crossorigin="anonymous" data-aa-adsense="1"></script>\n`;
}

function injectHeadCode(html, code) {
  if (!code || html.includes("data-aa-adsense=")) return html;
  return html.replace("</head>", `${code}</head>`);
}

function loadPtBaseUrl() {
  const configPath = path.join(rootDir, "assets", "config.js");
  const source = fs.readFileSync(configPath, "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { timeout: 1000, filename: "assets/config.js" });
  return sandbox.window.SITE_CONFIG?.siteUrl || "https://achadoagora.blog.br";
}

function hreflangBlock(file, ptBase) {
  const base = ptBase.replace(/\/+$/, "");
  return `  <link rel="alternate" hreflang="pt-BR" href="${base}/${file}" data-aa-hreflang="1" />\n` +
    `  <link rel="alternate" hreflang="en" href="${base}/en/${file}" />\n` +
    `  <link rel="alternate" hreflang="es" href="${base}/es/${file}" />\n` +
    `  <link rel="alternate" hreflang="x-default" href="${base}/${file}" />\n`;
}

function injectHreflang(html, file, ptBase) {
  if (html.includes("data-aa-hreflang")) return html;
  return html.replace("</head>", `${hreflangBlock(file, ptBase)}</head>`);
}

function formatBRL(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}

function discount(product) {
  if (!product.oldPrice || product.oldPrice <= product.price) return 0;
  return Math.round((1 - product.price / product.oldPrice) * 100);
}

function productPagePath(product) {
  return `ofertas/${encodeURIComponent(product.id)}.html`;
}

function pageAssetHref(assetPath, prefix = "../") {
  if (/^https?:\/\//i.test(String(assetPath || ""))) return assetPath;
  return `${prefix}${String(assetPath || "").replace(/^\/+/, "")}`;
}

function absoluteAssetUrl(siteUrl, assetPath) {
  if (/^https?:\/\//i.test(String(assetPath || ""))) return assetPath;
  return publicUrl(siteUrl, String(assetPath || "").replace(/^\/+/, ""));
}

function jsonForScript(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function listItems(items) {
  return (items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function renderProductPage(product, siteConfig, siteUrl, locale) {
  const t = UI[locale];
  const brand = siteConfig.brand || "Achado Agora";
  const canonical = publicUrl(siteUrl, productPagePath(product));
  const adHead = adsenseHeadCode(siteConfig.adsenseClient);
  const image = product.image || "assets/img/og.jpg";
  const imageHref = pageAssetHref(image);
  const imageUrl = absoluteAssetUrl(siteUrl, image);
  const offerUrl = affiliateUrl(product, siteConfig);
  const off = discount(product);
  const description = product.description || product.why || product.title;
  const checkedAt = product.updatedAt || siteConfig.priceCheckedOn || "";
  const related = (siteConfig.products || [])
    .filter((item) => item.id !== product.id)
    .slice(0, 3)
    .map((item) => `
      <article class="product-card">
        <a class="product-art" href="../${escapeHtml(productPagePath(item))}">
          ${item.badge ? `<span class="badge">${escapeHtml(item.badge)}</span>` : ""}
          <img src="${escapeHtml(pageAssetHref(item.image || "assets/img/og.jpg"))}" alt="${escapeHtml(item.title)}" width="400" height="300" loading="lazy">
        </a>
        <div class="product-body">
          <span class="category">${escapeHtml(item.store)} · ${escapeHtml(item.category)}</span>
          <h3><a href="../${escapeHtml(productPagePath(item))}">${escapeHtml(item.title)}</a></h3>
          <p>${escapeHtml(item.description || item.why || "")}</p>
          <div class="price-row">
            <strong class="price">${formatBRL(item.price)}</strong>
            ${item.oldPrice ? `<span class="old">${formatBRL(item.oldPrice)}</span>` : ""}
          </div>
        </div>
      </article>
    `).join("");

  const productJsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.title,
    description,
    image: imageUrl,
    brand: product.brand,
    offers: {
      "@type": "Offer",
      priceCurrency: "BRL",
      price: product.price,
      availability: "https://schema.org/InStock",
      seller: { "@type": "Organization", name: product.store }
    }
  };

  return `<!doctype html>
<html lang="${locale}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="description" content="${escapeHtml(description.slice(0, 155))}" />
  <meta name="theme-color" content="#09090b" />
  <meta property="og:title" content="${escapeHtml(product.title)} - ${escapeHtml(brand)}" />
  <meta property="og:description" content="${escapeHtml(description.slice(0, 180))}" />
  <meta property="og:type" content="product" />
  <meta property="og:url" content="${escapeHtml(canonical)}" />
  <meta property="og:image" content="${escapeHtml(imageUrl)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(product.title)} - ${escapeHtml(brand)}" />
  <meta name="twitter:description" content="${escapeHtml(description.slice(0, 180))}" />
  <meta name="twitter:image" content="${escapeHtml(imageUrl)}" />
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  <title>${escapeHtml(product.title)} - ${escapeHtml(brand)}</title>
  <link rel="icon" href="../assets/img/favicon.svg" type="image/svg+xml" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../assets/styles.css" />
${adHead}  <script type="application/ld+json" data-aa-jsonld="product">${jsonForScript(productJsonLd)}</script>
</head>
<body data-page="oferta" data-product-id="${escapeHtml(product.id)}">
  <a class="skip" href="#dealRoot">${t.skipLink}</a>
  <header class="topbar">
    <div class="topbar-inner">
      <a class="brand" href="../index.html">Achado<span>Agora</span></a>
      <nav class="nav-links" id="navLinks">
        <a href="../index.html#ofertas">${t.nav.offers}</a>
        <a href="../comparativos.html">${t.nav.comparisons}</a>
        <a href="../busca.html">${t.nav.search}</a>
        <a href="../sobre.html">${t.nav.method}</a>
      </nav>
      <button class="menu-btn" id="menuBtn" type="button" aria-expanded="false" aria-controls="navLinks">${t.menu}</button>
    </div>
  </header>
  <main class="page" id="dealRoot">
    <section class="deal">
      <div class="deal-visual">
        <img src="${escapeHtml(imageHref)}" alt="${escapeHtml(product.title)}">
      </div>
      <aside class="deal-panel">
        <p class="eyebrow">${escapeHtml(product.badge || product.category)}</p>
        <h1>${escapeHtml(product.title)}</h1>
        <p>${escapeHtml(product.why || description)}</p>
        <div class="meta-line">
          <span>${escapeHtml(product.store)}</span>
          <span>${escapeHtml(product.reviewLabel || "")}</span>
        </div>
        <div class="price-row">
          <strong class="price">${formatBRL(product.price)}</strong>
          ${product.oldPrice ? `<span class="old">${formatBRL(product.oldPrice)}</span>` : ""}
          ${off ? `<span class="off">-${off}%</span>` : ""}
        </div>
        <p class="legal-meta">${escapeHtml(t.referencePrice(checkedAt))}</p>
        <p><a class="btn primary full affiliate-link" data-product="${escapeHtml(product.id)}" href="${escapeHtml(offerUrl || "#")}" target="_blank" rel="sponsored nofollow noopener">${escapeHtml(t.viewDealOn(product.store))}</a></p>
      </aside>
    </section>
    <section class="ad-slot" aria-label="${t.ad}" data-ad-slot-key="offerTop" data-ad-format="horizontal">
      <span>${t.ad}</span>
      <small>${t.adSpace}</small>
    </section>
    <section class="section">
      <h2>${t.whyItMadeTheCut}</h2>
      <p>${escapeHtml(description)}</p>
      <div class="how" style="margin-top:24px">
        <article>
          <h3>${t.specs}</h3>
          <ul class="spec-list">${listItems(product.specs)}</ul>
        </article>
        <article>
          <h3>${t.worthItIf}</h3>
          <ul class="spec-list">${listItems(product.pros)}</ul>
        </article>
        <article>
          <h3>${t.thinkTwiceIf}</h3>
          <ul class="spec-list procon">${listItems(product.cons)}</ul>
        </article>
      </div>
    </section>
    ${related ? `<section class="related"><div class="section-head"><h2>${t.otherDeals}</h2></div><div class="grid">${related}</div></section>` : ""}
    <div class="sticky-cta" aria-label="${t.otherDeals}">
      <div>
        <span>${t.refPrice}</span>
        <strong>${formatBRL(product.price)}</strong>
      </div>
      <a class="btn primary affiliate-link" data-product="${escapeHtml(product.id)}" href="${escapeHtml(offerUrl || "#")}" target="_blank" rel="sponsored nofollow noopener">${t.openDeal}</a>
    </div>
  </main>
  <footer class="site-footer">
    <div>
      <div class="brand">Achado<span>Agora</span></div>
      <p>${t.footerTagline}</p>
    </div>
    <div>
      <ul>
        <li><a href="../index.html#ofertas">${t.nav.offers}</a></li>
        <li><a href="../comparativos.html">${t.nav.comparisons}</a></li>
        <li><a href="../busca.html">${t.nav.search}</a></li>
        <li><a href="../sobre.html">${t.nav.method}</a></li>
        <li><a href="https://www.facebook.com/profile.php?id=61594174943230" target="_blank" rel="noopener">Facebook</a></li>
      </ul>
    </div>
    <div>
      <ul>
        <li><a href="../privacidade.html">${t.legal.privacy}</a></li>
        <li><a href="../termos.html">${t.legal.terms}</a></li>
      </ul>
    </div>
  </footer>
  <div class="cookie" id="cookieBox" role="dialog" aria-label="Cookies">
    <p>${t.cookieText} <a href="../privacidade.html">${t.cookieLink}</a>.</p>
    <div class="cookie-actions"><button class="btn primary" id="cookieOk" type="button">${t.cookieOk}</button></div>
  </div>
  <script src="../assets/config.js"></script>
  <script src="../assets/app.js"></script>
</body>
</html>
`;
}

function copyFileTransform(src, dest, transform) {
  ensureDir(path.dirname(dest));
  if (transform) fs.writeFileSync(dest, transform(fs.readFileSync(src, "utf8")), "utf8");
  else fs.copyFileSync(src, dest);
}

function copyDir(src, dest, options = {}) {
  if (!fs.existsSync(src)) return;
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    const relForward = path.relative(rootDir, srcPath).replace(/\\/g, "/");
    if (options.exclude?.some((pattern) => pattern.test(relForward))) continue;
    if (entry.isDirectory()) copyDir(srcPath, destPath, options);
    else if (entry.isFile()) fs.copyFileSync(srcPath, destPath);
  }
}

function buildLocaleSite(locale) {
  const localeSrcDir = path.join(rootDir, "locales", locale);
  if (!fs.existsSync(localeSrcDir)) {
    throw new Error(`locales/${locale} nao existe. Rode a traducao antes do build.`);
  }
  const outputDir = path.join(rootDir, "public-site", locale);
  fs.rmSync(outputDir, { recursive: true, force: true });
  ensureDir(outputDir);

  const siteConfig = loadLocaleConfig(locale);
  const siteUrl = siteConfig.siteUrl;
  const adHead = adsenseHeadCode(siteConfig.adsenseClient);
  const ptBase = loadPtBaseUrl();

  const rootFiles = [
    "index.html",
    "index-mobile.html",
    "artigo.html",
    "oferta.html",
    "busca.html",
    "comparativos.html",
    "favoritos.html",
    "sobre.html",
    "privacidade.html",
    "termos.html"
  ];
  const copied = [];
  for (const file of rootFiles) {
    const src = path.join(localeSrcDir, file);
    if (!fs.existsSync(src)) continue;
    copyFileTransform(src, path.join(outputDir, file), (html) => injectHreflang(injectHeadCode(html, adHead), file, ptBase));
    copied.push(file);
  }

  copyDir(path.join(rootDir, "assets"), path.join(outputDir, "assets"), {
    exclude: [/^assets\/config(\.\w+)?\.js$/i, /^assets\/app(\.\w+)?\.js$/i]
  });
  fs.writeFileSync(
    path.join(outputDir, "assets", "config.js"),
    `window.SITE_CONFIG = ${JSON.stringify({ ...siteConfig, staticProductPages: true, staticProductPagesBase: "ofertas" }, null, 2)};\n`,
    "utf8"
  );
  fs.copyFileSync(path.join(rootDir, "assets", `app.${locale}.js`), path.join(outputDir, "assets", "app.js"));

  const products = Array.isArray(siteConfig.products) ? siteConfig.products : [];
  const pagesDir = path.join(outputDir, "ofertas");
  ensureDir(pagesDir);
  for (const product of products) {
    fs.writeFileSync(path.join(outputDir, productPagePath(product)), renderProductPage(product, siteConfig, siteUrl, locale), "utf8");
  }

  copyDir(path.join(localeSrcDir, "comparativos"), path.join(outputDir, "comparativos"));

  const comparisonSlugs = fs.existsSync(path.join(localeSrcDir, "comparativos"))
    ? fs.readdirSync(path.join(localeSrcDir, "comparativos")).filter((f) => f.endsWith(".html"))
    : [];

  const urls = [
    "index.html",
    "artigo.html",
    "busca.html",
    "sobre.html",
    "privacidade.html",
    "termos.html",
    ...products.map(productPagePath),
    ...(comparisonSlugs.length ? ["comparativos.html"] : []),
    ...comparisonSlugs.map((f) => `comparativos/${f}`)
  ].map((url) => publicUrl(siteUrl, url));

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...new Set(urls)].map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`).join("\n")}
</urlset>
`;
  fs.writeFileSync(path.join(outputDir, "sitemap.xml"), sitemap, "utf8");
  fs.writeFileSync(path.join(outputDir, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${publicUrl(siteUrl, "sitemap.xml")}\n`, "utf8");

  return { locale, outputDir, siteUrl, copied, productPageCount: products.length, comparisonCount: comparisonSlugs.length, urlCount: urls.length };
}

const locales = process.argv.slice(2).length ? process.argv.slice(2) : ["en", "es"];
for (const locale of locales) {
  const result = buildLocaleSite(locale);
  console.log(`[${locale}] site gerado em ${result.outputDir}`);
  console.log(`[${locale}] siteUrl: ${result.siteUrl}`);
  console.log(`[${locale}] paginas de oferta: ${result.productPageCount}, comparativos: ${result.comparisonCount}, urls no sitemap: ${result.urlCount}`);
}

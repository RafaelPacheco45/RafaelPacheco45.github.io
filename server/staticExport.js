import fs from "node:fs";
import path from "node:path";
import { config, rootDir } from "./config.js";
import { escapeHtml, ensureDir, publicUrl, xmlEscape } from "./lib/utils.js";
import { affiliateUrl } from "./lib/affiliate.js";
import { loadSiteConfig } from "./sitePublisher.js";
import { listComparisons } from "./db.js";

const outputDir = path.join(rootDir, "public-site");

function assertInsideRoot(targetPath) {
  const resolved = path.resolve(targetPath);
  const relative = path.relative(rootDir, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Caminho fora do projeto bloqueado: ${resolved}`);
  }
  return resolved;
}

function removeDirSafe(targetPath) {
  const resolved = assertInsideRoot(targetPath);
  if (path.basename(resolved) !== "public-site") {
    throw new Error(`Remocao recusada: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function validAdsenseClient(client) {
  return /^ca-pub-\d+$/i.test(String(client || "").trim());
}

function adsensePublisherId(client) {
  const match = String(client || "").trim().match(/^ca-pub-(\d+)$/i);
  return match ? `pub-${match[1]}` : "";
}

function adsenseHeadCode(client) {
  const safeClient = String(client || "").trim();
  if (!validAdsenseClient(safeClient)) return "";
  return `  <meta name="google-adsense-account" content="${safeClient}" />\n  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${safeClient}" crossorigin="anonymous" data-aa-adsense="1"></script>\n`;
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

function renderProductPage(product, siteConfig, siteUrl) {
  const brand = siteConfig.brand || "Achado Agora";
  const canonical = publicUrl(siteUrl, productPagePath(product));
  const adHead = adsenseHeadCode(siteConfig.adsenseClient);
  const image = product.image || "assets/img/og.jpg";
  const imageHref = pageAssetHref(image);
  const imageUrl = absoluteAssetUrl(siteUrl, image);
  const offerUrl = affiliateUrl(product, siteConfig);
  const off = discount(product);
  const description = product.description || product.why || `${product.title}. Confira preco, frete e estoque no checkout.`;
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
<html lang="pt-BR">
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
  <a class="skip" href="#dealRoot">Ir para a oferta</a>
  <header class="topbar">
    <div class="topbar-inner">
      <a class="brand" href="../index.html">Achado<span>Agora</span></a>
      <nav class="nav-links" id="navLinks">
        <a href="../index.html#ofertas">Ofertas</a>
        <a href="../comparativos.html">Comparativos</a>
        <a href="../busca.html">Buscar</a>
        <a href="../sobre.html">Método</a>
      </nav>
      <button class="menu-btn" id="menuBtn" type="button" aria-expanded="false" aria-controls="navLinks">Menu</button>
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
        <p class="legal-meta">Preco de referencia consultado em ${escapeHtml(checkedAt)}. O valor final e o da loja no checkout.</p>
        <p><a class="btn primary full affiliate-link" data-product="${escapeHtml(product.id)}" href="${escapeHtml(offerUrl || "#")}" target="_blank" rel="sponsored nofollow noopener">Ver oferta no ${escapeHtml(product.store)}</a></p>
      </aside>
    </section>
    <section class="ad-slot" aria-label="Publicidade" data-ad-slot-key="offerTop" data-ad-format="horizontal">
      <span>Publicidade</span>
      <small>Espaco para rede display.</small>
    </section>
    <section class="section">
      <h2>Por que entrou na vitrine</h2>
      <p>${escapeHtml(description)}</p>
      <div class="how" style="margin-top:24px">
        <article>
          <h3>Ficha</h3>
          <ul class="spec-list">${listItems(product.specs)}</ul>
        </article>
        <article>
          <h3>Vale se</h3>
          <ul class="spec-list">${listItems(product.pros)}</ul>
        </article>
        <article>
          <h3>Pense duas vezes se</h3>
          <ul class="spec-list procon">${listItems(product.cons)}</ul>
        </article>
      </div>
    </section>
    ${related ? `<section class="related"><div class="section-head"><h2>Outras ofertas</h2></div><div class="grid">${related}</div></section>` : ""}
    <div class="sticky-cta" aria-label="Atalho para oferta">
      <div>
        <span>Preco ref.</span>
        <strong>${formatBRL(product.price)}</strong>
      </div>
      <a class="btn primary affiliate-link" data-product="${escapeHtml(product.id)}" href="${escapeHtml(offerUrl || "#")}" target="_blank" rel="sponsored nofollow noopener">Abrir oferta</a>
    </div>
  </main>
  <footer class="site-footer">
    <div>
      <div class="brand">Achado<span>Agora</span></div>
      <p>Preco de referencia. A compra e fechada na loja de destino.</p>
    </div>
    <div>
      <ul>
        <li><a href="../index.html#ofertas">Ofertas</a></li>
        <li><a href="../comparativos.html">Comparativos</a></li>
        <li><a href="../busca.html">Buscar</a></li>
        <li><a href="../sobre.html">Método</a></li>
        <li><a href="https://www.facebook.com/profile.php?id=61594174943230" target="_blank" rel="noopener">Facebook</a></li>
      </ul>
    </div>
    <div>
      <ul>
        <li><a href="../privacidade.html">Privacidade</a></li>
        <li><a href="../termos.html">Termos</a></li>
      </ul>
    </div>
  </footer>
  <div class="cookie" id="cookieBox" role="dialog" aria-label="Cookies">
    <p>Usamos cookies para medir campanhas. Veja a <a href="../privacidade.html">privacidade</a>.</p>
    <div class="cookie-actions"><button class="btn primary" id="cookieOk" type="button">Ok</button></div>
  </div>
  <script src="../assets/config.js"></script>
  <script src="../assets/app.js"></script>
</body>
</html>
`;
}

function injectHeadCode(html, code) {
  if (!code || html.includes("data-aa-adsense=")) return html;
  return html.replace("</head>", `${code}</head>`);
}

function copyFile(srcRel, destRel = srcRel, transform = null) {
  const src = assertInsideRoot(path.join(rootDir, srcRel));
  if (!fs.existsSync(src)) return false;
  const dest = assertInsideRoot(path.join(outputDir, destRel));
  ensureDir(path.dirname(dest));
  if (transform) fs.writeFileSync(dest, transform(fs.readFileSync(src, "utf8")), "utf8");
  else fs.copyFileSync(src, dest);
  return true;
}

function copyDir(srcRel, destRel = srcRel, options = {}) {
  const src = assertInsideRoot(path.join(rootDir, srcRel));
  if (!fs.existsSync(src)) return;
  const dest = assertInsideRoot(path.join(outputDir, destRel));
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const rel = path.join(srcRel, entry.name);
    const outRel = path.join(destRel, entry.name);
    if (options.exclude?.some((pattern) => pattern.test(rel.replace(/\\/g, "/")))) continue;
    if (entry.isDirectory()) copyDir(rel, outRel, options);
    else if (entry.isFile()) {
      const relForward = rel.replace(/\\/g, "/");
      const transform = options.transform
        ? (content) => options.transform(content, relForward)
        : null;
      copyFile(rel, outRel, transform);
    }
  }
}

function comparisonPagePath(comparison) {
  return `comparativos/${encodeURIComponent(comparison.slug)}.html`;
}

function staticUrls(siteUrl) {
  const cfg = loadSiteConfig();
  const products = Array.isArray(cfg.products) ? cfg.products : [];
  const posts = fs.existsSync(path.join(rootDir, "posts"))
    ? fs.readdirSync(path.join(rootDir, "posts")).filter((name) => name.endsWith(".html")).map((name) => `posts/${name}`)
    : [];
  const comparisons = listComparisons(500).filter((item) => item.status === "published");
  return [
    "index.html",
    "artigo.html",
    "busca.html",
    "sobre.html",
    "privacidade.html",
    "termos.html",
    ...products.map(productPagePath),
    ...posts,
    ...(comparisons.length ? ["comparativos.html"] : []),
    ...comparisons.map(comparisonPagePath)
  ].map((url) => publicUrl(siteUrl, url));
}

function writePublicConfig(siteUrl) {
  const cfg = loadSiteConfig();
  cfg.siteUrl = siteUrl || cfg.siteUrl || config.siteUrl || "";
  cfg.searchApiBase = process.env.AUTOBLOG_PUBLIC_SEARCH_API_URL || cfg.searchApiBase || "";
  cfg.staticProductPages = true;
  cfg.staticProductPagesBase = "ofertas";
  fs.writeFileSync(path.join(outputDir, "assets", "config.js"), `window.SITE_CONFIG = ${JSON.stringify(cfg, null, 2)};\n`, "utf8");
  return cfg;
}

function writeProductPages(siteConfig, siteUrl) {
  const products = Array.isArray(siteConfig.products) ? siteConfig.products : [];
  const pagesDir = path.join(outputDir, "ofertas");
  ensureDir(pagesDir);
  for (const product of products) {
    const filePath = path.join(outputDir, productPagePath(product));
    ensureDir(path.dirname(filePath));
    fs.writeFileSync(filePath, renderProductPage(product, siteConfig, siteUrl), "utf8");
  }
  return products.length;
}

function writeDeployFiles(siteUrl) {
  const cfg = loadSiteConfig();
  const publisherId = adsensePublisherId(cfg.adsenseClient);
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...new Set(staticUrls(siteUrl))].map((url) => `  <url><loc>${xmlEscape(url)}</loc></url>`).join("\n")}
</urlset>
`;
  fs.writeFileSync(path.join(outputDir, "sitemap.xml"), sitemap, "utf8");
  fs.writeFileSync(path.join(outputDir, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${publicUrl(siteUrl, "sitemap.xml")}\n`, "utf8");
  fs.writeFileSync(path.join(outputDir, ".nojekyll"), "", "utf8");
  fs.writeFileSync(path.join(outputDir, "_headers"), `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
`, "utf8");
  if (publisherId) {
    fs.writeFileSync(path.join(outputDir, "ads.txt"), `google.com, ${publisherId}, DIRECT, f08c47fec0942fa0\n`, "utf8");
  }
}

export function buildPublicSite(options = {}) {
  const siteUrl = options.siteUrl || process.env.AUTOBLOG_SITE_URL || config.siteUrl || "";
  const cfg = loadSiteConfig();
  const adHead = adsenseHeadCode(cfg.adsenseClient);
  removeDirSafe(outputDir);
  ensureDir(outputDir);

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
    if (copyFile(file, file, (html) => injectHeadCode(html, adHead))) copied.push(file);
  }

  copyDir("assets", "assets");
  const publicConfig = writePublicConfig(siteUrl);
  const productPageCount = writeProductPages(publicConfig, siteUrl);
  copyDir("posts", "posts");
  copyDir("comparativos", "comparativos", {
    transform: (content, rel) => (/\.html$/i.test(rel) ? injectHeadCode(content, adHead) : content)
  });
  writeDeployFiles(siteUrl);

  return {
    outputDir,
    siteUrl,
    copied,
    productPageCount,
    comparisonCount: listComparisons(500).filter((item) => item.status === "published").length,
    urls: staticUrls(siteUrl)
  };
}

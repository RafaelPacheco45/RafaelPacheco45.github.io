import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { config, rootDir } from "./config.js";
import { createOrUpdatePost, listComparisons, listPosts, markProductPublished, upsertProduct } from "./db.js";
import { cleanText, ensureDir, escapeHtml, nowIso, publicUrl, slugify, xmlEscape } from "./lib/utils.js";

const siteConfigPath = path.join(rootDir, "assets", "config.js");
const postsDir = path.join(rootDir, "posts");
const generatedImagesDir = path.join(rootDir, "assets", "img", "generated");

export function loadSiteConfig() {
  const source = fs.readFileSync(siteConfigPath, "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(source, sandbox, { timeout: 1000, filename: "assets/config.js" });
  if (!sandbox.window.SITE_CONFIG) throw new Error("assets/config.js nao define window.SITE_CONFIG.");
  return sandbox.window.SITE_CONFIG;
}

export function saveSiteConfig(siteConfig) {
  const out = `window.SITE_CONFIG = ${JSON.stringify(siteConfig, null, 2)};\n`;
  fs.writeFileSync(siteConfigPath, out, "utf8");
}

function marketplaceLabel(key) {
  if (key === "mercadolivre") return "Mercado Livre";
  if (key === "amazon") return "Amazon";
  if (key === "shopee") return "Shopee";
  return key || "Marketplace";
}

function relativeImagePath(product) {
  if (product.localImagePath) return product.localImagePath.replace(/\\/g, "/");
  if (product.imageUrl) return product.imageUrl;
  return "assets/img/og.jpg";
}

function pageAssetHref(assetPath, prefix = "../") {
  if (/^https?:\/\//i.test(assetPath)) return assetPath;
  return `${prefix}${assetPath}`;
}

function productPagePath(product) {
  return `ofertas/${encodeURIComponent(product.id)}.html`;
}

export async function downloadProductImage(product) {
  if (!product.imageUrl || !/^https?:\/\//i.test(product.imageUrl)) return product.localImagePath || "";
  ensureDir(generatedImagesDir);
  try {
    const res = await fetch(product.imageUrl, { redirect: "follow" });
    if (!res.ok) return product.localImagePath || "";
    const type = res.headers.get("content-type") || "";
    if (!type.startsWith("image/")) return product.localImagePath || "";
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
    const name = `${slugify(product.title || product.id)}.${ext}`;
    const filePath = path.join(generatedImagesDir, name);
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(filePath, buffer);
    return path.relative(rootDir, filePath).replace(/\\/g, "/");
  } catch {
    return product.localImagePath || "";
  }
}

export function productToSiteProduct(product) {
  const storeKey = product.marketplace || "mercadolivre";
  const price = Number.isFinite(Number(product.price)) ? Number(product.price) : 0;
  return {
    id: product.id,
    category: product.category || "geral",
    badge: product.badge || "Achado automatico",
    featured: false,
    title: product.title,
    brand: product.brand || "Selecao automatica",
    description: product.description || `${product.title}. Confira preco, frete e estoque no checkout.`,
    why: product.why || "Produto selecionado automaticamente.",
    image: relativeImagePath(product),
    price,
    oldPrice: product.oldPrice || null,
    store: marketplaceLabel(storeKey),
    storeKey,
    rating: product.rating || null,
    reviewLabel: product.reviewLabel || "captura automatica",
    specs: product.specs || [],
    pros: product.pros || [],
    cons: product.cons || [],
    affiliateUrl: product.affiliateUrl || product.sourceUrl,
    updatedAt: nowIso().slice(0, 10)
  };
}

export async function publishProductToConfig(product) {
  const localImagePath = await downloadProductImage(product);
  const enriched = localImagePath ? upsertProduct({ ...product, localImagePath, status: product.status }) : product;
  const cfg = loadSiteConfig();
  cfg.siteUrl = cfg.siteUrl || config.siteUrl || "";
  cfg.products = Array.isArray(cfg.products) ? cfg.products : [];
  const siteProduct = productToSiteProduct(enriched);
  const index = cfg.products.findIndex((item) => item.id === siteProduct.id);
  if (index >= 0) cfg.products[index] = { ...cfg.products[index], ...siteProduct };
  else cfg.products.unshift(siteProduct);
  saveSiteConfig(cfg);
  markProductPublished(product.id);
  return siteProduct;
}

function renderPostPage(post, product) {
  const cfg = loadSiteConfig();
  const brand = cfg.brand || "Achado Agora";
  const description = cleanText(product.description || post.socialCopy || "");
  const offerHref = `../oferta.html?id=${encodeURIComponent(product.id)}`;
  const imageHref = pageAssetHref(relativeImagePath(product));
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="description" content="${escapeHtml(description.slice(0, 155))}" />
  <meta name="theme-color" content="#09090b" />
  <meta property="og:title" content="${escapeHtml(post.title)}" />
  <meta property="og:image" content="${escapeHtml(imageHref)}" />
  <title>${escapeHtml(post.title)} - ${escapeHtml(brand)}</title>
  <link rel="icon" href="../assets/img/favicon.svg" type="image/svg+xml" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="../assets/styles.css" />
</head>
<body data-page="post">
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
  <main class="page article-wrap">
    <article>
      ${post.html}
      <div class="ad-slot" aria-label="Publicidade" data-ad-slot-key="articleTop" data-ad-format="horizontal"><span>Publicidade</span></div>
      <p><a class="btn primary" href="${escapeHtml(offerHref)}">Ver oferta analisada</a></p>
    </article>
  </main>
  <footer class="site-footer">
    <div>
      <div class="brand">Achado<span>Agora</span></div>
      <p>Selecao editorial com automacao e revisao de qualidade.</p>
    </div>
    <div>
      <ul>
        <li><a href="../comparativos.html">Comparativos</a></li>
        <li><a href="../busca.html">Buscar</a></li>
        <li><a href="../sobre.html">Método</a></li>
      </ul>
    </div>
    <div>
      <ul>
        <li><a href="../privacidade.html">Privacidade</a></li>
        <li><a href="../termos.html">Termos</a></li>
      </ul>
    </div>
  </footer>
  <script src="../assets/config.js"></script>
  <script src="../assets/app.js"></script>
</body>
</html>
`;
}

export function writePostFile(post, product) {
  ensureDir(postsDir);
  const filePath = path.join(postsDir, `${post.slug}.html`);
  fs.writeFileSync(filePath, renderPostPage(post, product), "utf8");
  return path.relative(rootDir, filePath).replace(/\\/g, "/");
}

export async function publishContentPackage(product, contentPackage) {
  const updated = upsertProduct({
    ...product,
    badge: contentPackage.badge || product.badge,
    description: contentPackage.description || product.description,
    why: contentPackage.why || product.why,
    specs: contentPackage.specs?.length ? contentPackage.specs : product.specs,
    pros: contentPackage.pros?.length ? contentPackage.pros : product.pros,
    cons: contentPackage.cons?.length ? contentPackage.cons : product.cons,
    status: "content_ready"
  });
  await publishProductToConfig(updated);
  const post = createOrUpdatePost({
    productId: updated.id,
    type: "offer",
    title: contentPackage.title,
    slug: contentPackage.slug,
    html: contentPackage.articleHtml,
    socialCopy: contentPackage.socialCopy,
    adCopy: contentPackage.adCopy,
    status: "published",
    publishedAt: nowIso()
  });
  const postPath = writePostFile(post, updated);
  updateSitemapAndRobots();
  return { post, postPath };
}

export function updateSitemapAndRobots() {
  const cfg = loadSiteConfig();
  const baseUrl = cfg.siteUrl || config.siteUrl || "";
  const products = Array.isArray(cfg.products) ? cfg.products : [];
  const posts = listPosts(500).filter((post) => post.status === "published");
  const comparisons = listComparisons(500).filter((item) => item.status === "published");
  const urls = [
    "index.html",
    "artigo.html",
    "busca.html",
    "sobre.html",
    "privacidade.html",
    "termos.html",
    ...products.map(productPagePath),
    ...posts.map((post) => `posts/${post.slug}.html`),
    ...(comparisons.length ? ["comparativos.html"] : []),
    ...comparisons.map((item) => `comparativos/${item.slug}.html`)
  ];
  const unique = [...new Set(urls)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${unique.map((url) => `  <url><loc>${xmlEscape(publicUrl(baseUrl, url))}</loc></url>`).join("\n")}
</urlset>
`;
  fs.writeFileSync(path.join(rootDir, "sitemap.xml"), xml, "utf8");
  const sitemapUrl = publicUrl(baseUrl, "sitemap.xml");
  fs.writeFileSync(path.join(rootDir, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${sitemapUrl}\n`, "utf8");
  return { urls: unique, sitemapUrl };
}

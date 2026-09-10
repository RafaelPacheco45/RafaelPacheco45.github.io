import fs from "node:fs";
import path from "node:path";
import { config, rootDir } from "./config.js";
import { createOrUpdateComparison, getComparisonByQuery, listComparisons } from "./db.js";
import { affiliateUrl } from "./lib/affiliate.js";
import { loadSiteConfig } from "./sitePublisher.js";
import { asJson, ensureDir, escapeHtml, nowIso, publicUrl } from "./lib/utils.js";

const comparisonsDir = path.join(rootDir, "comparativos");
const comparisonsIndexPath = path.join(rootDir, "assets", "comparisons-index.json");
const comparisonsIndexPagePath = path.join(rootDir, "comparativos.html");

function marketplaceLabel(key) {
  if (key === "mercadolivre") return "Mercado Livre";
  if (key === "amazon") return "Amazon";
  if (key === "shopee") return "Shopee";
  return key || "Loja";
}

function formatBRL(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value || 0));
}

function listItems(items) {
  return (items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

function discountPct(item) {
  if (!item.oldPrice || item.oldPrice <= item.price) return 0;
  return Math.round((1 - item.price / item.oldPrice) * 100);
}

function priceCeilingLabel(items) {
  const max = Math.max(...items.map((item) => Number(item.price) || 0));
  if (!Number.isFinite(max) || max <= 0) return "";
  const step = max >= 1000 ? 100 : max >= 200 ? 50 : 10;
  const rounded = Math.ceil(max / step) * step;
  return formatBRL(rounded);
}

function storeBadge(marketplace) {
  const label = marketplaceLabel(marketplace);
  const initials = label.slice(0, 2).toUpperCase();
  return `<span class="store-chip store-chip-${escapeHtml(marketplace || "")}">${escapeHtml(initials)}</span> ${escapeHtml(label)}`;
}

function comparisonPagePath(comparison) {
  return `comparativos/${encodeURIComponent(comparison.slug)}.html`;
}

function pageChromeHead(title, description, brand, prefix = "") {
  return `
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="description" content="${escapeHtml(description.slice(0, 155))}" />
  <meta name="theme-color" content="#09090b" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:type" content="article" />
  <title>${escapeHtml(title)} - ${escapeHtml(brand)}</title>
  <link rel="icon" href="${prefix}assets/img/favicon.svg" type="image/svg+xml" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet" />
  <link rel="stylesheet" href="${prefix}assets/styles.css" />`;
}

function topbar(prefix, activeHref = "") {
  const link = (href, label) => `<a href="${prefix}${href}"${activeHref === href ? ' aria-current="page"' : ""}>${label}</a>`;
  return `
  <header class="topbar">
    <div class="topbar-inner">
      <a class="brand" href="${prefix}index.html">Achado<span>Agora</span></a>
      <nav class="nav-links" id="navLinks">
        ${link("index.html#ofertas", "Ofertas")}
        ${link("comparativos.html", "Comparativos")}
        ${link("busca.html", "Buscar")}
        ${link("sobre.html", "Método")}
      </nav>
      <button class="menu-btn" id="menuBtn" type="button" aria-expanded="false" aria-controls="navLinks">Menu</button>
    </div>
  </header>`;
}

function footer(prefix) {
  return `
  <footer class="site-footer">
    <div>
      <div class="brand">Achado<span>Agora</span></div>
      <p>Comparativo automatico com dados e reviews reais.</p>
    </div>
    <div>
      <ul>
        <li><a href="${prefix}index.html#ofertas">Ofertas</a></li>
        <li><a href="${prefix}comparativos.html">Comparativos</a></li>
        <li><a href="${prefix}busca.html">Buscar</a></li>
        <li><a href="${prefix}sobre.html">Método</a></li>
      </ul>
    </div>
    <div>
      <ul>
        <li><a href="${prefix}privacidade.html">Privacidade</a></li>
        <li><a href="${prefix}termos.html">Termos</a></li>
      </ul>
    </div>
  </footer>
  <div class="cookie" id="cookieBox" role="dialog" aria-label="Cookies">
    <p>Cookies para medir campanhas. <a href="${prefix}privacidade.html">Privacidade</a>.</p>
    <div class="cookie-actions"><button class="btn primary" id="cookieOk" type="button">Ok</button></div>
  </div>
  <script src="${prefix}assets/config.js"></script>
  <script src="${prefix}assets/app.js"></script>`;
}

function heroCard(item, siteConfig) {
  const store = marketplaceLabel(item.marketplace);
  const affHref = affiliateUrl({ ...item, storeKey: item.marketplace }, siteConfig);
  const href = affHref || item.sourceUrl || "";
  const legalMeta = affHref ? "" : "Link direto para o anúncio no marketplace.";
  const off = discountPct(item);
  return `
    <section class="deal comparison-hero-deal">
      <div class="deal-visual">
        ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" loading="lazy">` : ""}
      </div>
      <aside class="deal-panel">
        <span class="badge badge-crown">🏆 Melhor custo-benefício</span>
        <h2>${escapeHtml(item.title)}</h2>
        ${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ""}
        <div class="meta-line">
          <span>${storeBadge(item.marketplace)}</span>
          ${item.rating ? `<span>★ ${escapeHtml(String(item.rating))}</span>` : ""}
          ${item.reviewLabel ? `<span>${escapeHtml(item.reviewLabel)}</span>` : ""}
        </div>
        <div class="price-row">
          <strong class="price">${formatBRL(item.price)}</strong>
          ${item.oldPrice ? `<span class="old">${formatBRL(item.oldPrice)}</span>` : ""}
          ${off ? `<span class="off">-${off}%</span>` : ""}
        </div>
        <div class="hero-actions">
          <a class="btn primary affiliate-link" data-product="${escapeHtml(item.productId)}" href="${escapeHtml(href || "#")}" target="_blank" rel="sponsored nofollow noopener">Abrir no ${escapeHtml(store)}</a>
          <a class="btn ghost" href="#ranking">Ver análise detalhada</a>
        </div>
        ${legalMeta ? `<p class="legal-meta">${legalMeta}</p>` : ""}
      </aside>
    </section>`;
}

function rankingStripItem(item) {
  const off = discountPct(item);
  return `
      <a class="ranking-item" href="#detalhe-${item.rank}">
        <span class="ranking-item-pos">${item.rank}º</span>
        ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" loading="lazy">` : `<span class="ranking-item-noimg"></span>`}
        <span class="ranking-item-body">
          <strong>${escapeHtml(item.title)}</strong>
          <small>${storeBadge(item.marketplace)}</small>
        </span>
        <span class="ranking-item-price">
          ${formatBRL(item.price)}
          ${off ? `<em>-${off}%</em>` : ""}
        </span>
        <span class="ranking-item-chevron" aria-hidden="true">›</span>
      </a>`;
}

function rankDetailCard(item, siteConfig) {
  const isWinner = item.rank === 1;
  const store = marketplaceLabel(item.marketplace);
  const affHref = isWinner ? affiliateUrl({ ...item, storeKey: item.marketplace }, siteConfig) : "";
  const href = affHref || (isWinner ? item.sourceUrl : "") || "";
  const legalMeta = affHref ? "" : "Link direto para o anúncio no marketplace.";
  const cta = isWinner
    ? `<p><a class="btn primary full affiliate-link" data-product="${escapeHtml(item.productId)}" href="${escapeHtml(href || "#")}" target="_blank" rel="sponsored nofollow noopener">Ver oferta no ${escapeHtml(store)}</a></p>
       ${legalMeta ? `<p class="legal-meta">${legalMeta}</p>` : ""}`
    : `<p class="legal-meta">Disponível no ${escapeHtml(store)}. Comparação apenas informativa - não enviamos link direto para este item.</p>`;
  const badgeText = isWinner ? `#1 · Melhor escolha` : `#${item.rank}`;
  return `
      <article class="rank-card rank-${item.rank}" id="detalhe-${item.rank}">
        <div class="rank-card-media">
          <span class="rank-badge">${escapeHtml(badgeText)}</span>
          ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" loading="lazy">` : ""}
        </div>
        <div class="rank-card-body">
          <h2>${escapeHtml(item.title)}</h2>
          <div class="meta-line">
            <span>${escapeHtml(store)}</span>
            ${item.reviewLabel ? `<span>${escapeHtml(item.reviewLabel)}</span>` : ""}
            ${item.rating ? `<span>★ ${escapeHtml(String(item.rating))}</span>` : ""}
          </div>
          <div class="price-row"><strong class="price">${formatBRL(item.price)}</strong></div>
          ${item.summary ? `<p>${escapeHtml(item.summary)}</p>` : ""}
          ${item.reviewQuote ? `<blockquote class="review-quote">&ldquo;${escapeHtml(item.reviewQuote)}&rdquo;</blockquote>` : ""}
          <div class="procon-grid">
            <div>
              <h3>Pontos fortes</h3>
              <ul class="spec-list">${listItems(item.pros)}</ul>
            </div>
            ${item.cons.length ? `<div><h3>Pontos de atenção</h3><ul class="spec-list procon">${listItems(item.cons)}</ul></div>` : ""}
          </div>
          ${cta}
        </div>
      </article>`;
}

export function renderComparisonPage(comparison, siteConfig, siteUrl) {
  const brand = siteConfig.brand || "Achado Agora";
  const canonical = publicUrl(siteUrl, comparisonPagePath(comparison));
  const items = [...comparison.items].sort((a, b) => a.rank - b.rank);
  const itemListJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: comparison.title,
    itemListElement: items.map((item) => ({
      "@type": "ListItem",
      position: item.rank,
      name: item.title,
      url: item.sourceUrl
    }))
  };
  const detailCardsHtml = [
    rankDetailCard(items[0], siteConfig),
    `<div class="ad-slot" aria-label="Publicidade" data-ad-slot-key="comparisonTop" data-ad-format="horizontal"><span>Publicidade</span></div>`,
    rankDetailCard(items[1], siteConfig),
    rankDetailCard(items[2], siteConfig),
    `<div class="ad-slot" aria-label="Publicidade" data-ad-slot-key="comparisonBottom" data-ad-format="horizontal"><span>Publicidade</span></div>`
  ].join("\n");

  return `<!doctype html>
<html lang="pt-BR">
<head>${pageChromeHead(comparison.title, comparison.intro || comparison.title, brand, "../")}
  <link rel="canonical" href="${escapeHtml(canonical)}" />
  <script type="application/ld+json" data-aa-jsonld="comparison">${asJson(itemListJsonLd).replace(/</g, "\\u003c")}</script>
</head>
<body data-page="comparativo">
  ${topbar("../")}
  <main class="page comparison-wrap">
    <p class="eyebrow">Comparativo automático · atualizado em ${escapeHtml((comparison.updatedAt || "").slice(0, 10))}</p>
    <h1>${escapeHtml(comparison.title)}</h1>
    <p class="lead">${escapeHtml(comparison.intro)}</p>
    <script type="application/json" data-aa-comparison="1">${asJson(items).replace(/</g, "\\u003c")}</script>

    ${heroCard(items[0], siteConfig)}

    <div class="ad-slot" aria-label="Publicidade" data-ad-slot-key="comparisonMiddle" data-ad-format="horizontal"><span>Publicidade</span></div>

    <section class="ranking-section" id="ranking">
      <div class="section-head">
        <div>
          <span class="pill">🏆 Ranking</span>
          <h2>Melhores opções${priceCeilingLabel(items) ? ` até ${priceCeilingLabel(items)}` : ""}</h2>
        </div>
        <a class="link-more" href="#detalhe-1">Ver comparativo completo →</a>
      </div>
      <div class="ranking-strip">
        ${items.map(rankingStripItem).join("")}
      </div>
    </section>

    <div class="rank-list article-wrap">
      ${detailCardsHtml}
    </div>
    <div class="notice article-wrap">${escapeHtml(comparison.conclusion)}</div>
  </main>
  ${footer("../")}
</body>
</html>
`;
}

const HEART_ICON_SVG = `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/></svg>`;

function comparisonIndexCard(comparison) {
  const winner = comparison.items.find((item) => item.rank === 1) || comparison.items[0];
  if (!winner) return "";
  return `
      <article class="product-card">
        <button type="button" class="fav-btn" data-fav-toggle="${escapeHtml(comparison.slug)}" aria-pressed="false" aria-label="Favoritar comparativo">${HEART_ICON_SVG}</button>
        <a class="product-art" href="comparativos/${encodeURIComponent(comparison.slug)}.html">
          <span class="badge">Comparativo</span>
          ${winner.imageUrl ? `<img src="${escapeHtml(winner.imageUrl)}" alt="${escapeHtml(comparison.title)}" width="400" height="300" loading="lazy">` : ""}
        </a>
        <div class="product-body">
          <span class="category">${escapeHtml(comparison.category)}</span>
          <h3><a href="comparativos/${encodeURIComponent(comparison.slug)}.html">${escapeHtml(comparison.title)}</a></h3>
          <p>${escapeHtml(comparison.intro || "")}</p>
          <div class="price-row"><strong class="price">${formatBRL(winner.price)}</strong></div>
        </div>
      </article>`;
}

export function renderComparisonsIndexPage(comparisons, siteConfig) {
  const brand = siteConfig.brand || "Achado Agora";
  const title = "Comparativos";
  const cards = comparisons.map(comparisonIndexCard).join("");
  return `<!doctype html>
<html lang="pt-BR">
<head>${pageChromeHead(title, "Comparativos automaticos com preco e reviews reais de compradores.", brand)}
</head>
<body data-page="comparativos-index">
  ${topbar("", "comparativos.html")}
  <main class="page">
    <section class="section" id="comparativos">
      <div class="section-head">
        <div>
          <p class="eyebrow">Comparativos</p>
          <h2>Comparamos preço e reviews reais para você</h2>
        </div>
      </div>
      <section class="ad-slot ad-slot-wide" aria-label="Publicidade" data-ad-slot-key="comparativosTop" data-ad-format="horizontal">
        <span>Publicidade</span>
        <small>Espaço para rede display.</small>
      </section>
      <div class="grid">
        ${cards || `<div class="empty">Ainda não publicamos comparativos. Volte em breve.</div>`}
      </div>
      <section class="ad-slot ad-slot-wide" aria-label="Publicidade" data-ad-slot-key="comparativosBottom" data-ad-format="horizontal">
        <span>Publicidade</span>
        <small>Espaço para rede display.</small>
      </section>
    </section>
  </main>
  ${footer("")}
</body>
</html>
`;
}

function writeComparisonsIndexAssets(siteConfig) {
  const published = listComparisons(500).filter((item) => item.status === "published");
  ensureDir(path.dirname(comparisonsIndexPath));
  const indexJson = published.map((comparison) => {
    const winner = comparison.items.find((item) => item.rank === 1) || comparison.items[0] || {};
    return {
      query: comparison.query,
      slug: comparison.slug,
      title: comparison.title,
      category: comparison.category,
      updatedAt: comparison.updatedAt,
      image: winner.imageUrl || "",
      price: winner.price || null,
      rating: winner.rating || null,
      store: winner.marketplace || ""
    };
  });
  fs.writeFileSync(comparisonsIndexPath, JSON.stringify(indexJson, null, 2), "utf8");
  fs.writeFileSync(comparisonsIndexPagePath, renderComparisonsIndexPage(published, siteConfig), "utf8");
  return published.length;
}

export function publishComparison({ query, category, contentPackage }) {
  const cfg = loadSiteConfig();
  const previous = getComparisonByQuery(query);
  const comparison = createOrUpdateComparison({
    query,
    slug: contentPackage.slug,
    title: contentPackage.title,
    category: category || contentPackage.category || "geral",
    intro: contentPackage.intro,
    conclusion: contentPackage.conclusion,
    socialCopy: contentPackage.socialCopy,
    items: contentPackage.items,
    status: "published",
    publishedAt: nowIso()
  });
  const siteUrl = cfg.siteUrl || config.siteUrl || "";
  ensureDir(comparisonsDir);
  if (previous && previous.slug && previous.slug !== comparison.slug) {
    const stalePath = path.join(comparisonsDir, `${previous.slug}.html`);
    fs.rmSync(stalePath, { force: true });
  }
  const filePath = path.join(comparisonsDir, `${comparison.slug}.html`);
  fs.writeFileSync(filePath, renderComparisonPage(comparison, cfg, siteUrl), "utf8");
  writeComparisonsIndexAssets(cfg);
  return { comparison, comparisonPath: path.relative(rootDir, filePath).replace(/\\/g, "/") };
}

export function rebuildComparisonsIndex() {
  const cfg = loadSiteConfig();
  return writeComparisonsIndexAssets(cfg);
}

export { comparisonPagePath };

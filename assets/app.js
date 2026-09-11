(function () {
  const cfg = window.SITE_CONFIG || { products: [] };
  const products = Array.isArray(cfg.products) ? cfg.products : [];

  function publicApiUrl(pathname) {
    const base = String(cfg.searchApiBase || "").trim().replace(/\/+$/, "");
    return base ? `${base}${pathname}` : pathname;
  }

  const qs = new URLSearchParams(location.search);
  const attribution = {
    utm_source: qs.get("utm_source") || "",
    utm_medium: qs.get("utm_medium") || "",
    utm_campaign: qs.get("utm_campaign") || "",
    utm_content: qs.get("utm_content") || ""
  };
  if (Object.values(attribution).some(Boolean)) {
    localStorage.setItem("last_attribution", JSON.stringify(attribution));
  }
  const lastAttribution = () => {
    try { return JSON.parse(localStorage.getItem("last_attribution") || "{}"); }
    catch { return {}; }
  };

  window.dataLayer = window.dataLayer || [];
  function track(name, params, options = {}) {
    const payload = { event: name, ...params };
    window.dataLayer.push(payload);
    if (window.gtag && options.gtag !== false) window.gtag("event", name, params || {});
    if (window.fbq) window.fbq("trackCustom", name, params || {});
    console.info("[track]", name, params);
  }

  let trackingLoaded = false;
  function hasCookieConsent() {
    try { return localStorage.getItem("aa_cookie_ok") === "1"; }
    catch { return false; }
  }

  function loadTracking() {
    if (trackingLoaded || !hasCookieConsent()) return;
    trackingLoaded = true;
    if (cfg.ga4MeasurementId) {
      const s = document.createElement("script");
      s.async = true;
      s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(cfg.ga4MeasurementId);
      document.head.appendChild(s);
      window.dataLayer.push(["js", new Date()]);
      window.gtag = function () { window.dataLayer.push(arguments); };
      window.gtag("js", new Date());
      window.gtag("config", cfg.ga4MeasurementId);
    }
    if (cfg.metaPixelId) {
      !function (f, b, e, v, n, t, s) {
        if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
        if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = [];
        t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0];
        s.parentNode.insertBefore(t, s);
      }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
      window.fbq("init", cfg.metaPixelId);
      window.fbq("track", "PageView");
    }
  }

  const FAV_KEY = "aa_favorites";
  function getFavorites() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY) || "[]"); }
    catch { return []; }
  }
  function isFavorite(id) {
    return getFavorites().includes(String(id));
  }
  function toggleFavorite(id) {
    const key = String(id);
    const list = getFavorites();
    const idx = list.indexOf(key);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(key);
    try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch {}
    return list.includes(key);
  }
  const heartIconSVG = `<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/></svg>`;
  function favButtonHTML(id, label) {
    const active = isFavorite(id);
    return `<button type="button" class="fav-btn${active ? " is-active" : ""}" data-fav-toggle="${escapeHtml(id)}" aria-pressed="${active}" aria-label="${escapeHtml(label || "Favoritar")}">${heartIconSVG}</button>`;
  }
  function refreshFavButtons(root = document) {
    root.querySelectorAll("[data-fav-toggle]").forEach((btn) => {
      const active = isFavorite(btn.dataset.favToggle);
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }
  function setupFavoriteButtons() {
    document.addEventListener("click", (ev) => {
      const btn = ev.target.closest("[data-fav-toggle]");
      if (!btn) return;
      ev.preventDefault();
      ev.stopPropagation();
      const active = toggleFavorite(btn.dataset.favToggle);
      track("favorite_toggle", { id: btn.dataset.favToggle, active });
      refreshFavButtons(document);
    });
  }

  const PROFILE_KEY = "aa_profile";
  function getProfile() {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || "null"); }
    catch { return null; }
  }
  function saveProfile(name) {
    const profile = { name: String(name || "").trim(), createdAt: new Date().toISOString() };
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch {}
    return profile;
  }
  function clearProfile() {
    try { localStorage.removeItem(PROFILE_KEY); } catch {}
  }

  function adsenseClient() {
    return String(cfg.adsenseClient || "").trim();
  }

  function validAdsenseClient(client) {
    return /^ca-pub-\d+$/i.test(client);
  }

  function loadDisplayAds() {
    const slots = Array.from(document.querySelectorAll(".ad-slot"));
    if (!slots.length) return;

    const client = adsenseClient();
    if (!client) {
      slots.forEach((slot) => slot.classList.add("ad-slot-pending"));
      return;
    }
    if (!validAdsenseClient(client)) {
      slots.forEach((slot) => {
        slot.classList.add("ad-slot-error");
        slot.innerHTML = "<span>Publicidade</span><small>AdSense Client invalido. Use ca-pub-0000000000000000.</small>";
      });
      return;
    }

    if (!document.querySelector("script[data-aa-adsense]")) {
      const s = document.createElement("script");
      s.async = true;
      s.crossOrigin = "anonymous";
      s.dataset.aaAdsense = "1";
      s.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(client);
      document.head.appendChild(s);
    }

    const slotsByKey = cfg.adsenseSlots && typeof cfg.adsenseSlots === "object" ? cfg.adsenseSlots : {};
    const defaultSlot = String(cfg.adsenseAdSlot || cfg.adsenseSlot || slotsByKey.display || "").trim();
    slots.forEach((slot) => {
      const slotKey = String(slot.dataset.adSlotKey || "").trim();
      const keyedSlot = slotKey ? slotsByKey[slotKey] : "";
      const adSlot = String(slot.dataset.adSlot || keyedSlot || defaultSlot || "").trim();
      if (!adSlot) {
        slot.hidden = true;
        slot.setAttribute("aria-hidden", "true");
        return;
      }

      slot.hidden = false;
      slot.removeAttribute("aria-hidden");
      slot.classList.add("ad-slot-live");
      slot.innerHTML = "";

      const label = document.createElement("span");
      label.className = "ad-label";
      label.textContent = "Publicidade";
      slot.appendChild(label);

      const ins = document.createElement("ins");
      ins.className = "adsbygoogle";
      ins.style.display = "block";
      ins.dataset.adClient = client;
      ins.dataset.adSlot = adSlot;
      ins.dataset.adFormat = slot.dataset.adFormat || "auto";
      ins.dataset.fullWidthResponsive = "true";
      slot.appendChild(ins);
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (error) {
        console.warn("[adsense]", error.message);
      }
    });
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
  }

  function formatBRL(n) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(n);
  }

  function discount(p) {
    if (!p.oldPrice || p.oldPrice <= p.price) return 0;
    return Math.round((1 - p.price / p.oldPrice) * 100);
  }

  function productById(id) {
    return products.find((p) => p.id === id);
  }

  function productPageHref(product, options = {}) {
    const id = encodeURIComponent(product.id);
    if (cfg.staticProductPages) {
      const base = String(cfg.staticProductPagesBase || "ofertas").replace(/^\/+|\/+$/g, "") || "ofertas";
      const path = `/${base}/${id}.html`;
      if (options.absolute && cfg.siteUrl) return String(cfg.siteUrl).replace(/\/+$/, "") + path;
      return path;
    }
    const path = `oferta.html?id=${id}`;
    if (options.absolute && cfg.siteUrl) return String(cfg.siteUrl).replace(/\/+$/, "") + "/" + path;
    return path;
  }

  function assetHref(assetPath) {
    if (/^https?:\/\//i.test(String(assetPath || ""))) return assetPath;
    if (cfg.staticProductPages) return "/" + String(assetPath || "").replace(/^\/+/, "");
    return assetPath;
  }

  function absoluteAssetHref(assetPath) {
    const href = assetHref(assetPath);
    if (/^https?:\/\//i.test(href) || !cfg.siteUrl) return href;
    return String(cfg.siteUrl).replace(/\/+$/, "") + "/" + href.replace(/^\/+/, "");
  }

  function productEventParams(product) {
    return {
      content_ids: [product.id],
      content_name: product.title,
      content_category: product.category,
      content_type: "product",
      value: product.price || 0,
      currency: "BRL"
    };
  }

  function trackGaItemEvent(name, product) {
    if (!window.gtag) return;
    window.gtag("event", name, {
      currency: "BRL",
      value: product.price || 0,
      items: [{
        item_id: product.id,
        item_name: product.title,
        item_brand: product.brand || product.store,
        item_category: product.category,
        price: product.price || 0,
        quantity: 1
      }]
    });
  }

  function affiliateUrl(product) {
    if (!product || !product.affiliateUrl) return "";
    try {
      const url = new URL(product.affiliateUrl);
      const aff = cfg.affiliates || {};
      if (product.storeKey === "mercadolivre" && /(^|\.)mercadolivre\.com\.br$/i.test(url.hostname)) {
        if (aff.mlMattTool) url.searchParams.set("matt_tool", aff.mlMattTool);
        if (aff.mlMattWord) url.searchParams.set("matt_word", aff.mlMattWord);
      }
      if (product.storeKey === "amazon" && aff.amazonTag) {
        url.searchParams.set("tag", aff.amazonTag);
      }
      return url.toString();
    } catch {
      return product.affiliateUrl;
    }
  }

  function bindAffiliate(el, product) {
    const url = affiliateUrl(product);
    el.classList.add("affiliate-link");
    el.setAttribute("rel", "sponsored nofollow noopener");
    el.setAttribute("target", "_blank");
    if (url) el.setAttribute("href", url);
    else {
      el.setAttribute("href", "#");
      el.setAttribute("aria-disabled", "true");
    }
    el.dataset.product = product.id;
    el.addEventListener("click", (ev) => {
      track("affiliate_click", {
        product: product.id,
        store: product.store,
        value: product.price,
        currency: "BRL",
        attribution: lastAttribution()
      });
      if (window.fbq) window.fbq("track", "Lead", productEventParams(product));
      trackGaItemEvent("select_item", product);
      if (!url) {
        ev.preventDefault();
        alert("Esta oferta ainda não tem link de destino configurado.");
      }
    });
  }

  function cardHTML(p) {
    const off = discount(p);
    const pageHref = productPageHref(p);
    return `
      <article class="product-card" data-category="${escapeHtml(p.category)}" data-id="${escapeHtml(p.id)}">
        ${favButtonHTML(p.id, "Favoritar oferta")}
        <a class="product-art" href="${escapeHtml(pageHref)}">
          ${p.badge ? `<span class="badge">${escapeHtml(p.badge)}</span>` : ""}
          <img src="${escapeHtml(assetHref(p.image))}" alt="${escapeHtml(p.title)}" width="400" height="300" loading="lazy">
        </a>
        <div class="product-body">
          <span class="category">${escapeHtml(p.store)} · ${escapeHtml(p.category)}</span>
          <h3><a href="${escapeHtml(pageHref)}">${escapeHtml(p.title)}</a></h3>
          <p>${escapeHtml(p.description)}</p>
          <div class="price-row">
            <strong class="price">${formatBRL(p.price)}</strong>
            ${p.oldPrice ? `<span class="old">${formatBRL(p.oldPrice)}</span>` : ""}
            ${off ? `<span class="off">-${off}%</span>` : ""}
          </div>
          <div class="product-bottom">
            <small style="color:var(--muted)">${escapeHtml(p.reviewLabel || "")}</small>
            <a class="btn primary" data-cta="${escapeHtml(p.id)}" href="${escapeHtml(affiliateUrl(p) || "#")}">Ver oferta</a>
          </div>
        </div>
      </article>`;
  }

  function renderGrid(list) {
    const grid = document.getElementById("productGrid");
    if (!grid) return;
    if (!list.length) {
      grid.innerHTML = `<div class="empty">Nenhuma oferta nesta seleção. Tente outro filtro ou termo.</div>`;
      return;
    }
    grid.innerHTML = list.map(cardHTML).join("");
    grid.querySelectorAll("[data-cta]").forEach((btn) => {
      const product = productById(btn.dataset.cta);
      if (product) bindAffiliate(btn, product);
    });
  }

  function storeInitials(store) {
    return String(store || "Loja").slice(0, 2).toUpperCase();
  }

  function storeChipHTML(p) {
    return `<span class="store-chip store-chip-${escapeHtml(p.storeKey || "")}">${escapeHtml(storeInitials(p.store))}</span> ${escapeHtml(p.store || "Loja")}`;
  }

  function pickCompareSet(list, n) {
    const pool = list.filter((p) => p.price);
    if (!pool.length) return [];
    const used = new Set();
    const picks = [];
    const best = pool.find((p) => p.featured) || [...pool].sort((a, b) => (b.rating || 0) - (a.rating || 0))[0];
    if (best) { picks.push({ item: best, label: "Melhor escolha" }); used.add(best.id); }
    const cheapest = [...pool].filter((p) => !used.has(p.id) && discount(p) > 0).sort((a, b) => discount(b) - discount(a))[0];
    if (cheapest) { picks.push({ item: cheapest, label: "Ótimo preço" }); used.add(cheapest.id); }
    const topRated = [...pool].filter((p) => !used.has(p.id)).sort((a, b) => (b.rating || 0) - (a.rating || 0))[0];
    if (topRated) { picks.push({ item: topRated, label: "Mais avaliado" }); used.add(topRated.id); }
    for (const p of pool) {
      if (picks.length >= n) break;
      if (used.has(p.id)) continue;
      picks.push({ item: p, label: "Também vale a pena" });
      used.add(p.id);
    }
    return picks.slice(0, n);
  }

  function compareCardHTML(pick, rank, isCheapest) {
    const p = pick.item;
    const off = discount(p);
    const pageHref = productPageHref(p);
    const rankClass = rank === 1 ? " rank-1" : "";
    return `
      <article class="compare-card${rankClass}" data-id="${escapeHtml(p.id)}">
        <span class="compare-rank"><em>${rank}º</em> ${escapeHtml(pick.label)}</span>
        <a class="compare-media" href="${escapeHtml(pageHref)}">
          <img src="${escapeHtml(assetHref(p.image))}" alt="${escapeHtml(p.title)}" width="400" height="300" loading="lazy">
        </a>
        <h3><a href="${escapeHtml(pageHref)}">${escapeHtml(p.title)}</a></h3>
        <span class="compare-store">${storeChipHTML(p)}</span>
        ${p.rating ? `<span class="compare-rating">★ <strong>${escapeHtml(p.rating)}</strong> ${escapeHtml(p.reviewLabel ? "(" + p.reviewLabel + ")" : "")}</span>` : ""}
        <div>
          <span class="compare-price">${formatBRL(p.price)}</span>
        </div>
        ${isCheapest ? `<span class="compare-best">✓ Menor preço da categoria</span>` : ""}
        <a class="btn ${rank === 1 ? "primary" : "outline"}" data-cta="${escapeHtml(p.id)}" href="${escapeHtml(affiliateUrl(p) || "#")}">Ver oferta</a>
      </article>`;
  }

  async function renderComparisonsSection() {
    const grid = document.getElementById("comparativosGrid");
    if (!grid) return;
    try {
      const res = await fetch(assetHref("assets/comparisons-index.json"), { cache: "no-store" });
      if (!res.ok) throw new Error("falha ao carregar comparativos");
      const items = await res.json();
      if (!Array.isArray(items) || !items.length) {
        grid.innerHTML = `<div class="empty">Ainda não publicamos comparativos. Volte em breve.</div>`;
        return;
      }
      const sorted = [...items].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 6);
      grid.innerHTML = sorted.map((item) => `
        <article class="product-card">
          ${favButtonHTML(item.slug, "Favoritar comparativo")}
          <a class="product-art" href="${escapeHtml(assetHref("comparativos/" + item.slug + ".html"))}">
            <span class="badge">Comparativo</span>
            ${item.image ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" width="400" height="300" loading="lazy">` : ""}
          </a>
          <div class="product-body">
            <span class="category">${escapeHtml(item.category || "geral")}</span>
            <h3><a href="${escapeHtml(assetHref("comparativos/" + item.slug + ".html"))}">${escapeHtml(item.title)}</a></h3>
            <div class="comparison-card-footer">
              ${item.price ? `<div class="price-row"><strong class="price">${formatBRL(item.price)}</strong>${item.rating ? `<span>★ ${escapeHtml(item.rating)}</span>` : ""}</div>` : ""}
              <a class="compare-more" href="${escapeHtml(assetHref("comparativos/" + item.slug + ".html"))}">Abrir comparativo →</a>
            </div>
          </div>
        </article>`).join("");
    } catch {
      grid.innerHTML = `<div class="empty">Não foi possível carregar os comparativos agora.</div>`;
    }
  }

  function renderCompareGrid() {
    const grid = document.getElementById("compareGrid");
    if (!grid) return;
    const picks = pickCompareSet(products, 3);
    if (!picks.length) {
      grid.innerHTML = `<div class="empty">Ainda não temos comparativo publicado.</div>`;
      return;
    }
    const cheapestId = [...picks].sort((a, b) => a.item.price - b.item.price)[0].item.id;
    grid.innerHTML = picks.map((pick, i) => compareCardHTML(pick, i + 1, pick.item.id === cheapestId)).join("");
    grid.querySelectorAll("[data-cta]").forEach((btn) => {
      const product = productById(btn.dataset.cta);
      if (product) bindAffiliate(btn, product);
    });
    const title = document.getElementById("compareTitle");
    if (title) title.textContent = `Melhores ofertas para "${picks[0].item.title}"`;
    const subtitle = document.getElementById("compareSubtitle");
    if (subtitle) subtitle.textContent = "Compare os preços nas principais lojas e escolha a melhor opção para você.";
  }

  function setupHeroSearch() {
    document.querySelectorAll(".hero-banner-section .hero-search").forEach((form) => {
      const input = form.querySelector("input[type=search]");
      if (!input) return;
      form.addEventListener("submit", (ev) => {
        ev.preventDefault();
        const q = input.value.trim();
        track("hero_search", { query: q });
        location.href = q ? `busca.html?q=${encodeURIComponent(q)}` : "busca.html";
      });
    });
  }

  function renderDealPage() {
    const root = document.getElementById("dealRoot");
    if (!root) return;
    const id = qs.get("id") || document.body.dataset.productId || "";
    const p = productById(id);
    if (!p) {
      root.innerHTML = `<div class="empty"><h1>Oferta não encontrada</h1><p>Essa vitrine mudou. Veja as ofertas ativas na home.</p><p><a class="btn primary" href="index.html">Voltar às ofertas</a></p></div>`;
      document.title = "Oferta não encontrada — Achado Agora";
      return;
    }
    document.title = p.title + " — Achado Agora";
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute("content", p.description);
    const off = discount(p);
    const viewParams = productEventParams(p);
    track("view_item", { product: p.id, store: p.store, ...viewParams }, { gtag: false });
    if (window.fbq) window.fbq("track", "ViewContent", viewParams);
    trackGaItemEvent("view_item", p);
    root.innerHTML = `
      <section class="deal">
        <div class="deal-visual">
          <img src="${escapeHtml(assetHref(p.image))}" alt="${escapeHtml(p.title)}">
        </div>
        <aside class="deal-panel">
          <p class="eyebrow">${escapeHtml(p.badge || p.category)}</p>
          <h1>${escapeHtml(p.title)}</h1>
          <p>${escapeHtml(p.why || p.description)}</p>
          <div class="meta-line">
            <span>${escapeHtml(p.store)}</span>
            <span>${escapeHtml(p.reviewLabel || "")}</span>
          </div>
          <div class="price-row">
            <strong class="price">${formatBRL(p.price)}</strong>
            ${p.oldPrice ? `<span class="old">${formatBRL(p.oldPrice)}</span>` : ""}
            ${off ? `<span class="off">-${off}%</span>` : ""}
          </div>
          <p class="legal-meta">Preço de referência consultado em ${escapeHtml(p.updatedAt || cfg.priceCheckedOn)}. O valor final é o da loja no checkout.</p>
          <p><a class="btn primary full" data-cta="${escapeHtml(p.id)}" href="${escapeHtml(affiliateUrl(p) || "#")}">Ver oferta no ${escapeHtml(p.store)}</a></p>
        </aside>
      </section>
      <section class="ad-slot" aria-label="Publicidade">
        <span>Publicidade</span>
        <small>Espaço para rede display.</small>
      </section>
      <section class="section">
        <h2>Por que entrou na vitrine</h2>
        <p>${escapeHtml(p.description)}</p>
        <div class="how" style="margin-top:24px">
          <article>
            <h3>Ficha</h3>
            <ul class="spec-list">${(p.specs || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
          </article>
          <article>
            <h3>Vale se</h3>
            <ul class="spec-list">${(p.pros || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
          </article>
          <article>
            <h3>Pense duas vezes se</h3>
            <ul class="spec-list procon">${(p.cons || []).map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ul>
          </article>
        </div>
      </section>
    <section class="related">
        <div class="section-head"><h2>Outras ofertas</h2></div>
        <div class="grid" id="productGrid"></div>
      </section>
      <div class="sticky-cta" aria-label="Atalho para oferta">
        <div>
          <span>Preco ref.</span>
          <strong>${formatBRL(p.price)}</strong>
        </div>
        <a class="btn primary" data-sticky-cta="${escapeHtml(p.id)}" href="${escapeHtml(affiliateUrl(p) || "#")}">Abrir oferta</a>
      </div>`;
    root.querySelectorAll("[data-cta], [data-sticky-cta]").forEach((cta) => bindAffiliate(cta, p));
    renderGrid(products.filter((x) => x.id !== p.id).slice(0, 3));
  }

  function setupFilters() {
    const buttons = document.querySelectorAll("[data-filter]");
    if (!buttons.length) return;
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        buttons.forEach((b) => {
          b.classList.remove("active");
          b.setAttribute("aria-pressed", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");
        const filter = btn.dataset.filter;
        const q = (document.getElementById("searchInput") || {}).value || "";
        applySearch(q, filter);
        track("filter_click", { filter });
      });
    });
  }

  function currentFilter() {
    const active = document.querySelector("[data-filter].active");
    return active ? active.dataset.filter : "todos";
  }

  function applySearch(query, filter) {
    const q = (query || "").trim().toLowerCase();
    const f = filter || currentFilter();
    const list = products.filter((p) => {
      const okCat = f === "todos" || p.category === f;
      const blob = [p.title, p.description, p.brand, p.store, p.category].join(" ").toLowerCase();
      const okQ = !q || blob.includes(q);
      return okCat && okQ;
    });
    renderGrid(list);
  }

  function setupSearch() {
    const form = document.getElementById("searchForm");
    const input = document.getElementById("searchInput");
    if (!input) return;
    const run = () => applySearch(input.value, currentFilter());
    input.addEventListener("input", run);
    if (form) form.addEventListener("submit", (e) => { e.preventDefault(); run(); });
    const q = qs.get("q");
    const cat = qs.get("cat");
    if (cat) {
      document.querySelectorAll("[data-filter]").forEach((b) => {
        const on = b.dataset.filter === cat;
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", String(on));
      });
    }
    if (q) input.value = q;
    if (q || cat) run();
  }

  function slugifyClient(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
  }

  function comparisonCardHTML(item) {
    const href = `comparativos/${encodeURIComponent(item.slug)}.html`;
    return `
      <article class="product-card" data-slug="${escapeHtml(item.slug)}">
        ${favButtonHTML(item.slug, "Favoritar comparativo")}
        <a class="product-art" href="${escapeHtml(href)}">
          <span class="badge">Comparativo</span>
          ${item.image ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" width="400" height="300" loading="lazy">` : ""}
        </a>
        <div class="product-body">
          <span class="category">${escapeHtml(item.category || "")}</span>
          <h3><a href="${escapeHtml(href)}">${escapeHtml(item.title)}</a></h3>
          ${item.price ? `<div class="price-row"><strong class="price">${formatBRL(item.price)}</strong></div>` : ""}
        </div>
      </article>`;
  }

  function searchProductHref(item) {
    return item.affiliateUrl || item.sourceUrl || "#";
  }

  function searchProductCardHTML(item, label) {
    const href = searchProductHref(item);
    const store = item.store || item.marketplace || "Loja";
    const signals = Array.isArray(item.qualitySignals) ? item.qualitySignals.slice(0, 3) : [];
    return `
      <article class="product-card" data-search-product="${escapeHtml(item.id)}">
        ${favButtonHTML(item.id, "Favoritar oferta")}
        <a class="product-art" href="${escapeHtml(href)}" target="_blank" rel="sponsored nofollow noopener">
          <span class="badge">${escapeHtml(label)}</span>
          ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" width="400" height="300" loading="lazy">` : ""}
        </a>
        <div class="product-body">
          <span class="category">${escapeHtml(store)} · score ${escapeHtml(item.score || "")}</span>
          <h3><a href="${escapeHtml(href)}" data-shopping-cta="${escapeHtml(item.id)}" target="_blank" rel="sponsored nofollow noopener">${escapeHtml(item.title)}</a></h3>
          <p>${escapeHtml(item.why || item.description || item.selectionReason || "")}</p>
          <div class="price-row">
            ${item.price ? `<strong class="price">${formatBRL(item.price)}</strong>` : `<strong class="price">Ver preço</strong>`}
            ${item.rating ? `<span>★ ${escapeHtml(item.rating)}</span>` : ""}
          </div>
          <div class="product-bottom">
            <small style="color:var(--muted)">${escapeHtml(signals.join(" · ") || item.reviewLabel || "")}</small>
            <a class="btn primary${item.affiliateUrl ? " affiliate-link" : ""}" data-shopping-cta="${escapeHtml(item.id)}" href="${escapeHtml(href)}" target="_blank" rel="sponsored nofollow noopener">Ver oferta</a>
          </div>
        </div>
      </article>`;
  }

  function bindShoppingResultLinks(root, items) {
    const byId = new Map(items.map((item) => [String(item.id), item]));
    root.querySelectorAll("[data-shopping-cta]").forEach((el) => {
      const item = byId.get(String(el.dataset.shoppingCta));
      if (!item) return;
      el.addEventListener("click", (ev) => {
        const href = searchProductHref(item);
        track(item.affiliateUrl ? "affiliate_click" : "marketplace_click", {
          product: item.id,
          store: item.store || item.marketplace,
          value: item.price || 0,
          currency: "BRL",
          source: "shopping_search",
          attribution: lastAttribution()
        });
        if (!href || href === "#") {
          ev.preventDefault();
          alert("Ainda não temos link seguro para esta oferta.");
        }
      });
    });
  }

  function renderShoppingSearchResult(data, query) {
    const grid = document.getElementById("buscaGrid");
    const empty = document.getElementById("buscaEmpty");
    const title = document.getElementById("buscaResultadosTitle");
    if (!grid) return false;
    const cards = [];
    const productsForTracking = [];
    if (data.recommendation) {
      cards.push(searchProductCardHTML(data.recommendation, "Melhor escolha"));
      productsForTracking.push(data.recommendation);
    }
    if (data.cheapest && (!data.recommendation || data.cheapest.id !== data.recommendation.id)) {
      cards.push(searchProductCardHTML(data.cheapest, "Menor preço"));
      productsForTracking.push(data.cheapest);
    }
    (data.alternatives || []).slice(0, 4).forEach((item, index) => {
      cards.push(searchProductCardHTML(item, index === 0 ? "Alternativa" : "Opção"));
      productsForTracking.push(item);
    });
    if (data.comparison) {
      cards.push(comparisonCardHTML(data.comparison));
    }
    if (!cards.length) return false;
    if (empty) empty.hidden = true;
    if (title) {
      title.textContent = data.mode === "live"
        ? `Melhores opções encontradas para "${query}"`
        : `Resultados salvos para "${query}"`;
    }
    grid.innerHTML = cards.join("");
    bindShoppingResultLinks(grid, productsForTracking);
    return true;
  }

  let comparisonsIndexCache = null;
  async function loadComparisonsIndex() {
    if (comparisonsIndexCache) return comparisonsIndexCache;
    try {
      const res = await fetch("assets/comparisons-index.json", { cache: "no-store" });
      comparisonsIndexCache = res.ok ? await res.json() : [];
    } catch {
      comparisonsIndexCache = [];
    }
    return comparisonsIndexCache;
  }

  function renderBuscaResults(list, query) {
    const grid = document.getElementById("buscaGrid");
    const empty = document.getElementById("buscaEmpty");
    const title = document.getElementById("buscaResultadosTitle");
    if (!grid) return;
    if (!list.length) {
      grid.innerHTML = "";
      if (empty) empty.hidden = false;
      if (title) title.textContent = query ? `Nada encontrado para "${query}"` : "Comparativos publicados";
      return;
    }
    if (empty) empty.hidden = true;
    if (title) title.textContent = query ? `Resultados para "${query}"` : "Comparativos publicados";
    grid.innerHTML = list.map(comparisonCardHTML).join("");
  }

  async function setupBuscaPage() {
    const form = document.getElementById("buscaForm");
    const input = document.getElementById("buscaInput");
    if (!input) return;
    const index = await loadComparisonsIndex();

    const FILTERS_KEY = "aa_search_preferences_v2";
    const LEGACY_FILTERS_KEY = "aa_saved_filters";
    const categorySelect = document.getElementById("filterCategoria");
    const prioritySelect = document.getElementById("filterPrioridade");
    const priceMinInput = document.getElementById("filterPrecoMin");
    const priceMaxInput = document.getElementById("filterPrecoMax");
    const minRatingSelect = document.getElementById("filterNotaMin");
    const storeChecks = Array.from(document.querySelectorAll("#buscaFilters .filter-stores input[type=checkbox]"));
    const saveBtn = document.getElementById("filterSaveBtn");
    const clearBtn = document.getElementById("filterClearBtn");
    const savedHint = document.getElementById("filterSavedHint");

    if (categorySelect) {
      const categories = Array.from(new Set(index.map((item) => item.category).filter(Boolean))).sort();
      categorySelect.innerHTML = `<option value="">Todas as categorias</option>` +
        categories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    }

    function readFilterState() {
      return {
        category: categorySelect ? categorySelect.value : "",
        priority: prioritySelect ? prioritySelect.value : "balanced",
        priceMin: priceMinInput && priceMinInput.value !== "" ? Number(priceMinInput.value) : null,
        priceMax: priceMaxInput && priceMaxInput.value !== "" ? Number(priceMaxInput.value) : null,
        minRating: minRatingSelect && minRatingSelect.value !== "" ? Number(minRatingSelect.value) : null,
        stores: storeChecks.filter((c) => c.checked).map((c) => c.value)
      };
    }

    function applyFilterState(state) {
      if (!state) return;
      if (categorySelect) categorySelect.value = state.category || "";
      if (prioritySelect) prioritySelect.value = state.priority || "balanced";
      if (priceMinInput && state.priceMin !== undefined && state.priceMin !== null) priceMinInput.value = state.priceMin;
      if (priceMaxInput && state.priceMax !== undefined && state.priceMax !== null) priceMaxInput.value = state.priceMax;
      if (minRatingSelect && state.minRating !== undefined && state.minRating !== null) minRatingSelect.value = state.minRating;
      if (Array.isArray(state.stores) && storeChecks.length) {
        storeChecks.forEach((c) => { c.checked = state.stores.includes(c.value); });
      }
    }

    function loadSavedFilters() {
      try {
        return JSON.parse(localStorage.getItem(FILTERS_KEY) || localStorage.getItem(LEGACY_FILTERS_KEY) || "null");
      }
      catch { return null; }
    }

    function reviewVolume(item) {
      const raw = String(item.reviewLabel || "").toLowerCase();
      const match = raw.match(/(\d+(?:[.,]\d+)?)\s*(mil|k)?/i);
      if (!match) return 0;
      const value = Number(match[1].replace(/\./g, "").replace(",", "."));
      return Number.isFinite(value) ? value * (match[2] ? 1000 : 1) : 0;
    }

    function applyControlFilters(list) {
      const state = readFilterState();
      const filtered = list.filter((item) => {
        if (state.category && item.category !== state.category) return false;
        if (state.priceMin !== null && Number.isFinite(state.priceMin) && (item.price || 0) < state.priceMin) return false;
        if (state.priceMax !== null && Number.isFinite(state.priceMax) && (!item.price || item.price > state.priceMax)) return false;
        if (state.minRating !== null && Number.isFinite(state.minRating) && (!item.rating || item.rating < state.minRating)) return false;
        if (state.stores.length && storeChecks.length && !state.stores.includes(item.store || "mercadolivre")) return false;
        return true;
      });
      return [...filtered].sort((a, b) => {
        if (state.priority === "lowest_price") return (a.price || Number.MAX_SAFE_INTEGER) - (b.price || Number.MAX_SAFE_INTEGER);
        if (state.priority === "top_rated") return (b.rating || 0) - (a.rating || 0) || (a.price || Number.MAX_SAFE_INTEGER) - (b.price || Number.MAX_SAFE_INTEGER);
        if (state.priority === "most_popular") return reviewVolume(b) - reviewVolume(a) || (b.rating || 0) - (a.rating || 0);
        return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
      });
    }

    function filterList(q) {
      const needle = q.trim().toLowerCase();
      const base = needle
        ? index.filter((item) => `${item.title} ${item.query} ${item.category}`.toLowerCase().includes(needle))
        : index;
      return applyControlFilters(base);
    }

    function updatePreferenceSummary() {
      const target = document.getElementById("activePreferencesSummary");
      if (!target) return;
      const state = readFilterState();
      const labels = {
        balanced: "melhor equilíbrio",
        lowest_price: "menor preço",
        top_rated: "melhor avaliação",
        most_popular: "mais popular"
      };
      const parts = [`Prioridade: ${labels[state.priority] || labels.balanced}`];
      if (state.category) parts.push(`categoria ${state.category}`);
      if (state.priceMin !== null) parts.push(`a partir de ${formatBRL(state.priceMin)}`);
      if (state.priceMax !== null) parts.push(`até ${formatBRL(state.priceMax)}`);
      if (state.minRating !== null) parts.push(`nota mínima ${String(state.minRating).replace(".", ",")}`);
      target.textContent = `${parts.join(" · ")}.`;
    }

    function refreshResults() {
      updatePreferenceSummary();
      renderBuscaResults(filterList(input.value), input.value.trim());
    }

    const savedFilters = loadSavedFilters();
    if (savedFilters) {
      applyFilterState(savedFilters);
      if (savedHint) {
        savedHint.textContent = "Suas preferências salvas estão ativas.";
        savedHint.classList.add("is-saved");
      }
    }

    updatePreferenceSummary();
    renderBuscaResults(filterList(input.value), "");

    input.addEventListener("input", refreshResults);
    if (categorySelect) categorySelect.addEventListener("change", refreshResults);
    if (prioritySelect) prioritySelect.addEventListener("change", refreshResults);
    if (priceMinInput) priceMinInput.addEventListener("input", refreshResults);
    if (priceMaxInput) priceMaxInput.addEventListener("input", refreshResults);
    if (minRatingSelect) minRatingSelect.addEventListener("change", refreshResults);
    storeChecks.forEach((c) => c.addEventListener("change", () => {
      if (!storeChecks.some((item) => item.checked)) c.checked = true;
      refreshResults();
    }));

    if (saveBtn) saveBtn.addEventListener("click", () => {
      localStorage.setItem(FILTERS_KEY, JSON.stringify(readFilterState()));
      localStorage.removeItem(LEGACY_FILTERS_KEY);
      if (savedHint) {
        savedHint.textContent = "Preferências salvas neste dispositivo.";
        savedHint.classList.add("is-saved");
      }
      track("filter_save", readFilterState());
    });
    if (clearBtn) clearBtn.addEventListener("click", () => {
      localStorage.removeItem(FILTERS_KEY);
      localStorage.removeItem(LEGACY_FILTERS_KEY);
      if (categorySelect) categorySelect.value = "";
      if (prioritySelect) prioritySelect.value = "balanced";
      if (priceMinInput) priceMinInput.value = "";
      if (priceMaxInput) priceMaxInput.value = "";
      if (minRatingSelect) minRatingSelect.value = "";
      storeChecks.forEach((c) => { c.checked = true; });
      if (savedHint) {
        savedHint.textContent = "Preferências restauradas para o padrão.";
        savedHint.classList.remove("is-saved");
      }
      refreshResults();
    });

    async function runSearch(q) {
      if (!q) return;
      const empty = document.getElementById("buscaEmpty");
      const title = document.getElementById("buscaResultadosTitle");
      if (empty) empty.hidden = true;
      if (title) title.textContent = `Buscando "${q}"...`;
      const preferences = readFilterState();
      updatePreferenceSummary();
      try {
        const res = await fetch(publicApiUrl("/api/shopping-search"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            query: q,
            category: preferences.category || "geral",
            live: true,
            limit: 8,
            priority: preferences.priority,
            priceMin: preferences.priceMin,
            priceMax: preferences.priceMax,
            minRating: preferences.minRating,
            marketplaces: preferences.stores
          })
        });
        if (res.ok) {
          const data = await res.json();
          if (renderShoppingSearchResult(data, q)) {
            track("shopping_search", { query: q, mode: data.mode, status: data.status });
            return;
          }
          if (empty && data.queued) {
            empty.hidden = false;
            empty.querySelector("p").textContent = `Estamos gerando o comparativo de "${q}" agora. Isso leva alguns minutos - volte e pesquise de novo daqui a pouco.`;
            return;
          }
        }
      } catch {
        // Site estatico sem backend Node: usa o indice publicado abaixo.
      }
      const targetSlug = slugifyClient(q);
      const exact = index.find((item) => item.slug === targetSlug || item.query.toLowerCase() === q.toLowerCase());
      const matches = filterList(q);
      if (exact && matches.some((item) => item.slug === exact.slug)) {
        location.href = `comparativos/${encodeURIComponent(exact.slug)}.html`;
        return;
      }
      renderBuscaResults(matches, q);
      if (!matches.length) {
        const hasUnfilteredMatch = index.some((item) => `${item.title} ${item.query} ${item.category}`.toLowerCase().includes(q.toLowerCase()));
        if (hasUnfilteredMatch) {
          if (empty) {
            empty.hidden = false;
            empty.querySelector("p").textContent = "Encontramos opções para essa busca, mas nenhuma atende às suas preferências. Ajuste os filtros e tente novamente.";
          }
          return;
        }
        track("search_miss", { query: q });
        fetch(publicApiUrl("/api/search-miss"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ query: q, category: preferences.category || "geral" })
        }).then((res) => res.json()).then((data) => {
          if (empty && data && data.queued) {
            empty.querySelector("p").textContent = `Estamos gerando o comparativo de "${q}" agora. Isso leva alguns minutos - volte e pesquise de novo daqui a pouco.`;
          }
        }).catch(() => {});
      }
    }

    if (form) {
      form.addEventListener("submit", (ev) => {
        ev.preventDefault();
        runSearch(input.value.trim());
      });
    }

    const initialQuery = (qs.get("q") || "").trim();
    if (initialQuery) {
      input.value = initialQuery;
      runSearch(initialQuery);
    }
  }

  async function setupFavoritosPage() {
    const grid = document.getElementById("favoritosGrid");
    const empty = document.getElementById("favoritosEmpty");
    if (!grid) return;
    const favIds = getFavorites();
    if (!favIds.length) {
      grid.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    const index = await loadComparisonsIndex();
    const comparisonMatches = index.filter((item) => favIds.includes(item.slug));
    const productMatches = products.filter((p) => favIds.includes(String(p.id)));
    const cards = [
      ...comparisonMatches.map((item) => comparisonCardHTML(item)),
      ...productMatches.map((p) => cardHTML(p))
    ];
    if (!cards.length) {
      grid.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    grid.innerHTML = cards.join("");
    grid.querySelectorAll("[data-cta]").forEach((btn) => {
      const product = productById(btn.dataset.cta);
      if (product) bindAffiliate(btn, product);
    });
  }

  function updateProfileButtons() {
    const profile = getProfile();
    document.querySelectorAll("[data-open-profile]").forEach((btn) => {
      if (profile && profile.name) {
        const short = profile.name.length > 14 ? profile.name.slice(0, 13) + "…" : profile.name;
        btn.textContent = short;
        btn.classList.add("has-profile");
      } else {
        btn.textContent = btn.dataset.profileLabel || btn.textContent;
        btn.classList.remove("has-profile");
      }
    });
  }

  function setupProfile() {
    const modal = document.getElementById("profileModal");
    const body = document.getElementById("profileModalBody");
    const openBtns = document.querySelectorAll("[data-open-profile]");
    updateProfileButtons();
    if (!modal || !body || !openBtns.length) return;

    function closeModal() {
      modal.classList.remove("show");
    }

    function renderModalBody() {
      const profile = getProfile();
      if (profile && profile.name) {
        body.innerHTML = `
          <div class="modal-profile-meta">
            <div>Olá, <strong>${escapeHtml(profile.name)}</strong></div>
            <a href="favoritos.html">Ver favoritos</a>
          </div>
          <p>Seu perfil fica salvo neste navegador para lembrar seus favoritos. Não é uma conta com senha e não sincroniza entre aparelhos.</p>
          <div class="modal-actions">
            <button type="button" class="btn-line" id="profileLogoutBtn">Sair</button>
            <button type="button" class="btn primary" id="profileCloseBtn">Fechar</button>
          </div>`;
        const logout = document.getElementById("profileLogoutBtn");
        if (logout) logout.addEventListener("click", () => {
          clearProfile();
          track("profile_logout", {});
          renderModalBody();
          updateProfileButtons();
        });
      } else {
        body.innerHTML = `
          <h2>Criar seu perfil</h2>
          <p>Guardamos só um nome neste navegador, pra você reconhecer seus favoritos. Sem senha, sem e-mail, sem sincronizar entre aparelhos.</p>
          <form id="profileForm">
            <input type="text" name="name" placeholder="Como podemos te chamar?" maxlength="40" required autocomplete="off" />
            <div class="modal-actions">
              <button type="button" class="btn-line" id="profileCancelBtn">Cancelar</button>
              <button type="submit" class="btn primary">Salvar</button>
            </div>
          </form>`;
        const form = document.getElementById("profileForm");
        if (form) form.addEventListener("submit", (ev) => {
          ev.preventDefault();
          const name = new FormData(form).get("name");
          if (!name || !String(name).trim()) return;
          saveProfile(name);
          track("profile_created", {});
          renderModalBody();
          updateProfileButtons();
        });
        const cancel = document.getElementById("profileCancelBtn");
        if (cancel) cancel.addEventListener("click", closeModal);
      }
      const close = document.getElementById("profileCloseBtn");
      if (close) close.addEventListener("click", closeModal);
    }

    function openModal() {
      renderModalBody();
      modal.classList.add("show");
    }

    openBtns.forEach((btn) => btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      openModal();
    }));
    modal.addEventListener("click", (ev) => {
      if (ev.target === modal) closeModal();
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") closeModal();
    });
  }

  function setupLangSwitcher(current) {
    const langs = [
      { code: "pt", label: "PT", prefix: "" },
      { code: "en", label: "EN", prefix: "en" },
      { code: "es", label: "ES", prefix: "es" }
    ];
    const stripped = location.pathname.replace(/^\/(en|es)(\/|$)/, "/") || "/";
    const box = document.createElement("div");
    box.className = "lang-switch";
    box.setAttribute("aria-label", "Idioma / Language / Idioma");
    langs.forEach((l) => {
      const a = document.createElement("a");
      a.href = (l.prefix ? `/${l.prefix}${stripped}` : stripped) + location.search;
      a.textContent = l.label;
      a.className = l.code === current ? "is-current" : "";
      if (l.code === current) a.setAttribute("aria-current", "true");
      box.appendChild(a);
    });
    document.body.appendChild(box);
  }

  function setupMenu() {
    const btn = document.getElementById("menuBtn");
    const nav = document.getElementById("navLinks");
    const search = document.querySelector(".search-wrap");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const open = nav.classList.toggle("open");
      if (search) search.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", String(open));
    });
  }

  function setupCookie() {
    const box = document.getElementById("cookieBox");
    if (!box) return;
    if (!hasCookieConsent()) {
      box.classList.add("show");
      document.body.classList.add("cookie-on");
    }
    const ok = document.getElementById("cookieOk");
    if (ok) ok.addEventListener("click", () => {
      localStorage.setItem("aa_cookie_ok", "1");
      box.classList.remove("show");
      document.body.classList.remove("cookie-on");
      loadTracking();
      loadDisplayAds();
      track("cookie_accept", { page: document.body.dataset.page || location.pathname });
    });
  }

  function bindStaticAffiliateLinks() {
    document.querySelectorAll("[data-product]").forEach((el) => {
      const product = productById(el.dataset.product);
      if (product) bindAffiliate(el, product);
    });
  }

  function jsonLd() {
    if (document.querySelector("script[data-aa-jsonld]")) return;
    const script = document.createElement("script");
    script.type = "application/ld+json";
    const page = document.body.dataset.page;
    if (page === "oferta") {
      const p = productById(qs.get("id") || document.body.dataset.productId || "");
      if (!p) return;
      script.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "Product",
        name: p.title,
        description: p.description,
        image: absoluteAssetHref(p.image),
        brand: p.brand,
        offers: {
          "@type": "Offer",
          priceCurrency: "BRL",
          price: p.price,
          availability: "https://schema.org/InStock",
          seller: { "@type": "Organization", name: p.store }
        }
      });
    } else {
      script.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: "Ofertas Achado Agora",
        itemListElement: products.map((p, i) => ({
          "@type": "ListItem",
          position: i + 1,
          url: productPageHref(p, { absolute: true }),
          name: p.title
        }))
      });
    }
    document.head.appendChild(script);
  }

  jsonLd();
  setupLangSwitcher("pt");
  setupMenu();
  setupCookie();
  loadTracking();
  setupFilters();
  setupFavoriteButtons();
  setupProfile();
  const page = document.body.dataset.page;
  if (page === "oferta") {
    renderDealPage();
  } else if (page === "busca") {
    setupBuscaPage();
  } else if (page === "favoritos") {
    setupFavoritosPage();
  } else {
    renderCompareGrid();
    renderGrid(products);
    renderComparisonsSection();
    setupSearch();
    setupHeroSearch();
    bindStaticAffiliateLinks();
  }
  refreshFavButtons(document);
  loadDisplayAds();
  track("page_view", { page: page || location.pathname, attribution: lastAttribution() });
})();

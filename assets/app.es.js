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
    try { localStorage.setItem("last_attribution", JSON.stringify(attribution)); } catch {}
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
    return `<button type="button" class="fav-btn${active ? " is-active" : ""}" data-fav-toggle="${escapeHtml(id)}" aria-pressed="${active}" aria-label="${escapeHtml(label || "Favorito")}">${heartIconSVG}</button>`;
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
      slots.forEach((slot) => { slot.hidden = true; slot.setAttribute("aria-hidden", "true"); });
      return;
    }
    if (!validAdsenseClient(client)) {
      slots.forEach((slot) => {
        slot.hidden = true;
        slot.setAttribute("aria-hidden", "true");
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
      label.textContent = "Publicidad";
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
        alert("Esta oferta todavía no tiene un enlace de destino configurado.");
      }
    });
  }

  function cardHTML(p) {
    const off = discount(p);
    const pageHref = productPageHref(p);
    return `
      <article class="product-card" data-category="${escapeHtml(p.category)}" data-id="${escapeHtml(p.id)}">
        ${favButtonHTML(p.id, "Marcar oferta como favorita")}
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
      grid.innerHTML = `<div class="empty">No hay ofertas en esta selección. Prueba otro filtro u otro término.</div>`;
      return;
    }
    grid.innerHTML = list.map(cardHTML).join("");
    grid.querySelectorAll("[data-cta]").forEach((btn) => {
      const product = productById(btn.dataset.cta);
      if (product) bindAffiliate(btn, product);
    });
  }

  function storeInitials(store) {
    return String(store || "Tienda").slice(0, 2).toUpperCase();
  }

  function storeChipHTML(p) {
    return `<span class="store-chip store-chip-${escapeHtml(p.storeKey || "")}">${escapeHtml(storeInitials(p.store))}</span> ${escapeHtml(p.store || "Tienda")}`;
  }

  function pickCompareSet(list, n) {
    const pool = list.filter((p) => p.price);
    if (!pool.length) return [];
    const used = new Set();
    const picks = [];
    const best = pool.find((p) => p.featured) || [...pool].sort((a, b) => (b.rating || 0) - (a.rating || 0))[0];
    if (best) { picks.push({ item: best, label: "Melhor escolha" }); used.add(best.id); }
    const cheapest = [...pool].filter((p) => !used.has(p.id) && discount(p) > 0).sort((a, b) => discount(b) - discount(a))[0];
    if (cheapest) { picks.push({ item: cheapest, label: "Muy buen precio" }); used.add(cheapest.id); }
    const topRated = [...pool].filter((p) => !used.has(p.id)).sort((a, b) => (b.rating || 0) - (a.rating || 0))[0];
    if (topRated) { picks.push({ item: topRated, label: "Mais avaliado" }); used.add(topRated.id); }
    for (const p of pool) {
      if (picks.length >= n) break;
      if (used.has(p.id)) continue;
      picks.push({ item: p, label: "También vale la pena" });
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
        ${isCheapest ? `<span class="compare-best">✓ Precio más bajo de la categoría</span>` : ""}
        <a class="btn ${rank === 1 ? "primary" : "outline"}" data-cta="${escapeHtml(p.id)}" href="${escapeHtml(affiliateUrl(p) || "#")}">Ver oferta</a>
      </article>`;
  }

  async function renderComparisonsSection() {
    const grid = document.getElementById("comparativosGrid");
    if (!grid || grid.hasAttribute("data-daily-grid")) return;
    try {
      const res = await fetch(assetHref("assets/comparisons-index.json"), { cache: "no-store" });
      if (!res.ok) throw new Error("error al cargar comparativos");
      const items = await res.json();
      if (!Array.isArray(items) || !items.length) {
        grid.innerHTML = `<div class="empty">Todavía no publicamos comparativos. Vuelve pronto.</div>`;
        return;
      }
      const sorted = [...items].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 6);
      grid.innerHTML = sorted.map((item) => `
        <article class="product-card">
          ${favButtonHTML(item.slug, "Marcar comparativo como favorito")}
          <a class="product-art" href="${escapeHtml(assetHref("comparativos/" + item.slug + ".html"))}">
            <span class="badge">Comparativa</span>
            ${item.image ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" width="400" height="300" loading="lazy">` : ""}
          </a>
          <div class="product-body">
            <span class="category">${escapeHtml(item.category || "geral")}</span>
            <h3><a href="${escapeHtml(assetHref("comparativos/" + item.slug + ".html"))}">${escapeHtml(item.title)}</a></h3>
            ${item.price ? `<div class="price-row"><strong class="price">${formatBRL(item.price)}</strong></div>` : ""}
          </div>
        </article>`).join("");
    } catch {
      grid.innerHTML = `<div class="empty">No fue posible cargar los comparativos ahora.</div>`;
    }
  }

  function renderCompareGrid() {
    const grid = document.getElementById("compareGrid");
    if (!grid) return;
    const picks = pickCompareSet(products, 3);
    if (!picks.length) {
      grid.innerHTML = `<div class="empty">Todavía no tenemos un comparativo publicado.</div>`;
      return;
    }
    const cheapestId = [...picks].sort((a, b) => a.item.price - b.item.price)[0].item.id;
    grid.innerHTML = picks.map((pick, i) => compareCardHTML(pick, i + 1, pick.item.id === cheapestId)).join("");
    grid.querySelectorAll("[data-cta]").forEach((btn) => {
      const product = productById(btn.dataset.cta);
      if (product) bindAffiliate(btn, product);
    });
    const title = document.getElementById("compareTitle");
    if (title) title.textContent = `Mejores ofertas para "${picks[0].item.title}"`;
    const subtitle = document.getElementById("compareSubtitle");
    if (subtitle) subtitle.textContent = "Compara los precios en las principales tiendas y elige la mejor opción para ti.";
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
      root.innerHTML = `<div class="empty"><h1>Oferta no encontrada</h1><p>Esta oferta cambió. Mira las ofertas activas en la página principal.</p><p><a class="btn primary" href="index.html">Volver a las ofertas</a></p></div>`;
      document.title = "Oferta no encontrada — Achado Agora";
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
          <p class="legal-meta">Precio de referencia consultado el ${escapeHtml(p.updatedAt || cfg.priceCheckedOn)}. El valor final es el de la tienda al finalizar la compra.</p>
          <p><a class="btn primary full" data-cta="${escapeHtml(p.id)}" href="${escapeHtml(affiliateUrl(p) || "#")}">Ver oferta en ${escapeHtml(p.store)}</a></p>
        </aside>
      </section>
      <section class="ad-slot" aria-label="Publicidad">
        <span>Publicidad</span>
        <small>Espacio para red de display.</small>
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
        <div class="section-head"><h2>Otras ofertas</h2></div>
        <div class="grid" id="productGrid"></div>
      </section>
      <div class="sticky-cta" aria-label="Atajo a la oferta">
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
        ${favButtonHTML(item.slug, "Marcar comparativo como favorito")}
        <a class="product-art" href="${escapeHtml(href)}">
          <span class="badge">Comparativa</span>
          ${item.image ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" width="400" height="300" loading="lazy">` : ""}
        </a>
        <div class="product-body">
          <span class="category">${escapeHtml(item.category || "")}</span>
          <h3><a href="${escapeHtml(href)}">${escapeHtml(item.title)}</a></h3>
          ${item.price ? `<div class="price-row"><strong class="price">${formatBRL(item.price)}</strong></div>` : ""}
        </div>
      </article>`;
  }

  const searchCopy = {
    "store": "Tienda",
    "partner": "Tienda asociada",
    "best": "Oferta destacada",
    "cheapest": "Menor precio encontrado",
    "option": "Oferta",
    "view": "Ver oferta",
    "price": "Ver precio",
    "checked": "Precio consultado el",
    "cachedCard": "Oferta guardada",
    "results": "Ofertas encontradas para",
    "ready": "Encuentra tu próxima oferta",
    "start": "Escribe el producto que buscas y haz clic en Buscar.",
    "searching": "Buscando",
    "busy": "Consultando las tiendas disponibles. Puede tardar hasta 90 segundos.",
    "empty": "No encontramos ofertas correspondientes con estos filtros. Añade marca o modelo, o ajusta el precio.",
    "partialEmpty": "No pudimos consultar todas las tiendas, y no encontramos ofertas en las que respondieron. Inténtalo de nuevo en unos momentos.",
    "errorTitle": "No pudimos completar la búsqueda",
    "error": "La búsqueda no está disponible ahora. Inténtalo de nuevo en unos momentos.",
    "limited": "Has hecho muchas búsquedas en poco tiempo. Espera un poco antes de intentarlo de nuevo.",
    "timeout": "La consulta tardó más de lo esperado. Inténtalo de nuevo en unos momentos.",
    "noLive": "No pudimos consultar los precios actuales. Estas ofertas son de una búsqueda anterior.",
    "saved": "Hay ofertas de búsquedas anteriores. Confirma el precio y la disponibilidad en la tienda.",
    "partial": "Algunas tiendas no respondieron. Mostramos las ofertas disponibles en esta consulta.",
    "finalPrice": "El precio y el envío pueden cambiar. Confirma el total y la disponibilidad en la tienda.",
    "invalid": "Escribe al menos 2 caracteres para buscar.",
    "invalidPrice": "Introduce precios válidos, con el mínimo menor o igual al máximo.",
    "waiting": "Haz clic en Buscar para consultar este producto.",
    "savedFilters": "Preferencias guardadas en este dispositivo.",
    "saveError": "El navegador no permitió guardar. Tus filtros siguen activos en esta búsqueda.",
    "restored": "Preferencias predeterminadas restauradas.",
    "activeSaved": "Tus preferencias guardadas están activas.",
    "changed": "Filtros ajustados. Aplicándolos a la búsqueda.",
    "priority": "Prioridad",
    "balanced": "mejor equilibrio",
    "lowest_price": "menor precio",
    "top_rated": "mejor valoración",
    "most_popular": "más popular",
    "priceFrom": "desde",
    "priceTo": "hasta",
    "minRating": "valoración mínima",
    "preparing": "Todavía no hay ofertas disponibles para esta búsqueda. Inténtalo más tarde."
  };

  function safeShoppingUrl(value) {
    try {
      const url = new URL(String(value || '').trim());
      return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
    } catch { return ''; }
  }

  function searchProductHref(item) {
    return safeShoppingUrl(item.affiliateUrl) || safeShoppingUrl(item.sourceUrl);
  }

  function searchProductCardHTML(item, label) {
    const href = searchProductHref(item);
    const store = item.store && String(item.store).toLowerCase() !== 'lomadee' ? item.store : searchCopy.partner;
    const rating = Number(item.rating);
    let image = '';
    try { image = safeShoppingUrl(new URL(item.imageUrl || '', document.baseURI).href); } catch {}
    const checked = item.checkedAt ? new Date(item.checkedAt) : null;
    const checkedLabel = checked && Number.isFinite(checked.getTime())
      ? searchCopy.checked + ' ' + checked.toLocaleString(document.documentElement.lang || 'pt-BR', { dateStyle: 'short', timeStyle: 'short' })
      : item.isCached ? searchCopy.cachedCard : '';
    return `
      <article class="product-card" data-search-product="${escapeHtml(item.id)}">
        <a class="product-art" data-shopping-cta="${escapeHtml(item.id)}" href="${escapeHtml(href)}" target="_blank" rel="sponsored nofollow noopener noreferrer">
          <span class="badge">${escapeHtml(label)}</span>
          ${item.imageUrl && image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(item.title)}" width="400" height="300" loading="lazy">` : ''}
        </a>
        <div class="product-body">
          <span class="category">${escapeHtml(store || searchCopy.store)}</span>
          <h3><a href="${escapeHtml(href)}" data-shopping-cta="${escapeHtml(item.id)}" target="_blank" rel="sponsored nofollow noopener noreferrer">${escapeHtml(item.title)}</a></h3>
          <div class="price-row">
            <strong class="price">${Number(item.price) > 0 ? formatBRL(Number(item.price)) : escapeHtml(searchCopy.price)}</strong>
            ${rating > 0 && rating <= 5 ? `<span>★ ${escapeHtml(rating)} / 5</span>` : ''}
          </div>
          <div class="product-bottom">
            <small style="color:var(--muted)">${escapeHtml(checkedLabel)}</small>
            <a class="btn primary" data-shopping-cta="${escapeHtml(item.id)}" href="${escapeHtml(href)}" target="_blank" rel="sponsored nofollow noopener noreferrer">${escapeHtml(searchCopy.view)}</a>
          </div>
        </div>
      </article>`;
  }

  function bindShoppingResultLinks(root, items) {
    const byId = new Map(items.map((item) => [String(item.id), item]));
    root.querySelectorAll('[data-shopping-cta]').forEach((el) => {
      const item = byId.get(String(el.dataset.shoppingCta));
      if (!item) return;
      el.addEventListener('click', (ev) => {
        if (!searchProductHref(item)) { ev.preventDefault(); return; }
        track(safeShoppingUrl(item.affiliateUrl) ? 'affiliate_click' : 'marketplace_click', {
          product: item.id, store: item.store || item.marketplace, value: Number(item.price) || 0,
          currency: 'BRL', source: 'shopping_search', attribution: lastAttribution()
        });
      });
    });
  }

  function renderShoppingSearchResult(data, query) {
    const grid = document.getElementById('buscaGrid');
    const empty = document.getElementById('buscaEmpty');
    const title = document.getElementById('buscaResultadosTitle');
    const status = document.getElementById('buscaStatus');
    if (!grid) return false;
    const items = Array.isArray(data.offers) ? data.offers : [data.recommendation, data.cheapest, ...(Array.isArray(data.alternatives) ? data.alternatives : [])];
    const seen = new Set();
    const shown = items.filter((item) => {
      if (!item || !item.title || !searchProductHref(item)) return false;
      const key = [item.title, item.store || item.marketplace, item.price].map((value) => String(value ?? '').trim().toLowerCase()).join('|');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 4);
    if (!shown.length) return false;
    if (empty) empty.hidden = true;
    if (title) title.textContent = searchCopy.results + ' “' + query + '”';
    const cached = data.isCached || shown.some((item) => item.isCached) || (data.mode && data.mode !== 'live');
    const partial = Array.isArray(data.sourceStatus) && data.sourceStatus.some((source) => source.status === 'error');
    if (status) status.textContent = [data.mode === 'cache_after_live_error' ? searchCopy.noLive : cached ? searchCopy.saved : '', partial ? searchCopy.partial : '', searchCopy.finalPrice].filter(Boolean).join(' ');
    grid.innerHTML = shown.map((item) => {
      const label = item.id && item.id === data.recommendation?.id ? searchCopy.best
        : item.id && item.id === data.cheapest?.id ? searchCopy.cheapest : searchCopy.option;
      return searchProductCardHTML(item, label);
    }).join('');
    bindShoppingResultLinks(grid, shown);
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

  function setupBuscaPage() {
    const form = document.getElementById('buscaForm');
    const input = document.getElementById('buscaInput');
    const grid = document.getElementById('buscaGrid');
    const empty = document.getElementById('buscaEmpty');
    const title = document.getElementById('buscaResultadosTitle');
    const status = document.getElementById('buscaStatus');
    if (!input || !grid) return;
    const FILTERS_KEY = 'aa_search_preferences_v2';
    const LEGACY_FILTERS_KEY = 'aa_saved_filters';
    const prioritySelect = document.getElementById('filterPrioridade');
    const priceMinInput = document.getElementById('filterPrecoMin');
    const priceMaxInput = document.getElementById('filterPrecoMax');
    const minRatingSelect = document.getElementById('filterNotaMin');
    const storeChecks = Array.from(document.querySelectorAll('#buscaFilters .filter-stores input[type=checkbox]'));
    const saveBtn = document.getElementById('filterSaveBtn');
    const clearBtn = document.getElementById('filterClearBtn');
    const savedHint = document.getElementById('filterSavedHint');
    const submit = form?.querySelector('[type=submit]');
    let activeRequest = null;
    let searchVersion = 0;
    let filterTimer = null;
    let lastQuery = '';

    function readFilterState() {
      return {
        priority: prioritySelect?.value || 'balanced',
        priceMin: priceMinInput && priceMinInput.value !== '' ? Number(priceMinInput.value) : null,
        priceMax: priceMaxInput && priceMaxInput.value !== '' ? Number(priceMaxInput.value) : null,
        minRating: minRatingSelect && minRatingSelect.value !== '' ? Number(minRatingSelect.value) : null,
        stores: storeChecks.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value)
      };
    }

    function updatePreferenceSummary() {
      const target = document.getElementById('activePreferencesSummary');
      const state = readFilterState();
      if (!target) return;
      const parts = [searchCopy.priority + ': ' + (searchCopy[state.priority] || searchCopy.balanced)];
      if (state.priceMin !== null) parts.push(searchCopy.priceFrom + ' ' + formatBRL(state.priceMin));
      if (state.priceMax !== null) parts.push(searchCopy.priceTo + ' ' + formatBRL(state.priceMax));
      if (state.minRating !== null) parts.push(searchCopy.minRating + ' ' + state.minRating);
      target.textContent = parts.join(' · ') + '.';
    }

    function setBusy(busy) {
      grid.setAttribute('aria-busy', String(busy));
      if (submit) submit.disabled = busy;
    }

    function cancelSearch() {
      searchVersion += 1;
      clearTimeout(filterTimer);
      if (activeRequest) activeRequest.abort();
      activeRequest = null;
      setBusy(false);
    }

    function showMessage(message, heading = searchCopy.ready) {
      grid.innerHTML = '';
      if (title) title.textContent = heading;
      if (status) status.textContent = '';
      if (empty) {
        empty.hidden = false;
        const paragraph = empty.querySelector('p');
        if (paragraph) paragraph.textContent = message;
      }
    }

    function showHint(message, saved = false) {
      if (!savedHint) return;
      savedHint.hidden = false;
      savedHint.textContent = message;
      savedHint.classList.toggle('is-saved', saved);
    }

    try {
      const state = JSON.parse(localStorage.getItem(FILTERS_KEY) || localStorage.getItem(LEGACY_FILTERS_KEY) || 'null');
      if (state && typeof state === 'object') {
        if (prioritySelect && ['balanced', 'lowest_price', 'top_rated', 'most_popular'].includes(state.priority)) prioritySelect.value = state.priority;
        if (priceMinInput && state.priceMin != null && Number.isFinite(Number(state.priceMin)) && Number(state.priceMin) >= 0) priceMinInput.value = state.priceMin;
        if (priceMaxInput && state.priceMax != null && Number.isFinite(Number(state.priceMax)) && Number(state.priceMax) >= 0) priceMaxInput.value = state.priceMax;
        if (minRatingSelect && state.minRating != null) minRatingSelect.value = state.minRating;
        if (Array.isArray(state.stores) && storeChecks.some((checkbox) => state.stores.includes(checkbox.value))) {
          storeChecks.forEach((checkbox) => { checkbox.checked = state.stores.includes(checkbox.value); });
        }
        showHint(searchCopy.activeSaved, true);
      }
    } catch {}

    async function runSearch(rawQuery) {
      cancelSearch();
      const version = searchVersion;
      const query = String(rawQuery || '').trim().slice(0, 160);
      updatePreferenceSummary();
      if (!query) { lastQuery = ''; showMessage(searchCopy.start); return; }
      if (query.length < 2) { showMessage(searchCopy.invalid); return; }
      const preferences = readFilterState();
      const invalidPrice = [preferences.priceMin, preferences.priceMax].some((price) => price !== null && (!Number.isFinite(price) || price < 0));
      if (invalidPrice || (preferences.priceMin !== null && preferences.priceMax !== null && preferences.priceMin > preferences.priceMax)) {
        showMessage(searchCopy.invalidPrice);
        return;
      }
      lastQuery = query;
      try {
        const url = new URL(location.href);
        url.searchParams.set('q', query);
        history.replaceState(null, '', url);
      } catch {}
      grid.innerHTML = '';
      if (empty) empty.hidden = true;
      if (title) title.textContent = searchCopy.searching + ' “' + query + '”…';
      if (status) status.textContent = searchCopy.busy;
      setBusy(true);
      const controller = new AbortController();
      activeRequest = controller;
      let timedOut = false;
      const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 90000);
      try {
        const res = await fetch(publicApiUrl('/api/shopping-search'), {
          method: 'POST', headers: { 'content-type': 'application/json' }, signal: controller.signal,
          body: JSON.stringify({ query, category: 'geral', live: true, limit: 8, priority: preferences.priority, priceMin: preferences.priceMin, priceMax: preferences.priceMax, minRating: preferences.minRating, marketplaces: preferences.stores })
        });
        if (version !== searchVersion) return;
        if (!res.ok) {
          showMessage(res.status === 429 ? searchCopy.limited : res.status === 400 ? searchCopy.invalid : searchCopy.error, searchCopy.errorTitle);
          return;
        }
        const data = await res.json();
        if (version !== searchVersion) return;
        if (!data || data.ok === false) { showMessage(searchCopy.error, searchCopy.errorTitle); return; }
        if (!renderShoppingSearchResult(data, query)) {
          const partial = data.liveError || (Array.isArray(data.sourceStatus) && data.sourceStatus.some((source) => source.status === 'error'));
          showMessage(partial ? searchCopy.partialEmpty : data.queued ? searchCopy.preparing : searchCopy.empty, searchCopy.results + ' “' + query + '”');
        }
        track('shopping_search', { query, mode: data.mode, status: data.status });
      } catch (error) {
        if (version !== searchVersion) return;
        showMessage(timedOut ? searchCopy.timeout : searchCopy.error, searchCopy.errorTitle);
      } finally {
        clearTimeout(timeout);
        if (version === searchVersion) { activeRequest = null; setBusy(false); }
      }
    }

    function filtersChanged() {
      cancelSearch();
      updatePreferenceSummary();
      showHint(searchCopy.changed);
      if (lastQuery && input.value.trim() === lastQuery) {
        showMessage(searchCopy.changed);
        filterTimer = setTimeout(() => runSearch(lastQuery), 650);
      }
    }

    input.addEventListener('input', () => {
      cancelSearch();
      showMessage(input.value.trim() ? searchCopy.waiting : searchCopy.start);
    });
    [prioritySelect, minRatingSelect].filter(Boolean).forEach((control) => control.addEventListener('change', filtersChanged));
    [priceMinInput, priceMaxInput].filter(Boolean).forEach((control) => control.addEventListener('input', filtersChanged));
    storeChecks.forEach((checkbox) => checkbox.addEventListener('change', () => {
      if (!storeChecks.some((item) => item.checked)) checkbox.checked = true;
      filtersChanged();
    }));
    if (saveBtn) saveBtn.addEventListener('click', () => {
      try {
        localStorage.setItem(FILTERS_KEY, JSON.stringify(readFilterState()));
        localStorage.removeItem(LEGACY_FILTERS_KEY);
        showHint(searchCopy.savedFilters, true);
      } catch { showHint(searchCopy.saveError); }
    });
    if (clearBtn) clearBtn.addEventListener('click', () => {
      try { localStorage.removeItem(FILTERS_KEY); localStorage.removeItem(LEGACY_FILTERS_KEY); } catch {}
      if (prioritySelect) prioritySelect.value = 'balanced';
      if (priceMinInput) priceMinInput.value = '';
      if (priceMaxInput) priceMaxInput.value = '';
      if (minRatingSelect) minRatingSelect.value = '';
      storeChecks.forEach((checkbox) => { checkbox.checked = true; });
      filtersChanged();
      showHint(searchCopy.restored);
    });
    if (form) form.addEventListener('submit', (ev) => { ev.preventDefault(); runSearch(input.value); });
    window.addEventListener('pagehide', cancelSearch);
    updatePreferenceSummary();
    const initialQuery = (qs.get('q') || '').trim().slice(0, 160);
    if (initialQuery) { input.value = initialQuery; runSearch(initialQuery); }
    else showMessage(searchCopy.start);
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
            <div>Hola, <strong>${escapeHtml(profile.name)}</strong></div>
            <a href="favoritos.html">Ver favoritos</a>
          </div>
          <p>Tu perfil se guarda en este navegador para recordar tus favoritos. No es una cuenta con contraseña y no se sincroniza entre dispositivos.</p>
          <div class="modal-actions">
            <button type="button" class="btn-line" id="profileLogoutBtn">Cerrar sesión</button>
            <button type="button" class="btn primary" id="profileCloseBtn">Cerrar</button>
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
          <h2>Crea tu perfil</h2>
          <p>Solo guardamos un nombre en este navegador para que reconozcas tus favoritos. Sin contraseña, sin correo, sin sincronizar entre dispositivos.</p>
          <form id="profileForm">
            <input type="text" name="name" placeholder="¿Cómo te llamamos?" maxlength="40" required autocomplete="off" />
            <div class="modal-actions">
              <button type="button" class="btn-line" id="profileCancelBtn">Cancelar</button>
              <button type="submit" class="btn primary">Guardar</button>
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
    if (!btn || !nav) return;
    const setOpen = open => {
      nav.classList.toggle("open", open);
      if (search) search.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", String(open));
    };
    btn.addEventListener("click", () => setOpen(btn.getAttribute("aria-expanded") !== "true"));
    nav.addEventListener("click", event => { if (event.target.closest("a")) setOpen(false); });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && btn.getAttribute("aria-expanded") === "true") { setOpen(false); btn.focus(); }
    });
    document.addEventListener("click", event => { if (!event.target.closest(".topbar")) setOpen(false); });
    window.matchMedia("(min-width: 901px)").addEventListener("change", () => setOpen(false));
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
  setupLangSwitcher("es");
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

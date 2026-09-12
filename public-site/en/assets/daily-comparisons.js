(async function () {
  const grid = document.querySelector('[data-daily-grid]');
  const detail = document.getElementById('dailyComparisonRoot');
  if (!grid && !detail) return;
  const lang = document.documentElement.lang.slice(0, 2);
  const copy = {
    pt: ['Comparar 3 ofertas', 'A partir de', 'Ver oferta', 'Consultado em', 'Preço e estoque podem mudar na loja.', 'Não foi possível carregar as ofertas agora.', 'Comparativos anteriores', 'Os novos comparativos estão sendo preparados.', 'Comparar outras opções'],
    en: ['Compare 3 offers', 'From', 'View offer', 'Checked on', 'Price and availability may change at the store.', 'Offers could not be loaded right now.', 'Previous comparisons', 'New comparisons are being prepared.', 'Compare other options'],
    es: ['Comparar 3 ofertas', 'Desde', 'Ver oferta', 'Consultado el', 'El precio y la disponibilidad pueden cambiar en la tienda.', 'No se pudieron cargar las ofertas.', 'Comparativos anteriores', 'Estamos preparando los nuevos comparativos.', 'Comparar otras opciones']
  }[lang] || [];
  const e = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = value => new Intl.NumberFormat(lang === 'pt' ? 'pt-BR' : lang, {style:'currency', currency:'BRL'}).format(value);
  const date = value => new Date(value).toLocaleString(lang === 'pt' ? 'pt-BR' : lang);
  const safe = value => { try { const u = new URL(value, location.href); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
  const affiliate = offer => {
    const href = safe(offer.affiliateUrl);
    if (!href) return '';
    const u = new URL(href);
    return (u.hostname === 'meli.la' || (/(^|\.)mercadolivre\.com\.br$/.test(u.hostname) && u.searchParams.get('matt_tool'))
      || (/(^|\.)amazon\.com\.br$/.test(u.hostname) && u.searchParams.get('tag')) || /(^|\.)lmdee\.link$/.test(u.hostname)) ? href : '';
  };
  const valid = item => item && item.offers?.length === 3 && item.offers.every(o => affiliate(o) && o.price > 0);
  const base = String(window.SITE_CONFIG?.searchApiBase || '').replace(/\/+$/, '');
  const id = new URLSearchParams(location.search).get('id');
  const status = document.querySelector('[data-daily-status]');
  const fallback = () => `<div class="empty"><p>${e(copy[7])}</p><a class="btn outline" href="comparativos.html">${e(copy[6])}</a></div>`;
  const offerCard = (o, i) => `<article class="compare-card${i === 0 ? ' rank-1' : ''}">
    <span class="compare-rank">${i + 1}º · ${e(o.store)}</span>
    ${safe(o.imageUrl) ? `<img class="daily-product-image" src="${e(safe(o.imageUrl))}" alt="${e(o.title)}" width="300" height="220" loading="lazy">` : ''}
    <h3>${e(o.title)}</h3><p>${o.rating ? `★ ${e(o.rating)} ${e(o.reviewLabel || '')}` : ''}</p>
    <strong class="compare-price">${money(o.price)}</strong>
    <a class="btn ${i === 0 ? 'primary' : 'outline'}" href="${e(affiliate(o))}" target="_blank" rel="sponsored nofollow noopener">${e(copy[2])}</a>
  </article>`;
  try {
    const response = await fetch(`${base}/api/home-comparisons${detail ? `?id=${encodeURIComponent(id || '')}` : ''}`, {cache:'no-store', signal:AbortSignal.timeout(12000)});
    if (!response.ok) throw new Error('unavailable');
    const data = await response.json();
    if (detail) {
      if (!valid(data)) throw new Error('invalid');
      document.title = `${data.query} — Achado Agora`;
      detail.innerHTML = `<div class="section-head"><div><p class="eyebrow">${e(copy[0])}</p><h1>${e(data.query)}</h1><p>${e(copy[3])} ${e(date(data.checkedAt))}. ${e(copy[4])}</p></div></div><div class="compare-grid">${data.offers.map(offerCard).join('')}</div><p><a class="compare-more" href="busca.html?q=${encodeURIComponent(data.query)}">${e(copy[8])} →</a></p>`;
      return;
    }
    if (data.items?.length !== 6 || !data.items.every(valid)) throw new Error('invalid');
    grid.innerHTML = data.items.map(item => {
      const offer = item.offers[0];
      const href = `comparativo-do-dia.html?id=${encodeURIComponent(item.id)}`;
      return `<article class="product-card"><a class="product-art" href="${href}">${safe(offer.imageUrl) ? `<img src="${e(safe(offer.imageUrl))}" alt="${e(item.query)}" width="300" height="220" loading="lazy">` : ''}</a><div class="product-body"><h3><a href="${href}">${e(item.query)}</a></h3><div class="price-row"><span>${e(copy[1])}</span><strong class="price">${money(Math.min(...item.offers.map(o => o.price)))}</strong></div><a class="compare-more" href="${href}">${e(copy[0])} →</a></div></article>`;
    }).join('');
    if (status) status.textContent = `${copy[3]} ${date(data.generatedAt)}. ${Date.now() > Date.parse(data.nextRefreshAt) ? copy[7] : copy[4]}`;
    const featured = document.querySelector('[data-daily-featured]');
    if (featured) featured.innerHTML = `<div class="compare-head"><div><h2>${e(data.items[0].query)}</h2><p>${e(copy[3])} ${e(date(data.items[0].checkedAt))}. ${e(copy[4])}</p></div></div><div class="compare-grid">${data.items[0].offers.map(offerCard).join('')}</div>`;
  } catch {
    if (grid) grid.innerHTML = fallback();
    if (detail) detail.innerHTML = `<div class="empty"><p>${e(copy[5])}</p><a class="btn outline" href="index.html">${e(copy[8])}</a></div>`;
  }
})();

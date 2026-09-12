import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { runShoppingSearch, hasAffiliateLink } from "./shoppingSearchEngine.js";
import { isRelevantCandidate } from "./lib/searchRelevance.js";

export const DAY_MS = 24 * 60 * 60 * 1000;
const TOPICS = ["geladeira", "air fryer", "fone bluetooth", "notebook i5", "micro ondas", "aspirador de po",
  "maquina de lavar", "monitor 24 polegadas", "cafeteira", "mouse sem fio", "ventilador", "caixa de som bluetooth",
  "liquidificador", "smart tv 50 polegadas", "teclado mecanico", "panela eletrica", "impressora", "headset gamer"];

export function createDailyComparisons({ file = path.join(config.dataDir, "home-comparisons.json"), search = runShoppingSearch,
  now = Date.now, topics = TOPICS, report = console.error } = {}) {
  let pending = null;
  let retryAt = 0;
  const isValidOffer = (offer, query, requireFresh = false) => {
    const age = now() - Date.parse(offer?.checkedAt);
    return hasAffiliateLink(offer) && isRelevantCandidate(offer, query) && offer?.title && offer?.price > 0
      && (!requireFresh || (age >= 0 && age < DAY_MS));
  };
  const isValidItem = item => item?.query && item.offers?.length === 3
    && item.offers.every(offer => isValidOffer(offer, item.query));
  function read() {
    try {
      const batch = JSON.parse(fs.readFileSync(file, "utf8"));
      if (batch.items?.length === 6 && batch.items.every(isValidItem)) return batch;
    } catch {}
    return null;
  }
  async function refresh() {
    const previous = read();
    if (previous && now() < Date.parse(previous.nextRefreshAt)) return previous;
    const previousTopics = new Set(previous?.items.map(item => item.query) || []);
    const pool = topics.filter(topic => !previousTopics.has(topic));
    const offset = Math.floor(now() / DAY_MS) % Math.max(pool.length, 1);
    const ordered = [...pool.slice(offset), ...pool.slice(0, offset)];
    const items = [];
    for (const query of ordered) {
      try {
        const result = await search({ query, live: true, preferAffiliate: true, headless: true, limit: 24 });
        if (result.mode !== "live" || result.isCached) continue;
        const seen = new Set();
        const offers = (result.offers || []).filter(offer => {
          const key = offer.sourceUrl;
          if (!key || seen.has(key) || !isValidOffer(offer, query, true)) return false;
          seen.add(key);
          return true;
        }).slice(0, 3).map(({ affiliateError, ...offer }) => offer);
        if (offers.length !== 3) continue;
        const slug = query.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
        items.push({ id: `${Math.floor(now() / DAY_MS)}-${slug}`, query, title: query, offers,
          checkedAt: offers.map(offer => offer.checkedAt).sort()[0] });
        if (items.length === 6) break;
      } catch (error) { report(`Comparativo diario indisponivel (${query}): ${error.message}`); }
    }
    if (items.length !== 6) throw new Error(`Lote mantido: somente ${items.length}/6 comparativos com tres ofertas afiliadas recentes.`);
    const batch = { generatedAt: new Date(now()).toISOString(), nextRefreshAt: new Date(now() + DAY_MS).toISOString(), items };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const archive = `${file}.archive`;
    fs.mkdirSync(archive, { recursive: true });
    for (const item of items) fs.writeFileSync(path.join(archive, `${item.id}.json`), JSON.stringify(item));
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(batch, null, 2));
    fs.renameSync(temp, file);
    return batch;
  }
  function ensureFresh() {
    if (pending) return pending;
    if (now() < retryAt) return Promise.resolve(read());
    pending = refresh().catch(error => { retryAt = now() + 60 * 60 * 1000; throw error; }).finally(() => { pending = null; });
    return pending;
  }
  function start() {
    const tick = () => ensureFresh().catch(error => report(error.message));
    tick();
    const timer = setInterval(tick, 60_000);
    timer.unref();
    return () => clearInterval(timer);
  }
  function readItem(id) {
    if (!/^\d+-[a-z0-9-]{1,100}$/.test(id || "")) return null;
    try {
      const item = JSON.parse(fs.readFileSync(path.join(`${file}.archive`, `${id}.json`), "utf8"));
      return isValidItem(item) ? item : null;
    } catch { return null; }
  }
  return { read, readItem, ensureFresh, start };
}

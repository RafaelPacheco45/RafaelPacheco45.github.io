import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";
import { asJson, fromJson, nowIso } from "./lib/utils.js";

const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  marketplace TEXT NOT NULL DEFAULT 'mercadolivre',
  source_url TEXT NOT NULL,
  affiliate_url TEXT,
  title TEXT NOT NULL,
  brand TEXT,
  category TEXT NOT NULL DEFAULT 'geral',
  badge TEXT,
  description TEXT,
  why TEXT,
  price REAL,
  old_price REAL,
  rating REAL,
  review_label TEXT,
  image_url TEXT,
  local_image_path TEXT,
  specs_json TEXT,
  pros_json TEXT,
  cons_json TEXT,
  status TEXT NOT NULL DEFAULT 'discovered',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT,
  type TEXT NOT NULL DEFAULT 'offer',
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  html TEXT NOT NULL,
  social_copy TEXT,
  ad_copy_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ad_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT,
  post_id INTEGER,
  platform TEXT NOT NULL DEFAULT 'meta',
  campaign_name TEXT NOT NULL,
  destination_url TEXT NOT NULL,
  copy_json TEXT,
  daily_budget_brl REAL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE SET NULL,
  FOREIGN KEY(post_id) REFERENCES posts(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload_json TEXT,
  result_json TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  meta_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comparisons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'geral',
  items_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT
);

CREATE TABLE IF NOT EXISTS campaign_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  campaign TEXT NOT NULL DEFAULT 'geral',
  spend_brl REAL NOT NULL DEFAULT 0,
  visitors INTEGER NOT NULL DEFAULT 0,
  affiliate_clicks INTEGER NOT NULL DEFAULT 0,
  affiliate_revenue_brl REAL NOT NULL DEFAULT 0,
  display_revenue_brl REAL NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(day, campaign)
);
`);

// Search metadata must survive link generation and later cache reads. Existing
// products are preserved; only fresh searches populate price observation time.
const productColumns = new Set(db.prepare("PRAGMA table_info(products)").all().map((column) => column.name));
for (const column of ["store", "organization_id", "observed_at"]) {
  if (!productColumns.has(column)) db.exec(`ALTER TABLE products ADD COLUMN ${column} TEXT`);
}

function rowToProduct(row) {
  if (!row) return null;
  return {
    id: row.id,
    marketplace: row.marketplace,
    store: row.store || "",
    organizationId: row.organization_id || "",
    observedAt: row.observed_at || "",
    sourceUrl: row.source_url,
    affiliateUrl: row.affiliate_url || "",
    title: row.title,
    brand: row.brand || "",
    category: row.category || "geral",
    badge: row.badge || "",
    description: row.description || "",
    why: row.why || "",
    price: row.price,
    oldPrice: row.old_price,
    rating: row.rating,
    reviewLabel: row.review_label || "",
    imageUrl: row.image_url || "",
    localImagePath: row.local_image_path || "",
    specs: fromJson(row.specs_json, []),
    pros: fromJson(row.pros_json, []),
    cons: fromJson(row.cons_json, []),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at || "",
    lastError: row.last_error || ""
  };
}

function rowToTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    payload: fromJson(row.payload_json, {}),
    result: fromJson(row.result_json, null),
    error: row.error || "",
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at || "",
    finishedAt: row.finished_at || ""
  };
}

function rowToPost(row) {
  if (!row) return null;
  return {
    id: row.id,
    productId: row.product_id || "",
    type: row.type,
    title: row.title,
    slug: row.slug,
    html: row.html,
    socialCopy: row.social_copy || "",
    adCopy: fromJson(row.ad_copy_json, {}),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at || ""
  };
}

function rowToMetric(row) {
  if (!row) return null;
  const spendBRL = Number(row.spend_brl || 0);
  const visitors = Number(row.visitors || 0);
  const affiliateClicks = Number(row.affiliate_clicks || 0);
  const affiliateRevenueBRL = Number(row.affiliate_revenue_brl || 0);
  const displayRevenueBRL = Number(row.display_revenue_brl || 0);
  const totalRevenueBRL = affiliateRevenueBRL + displayRevenueBRL;
  const profitBRL = totalRevenueBRL - spendBRL;
  return {
    id: row.id,
    day: row.day,
    campaign: row.campaign,
    spendBRL,
    visitors,
    affiliateClicks,
    affiliateRevenueBRL,
    displayRevenueBRL,
    totalRevenueBRL,
    profitBRL,
    epcBRL: affiliateClicks > 0 ? affiliateRevenueBRL / affiliateClicks : 0,
    costPerAffiliateClickBRL: affiliateClicks > 0 ? spendBRL / affiliateClicks : 0,
    revenuePerVisitorBRL: visitors > 0 ? totalRevenueBRL / visitors : 0,
    notes: row.notes || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function logEvent(level, message, meta = null) {
  db.prepare("INSERT INTO events(level, message, meta_json, created_at) VALUES (?, ?, ?, ?)")
    .run(level, message, asJson(meta), nowIso());
}

export function listEvents(limit = 100) {
  return db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?").all(limit).map((row) => ({
    id: row.id,
    level: row.level,
    message: row.message,
    meta: fromJson(row.meta_json, null),
    createdAt: row.created_at
  }));
}

export function getSetting(key, fallback = "") {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, String(value ?? ""), nowIso());
}

export function listSettings() {
  const rows = db.prepare("SELECT key, value, updated_at FROM settings ORDER BY key").all();
  return Object.fromEntries(rows.map((row) => [row.key, { value: row.value, updatedAt: row.updated_at }]));
}

export function upsertProduct(input) {
  const now = nowIso();
  const existing = getProduct(input.id);
  db.prepare(`
    INSERT INTO products (
      id, marketplace, source_url, affiliate_url, title, brand, category, badge,
      description, why, price, old_price, rating, review_label, image_url, local_image_path,
      specs_json, pros_json, cons_json, status, created_at, updated_at, published_at, last_error,
      store, organization_id, observed_at
    ) VALUES (
      @id, @marketplace, @sourceUrl, @affiliateUrl, @title, @brand, @category, @badge,
      @description, @why, @price, @oldPrice, @rating, @reviewLabel, @imageUrl, @localImagePath,
      @specsJson, @prosJson, @consJson, @status, @createdAt, @updatedAt, @publishedAt, @lastError,
      @store, @organizationId, @observedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      marketplace = excluded.marketplace,
      store = COALESCE(excluded.store, products.store),
      organization_id = COALESCE(excluded.organization_id, products.organization_id),
      observed_at = COALESCE(excluded.observed_at, products.observed_at),
      source_url = excluded.source_url,
      affiliate_url = COALESCE(excluded.affiliate_url, products.affiliate_url),
      title = excluded.title,
      brand = COALESCE(excluded.brand, products.brand),
      category = excluded.category,
      badge = COALESCE(excluded.badge, products.badge),
      description = COALESCE(excluded.description, products.description),
      why = COALESCE(excluded.why, products.why),
      price = COALESCE(excluded.price, products.price),
      old_price = COALESCE(excluded.old_price, products.old_price),
      rating = COALESCE(excluded.rating, products.rating),
      review_label = COALESCE(excluded.review_label, products.review_label),
      image_url = COALESCE(excluded.image_url, products.image_url),
      local_image_path = COALESCE(excluded.local_image_path, products.local_image_path),
      specs_json = COALESCE(excluded.specs_json, products.specs_json),
      pros_json = COALESCE(excluded.pros_json, products.pros_json),
      cons_json = COALESCE(excluded.cons_json, products.cons_json),
      status = excluded.status,
      updated_at = excluded.updated_at,
      published_at = COALESCE(excluded.published_at, products.published_at),
      last_error = excluded.last_error
  `).run({
    id: input.id,
    marketplace: input.marketplace || existing?.marketplace || "mercadolivre",
    store: input.store || null,
    organizationId: input.organizationId || null,
    observedAt: input.observedAt || null,
    sourceUrl: input.sourceUrl || existing?.sourceUrl || "",
    affiliateUrl: input.affiliateUrl || null,
    title: input.title || existing?.title || "Produto sem titulo",
    brand: input.brand || null,
    category: input.category || existing?.category || "geral",
    badge: input.badge || null,
    description: input.description || null,
    why: input.why || null,
    price: input.price ?? null,
    oldPrice: input.oldPrice ?? null,
    rating: input.rating ?? null,
    reviewLabel: input.reviewLabel || null,
    imageUrl: input.imageUrl || null,
    localImagePath: input.localImagePath || null,
    specsJson: input.specs ? asJson(input.specs) : null,
    prosJson: input.pros ? asJson(input.pros) : null,
    consJson: input.cons ? asJson(input.cons) : null,
    status: input.status || existing?.status || "discovered",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    publishedAt: input.publishedAt || null,
    lastError: input.lastError || null
  });
  return getProduct(input.id);
}

export function getProduct(id) {
  return rowToProduct(db.prepare("SELECT * FROM products WHERE id = ?").get(id));
}

export function listProducts(limit = 200) {
  return db.prepare("SELECT * FROM products ORDER BY updated_at DESC LIMIT ?").all(limit).map(rowToProduct);
}

export function markProductError(id, message) {
  const product = getProduct(id);
  if (!product) return;
  db.prepare("UPDATE products SET status = ?, last_error = ?, updated_at = ? WHERE id = ?")
    .run("error", String(message || ""), nowIso(), id);
}

export function markProductPublished(id) {
  db.prepare("UPDATE products SET status = ?, published_at = ?, updated_at = ? WHERE id = ?")
    .run("published", nowIso(), nowIso(), id);
}

export function createTask(type, payload = {}) {
  const now = nowIso();
  const result = db.prepare(`
    INSERT INTO tasks(type, status, payload_json, created_at, updated_at)
    VALUES (?, 'pending', ?, ?, ?)
  `).run(type, asJson(payload), now, now);
  return getTask(Number(result.lastInsertRowid));
}

export function getTask(id) {
  return rowToTask(db.prepare("SELECT * FROM tasks WHERE id = ?").get(id));
}

export function listTasks(limit = 100) {
  return db.prepare("SELECT * FROM tasks ORDER BY id DESC LIMIT ?").all(limit).map(rowToTask);
}

export function nextPendingTask() {
  return rowToTask(db.prepare("SELECT * FROM tasks WHERE status = 'pending' ORDER BY id ASC LIMIT 1").get());
}

export function startTask(id) {
  const now = nowIso();
  db.prepare("UPDATE tasks SET status = 'running', attempts = attempts + 1, started_at = ?, updated_at = ? WHERE id = ?")
    .run(now, now, id);
  return getTask(id);
}

export function completeTask(id, result = null) {
  const now = nowIso();
  db.prepare("UPDATE tasks SET status = 'done', result_json = ?, error = NULL, finished_at = ?, updated_at = ? WHERE id = ?")
    .run(asJson(result), now, now, id);
  return getTask(id);
}

export function failTask(id, error) {
  const now = nowIso();
  db.prepare("UPDATE tasks SET status = 'failed', error = ?, finished_at = ?, updated_at = ? WHERE id = ?")
    .run(String(error || "Erro desconhecido"), now, now, id);
  return getTask(id);
}

export function retryTask(id) {
  db.prepare("UPDATE tasks SET status = 'pending', error = NULL, started_at = NULL, finished_at = NULL, updated_at = ? WHERE id = ?")
    .run(nowIso(), id);
  return getTask(id);
}

export function cancelTask(id) {
  const now = nowIso();
  db.prepare("UPDATE tasks SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'failed')")
    .run(now, now, id);
  return getTask(id);
}

export function createOrUpdatePost(input) {
  const now = nowIso();
  const existing = db.prepare("SELECT * FROM posts WHERE slug = ?").get(input.slug);
  if (existing) {
    db.prepare(`
      UPDATE posts SET product_id = ?, type = ?, title = ?, html = ?, social_copy = ?,
        ad_copy_json = ?, status = ?, updated_at = ?, published_at = COALESCE(?, published_at)
      WHERE slug = ?
    `).run(
      input.productId || null,
      input.type || existing.type || "offer",
      input.title,
      input.html,
      input.socialCopy || "",
      asJson(input.adCopy || {}),
      input.status || existing.status || "draft",
      now,
      input.publishedAt || null,
      input.slug
    );
    return rowToPost(db.prepare("SELECT * FROM posts WHERE slug = ?").get(input.slug));
  }
  const result = db.prepare(`
    INSERT INTO posts(product_id, type, title, slug, html, social_copy, ad_copy_json, status, created_at, updated_at, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.productId || null,
    input.type || "offer",
    input.title,
    input.slug,
    input.html,
    input.socialCopy || "",
    asJson(input.adCopy || {}),
    input.status || "draft",
    now,
    now,
    input.publishedAt || null
  );
  return getPost(Number(result.lastInsertRowid));
}

export function getPost(id) {
  return rowToPost(db.prepare("SELECT * FROM posts WHERE id = ?").get(id));
}

export function getPostBySlug(slug) {
  return rowToPost(db.prepare("SELECT * FROM posts WHERE slug = ?").get(slug));
}

export function listPosts(limit = 100) {
  return db.prepare("SELECT * FROM posts ORDER BY updated_at DESC LIMIT ?").all(limit).map(rowToPost);
}

export function createAdDraft(input) {
  const now = nowIso();
  const result = db.prepare(`
    INSERT INTO ad_drafts(product_id, post_id, platform, campaign_name, destination_url, copy_json, daily_budget_brl, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.productId || null,
    input.postId || null,
    input.platform || "meta",
    input.campaignName,
    input.destinationUrl,
    asJson(input.copy || {}),
    input.dailyBudgetBRL ?? null,
    input.status || "draft",
    now,
    now
  );
  return getAdDraft(Number(result.lastInsertRowid));
}

export function getAdDraft(id) {
  const row = db.prepare("SELECT * FROM ad_drafts WHERE id = ?").get(id);
  if (!row) return null;
  return {
    id: row.id,
    productId: row.product_id || "",
    postId: row.post_id || "",
    platform: row.platform,
    campaignName: row.campaign_name,
    destinationUrl: row.destination_url,
    copy: fromJson(row.copy_json, {}),
    dailyBudgetBRL: row.daily_budget_brl,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function listAdDrafts(limit = 100) {
  return db.prepare("SELECT * FROM ad_drafts ORDER BY id DESC LIMIT ?").all(limit).map((row) => getAdDraft(row.id));
}

export function upsertCampaignMetric(input) {
  const now = nowIso();
  db.prepare(`
    INSERT INTO campaign_metrics(
      day, campaign, spend_brl, visitors, affiliate_clicks,
      affiliate_revenue_brl, display_revenue_brl, notes, created_at, updated_at
    ) VALUES (
      @day, @campaign, @spendBRL, @visitors, @affiliateClicks,
      @affiliateRevenueBRL, @displayRevenueBRL, @notes, @createdAt, @updatedAt
    )
    ON CONFLICT(day, campaign) DO UPDATE SET
      spend_brl = excluded.spend_brl,
      visitors = excluded.visitors,
      affiliate_clicks = excluded.affiliate_clicks,
      affiliate_revenue_brl = excluded.affiliate_revenue_brl,
      display_revenue_brl = excluded.display_revenue_brl,
      notes = excluded.notes,
      updated_at = excluded.updated_at
  `).run({
    day: input.day,
    campaign: input.campaign || "geral",
    spendBRL: input.spendBRL ?? 0,
    visitors: input.visitors ?? 0,
    affiliateClicks: input.affiliateClicks ?? 0,
    affiliateRevenueBRL: input.affiliateRevenueBRL ?? 0,
    displayRevenueBRL: input.displayRevenueBRL ?? 0,
    notes: input.notes || "",
    createdAt: now,
    updatedAt: now
  });
  return rowToMetric(db.prepare("SELECT * FROM campaign_metrics WHERE day = ? AND campaign = ?").get(input.day, input.campaign || "geral"));
}

export function listCampaignMetrics(limit = 100) {
  return db.prepare("SELECT * FROM campaign_metrics ORDER BY day DESC, updated_at DESC LIMIT ?").all(limit).map(rowToMetric);
}

export function deleteCampaignMetric(id) {
  const metric = rowToMetric(db.prepare("SELECT * FROM campaign_metrics WHERE id = ?").get(id));
  if (!metric) return null;
  db.prepare("DELETE FROM campaign_metrics WHERE id = ?").run(id);
  return metric;
}

function rowToComparison(row) {
  if (!row) return null;
  const content = fromJson(row.items_json, {});
  return {
    id: row.id,
    query: row.query,
    slug: row.slug,
    title: row.title,
    category: row.category || "geral",
    intro: content.intro || "",
    conclusion: content.conclusion || "",
    socialCopy: content.socialCopy || "",
    items: Array.isArray(content.items) ? content.items : [],
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at || ""
  };
}

function comparisonContentJson(input) {
  return asJson({
    intro: input.intro || "",
    conclusion: input.conclusion || "",
    socialCopy: input.socialCopy || "",
    items: input.items || []
  });
}

export function getComparisonByQuery(query) {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) return null;
  return rowToComparison(db.prepare("SELECT * FROM comparisons WHERE lower(trim(query)) = ?").get(normalized));
}

export function createOrUpdateComparison(input) {
  const now = nowIso();
  // Upsert pela busca (query), nao pelo slug: o vencedor de uma mesma busca pode mudar
  // entre geracoes (dado do Mercado Livre muda), o que muda o slug. Se o upsert fosse
  // por slug, regerar a mesma busca criava uma linha nova em vez de substituir a antiga.
  const normalizedQuery = String(input.query || "").trim().toLowerCase();
  const existing = db.prepare("SELECT * FROM comparisons WHERE lower(trim(query)) = ?").get(normalizedQuery);
  if (existing) {
    db.prepare(`
      UPDATE comparisons SET query = ?, slug = ?, title = ?, category = ?, items_json = ?,
        status = ?, updated_at = ?, published_at = COALESCE(?, published_at)
      WHERE id = ?
    `).run(
      input.query,
      input.slug,
      input.title,
      input.category || existing.category || "geral",
      comparisonContentJson(input),
      input.status || existing.status || "draft",
      now,
      input.publishedAt || null,
      existing.id
    );
    return rowToComparison(db.prepare("SELECT * FROM comparisons WHERE id = ?").get(existing.id));
  }
  const result = db.prepare(`
    INSERT INTO comparisons(query, slug, title, category, items_json, status, created_at, updated_at, published_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.query,
    input.slug,
    input.title,
    input.category || "geral",
    comparisonContentJson(input),
    input.status || "draft",
    now,
    now,
    input.publishedAt || null
  );
  return getComparison(Number(result.lastInsertRowid));
}

export function getComparison(id) {
  return rowToComparison(db.prepare("SELECT * FROM comparisons WHERE id = ?").get(id));
}

export function getComparisonBySlug(slug) {
  return rowToComparison(db.prepare("SELECT * FROM comparisons WHERE slug = ?").get(slug));
}

export function listComparisons(limit = 100) {
  return db.prepare("SELECT * FROM comparisons ORDER BY updated_at DESC LIMIT ?").all(limit).map(rowToComparison);
}

export function closeDb() {
  db.close();
}

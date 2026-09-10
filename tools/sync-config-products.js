import { closeDb, upsertProduct } from "../server/db.js";
import { loadSiteConfig } from "../server/sitePublisher.js";

function marketplaceFromProduct(product) {
  if (product.storeKey) return product.storeKey;
  const store = String(product.store || "").toLowerCase();
  if (store.includes("amazon")) return "amazon";
  if (store.includes("shopee")) return "shopee";
  return "mercadolivre";
}

function dbProductFromConfig(product) {
  const marketplace = marketplaceFromProduct(product);
  return {
    id: product.id,
    marketplace,
    sourceUrl: product.sourceUrl || product.affiliateUrl || `config:${product.id}`,
    affiliateUrl: product.affiliateUrl || "",
    title: product.title,
    brand: product.brand || "",
    category: product.category || "geral",
    badge: product.badge || "",
    description: product.description || "",
    why: product.why || "",
    price: product.price ?? null,
    oldPrice: product.oldPrice ?? null,
    rating: product.rating ?? null,
    reviewLabel: product.reviewLabel || "",
    imageUrl: /^https?:\/\//i.test(String(product.image || "")) ? product.image : "",
    localImagePath: /^https?:\/\//i.test(String(product.image || "")) ? "" : product.image || "",
    specs: product.specs || [],
    pros: product.pros || [],
    cons: product.cons || [],
    status: product.affiliateUrl ? "published" : "needs_affiliate",
    publishedAt: product.updatedAt || null
  };
}

try {
  const cfg = loadSiteConfig();
  const products = Array.isArray(cfg.products) ? cfg.products : [];
  const saved = products.map((product) => upsertProduct(dbProductFromConfig(product)));
  console.log(`Produtos sincronizados da vitrine: ${saved.length}`);
  for (const product of saved) {
    console.log(`- ${product.id}: ${product.title}`);
  }
} finally {
  closeDb();
}

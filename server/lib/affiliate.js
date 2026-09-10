export function affiliateUrl(product, siteConfig) {
  if (!product?.affiliateUrl) return "";
  try {
    const url = new URL(product.affiliateUrl);
    const aff = siteConfig?.affiliates || {};
    const storeKey = product.storeKey || product.marketplace || "";
    if (storeKey === "mercadolivre" && /(^|\.)mercadolivre\.com\.br$/i.test(url.hostname)) {
      if (aff.mlMattTool) url.searchParams.set("matt_tool", aff.mlMattTool);
      if (aff.mlMattWord) url.searchParams.set("matt_word", aff.mlMattWord);
    }
    if (storeKey === "amazon" && aff.amazonTag) {
      url.searchParams.set("tag", aff.amazonTag);
    }
    return url.toString();
  } catch {
    return product.affiliateUrl;
  }
}

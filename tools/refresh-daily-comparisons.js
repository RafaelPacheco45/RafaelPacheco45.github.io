import { createDailyComparisons } from "../server/dailyComparisons.js";
const batch = await createDailyComparisons().ensureFresh();
if (!batch) throw new Error("Nenhum lote disponivel.");
console.log(JSON.stringify({ generatedAt: batch.generatedAt, nextRefreshAt: batch.nextRefreshAt,
  comparisons: batch.items.map(item => ({ query: item.query, offers: item.offers.length })) }, null, 2));

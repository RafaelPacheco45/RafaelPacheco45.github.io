import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "achado-agora-search-"));
process.env.AUTOBLOG_DB_PATH = path.join(testDir, "test.db");
process.env.AUTOBLOG_CHROME_PROFILE = path.join(testDir, "chrome-profile");
process.env.AUTOBLOG_PUBLIC_SEARCH_ORIGINS = "https://achadoagora.blog.br";

const {
  affiliateShoppingOffers,
  attemptAffiliateForWinner,
  chooseShoppingRecommendation,
  dedupeCandidates,
  rankShoppingCandidates,
  visibleShoppingOffers
} = await import("../server/shoppingSearchEngine.js");
const { createPublicSearchServer } = await import("../server/publicSearchServer.js");
const { lomadeePriceFromProduct } = await import("../server/adapters/lomadee.js");
const { isRelevantCandidate } = await import("../server/lib/searchRelevance.js");

function candidate(overrides = {}) {
  return {
    id: overrides.id || "item",
    marketplace: "mercadolivre",
    store: "Mercado Livre",
    sourceUrl: "https://www.mercadolivre.com.br/produto/p/MLB123",
    affiliateUrl: "",
    title: "Produto de teste",
    category: "tech",
    price: 100,
    rating: 4.8,
    reviewLabel: "1000 avaliacoes",
    imageUrl: "https://example.com/item.jpg",
    ...overrides
  };
}

test("afiliacao nao altera score nem ordem", () => {
  const plain = candidate({ id: "plain" });
  const affiliated = candidate({ id: "affiliated", affiliateUrl: "https://meli.la/abc123" });
  const ranked = rankShoppingCandidates([plain, affiliated]);
  assert.equal(ranked[0].score, ranked[1].score);
  assert.equal(ranked[0].id, "plain");
});

test("melhor produto vence antes da tentativa de afiliacao", () => {
  const better = candidate({ id: "better", price: 95, rating: 4.9, reviewLabel: "2500 avaliacoes" });
  const affiliated = candidate({ id: "affiliated", price: 108, rating: 4.7, reviewLabel: "400 avaliacoes", affiliateUrl: "https://meli.la/abc123" });
  const ranked = rankShoppingCandidates([affiliated, better]);
  const selected = chooseShoppingRecommendation(ranked, { priority: "balanced" });
  assert.equal(selected.id, "better");
  assert.equal(selected.selectionReason, "melhor equilibrio entre preco, avaliacao e confiabilidade");
});

test("somente o vencedor global recebe tentativa de afiliacao", async () => {
  const better = candidate({ id: "better", price: 95, rating: 4.9, reviewLabel: "2500 avaliacoes" });
  const other = candidate({ id: "other", price: 108, rating: 4.7, reviewLabel: "400 avaliacoes" });
  const winner = chooseShoppingRecommendation(rankShoppingCandidates([other, better]), { priority: "balanced" });
  const attempted = [];
  const affiliated = await attemptAffiliateForWinner(winner, {
    mercadoLivreGenerator: async (item) => {
      attempted.push(item.id);
      return "https://meli.la/winner123";
    }
  });
  assert.deepEqual(attempted, ["better"]);
  assert.equal(affiliated.id, "better");
  assert.equal(affiliated.affiliateUrl, "https://meli.la/winner123");
  assert.equal(affiliated.affiliateStatus, "generated");
});

test("preco da Lomadee permanece em reais", () => {
  const product = { options: [{ pricing: [{ price: 79.79 }] }] };
  assert.equal(lomadeePriceFromProduct(product), 79.79);
});

test("oferta repetida com rastreamento diferente aparece uma vez", () => {
  const first = candidate({ id: "one", sourceUrl: "https://loja.example/produto/123?utm_source=a" });
  const duplicate = candidate({ id: "two", sourceUrl: "https://loja.example/produto/123?utm_source=b" });
  assert.deepEqual(dedupeCandidates([first, duplicate]).map((item) => item.id), ["one"]);
});

test("busca sem fio rejeita produto com fio e entende wireless", () => {
  assert.equal(isRelevantCandidate({ title: "Mouse gamer RGB com fio" }, "mouse gamer sem fio"), false);
  assert.equal(isRelevantCandidate({ title: "Mouse gamer wireless RGB" }, "mouse gamer sem fio"), true);
});

test("acessorio nao vence o produto inteiro, salvo quando solicitado", () => {
  assert.equal(isRelevantCandidate({ title: "Placa de controle para geladeira Electrolux" }, "geladeira electrolux"), false);
  assert.equal(isRelevantCandidate({ title: "Geladeira Electrolux Inverter 400 Litros" }, "geladeira electrolux"), true);
  assert.equal(isRelevantCandidate({ title: "Placa de controle para geladeira Electrolux" }, "placa para geladeira electrolux"), true);
});

test("busca generica por geladeira rejeita utilidades e pecas que citam geladeira", () => {
  const query = "geladeira";
  assert.equal(isRelevantCandidate({ title: "Kit 6 Tampas Panela Silicone Cozinha Geladeira" }, query), false);
  assert.equal(isRelevantCandidate({ title: "Organizador Multiuso Porta Latas Despensa Geladeira" }, query), false);
  assert.equal(isRelevantCandidate({ title: "Gaveta de Legumes Compatível com Geladeira Electrolux" }, query), false);
  assert.equal(isRelevantCandidate({ title: "Borracha de Vedação para Geladeira Brastemp" }, query), false);
  assert.equal(isRelevantCandidate({ title: "Armário Aéreo Geladeira Aurea 80 cm 1 Porta" }, query), false);
  assert.equal(isRelevantCandidate({ title: "Geladeira Portátil para Caminhão 12v 24v" }, query), false);
  assert.equal(isRelevantCandidate({ title: "Cozinha Infantil Magic Forno Geladeira e Acessórios" }, query), false);
  assert.equal(isRelevantCandidate({ title: "Porta Geladeira Madesa Lux 1 Porta Basculante" }, query), false);
  assert.equal(isRelevantCandidate({ title: "Geladeira Brastemp Frost Free Duplex 375L" }, query), true);
  assert.equal(isRelevantCandidate({ title: "Electrolux Geladeira Inverter 480 Litros" }, query), true);
  assert.equal(isRelevantCandidate({ title: "Mini Geladeira Portátil 45 Litros 12v 110v" }, "geladeira portatil"), true);
});

test("acessorio de geladeira continua pesquisavel quando essa e a intencao", () => {
  assert.equal(isRelevantCandidate({ title: "Organizador Multiuso para Geladeira" }, "organizador para geladeira"), true);
  assert.equal(isRelevantCandidate({ title: "Kit 6 Tampas para Potes de Geladeira" }, "tampas para geladeira"), true);
  assert.equal(isRelevantCandidate({ title: "Armário Aéreo para Geladeira 80 cm" }, "armario para geladeira"), true);
  assert.equal(isRelevantCandidate({ title: "Porta de Geladeira Brastemp Original" }, "porta de geladeira"), true);
});

test("somente ofertas exibidas sao afiliadas sem mudar a ordem", async () => {
  const candidates = Array.from({ length: 5 }, (_, index) => candidate({
    id: `offer-${index}`,
    sourceUrl: `https://www.mercadolivre.com.br/produto/p/MLB12${index}`,
    title: `Mouse gamer sem fio modelo ${index}`,
    price: 100 + index,
    rating: 4.9 - index * 0.1
  }));
  const visible = visibleShoppingOffers(rankShoppingCandidates(candidates));
  const attempted = [];
  const affiliated = await affiliateShoppingOffers(visible, {
    mercadoLivreGenerator: async (item) => {
      attempted.push(item.id);
      return `https://meli.la/${item.id}`;
    }
  });
  assert.deepEqual(affiliated.map((item) => item.id), visible.map((item) => item.id));
  assert.deepEqual(attempted, visible.map((item) => item.id));
  assert.ok(affiliated.every((item) => item.affiliateReady && item.affiliateUrl.startsWith("https://meli.la/")));
});

test("gateway expoe somente busca, aplica CORS e forca busca ao vivo", async (t) => {
  let received;
  let searchCalls = 0;
  const server = createPublicSearchServer({
    search: async (input) => {
      searchCalls += 1;
      received = input;
      return { ok: true, status: "ready", recommendation: { id: "winner" }, alternatives: [] };
    },
    allowedOrigins: new Set(["https://achadoagora.blog.br"])
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;

  const response = await fetch(`${base}/api/shopping-search`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://achadoagora.blog.br" },
    body: JSON.stringify({ query: "fone bluetooth", live: false, preferAffiliate: false })
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "https://achadoagora.blog.br");
  assert.equal(received.live, true);
  assert.equal(received.preferAffiliate, true);
  assert.equal(received.headless, true);

  const cached = await fetch(`${base}/api/shopping-search`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://achadoagora.blog.br" },
    body: JSON.stringify({ query: "fone bluetooth" })
  });
  assert.equal(cached.status, 200);
  assert.equal((await cached.json()).cache, "hit");
  assert.equal(searchCalls, 1);

  const hidden = await fetch(`${base}/api/tasks`, { headers: { origin: "https://achadoagora.blog.br" } });
  assert.equal(hidden.status, 404);

  const blocked = await fetch(`${base}/api/shopping-search`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://example.org" },
    body: JSON.stringify({ query: "fone bluetooth" })
  });
  assert.equal(blocked.status, 403);

  for (let index = 0; index < 4; index += 1) {
    const allowed = await fetch(`${base}/api/shopping-search`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://achadoagora.blog.br" },
      body: JSON.stringify({ query: `produto ${index}` })
    });
    assert.equal(allowed.status, 200);
  }
  const limited = await fetch(`${base}/api/shopping-search`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://achadoagora.blog.br" },
    body: JSON.stringify({ query: "produto bloqueado" })
  });
  assert.equal(limited.status, 429);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), "achado-agora-gateway-"));
process.env.AUTOBLOG_DB_PATH = path.join(testDir, "test.db");
process.env.AUTOBLOG_CHROME_PROFILE = path.join(testDir, "chrome-profile");
process.env.AUTOBLOG_PUBLIC_SEARCH_RATE_LIMIT = "6";
process.env.AUTOBLOG_PUBLIC_SEARCH_MAX_QUEUE = "2";
const { createPublicSearchServer } = await import("../server/publicSearchServer.js");
const ORIGIN = "https://achadoagora.blog.br";
const ready = () => ({ ok: true, status: "ready", recommendation: { id: "item" }, alternatives: [] });

async function gateway(t, options = {}) {
  const server = createPublicSearchServer({
    allowedOrigins: new Set([ORIGIN]),
    trustedProxyAddresses: [],
    search: async () => ready(),
    ...options
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body = { query: "geladeira" }, headers = {}) => fetch(`${base}/api/shopping-search`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, ...headers },
    body: JSON.stringify(body)
  });
  return { base, post };
}

test("somente saude e busca ficam publicas; origem invalida nao escapa do CORS", async (t) => {
  const { base, post } = await gateway(t, { rateLimit: 100 });
  for (const route of ["/admin", "/api/tasks", "/api/status", "/api/products", "/api/shopping-search"]) {
    assert.equal((await fetch(`${base}${route}`)).status, 404, route);
  }
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  for (const origin of ["null", "invalida", `${ORIGIN}/`, `${ORIGIN}/rota`, "https://outro.example"]) {
    const blocked = await post(undefined, { origin });
    assert.equal(blocked.status, 403, origin);
    assert.equal(blocked.headers.get("access-control-allow-origin"), null);
  }
  const preflight = await fetch(`${base}/api/shopping-search`, { method: "OPTIONS", headers: { origin: ORIGIN } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(preflight.headers.get("vary"), "Origin");
});

test("headers de IP forjados nao contornam o limite de uma conexao direta", async (t) => {
  const { post } = await gateway(t, { rateLimit: 2 });
  for (const suffix of [1, 2]) {
    assert.equal((await post(undefined, { "cf-connecting-ip": `203.0.113.${suffix}`, "x-forwarded-for": `198.51.100.${suffix}` })).status, 200);
  }
  assert.equal((await post(undefined, { "cf-connecting-ip": "203.0.113.3", "x-forwarded-for": "198.51.100.3" })).status, 429);
});

test("proxy local confiavel preserva IPs distintos e normaliza IPv6", async (t) => {
  const { post } = await gateway(t, { trustedProxyAddresses: ["127.0.0.1"], rateLimit: 1 });
  assert.equal((await post(undefined, { "cf-connecting-ip": "2001:db8::1" })).status, 200);
  assert.equal((await post(undefined, { "cf-connecting-ip": "2001:0db8:0:0:0:0:0:1" })).status, 429);
  assert.equal((await post(undefined, { "cf-connecting-ip": "203.0.113.2" })).status, 200);
  assert.equal((await post(undefined, { "cf-connecting-ip": "fe80::1%eth0", "x-forwarded-for": "203.0.113.3" })).status, 200);
  assert.equal((await post(undefined, { "cf-connecting-ip": "invalido", "x-forwarded-for": "203.0.113.4" })).status, 429);
});

test("entrada invalida retorna erro publico sem invocar lojas", async (t) => {
  let calls = 0;
  const { base, post } = await gateway(t, { rateLimit: 100, search: async () => { calls += 1; return ready(); } });
  for (const body of [null, [], "geladeira", {}, { query: {} }, { query: "x" }, { query: "a".repeat(161) },
    { query: "geladeira", priceMax: {} }, { query: "geladeira", priceMin: -1 },
    { query: "geladeira", minRating: 6 }, { query: "geladeira", limit: true },
    { query: "geladeira", priority: "inventada" }, { query: "geladeira", marketplaces: ["loja-inventada"] }]) {
    assert.equal((await post(body)).status, 400, JSON.stringify(body));
  }
  const malformed = await fetch(`${base}/api/shopping-search`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
  assert.equal(malformed.status, 400);
  assert.doesNotMatch(await malformed.text(), /SyntaxError|JSON at position|Unexpected/);
  assert.equal((await post(undefined, { "content-type": "text/plain" })).status, 415);
  assert.equal((await post(undefined, { "content-encoding": "gzip" })).status, 415);
  assert.equal(calls, 0);
});

test("limite de corpo responde 413 tanto com tamanho declarado quanto em chunks", async (t) => {
  const { base, post } = await gateway(t);
  assert.equal((await post({ query: "x".repeat(9000) })).status, 413);
  const chunked = await new Promise((resolve, reject) => {
    const request = http.request(`${base}/api/shopping-search`, { method: "POST", headers: { "content-type": "application/json" } }, (response) => {
      response.resume();
      response.on("end", () => resolve(response.statusCode));
    });
    request.on("error", reject);
    request.write('{"query":"');
    request.write("x".repeat(9000));
    request.end('"}');
  });
  assert.equal(chunked, 413);
  assert.equal((await post()).status, 200);
});

test("cache tem teto, expira e compartilha filtros equivalentes", async (t) => {
  let calls = 0;
  let instant = 1000000;
  const { post } = await gateway(t, { maxCacheEntries: 2, rateLimit: 100, now: () => instant,
    search: async () => { calls += 1; return ready(); } });
  const first = { query: "geladeira", priceMin: "200", priceMax: "100", marketplaces: ["amazon", "amazon", "magalu"] };
  assert.equal((await (await post(first)).json()).cache, "miss");
  assert.equal((await (await post({ ...first, priceMin: 100, priceMax: 200, marketplaces: ["magalu", "amazon"] })).json()).cache, "hit");
  assert.equal(calls, 1);
  await post({ query: "fogao" });
  await post({ query: "lavadora" });
  assert.equal((await (await post(first)).json()).cache, "miss");
  assert.equal(calls, 4);
  instant += 86400001;
  assert.equal((await (await post(first)).json()).cache, "miss");
  assert.equal(calls, 5);
});

test("teto de IPs preserva limites existentes e libera buckets expirados", async (t) => {
  let instant = 1000000;
  const { post } = await gateway(t, { trustedProxyAddresses: ["127.0.0.1"], maxRateBuckets: 2, rateLimit: 1, now: () => instant });
  const client = (id) => post(undefined, { "cf-connecting-ip": `203.0.113.${id}` });
  assert.equal((await client(1)).status, 200);
  assert.equal((await client(2)).status, 200);
  assert.equal((await client(3)).status, 429);
  assert.equal((await client(1)).status, 429);
  instant += 3600001;
  assert.equal((await client(3)).status, 200);
});

test("falhas internas sao ocultadas e nao ficam presas no cache", async (t) => {
  let calls = 0;
  const secret = "C:/perfil/privado token=segredo";
  const { post } = await gateway(t, { search: async () => {
    calls += 1;
    return { ...ready(), liveError: secret, sourceStatus: [{ status: "error", error: secret }],
      recommendation: { affiliateError: secret }, cheapest: { affiliateError: secret },
      topRated: { affiliateError: secret }, offers: [{ affiliateError: secret }], alternatives: [{ affiliateError: secret }] };
  } });
  const result = await (await post()).json();
  assert.doesNotMatch(JSON.stringify(result), /privado|segredo/);
  assert.match(result.sourceStatus[0].error, /temporariamente/);
  await post();
  assert.equal(calls, 2);
});

test("fila serializa lojas, compartilha buscas iguais, rejeita excesso e se recupera", async (t) => {
  let releaseFirst;
  let firstEntered;
  const entered = new Promise((resolve) => { firstEntered = resolve; });
  const hold = new Promise((resolve) => { releaseFirst = resolve; });
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  const { base, post } = await gateway(t, { rateLimit: 100, search: async () => {
    calls += 1;
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (calls === 1) { firstEntered(); await hold; }
    active -= 1;
    return ready();
  } });
  t.after(() => releaseFirst());
  const first = post({ query: "geladeira" });
  await entered;
  const duplicate = post({ query: "geladeira" });
  const second = post({ query: "fogao" });
  const third = post({ query: "lavadora" });
  let queue;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    queue = (await (await fetch(`${base}/healthz`)).json()).queue;
    if (queue.waiting === 2) break;
  }
  assert.deepEqual(queue, { active: true, waiting: 2 });
  const full = await post({ query: "televisao" });
  assert.equal(full.status, 503);
  assert.equal(full.headers.get("retry-after"), "5");
  releaseFirst();
  for (const response of await Promise.all([first, duplicate, second, third])) assert.equal(response.status, 200);
  assert.equal(calls, 3);
  assert.equal(maxActive, 1);
  assert.equal((await post({ query: "televisao" })).status, 200);
  assert.equal(calls, 4);
});

test("excecao do motor nao expoe detalhes nem impede a proxima tentativa", async (t) => {
  let calls = 0;
  const { post } = await gateway(t, { search: async () => {
    calls += 1;
    if (calls === 1) throw new Error("token=segredo caminho privado");
    return ready();
  } });
  const failed = await post();
  assert.equal(failed.status, 500);
  assert.doesNotMatch(await failed.text(), /segredo|privado/);
  assert.equal((await post()).status, 200);
  assert.equal(calls, 2);
});

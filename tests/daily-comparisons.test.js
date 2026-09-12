import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDailyComparisons, DAY_MS } from '../server/dailyComparisons.js';

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-comparison-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let clock = Date.now(), calls = 0, valid = true;
  const options = { file: path.join(dir, 'batch.json'), now: () => clock,
    topics: Array.from({length: 18}, (_, i) => `produto ${i}`), report: () => {},
    search: async ({query}) => {
      calls++;
      return { mode: 'live', isCached: false, offers: Array.from({length: 3}, (_, i) => ({
        id: `${query}-${i}`, title: `${query} ${i}`, marketplace: 'mercadolivre', price: 100 + i,
        sourceUrl: `https://www.mercadolivre.com.br/${query.replaceAll(' ', '-')}-${i}`,
        affiliateUrl: valid ? `https://meli.la/${query.replaceAll(' ', '')}${i}` : 'https://www.mercadolivre.com.br/produto',
        checkedAt: new Date(clock).toISOString()
      })) };
    } };
  return { options, advance: () => {clock += DAY_MS;}, fail: () => {valid = false;}, calls: () => calls };
}

test('six new comparisons every 24h, three affiliates each; restart preserves schedule and previous detail', async t => {
  const ctx = setup(t);
  const service = createDailyComparisons(ctx.options);
  const first = await service.ensureFresh();
  assert.equal(first.items.length, 6);
  assert.equal(ctx.calls(), 6);
  await createDailyComparisons(ctx.options).ensureFresh();
  assert.equal(ctx.calls(), 6);
  ctx.advance();
  const second = await service.ensureFresh();
  assert.equal(ctx.calls(), 12);
  assert.ok(second.items.every(item => !first.items.some(old => old.query === item.query)));
  assert.deepEqual(service.readItem(first.items[0].id), first.items[0]);
  assert.equal(service.readItem('../batch'), null);
});

test('failed affiliate generation never replaces the last complete batch and backs off', async t => {
  const ctx = setup(t), service = createDailyComparisons(ctx.options);
  const first = await service.ensureFresh();
  ctx.advance(); ctx.fail();
  await assert.rejects(service.ensureFresh(), /0\/6/);
  assert.deepEqual(service.read(), first);
  const calls = ctx.calls();
  await service.ensureFresh();
  assert.equal(ctx.calls(), calls);
});

test('simultaneous refreshes share one batch generation', async t => {
  const ctx = setup(t), service = createDailyComparisons(ctx.options);
  const results = await Promise.all([service.ensureFresh(), service.ensureFresh(), service.ensureFresh()]);
  assert.equal(ctx.calls(), 6);
  assert.deepEqual(results[0], results[2]);
});

test('cached prices cannot become a new daily batch', async t => {
  const ctx = setup(t);
  const service = createDailyComparisons({...ctx.options, search: async () => ({mode:'cache', isCached:true, offers:[]})});
  await assert.rejects(service.ensureFresh(), /0\/6/);
  assert.equal(service.read(), null);
});

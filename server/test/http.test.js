'use strict';
const test = require('node:test');
const assert = require('node:assert');
process.env.DATA_DIR = require('os').tmpdir() + '/bs-test-' + process.pid;
const app = require('../index');

test('статика: только белый список, без обходов и падений', async () => {
  const { resolveStatic } = app;
  assert.ok(resolveStatic('/'));
  assert.equal(resolveStatic('/').rel, 'index.html');
  assert.ok(resolveStatic('/js/app.js'));
  assert.ok(resolveStatic('/css/style.css?v=1'));
  assert.equal(resolveStatic('/README.md'), null);
  assert.equal(resolveStatic('/docker-compose.yml'), null);
  assert.equal(resolveStatic('/.env'), null);
  assert.equal(resolveStatic('/server/db.js'), null);
  assert.equal(resolveStatic('/js/../server/db.js'), null);
  assert.equal(resolveStatic('/..%2f..%2fetc/passwd'), null);
  assert.equal(resolveStatic('/index.html%00'), null);
  assert.equal(resolveStatic('/%E0%A4%A'), null);
  assert.equal(resolveStatic('/' + 'a'.repeat(5000)), null);
});

test('имена игроков очищаются', () => {
  const { cleanName } = app;
  assert.equal(cleanName('  Аня\u0000\u200b  '), 'Аня');
  assert.equal(cleanName('<script>alert(1)</script>').length, 16);
  assert.equal(cleanName(''), 'Капитан');
  assert.equal(cleanName('x'.repeat(50)).length, 16);
});

test('сервер отвечает 404, а не падает, на битые URL', async () => {
  const server = await app.start(0, '127.0.0.1');
  const base = `http://127.0.0.1:${server.address().port}`;
  const code = async (p) => (await fetch(base + p)).status;
  assert.equal(await code('/healthz'), 200);
  assert.equal(await code('/index.html%00'), 404);
  assert.equal(await code('/%E0%A4%A'), 404);
  assert.equal(await code('/README.md'), 404);
  assert.equal(await code('/js/'), 404);
  assert.equal(await code('/server/db.js'), 404);
  assert.equal(await code('/js/../server/db.js'), 404);
  assert.equal(await code('/..%2f..%2fetc/passwd'), 404);
  assert.equal(await code('/api/daily/top?date=zzz'), 400);
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
  assert.equal(await code('/healthz'), 200);
  const h = await fetch(base + '/');
  assert.equal(h.headers.get('x-content-type-options'), 'nosniff');
  server.close();
});

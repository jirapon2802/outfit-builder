import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { NextRequest } from 'next/server.js';
import ts from 'typescript';

async function sourceModule(file) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}
const { generationBlock, restoreSelection } = await sourceModule('../src/lib/outfit.ts');
const { removePlainBackground } = await sourceModule('../src/lib/images.ts');
const { runFastFit, runQwenEdit, readResult, providerFailure } = await sourceModule('../src/lib/providers.ts');
const complete = { top: 't', bottom: 'b', shoes: 's' };

test('generation requires all three pieces; outerwear, quota, availability, and busy state block it', () => {
  assert.equal(generationBlock(complete, true), null);
  for (const category of ['top', 'bottom', 'shoes']) assert.match(generationBlock({ ...complete, [category]: undefined }, true), /Select a top/);
  assert.match(generationBlock({ ...complete, outerwear: 'o' }, true), /Outerwear/);
  assert.match(generationBlock(complete, false), /not connected/);
  assert.match(generationBlock(complete, true, true), /Creating/);
  assert.match(generationBlock(complete, true, false, true), /limit/);
});

test('API validates pieces and outerwear before inference, and handles success and quota', async () => {
  const require = createRequire(import.meta.url);
  const providerSource = await readFile(new URL('../src/lib/providers.ts', import.meta.url), 'utf8');
  const providerJS = ts.transpileModule(providerSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const providerURL = `data:text/javascript;base64,${Buffer.from(providerJS).toString('base64')}`;
  const routeSource = (await readFile(new URL('../src/app/api/try-on/route.ts', import.meta.url), 'utf8'))
    .replace('"@/lib/providers"', JSON.stringify(providerURL))
    .replace('"next/server"', JSON.stringify(pathToFileURL(require.resolve('next/server')).href));
  const routeJS = ts.transpileModule(routeSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const { GET, POST } = await import(`data:text/javascript;base64,${Buffer.from(routeJS).toString('base64')}`);
  const previous = { FASTFIT_URL: process.env.FASTFIT_URL, HF_TOKEN: process.env.HF_TOKEN, IMAGE_EDIT_URL: process.env.IMAGE_EDIT_URL };
  delete process.env.FASTFIT_URL; delete process.env.HF_TOKEN;
  // Point at a closed port so the check never reaches the public Space.
  process.env.IMAGE_EDIT_URL = 'http://127.0.0.1:1';
  assert.equal((await (await GET()).json()).available, false);
  let queued = 0, quota = false, origin;
  const fixture = await readFile(new URL('./fixtures/top.png', import.meta.url));
  const server = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    response.setHeader('content-type', 'application/json');
    if (request.url === '/gradio_api/info') response.end('{"named_endpoints":{"/try_on":{}}}');
    else if (request.url === '/gradio_api/upload') response.end('["a","b","c","d"]');
    else if (request.url === '/gradio_api/call/try_on') { queued++; response.end('{"event_id":"outfit"}'); }
    else if (request.url === '/gradio_api/call/try_on/outfit') {
      response.setHeader('content-type', 'text/event-stream');
      response.end(quota ? 'event: error\ndata: "GPU quota exceeded, retry in 10m"\n\n' : `event: complete\ndata: [{"url":"${origin}/gradio_api/file=result.png"}]\n\n`);
    } else { response.setHeader('content-type', 'image/png'); response.end(fixture); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  process.env.FASTFIT_URL = origin;
  const makeRequest = ({ outerwear = false, omit = '', requestOrigin = 'http://localhost:3000' } = {}) => {
    const form = new FormData(); form.set('presentation', 'feminine');
    for (const kind of ['top', 'bottom', 'shoes']) if (kind !== omit) form.set(kind, new Blob([fixture], { type: 'image/png' }), `${kind}.png`);
    if (outerwear) form.set('outerwear', 'selected');
    return new NextRequest('http://localhost:3000/api/try-on', { method: 'POST', headers: { origin: requestOrigin }, body: form });
  };
  try {
    assert.equal((await (await GET()).json()).available, true);
    assert.equal((await POST(makeRequest({ requestOrigin: 'https://another-site.invalid' }))).status, 403);
    assert.equal((await POST(makeRequest({ outerwear: true }))).status, 400);
    assert.equal((await POST(makeRequest({ omit: 'shoes' }))).status, 400);
    assert.equal(queued, 0, 'invalid outfits must never consume inference');
    const result = await POST(makeRequest());
    assert.equal(result.status, 200); assert.equal(result.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), fixture); assert.equal(queued, 1);
    quota = true;
    const limited = await POST(makeRequest()); assert.equal(limited.status, 429); assert.equal((await limited.json()).retryAfter, 600);
    assert.equal((await POST(makeRequest())).status, 429); assert.equal(queued, 2, 'cooldown must avoid another inference request');
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
test('restoring selections drops deleted garments and mismatched categories', () => {
  assert.deepEqual(restoreSelection(complete, [{ id: 't', category: 'top' }, { id: 'b', category: 'outerwear' }]), { top: 't' });
});
test('background cleanup preserves the garment and enclosed matching colors', () => {
  const width = 10; const pixels = new Uint8ClampedArray(10 * 10 * 4).fill(255);
  for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) { const i = (y * width + x) * 4; pixels[i] = 80; pixels[i + 1] = 100; pixels[i + 2] = 70; }
  pixels[44 * 4] = pixels[44 * 4 + 1] = pixels[44 * 4 + 2] = 255;
  assert.equal(removePlainBackground(pixels, width, 10), true);
  assert.equal(pixels[3], 0);
  assert.equal(pixels[44 * 4 + 3], 255);
  assert.equal(pixels[33 * 4 + 3], 255);
});
test('background cleanup refuses images where removal would erase almost everything', () => {
  const pixels = new Uint8ClampedArray(400).fill(255);
  assert.equal(removePlainBackground(pixels, 10, 10), false);
  assert.equal(pixels[3], 255);
});
test('quota errors preserve provider retry duration without confusing ordinary errors', () => {
  const error = providerFailure('GPU quota exceeded. Try again in 2h 15m 10s');
  assert.equal(error.status, 429); assert.equal(error.retryAfter, 8110);
  assert.equal(providerFailure('CUDA out of memory').status, 503);
});
test('SSE parser handles fragmented events, heartbeats, quota failures and unfinished streams', async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({ start(controller) {
    for (const part of ['event: heartbeat\r\ndata: null\r\n\r\nev', 'ent: complete\ndata: [{"url":"ok"}]\n', '\n']) controller.enqueue(encoder.encode(part));
    controller.close();
  } });
  assert.deepEqual(await readResult(new Response(stream)), [{ url: 'ok' }]);
  await assert.rejects(readResult(new Response('event: error\ndata: "GPU quota exceeded"\n\n')), e => e.status === 429);
  await assert.rejects(readResult(new Response('event: heartbeat\ndata: null\n\n')), /ended before/);
  await assert.rejects(readResult(new Response('event: error\ndata: null\n\n')), e => e.status === 429 && /allowance is used up, or the access token/.test(e.message));
});
test('Qwen adapter sends the gallery payload with the token and never enables prompt rewriting', async () => {
  let payload, authorization, origin;
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    if (request.url === '/gradio_api/upload') {
      response.setHeader('content-type', 'application/json'); response.end('["m","t","b","s"]');
    } else if (request.url === '/gradio_api/call/infer') {
      authorization = request.headers.authorization; payload = JSON.parse(Buffer.concat(chunks).toString()).data;
      response.setHeader('content-type', 'application/json'); response.end('{"event_id":"job"}');
    } else if (request.url === '/gradio_api/call/infer/job') {
      response.setHeader('content-type', 'text/event-stream');
      response.end(`event: complete\ndata: ${JSON.stringify([[{ image: { path: '/tmp/gradio/out.webp' } }], 42])}\n\n`);
    } else { response.setHeader('content-type', 'image/webp'); response.end(Buffer.from([82, 73, 70, 70])); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const images = Array.from({ length: 4 }, () => new Blob(['test'], { type: 'image/webp' }));
    const image = await runQwenEdit(origin, images, 'hf_test', AbortSignal.timeout(5000));
    assert.equal(image.type, 'image/webp');
    assert.equal(authorization, 'Bearer hf_test');
    assert.deepEqual(payload[0].map(item => item.image.path), ['m', 't', 'b', 's']);
    assert.match(payload[1], /picture 1/i);
    assert.deepEqual(payload.slice(-3), [256, 256, false], 'auto-size sentinel, and prompt rewriting stays off');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
test('Gradio adapter uploads four images, queues once and retrieves only a same-origin result', async () => {
  let mode = 'success', calls = 0, origin;
  const server = createServer(async (request, response) => {
    if (request.url === '/gradio_api/upload') {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      assert.equal((Buffer.concat(chunks).toString().match(/name="files"/g) || []).length, 4);
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(['a', 'b', 'c', 'd']));
    } else if (request.url === '/gradio_api/call/try_on') {
      calls++; response.setHeader('content-type', 'application/json'); response.end('{"event_id":"test-job"}');
    } else if (request.url === '/gradio_api/call/try_on/test-job') {
      response.setHeader('content-type', 'text/event-stream');
      if (mode === 'quota') response.end('event: error\ndata: "GPU quota exceeded. Try again in 15m"\n\n');
      else response.end(`event: complete\ndata: ${JSON.stringify([{ url: mode === 'external' ? 'https://untrusted.invalid/picture.png' : `${origin}/gradio_api/file=result.png` }])}\n\n`);
    } else { response.setHeader('content-type', 'image/png'); response.end(Buffer.from([137,80,78,71])); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const images = Array.from({ length: 4 }, () => new Blob(['test'], { type: 'image/webp' }));
    const image = await runFastFit(origin, images, AbortSignal.timeout(5000));
    assert.equal(image.type, 'image/png'); assert.equal(image.size, 4); assert.equal(calls, 1);
    mode = 'external'; await assert.rejects(runFastFit(origin, images, AbortSignal.timeout(5000)), /unexpected image location/);
    mode = 'quota'; await assert.rejects(runFastFit(origin, images, AbortSignal.timeout(5000)), e => e.status === 429 && e.retryAfter === 900);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

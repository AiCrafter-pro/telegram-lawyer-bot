import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// 엔진과 Telegram만 대체하고 배포할 Worker/DO 소스 자체를 실행합니다.
const source = (await readFile(new URL('./worker.js', import.meta.url), 'utf8'))
  .replace(/import \{[^}]+\} from '\.\/engine\.js';/,
    'const processCloudQuery = (...args) => globalThis.__lawEngine(...args); const checkCloudSetup = async () => ({openai:true});');
const { default: worker, Conversation, normalizeUpdate, splitReply, compactSession } =
  await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));

class MemoryStorage {
  constructor() { this.values = new Map(); this.alarmAt = null; this.tail = Promise.resolve(); }
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { return this.values.delete(key); }
  async list({ prefix = '', limit = Infinity } = {}) {
    return new Map([...this.values].filter(([key]) => key.startsWith(prefix)).sort(([a], [b]) => a.localeCompare(b))
      .slice(0, limit).map(([key, value]) => [key, structuredClone(value)]));
  }
  async getAlarm() { return this.alarmAt; }
  async setAlarm(value) { this.alarmAt = value; }
  async deleteAlarm() { this.alarmAt = null; }
  transaction(callback) {
    const result = this.tail.then(() => callback(this));
    this.tail = result.catch(() => {});
    return result;
  }
}

function update(id, extra = {}) {
  return { update_id: id, message: { message_id: id, from: { id: 22 }, chat: { id: 11 }, text: '임대차 질문', ...extra } };
}
function incoming(item) {
  return new Request('https://conversation/inbox', { method: 'POST', body: JSON.stringify(item) });
}
function harness(t) {
  let now = 1_800_000_000_000;
  t.mock.method(Date, 'now', () => now);
  const storage = new MemoryStorage();
  const env = { TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret' };
  let object = new Conversation({ storage }, env);
  const telegramCalls = [];
  const engineCalls = [];
  let messageId = 500;
  let telegramHandler = null;
  let engineHandler = null;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const method = String(url).split('/').at(-1);
    const body = JSON.parse(options.body);
    telegramCalls.push({ method, body });
    if (telegramHandler) {
      const response = await telegramHandler(method, body);
      if (response) return response;
    }
    return Response.json({ ok: true, result: { message_id: ++messageId } });
  });
  globalThis.__lawEngine = async (input, engineEnv) => {
    engineCalls.push(structuredClone(input));
    return engineHandler ? engineHandler(input, engineEnv) : {
      text: '확인한 법령에 따른 답변입니다.',
      session: { history: [{ role: 'user', content: input.userMessage }, { role: 'assistant', content: '답변' }], turns: 1 },
    };
  };
  t.after(() => { delete globalThis.__lawEngine; });
  return {
    storage, env, telegramCalls, engineCalls,
    advance(ms) { now += ms; },
    restart() { object = new Conversation({ storage }, env); },
    setEngine(fn) { engineHandler = fn; },
    setTelegram(fn) { telegramHandler = fn; },
    enqueue(value) { return object.fetch(incoming(normalizeUpdate(value))); },
    alarm() { storage.alarmAt = null; return object.alarm(); },
    object() { return object; },
  };
}

test('webhook은 secret을 검사하고 영속 저장 성공 뒤에만 200을 반환한다', async t => {
  const h = harness(t);
  let calls = 0;
  h.env.CONVERSATIONS = {
    idFromName(name) { assert.equal(name, '11:22'); return name; },
    get() { return { async fetch(request) { calls++; return h.object().fetch(request); } }; },
  };
  const request = secret => new Request('https://bot/telegram/webhook', {
    method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': secret }, body: JSON.stringify(update(1)),
  });
  assert.equal((await worker.fetch(request('wrong'), h.env)).status, 401);
  assert.equal(calls, 0);
  assert.equal((await worker.fetch(request('test-webhook-secret'), h.env)).status, 200);
  assert.equal((await h.storage.get('inbox')).keys.length, 1);
  assert.equal((await worker.fetch(request('test-webhook-secret'), h.env)).status, 200);
  assert.equal((await h.storage.get('inbox')).keys.length, 1);
  h.env.CONVERSATIONS.get = () => ({ fetch: async () => { throw new Error('storage offline'); } });
  assert.equal((await worker.fetch(request('test-webhook-secret'), h.env)).status, 503);
});

test('webhook은 길이 헤더 없는 큰 본문도 128KiB에서 차단한다', async () => {
  const response = await worker.fetch(new Request('https://bot/telegram/webhook', {
    method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'secret' },
    body: 'x'.repeat(128 * 1024 + 1),
  }), { TELEGRAM_WEBHOOK_SECRET: 'secret' });
  assert.equal(response.status, 413);
});

test('잘못된 JSON은 400, 무관한 update는 200, health는 최소 응답이다', async () => {
  const request = body => new Request('https://bot/telegram/webhook', {
    method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'secret' }, body,
  });
  assert.equal((await worker.fetch(request('{'), { TELEGRAM_WEBHOOK_SECRET: 'secret' })).status, 400);
  assert.equal((await worker.fetch(request('{}'), { TELEGRAM_WEBHOOK_SECRET: 'secret' })).status, 200);
  assert.deepEqual(await (await worker.fetch(new Request('https://bot/health'), {})).json(), { status: 'ok' });
});

test('재시작 후 inbox를 처리하며 완료된 update가 다시 와도 중복 답변하지 않는다', async t => {
  const h = harness(t);
  await h.enqueue(update(1));
  h.restart();
  h.advance(2);
  await h.alarm();
  assert.equal(h.engineCalls.length, 1);
  assert.equal(h.telegramCalls.filter(call => call.method === 'sendMessage').length, 1);
  assert.equal(h.telegramCalls.filter(call => call.method === 'editMessageText').length, 1);
  assert.deepEqual((await h.storage.get('inbox')).keys, []);
  await h.enqueue(update(1));
  await h.alarm();
  assert.equal(h.engineCalls.length, 1);
});

test('앨범 조각은 재시작에도 모이며 바이너리 대신 fileId를 엔진에 넘긴다', async t => {
  const h = harness(t);
  await h.enqueue(update(10, { text: undefined, caption: '계약서 검토', media_group_id: 'album-a',
    photo: [{ file_id: 'small', file_size: 10 }, { file_id: 'photo-a', file_size: 100 }] }));
  h.advance(500);
  h.restart();
  await h.enqueue(update(11, { text: undefined, media_group_id: 'album-a',
    document: { file_id: 'pdf-b', mime_type: 'application/pdf', file_size: 200 } }));
  await h.alarm();
  assert.equal(h.engineCalls.length, 0);
  h.advance(1801);
  await h.alarm();
  assert.equal(h.engineCalls.length, 1);
  assert.equal(h.engineCalls[0].userMessage, '계약서 검토');
  assert.deepEqual(h.engineCalls[0].files, [
    { fileId: 'photo-a', mimeType: 'image/jpeg', fileSize: 100 },
    { fileId: 'pdf-b', mimeType: 'application/pdf', fileSize: 200 },
  ]);
});

test('엔진 실행 중 수신된 앨범 조각은 후속 작업으로 보존된다', async t => {
  const h = harness(t);
  await h.enqueue(update(20, { media_group_id: 'album-b', photo: [{ file_id: 'first' }] }));
  h.setEngine(async input => {
    if (h.engineCalls.length === 1) await h.enqueue(update(21, { media_group_id: 'album-b', photo: [{ file_id: 'late' }] }));
    return { text: input.files[0].fileId };
  });
  h.advance(1801);
  await h.alarm();
  assert.equal((await h.storage.get('inbox')).keys.length, 1);
  h.advance(1801);
  await h.alarm();
  assert.deepEqual(h.engineCalls.map(call => call.files[0].fileId), ['first', 'late']);
});

test('세션은 다음 질문에 전달되고 30분 후 삭제된다', async t => {
  const h = harness(t);
  await h.enqueue(update(1));
  h.advance(2);
  await h.alarm();
  await h.enqueue(update(2));
  h.advance(2);
  await h.alarm();
  assert.equal(h.engineCalls[1].session.turns, 1);
  h.advance(30 * 60 * 1000 + 1);
  await h.alarm();
  assert.equal(await h.storage.get('session'), undefined);
  await h.enqueue(update(3));
  h.advance(2);
  await h.alarm();
  assert.equal(h.engineCalls[2].session, null);
});

test('/clear와 /start는 엔진 호출 없이 기존 대화를 지운다', async t => {
  const h = harness(t);
  for (const [id, command] of [[1, '/clear'], [2, '/start@lawbot']]) {
    await h.storage.put('session', { history: [{ role: 'user', content: '이전 질문' }], turns: 1, expiresAt: Date.now() + 10000 });
    await h.enqueue(update(id, { text: command }));
    h.advance(2);
    await h.alarm();
    assert.equal(await h.storage.get('session'), undefined);
  }
  assert.equal(h.engineCalls.length, 0);
  assert.ok(h.telegramCalls.some(call => call.body.text.includes('이전 대화를 지웠')));
});

test('실패한 답변 편집 재시도는 엔진을 다시 호출하거나 placeholder를 중복 생성하지 않는다', async t => {
  const h = harness(t);
  let edits = 0;
  h.setTelegram(method => method === 'editMessageText' && ++edits === 1
    ? Response.json({ ok: false, error_code: 429, parameters: { retry_after: 7 } }, { status: 429 }) : null);
  await h.enqueue(update(1));
  h.advance(2);
  await h.alarm();
  assert.equal(h.engineCalls.length, 1);
  h.restart();
  h.advance(7001);
  await h.alarm();
  assert.equal(h.engineCalls.length, 1);
  assert.equal(h.telegramCalls.filter(call => call.method === 'sendMessage').length, 1);
  assert.deepEqual((await h.storage.get('inbox')).keys, []);
});

test('긴 답변 전송은 저장된 분할 진척부터 재개한다', async t => {
  const h = harness(t);
  h.setEngine(() => ({ text: '가'.repeat(10000) }));
  let sends = 0;
  h.setTelegram(method => method === 'sendMessage' && ++sends === 3
    ? Response.json({ ok: false, error_code: 503 }, { status: 503 }) : null);
  await h.enqueue(update(1));
  h.advance(2);
  await h.alarm();
  const pending = await h.storage.get((await h.storage.get('inbox')).keys[0]);
  assert.equal(pending.nextChunk, 2);
  h.restart();
  h.advance(5001);
  await h.alarm();
  const continuations = h.telegramCalls.filter(call => call.method === 'sendMessage').map(call => call.body.text);
  assert.equal(continuations.filter(text => text.startsWith('(계속 2/3)')).length, 1);
  assert.equal(h.engineCalls.length, 1);
});

test('message is not modified는 이미 반영된 편집으로 처리한다', async t => {
  const h = harness(t);
  h.setTelegram(method => method === 'editMessageText'
    ? Response.json({ ok: false, error_code: 400, description: 'Bad Request: message is not modified' }, { status: 400 }) : null);
  await h.enqueue(update(1));
  h.advance(2);
  await h.alarm();
  assert.deepEqual((await h.storage.get('inbox')).keys, []);
});

test('엔진 재시도는 세 번으로 제한되고 placeholder에 실패 안내를 남긴다', async t => {
  const h = harness(t);
  h.setEngine(() => { throw new Error('upstream failed'); });
  await h.enqueue(update(1));
  for (let attempt = 0; attempt < 4; attempt++) {
    h.advance(10001);
    await h.alarm();
  }
  assert.equal(h.engineCalls.length, 3);
  assert.deepEqual((await h.storage.get('inbox')).keys, []);
  assert.ok(h.telegramCalls.at(-1).body.text.includes('다시 질문'));
});

test('저장할 세션에서 바이너리를 제외하고 100KiB 이하로 제한한다', () => {
  const result = compactSession({
    history: [{ role: 'user', content: [{ type: 'input_image', image_url: 'data:image/jpeg;base64,large' }] },
      ...Array.from({ length: 50 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: '법'.repeat(1500) })),
      { role: 'user', parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }, { text: '문서 질문' }] }],
    turns: 20,
  });
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 100 * 1024);
  assert.ok(!JSON.stringify(result).includes('inlineData'));
  assert.ok(!JSON.stringify(result).includes('base64'));
  assert.equal(result.history[0].role, 'user');
});

test('첨부 제한과 emoji 분할 및 채팅별 대화 분리가 적용된다', () => {
  assert.equal(normalizeUpdate(update(1, { document: { file_id: 'f', mime_type: 'application/pdf', file_size: 5 * 1024 * 1024 } })).kind, 'notice');
  assert.equal(normalizeUpdate(update(1, { document: { file_id: 'f', mime_type: 'application/zip' } })).kind, 'notice');
  assert.equal(normalizeUpdate(update(1, { chat: { id: 33 } })).conversationKey, '33:22');
  const text = '🐶'.repeat(4500);
  const chunks = splitReply(text);
  assert.equal(chunks.join(''), text);
  assert.ok(chunks.every(chunk => chunk.length <= 3800 && !/^[\uDC00-\uDFFF]/.test(chunk)));
});

test('inbox가 가득 차면 미접수 update를 503으로 돌려보내 재전송할 수 있다', async t => {
  const h = harness(t);
  for (let i = 0; i < 25; i++) assert.equal((await h.enqueue(update(i))).status, 200);
  assert.equal((await h.enqueue(update(100))).status, 503);
  assert.equal(await h.storage.get('seen:100'), undefined);
});

test('만료된 중복방지 기록을 정리한 뒤 빈 객체의 alarm을 중단한다', async t => {
  const h = harness(t);
  await h.enqueue(update(1));
  h.advance(2);
  await h.alarm();
  h.advance(24 * 60 * 60 * 1000 + 1);
  await h.alarm();
  assert.equal(await h.storage.get('seen:1'), undefined);
  assert.equal(await h.storage.get('inbox'), undefined);
  assert.equal(await h.storage.getAlarm(), null);
});

test('큰 한글 답변도 inbox key의 128KiB 한도를 넘지 않게 제한한다', () => {
  const chunks = splitReply('법률'.repeat(40000));
  assert.ok(Buffer.byteLength(chunks.join('')) <= 64 * 1024);
  assert.ok(chunks.at(-1).includes('답변이 길어'));
});

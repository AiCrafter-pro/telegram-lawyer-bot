import { processCloudQuery, checkCloudSetup } from './engine.js';

const BODY_LIMIT = 128 * 1024;
const SESSION_LIMIT = 100 * 1024;
const SESSION_TTL = 30 * 60 * 1000;
const DEDUPE_TTL = 24 * 60 * 60 * 1000;
const ALBUM_WAIT = 1800;
const MAX_PENDING = 25;
const MAX_RETRIES = 3;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const encoder = new TextEncoder();

function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function readJson(request) {
  const length = request.headers.get('content-length');
  if (length && Number(length) > BODY_LIMIT) throw new HttpError(413);
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400);
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_LIMIT) { await reader.cancel(); throw new HttpError(413); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder().decode(bytes)); }
    catch { throw new HttpError(400); }
  } finally { reader.releaseLock(); }
}

class HttpError extends Error {
  constructor(status) { super('Invalid request'); this.status = status; }
}
class TelegramError extends Error {
  constructor(status, retryAfter = 0, editMissing = false) {
    super('Telegram request failed');
    this.status = status;
    this.retryAfter = retryAfter;
    this.editMissing = editMissing;
  }
}

// 인증 값은 로그나 오류 응답에 포함하지 않습니다.
function secretEquals(actual, expected) {
  if (typeof expected !== 'string' || !expected || !actual) return false;
  let different = actual.length ^ expected.length;
  const width = Math.max(actual.length, expected.length);
  for (let i = 0; i < width; i++) different |= (actual.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0);
  return different === 0;
}

export function normalizeUpdate(update) {
  const message = update?.message;
  if (!Number.isSafeInteger(update?.update_id) || !message ||
      !Number.isSafeInteger(message.chat?.id) ||
      !Number.isSafeInteger(message.from?.id) ||
      !Number.isSafeInteger(message.message_id) || message.from.is_bot) return null;
  const text = typeof message.text === 'string' ? message.text
    : typeof message.caption === 'string' ? message.caption : '';
  const command = text.match(/^\/(start|clear|help)(?:@[A-Za-z0-9_]+)?(?:\s|$)/i)?.[1]?.toLowerCase();
  let kind = command || 'query';
  let files = [];
  const photo = Array.isArray(message.photo) ? message.photo.at(-1) : null;
  const document = message.document;
  let inputError = null;
  if (photo?.file_id) {
    files = [{ fileId: photo.file_id, mimeType: 'image/jpeg', fileSize: photo.file_size || 0 }];
  } else if (document?.file_id) {
    const mimeType = document.mime_type || '';
    if (mimeType === 'application/pdf' || /^image\/(jpeg|png|webp)$/.test(mimeType)) {
      files = [{ fileId: document.file_id, mimeType, fileSize: document.file_size || 0 }];
    } else {
      inputError = 'PDF 또는 JPG·PNG·WebP 이미지 파일을 보내 주세요.';
    }
  } else if (!text) {
    inputError = '질문을 글로 보내거나 사진·PDF 문서를 첨부해 주세요.';
  }
  if (files.some(file => typeof file.fileId !== 'string' || file.fileId.length > 512 ||
      !Number.isSafeInteger(file.fileSize) || file.fileSize < 0 || file.fileSize > MAX_FILE_BYTES)) {
    inputError = '첨부 파일은 한 개당 4MB 이하로 보내 주세요.';
    files = [];
  }
  if (encoder.encode(text).byteLength > 24 * 1024) {
    inputError = '질문이 너무 깁니다. 내용을 나누어 보내 주세요.';
  }
  if (inputError) kind = 'notice';
  return {
    updateId: update.update_id,
    conversationKey: String(message.chat.id) + ':' + String(message.from.id),
    chatId: message.chat.id,
    messageId: message.message_id,
    threadId: Number.isSafeInteger(message.message_thread_id) ? message.message_thread_id : undefined,
    kind, text: inputError ? '' : text, files,
    notice: inputError,
    albumId: !command && !inputError && message.media_group_id ? String(message.media_group_id) : null,
  };
}

export function splitReply(value) {
  let text = typeof value === 'string' && value.trim() ? value.trim() : '답변을 만들지 못했습니다. 다시 질문해 주세요.';
  if (text.length > 48000 || encoder.encode(text).byteLength > 64 * 1024) {
    let low = 0, high = Math.min(47900, text.length);
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (encoder.encode(text.slice(0, middle)).byteLength <= 64 * 1024 - 400) low = middle;
      else high = middle - 1;
    }
    if (/^[\uDC00-\uDFFF]$/.test(text[low])) low--;
    text = text.slice(0, low) + '\n\n답변이 길어 여기까지 표시했습니다. 이어서 궁금한 부분을 질문해 주세요.';
  }
  const chunks = [];
  while (text.length > 3800) {
    let end = text.lastIndexOf('\n', 3800);
    if (end < 1500) end = 3800;
    // 이모지 surrogate pair를 중간에서 자르지 않습니다.
    if (/^[\uDC00-\uDFFF]$/.test(text[end])) end--;
    chunks.push(text.slice(0, end));
    text = text.slice(end).trimStart();
  }
  if (text) chunks.push(text);
  return chunks;
}

function removeBinary(value) {
  if (Array.isArray(value)) return value.map(removeBinary).filter(item => item !== undefined);
  if (typeof value === 'string') return value.startsWith('data:') ? undefined : value;
  if (!value || typeof value !== 'object') return value;
  if (value.inlineData || value.type === 'input_image' || value.type === 'input_file') return undefined;
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'file_data' || key === 'inlineData') continue;
    const clean = removeBinary(item);
    if (clean !== undefined) output[key] = clean;
  }
  return output;
}

export function compactSession(session) {
  if (!session || !Array.isArray(session.history)) return null;
  const clean = {
    history: removeBinary(session.history),
    turns: Number.isSafeInteger(session.turns) ? Math.max(0, session.turns) : 0,
  };
  while (clean.history.length && encoder.encode(JSON.stringify(clean)).byteLength > SESSION_LIMIT - 128) clean.history.shift();
  // 이전 assistant/tool 응답만 남은 경우에도 다음 질의가 새 사용자 메시지부터 시작하도록 정리합니다.
  while (clean.history.length && ['assistant', 'model', 'tool'].includes(clean.history[0]?.role)) clean.history.shift();
  return clean;
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/health') return json({ status: 'ok' });
    if (path === '/admin/check' || path === '/admin/query') {
      if (request.method !== 'POST') return json({error:'Method not allowed'},405);
      if (!secretEquals(request.headers.get('Authorization'), 'Bearer '+env.ADMIN_API_SECRET) || !env.ADMIN_API_SECRET) return json({error:'Unauthorized'},401);
      try {
        if (path === '/admin/check') {
          const storage=env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName('__healthcheck'));
          const verified=await storage.fetch(new Request('https://conversation/check',{method:'POST'}));
          return json({...await checkCloudSetup(env),storage:verified.ok});
        }
        const body=await readJson(request);
        const answer=await processCloudQuery({userMessage:String(body.question || '').slice(0,4000),files:[],session:null},env);
        return json({text:answer.text,toolRounds:answer.toolRounds});
      } catch { return json({error:'Integration check failed'},502); }
    }
    if (path !== '/telegram/webhook') return json({ error: 'Not found' }, 404);
    if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!secretEquals(request.headers.get('X-Telegram-Bot-Api-Secret-Token'), env.TELEGRAM_WEBHOOK_SECRET)) {
      return json({ error: 'Unauthorized' }, 401);
    }
    try {
      const item = normalizeUpdate(await readJson(request));
      if (!item) return json({ ok: true });
      const object = env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(item.conversationKey));
      // 영속 inbox에 기록된 뒤에만 Telegram 접수를 확인합니다.
      const response = await object.fetch(new Request('https://conversation/inbox', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(item),
      }));
      return response.ok ? json({ ok: true }) : json({ error: 'Temporarily unavailable' }, response.status);
    } catch (error) {
      if (error instanceof HttpError) return json({ error: 'Invalid request' }, error.status);
      console.error('webhook_storage_failed');
      return json({ error: 'Temporarily unavailable' }, 503);
    }
  },
};

// Durable Object의 영속 storage와 alarm만 사용합니다. Queue·D1·Container는 필요 없습니다.
export class Conversation {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.storage = ctx.storage;
    this.running = false;
  }

  async fetch(request) {
    if (request.method === 'POST' && new URL(request.url).pathname === '/check') {
      await this.storage.put('healthcheck',Date.now());
      const saved=await this.storage.get('healthcheck');
      await this.storage.delete('healthcheck');
      return json({ok:typeof saved==='number'});
    }
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/inbox') return json({ error: 'Not found' }, 404);
    const item = await readJson(request);
    const now = Date.now();
    const status = await this.storage.transaction(async txn => {
      const seen = await txn.get('seen:' + item.updateId);
      if (seen && seen > now) return 200;
      const inbox = (await txn.get('inbox')) || { keys: [], cleanupAt: now + DEDUPE_TTL };
      let key = 'job:' + (item.albumId ? 'album:' + item.albumId : 'update:' + item.updateId);
      let job = item.albumId ? await txn.get(key) : null;
      // 이미 처리를 시작한 앨범의 늦은 조각은 후속 작업으로 보존합니다.
      if (job && job.phase !== 'pending') { key += ':' + item.updateId; job = null; }
      if (!job && inbox.keys.length >= MAX_PENDING) return 503;
      if (!job) {
        job = {
          key, jobId: item.conversationKey + ':' + item.updateId,
          chatId: item.chatId, messageId: item.messageId, threadId: item.threadId,
          kind: item.kind, texts: [], files: [], notice: item.notice,
          phase: 'pending', dueAt: now + (item.albumId ? ALBUM_WAIT : 1),
          createdAt: now, failures: 0, nextChunk: 0, replyIds: [],
        };
        inbox.keys.push(key);
      }
      if (item.text && !job.texts.includes(item.text)) job.texts.push(item.text);
      for (const file of item.files) if (!job.files.some(existing => existing.fileId === file.fileId)) job.files.push(file);
      if (encoder.encode(job.texts.join('\n\n')).byteLength > 32 * 1024) {
        job.kind = 'notice'; job.notice = '질문이 너무 깁니다. 내용을 나누어 보내 주세요.'; job.texts = [];
      }
      if (job.files.length > 10 || job.files.reduce((sum, file) => sum + file.fileSize, 0) > 8 * 1024 * 1024) {
        job.kind = 'notice'; job.notice = '첨부는 한 번에 10개, 합계 8MB 이하로 나누어 보내 주세요.'; job.files = []; job.texts = [];
      }
      if (item.albumId) job.dueAt = Math.min(now + ALBUM_WAIT, job.createdAt + 6000);
      await txn.put(key, job);
      await txn.put('inbox', inbox);
      await txn.put('seen:' + item.updateId, now + DEDUPE_TTL);
      const alarm = await this.storage.getAlarm();
      if (alarm === null || alarm > job.dueAt) await this.storage.setAlarm(job.dueAt);
      return 200;
    });
    return json({ ok: status === 200 }, status);
  }

  async alarm() {
    // 런타임에서도 객체별 alarm은 직렬 실행됩니다. 테스트/수동 호출도 겹치지 않게 합니다.
    if (this.running) return;
    this.running = true;
    try {
      await this.cleanup();
      // 앨범 추가와 작업 시작이 경쟁해도 메시지가 유실되지 않도록 같은 트랜잭션에서 잠급니다.
      let job = await this.storage.transaction(async txn => {
        const inbox = await txn.get('inbox');
        const key = inbox?.keys[0];
        if (!key) return null;
        const current = await txn.get(key);
        if (!current) {
          inbox.keys.shift();
          await txn.put('inbox', inbox);
          return null;
        }
        if (current.dueAt > Date.now()) return null;
        current.phase = current.chunks ? 'answering' : 'processing';
        await txn.put(key, current);
        return current;
      });
      if (!job) return;
      const key = job.key;
      try {
        if (!job.replyIds[0]) {
          const placeholder = await this.telegram('sendMessage', {
            ...this.telegramTarget(job),
            text: job.kind === 'query' ? '🐶 푸숑이가 법령과 판례를 확인하고 있어요. 잠시만 기다려 주세요.' : '잠시만요.',
            reply_parameters: { message_id: job.messageId, allow_sending_without_reply: true },
          });
          job.replyIds[0] = placeholder.message_id;
          await this.storage.put(key, job);
        }
        if (!job.chunks) {
          let result;
          if (job.kind === 'clear' || job.kind === 'start') {
            await this.storage.delete('session');
            result = { text: job.kind === 'clear' ? '이전 대화를 지웠어요. 새로운 질문을 보내 주세요.'
              : '🐶 안녕하세요, 법률봇 푸숑이입니다! 법률 질문이나 사진·PDF 문서를 보내 주세요.\n\n/clear — 대화 초기화\n/help — 사용 방법' };
          } else if (job.kind === 'help') {
            result = { text: '법률 질문을 글로 보내거나 사진·PDF 문서를 첨부해 주세요. 사진을 여러 장 보내면 함께 살펴봅니다.\n\n대화는 마지막 답변 후 30분 동안 이어집니다. /clear 명령으로 이전 대화를 지울 수 있어요.' };
          } else if (job.kind === 'notice') {
            result = { text: job.notice };
          } else {
            const stored = await this.storage.get('session');
            const session = stored && stored.expiresAt > Date.now() ? { history: stored.history, turns: stored.turns } : null;
            result = await processCloudQuery({
              jobId: job.jobId,
              userMessage: job.texts.join('\n\n') || '첨부한 자료를 살펴보고 법률적으로 중요한 내용을 설명해 주세요.',
              files: job.files, session,
            }, this.env);
          }
          job.chunks = splitReply(result.text);
          job.phase = 'answering';
          job.failures = 0;
          const session = compactSession(result.session);
          // 생성 결과와 대화 기록을 출력보다 먼저 함께 저장합니다.
          await this.storage.transaction(async txn => {
            if (session) await txn.put('session', { ...session, expiresAt: Date.now() + SESSION_TTL });
            await txn.put(key, job);
          });
        }
        for (let index = job.nextChunk; index < job.chunks.length; index++) {
          const text = index === 0 ? job.chunks[index] : '(계속 ' + (index + 1) + '/' + job.chunks.length + ')\n\n' + job.chunks[index];
          if (index === 0) {
            try {
              await this.telegram('editMessageText', { chat_id: job.chatId, message_id: job.replyIds[0], text });
            } catch (error) {
              if (!error.editMissing) throw error;
              const sent = await this.telegram('sendMessage', { ...this.telegramTarget(job), text });
              job.replyIds[0] = sent.message_id;
            }
          } else {
            const sent = await this.telegram('sendMessage', { ...this.telegramTarget(job), text });
            job.replyIds[index] = sent.message_id;
          }
          job.nextChunk = index + 1;
          job.failures = 0;
          await this.storage.put(key, job);
        }
        await this.finish(key);
      } catch (error) {
        job.failures++;
        console.error('conversation_job_failed', { phase: job.phase, attempt: job.failures, status: error.status || 0 });
        if (job.failures >= MAX_RETRIES) {
          if (!job.chunks && job.replyIds[0]) {
            job.chunks = ['지금 답변을 완성하지 못했습니다. 잠시 후 다시 질문해 주세요.'];
            job.phase = 'answering';
            job.failures = 0;
            job.dueAt = Date.now() + 1000;
            await this.storage.put(key, job);
          } else {
            await this.finish(key);
          }
        } else {
          const delay = Math.max(5000 * 2 ** (job.failures - 1), Math.min(300000, (error.retryAfter || 0) * 1000));
          job.dueAt = Date.now() + delay;
          await this.storage.put(key, job);
        }
      }
    } finally {
      this.running = false;
      await this.schedule();
    }
  }

  telegramTarget(job) {
    const target = { chat_id: job.chatId };
    if (job.threadId !== undefined) target.message_thread_id = job.threadId;
    return target;
  }

  async telegram(method, body) {
    let response;
    try {
      response = await fetch('https://api.telegram.org/bot' + this.env.TELEGRAM_BOT_TOKEN + '/' + method, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(30000),
      });
    } catch { throw new TelegramError(0); }
    let data;
    try { data = await response.json(); } catch { throw new TelegramError(response.status); }
    if (response.ok && data.ok) return data.result;
    if (method === 'editMessageText' && data.error_code === 400 && /message is not modified/i.test(data.description || '')) return true;
    throw new TelegramError(data.error_code || response.status, data.parameters?.retry_after,
      method === 'editMessageText' && data.error_code === 400 && /message to edit not found/i.test(data.description || ''));
  }

  async finish(key) {
    await this.storage.transaction(async txn => {
      const inbox = (await txn.get('inbox')) || { keys: [], cleanupAt: Date.now() + DEDUPE_TTL };
      inbox.keys = inbox.keys.filter(value => value !== key);
      await txn.put('inbox', inbox);
      await txn.delete(key);
    });
  }

  async cleanup() {
    const now = Date.now();
    const session = await this.storage.get('session');
    if (session && session.expiresAt <= now) await this.storage.delete('session');
    const inbox = await this.storage.get('inbox');
    if (!inbox || inbox.cleanupAt > now) return;
    // 하루 지난 update ID와 사용이 끝난 대화만 제거합니다.
    const seen = await this.storage.list({ prefix: 'seen:' });
    for (const [key, expiresAt] of seen) if (expiresAt <= now) await this.storage.delete(key);
    await this.storage.transaction(async txn => {
      const latest = await txn.get('inbox');
      if (latest) {
        const remaining = await txn.list({ prefix: 'seen:', limit: 1 });
        if (!latest.keys.length && !remaining.size) await txn.delete('inbox');
        else { latest.cleanupAt = now + DEDUPE_TTL; await txn.put('inbox', latest); }
      }
    });
  }

  async schedule() {
    await this.storage.transaction(async txn => {
      const inbox = await txn.get('inbox');
      const session = await txn.get('session');
      const head = inbox?.keys[0] ? await txn.get(inbox.keys[0]) : null;
      const times = [];
      if (head) times.push(head.dueAt);
      else if (inbox?.keys.length) times.push(Date.now() + 1);
      if (session) times.push(session.expiresAt);
      if (inbox) times.push(inbox.cleanupAt);
      if (times.length) await this.storage.setAlarm(Math.max(Date.now() + 1, Math.min(...times)));
      else await this.storage.deleteAlarm();
    });
  }
}

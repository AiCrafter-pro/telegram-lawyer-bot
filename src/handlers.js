/**
 * 푸숑이 법률 봇 — 텔레그램 핸들러 모듈
 * 
 * 텍스트, 사진, 앨범, 문서(PDF/이미지) 핸들러를 관리합니다.
 * 모든 핸들러는 gemini.processQuery()를 호출하여 답변을 받습니다.
 */

import fetch from 'node-fetch';
import { processQuery, clearSession, getSessionCount } from './gemini.js';

// ━━━ 사진/문서 다운로드 유틸 ━━━
async function downloadFileAsBase64(bot, fileId) {
    const fileLink = await bot.telegram.getFileLink(fileId);
    const response = await fetch(fileLink.href);
    const buffer = Buffer.from(await response.arrayBuffer());
    return buffer.toString('base64');
}

// ━━━ 긴 답변 분할 전송 ━━━
const TELEGRAM_MAX_LENGTH = 4000;

async function sendLongMessage(ctx, chatId, firstMsgId, text) {
    if (!text || text.length === 0) {
        text = "앗, 법전을 찾다가 길을 잃었어요. 다시 한 번 질문해주세요 멍멍 ㅠㅠ";
    }

    if (text.length <= TELEGRAM_MAX_LENGTH) {
        await ctx.telegram.editMessageText(chatId, firstMsgId, null, text);
        return;
    }

    // 긴 답변 → 문단 단위로 분할
    const chunks = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= TELEGRAM_MAX_LENGTH) {
            chunks.push(remaining);
            break;
        }

        let splitAt = remaining.lastIndexOf('\n\n', TELEGRAM_MAX_LENGTH);
        if (splitAt === -1 || splitAt < 500) {
            splitAt = remaining.lastIndexOf('\n', TELEGRAM_MAX_LENGTH);
        }
        if (splitAt === -1 || splitAt < 500) {
            splitAt = TELEGRAM_MAX_LENGTH;
        }

        chunks.push(remaining.substring(0, splitAt));
        remaining = remaining.substring(splitAt).trimStart();
    }

    await ctx.telegram.editMessageText(chatId, firstMsgId, null, chunks[0]);
    for (let i = 1; i < chunks.length; i++) {
        await ctx.reply(`📜 (계속 ${i + 1}/${chunks.length})\n\n${chunks[i]}`);
    }
}

// ━━━ 공통 메시지 처리 함수 ━━━
async function handleUserMessage(ctx, userMessage, imageParts = []) {
    const userId = ctx.from.id;
    const msgId = ctx.message.message_id;
    const startTime = Date.now();
    const timestamp = new Date().toLocaleTimeString('ko-KR', { hour12: false });

    const imgInfo = imageParts.length > 0 ? ` + 📸 ${imageParts.length}장` : '';
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`[${timestamp}] 📩 USER ${userId} | 질문 수신 (${userMessage.length}자${imgInfo})`);
    console.log(`[${timestamp}] 💬 "${userMessage.substring(0, 100)}${userMessage.length > 100 ? '...' : ''}"`);
    console.log(`${'─'.repeat(60)}`);

    ctx.sendChatAction('typing');
    const processingMsg = await ctx.reply("🤔 푸숑이가 법전을 뒤적이는 중입니다... (잠시만 기다려주세요!)", { reply_to_message_id: msgId });

    try {
        // Gemini 엔진에 질문 전달 (도구 호출 포함)
        const result = await processQuery(userId, userMessage, imageParts, async (toolName) => {
            // 도구 진행 상황 UI 업데이트
            try {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    processingMsg.message_id,
                    null,
                    `🐾 법제처 데이터베이스 조회 중... (${toolName})`
                );
            } catch (editErr) {
                if (!editErr.message.includes('is not modified')) {
                    console.error('[Telegram Edit Error]', editErr.message);
                }
            }
        });

        console.log(`\n${'─'.repeat(60)}`);
        console.log(`[BOT 답변] 📤 ${result.text.length}자 | 도구 ${result.toolRounds}라운드 | 총 ${Date.now() - startTime}ms`);
        console.log(`[BOT 답변] 미리보기: "${result.text.substring(0, 80).replace(/\n/g, ' ')}..."`);
        console.log(`${'═'.repeat(60)}\n`);

        await sendLongMessage(ctx, ctx.chat.id, processingMsg.message_id, result.text);

    } catch (error) {
        const elapsed = Date.now() - startTime;
        console.error(`\n${'❌'.repeat(20)}`);
        console.error(`[ERROR] ${error.message} (${elapsed}ms 경과)`);
        console.error(`[STACK] ${error.stack?.split('\n')[1]?.trim()}`);
        console.error(`${'❌'.repeat(20)}\n`);
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            processingMsg.message_id,
            null,
            "🚨 에러 발생! 푸숑이 배가 고프거나 법제처 서버가 점검 중인 것 같아요. (오류: " + error.message + ")"
        );
    }
}

/**
 * 텔레그램 봇에 모든 핸들러를 등록합니다.
 */
export function registerHandlers(bot) {

    // /start 명령어
    bot.start((ctx) => {
        clearSession(ctx.from.id);
        ctx.reply("안녕하세요! 저는 'AI크래프터 법무팀'의 수석 변호사 푸숑이입니다. 🐶🐾\n거기, 법 때문에 머리 아프신 분! 무엇이든 물어보세요. 제가 법제처 서재를 다 뒤져서 정확하게 알려드릴게요! 왈왈!");
    });

    // /clear 명령어: 세션 초기화
    bot.command('clear', (ctx) => {
        clearSession(ctx.from.id);
        ctx.reply("🐾 세션이 초기화되었습니다! 새로운 상담을 시작합니다, 멍!\nAI크래프터 법무팀 수석 변호사 푸숑이가 대기 중입니다~ 🐶");
    });

    // "잊어라" 텍스트 감지: 세션 초기화
    bot.hears(/잊어|리셋|초기화|새로.*상담/, (ctx) => {
        clearSession(ctx.from.id);
        ctx.reply("🐾 알겠습니다! 이전 대화 내용을 깨끗하게 지웠습니다, 멍!\n새로운 상담을 시작해주세요~ 🐶");
    });

    // ━━━ 텍스트 전용 ━━━
    bot.on('text', async (ctx) => {
        await handleUserMessage(ctx, ctx.message.text);
    });

    // ━━━ 단일 사진 ━━━
    bot.on('photo', async (ctx) => {
        if (ctx.message.media_group_id) return;

        const caption = ctx.message.caption || '';
        const photo = ctx.message.photo;
        const bestPhoto = photo[photo.length - 1];

        console.log(`[📸 사진] 단일 사진 수신 (${bestPhoto.width}x${bestPhoto.height}, ${bestPhoto.file_size} bytes)`);

        try {
            const base64 = await downloadFileAsBase64(bot, bestPhoto.file_id);
            const imageParts = [{
                inlineData: { mimeType: 'image/jpeg', data: base64 }
            }];
            await handleUserMessage(ctx, caption, imageParts);
        } catch (err) {
            console.error('[사진 처리 에러]', err.message);
            ctx.reply('📸 사진 처리 중 오류가 발생했어요. 다시 시도해주세요, 멍! 🐾');
        }
    });

    // ━━━ 앨범 (사진 여러 장) ━━━
    bot.on('media_group', async (ctx) => {
        const album = ctx.update.media_group;
        const photos = album.filter(msg => msg.photo);
        const caption = album[0]?.caption || '';

        console.log(`[📸 앨범] ${photos.length}장 수신`);

        if (photos.length === 0) {
            ctx.reply('📸 사진이 포함된 앨범을 보내주세요, 멍!');
            return;
        }

        try {
            const imageParts = [];
            for (const msg of photos) {
                const bestPhoto = msg.photo[msg.photo.length - 1];
                console.log(`  → 사진 ${imageParts.length + 1}: ${bestPhoto.width}x${bestPhoto.height}, ${bestPhoto.file_size} bytes`);
                const base64 = await downloadFileAsBase64(bot, bestPhoto.file_id);
                imageParts.push({
                    inlineData: { mimeType: 'image/jpeg', data: base64 }
                });
            }
            await handleUserMessage(ctx, caption, imageParts);
        } catch (err) {
            console.error('[앨범 처리 에러]', err.message);
            ctx.reply('📸 앨범 처리 중 오류가 발생했어요. 다시 시도해주세요, 멍! 🐾');
        }
    });

    // ━━━ 문서 (PDF/이미지 파일) ━━━
    bot.on('document', async (ctx) => {
        const doc = ctx.message.document;
        const caption = ctx.message.caption || '';
        const mime = doc.mime_type || '';

        console.log(`[📄 문서] ${doc.file_name} (${mime}, ${doc.file_size} bytes)`);

        // 이미지 파일
        if (mime.startsWith('image/')) {
            try {
                const base64 = await downloadFileAsBase64(bot, doc.file_id);
                const imageParts = [{
                    inlineData: { mimeType: mime, data: base64 }
                }];
                await handleUserMessage(ctx, caption || `이 이미지 파일(${doc.file_name})을 분석해주세요.`, imageParts);
            } catch (err) {
                console.error('[문서(이미지) 처리 에러]', err.message);
                ctx.reply('📄 이미지 파일 처리 중 오류가 발생했어요, 멍! 🐾');
            }
            return;
        }

        // PDF 파일
        if (mime === 'application/pdf') {
            try {
                const base64 = await downloadFileAsBase64(bot, doc.file_id);
                const pdfPart = [{
                    inlineData: { mimeType: 'application/pdf', data: base64 }
                }];
                await handleUserMessage(ctx, caption || `이 PDF 문서(${doc.file_name})를 분석해주세요. 법적으로 중요한 조항이 있다면 알려주세요.`, pdfPart);
            } catch (err) {
                console.error('[PDF 처리 에러]', err.message);
                ctx.reply('📄 PDF 처리 중 오류가 발생했어요, 멍! 🐾');
            }
            return;
        }

        // 지원하지 않는 파일
        ctx.reply(`📄 죄송합니다, ${mime || '알 수 없는'} 형식의 파일은 아직 분석할 수 없어요.\n지원 형식: 사진(JPEG/PNG), PDF 문서 🐾`);
    });
}

/**
 * 🐶 푸숑이 법률 봇 — 메인 엔트리포인트
 * 
 * 구조:
 *   bot.js      → 메인 뼈대 (이 파일)
 *   prompt.js   → 시스템 프롬프트 (캐릭터 설정 + 검색 전략)
 *   gemini.js   → Gemini AI 엔진 (세션, MCP, 도구 호출 루프)
 *   handlers.js → 텔레그램 핸들러 (텍스트/사진/앨범/문서)
 */

import './src/logger.js';
import { Telegraf } from 'telegraf';
import { MediaGroup } from '@dietime/telegraf-media-group';
import dotenv from 'dotenv';
import process from 'process';

import { initMCP } from './src/gemini.js';
import { registerHandlers } from './src/handlers.js';

// .env 환경변수 로딩
dotenv.config();

// ━━━ 환경변수 검증 ━━━
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN.includes("여기에")) {
    console.error("❌ ERROR: .env 파일에 TELEGRAM_BOT_TOKEN을 정확하게 설정해주세요!");
    process.exit(1);
}

if (!GEMINI_API_KEY || GEMINI_API_KEY.includes("여기에")) {
    console.error("❌ ERROR: .env 파일에 GEMINI_API_KEY를 정확하게 설정해주세요!");
    process.exit(1);
}

// ━━━ 메인 ━━━
async function init() {
    // 1. MCP 서버 연결 + 법률 도구 로드
    await initMCP();

    // 2. 텔레그램 봇 초기화
    const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
    bot.use(new MediaGroup({ timeout: 1000 }).middleware());

    // 3. 핸들러 등록
    registerHandlers(bot);

    // 4. 봇 구동
    bot.launch();
    console.log("=========================================");
    console.log("🚀 'AI크래프터 법무팀' 푸숑이 봇이 텔레그램에서 활동을 시작했습니다!");
    console.log("=========================================");

    // 안전한 종료 설정
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

init().catch(console.error);

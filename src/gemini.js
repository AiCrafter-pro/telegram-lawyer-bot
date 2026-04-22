/**
 * 푸숑이 법률 봇 — Gemini AI 엔진 모듈
 * 
 * Gemini 세션 관리, 도구(Function Calling) 루프, 
 * MCP 서버 연결, 응답 복구 로직을 담당합니다.
 */

import { GoogleGenAI } from '@google/genai';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fetch from 'node-fetch';
import process from 'process';
import { buildSystemPrompt } from './prompt.js';
import axios from 'axios';
import * as cheerio from 'cheerio';

// ━━━ Gemini + MCP 클라이언트 ━━━
// dotenv.config()가 bot.js에서 먼저 실행된 후에 초기화되도록 lazy init
let ai = null;
function getAI() {
    if (!ai) ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    return ai;
}

const mcpClient = new Client(
    { name: 'telegram-lawyer-bot', version: '1.0.0' },
    { capabilities: {} }
);

let geminiTools = []; // MCP 도구 → Gemini 포맷 변환 결과

// ━━━ 대화 기억: 유저별 세션 저장소 ━━━
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30분
const sessions = new Map(); // userId → { chat, timer, turns }

export function clearSession(userId) {
    const session = sessions.get(userId);
    if (session?.timer) clearTimeout(session.timer);
    sessions.delete(userId);
    console.log(`[세션] 🗑️ ${userId} 세션 초기화됨`);
}

function resetSessionTimer(userId) {
    const session = sessions.get(userId);
    if (!session) return;
    if (session.timer) clearTimeout(session.timer);
    session.timer = setTimeout(() => clearSession(userId), SESSION_TIMEOUT_MS);
}

export function getSessionCount() {
    return sessions.size;
}

// ━━━ JSON Schema 정제 (Gemini 호환) ━━━
function cleanSchemaForGemini(schema) {
    if (!schema || typeof schema !== 'object') return schema;
    if (Array.isArray(schema)) return schema.map(cleanSchemaForGemini);
    
    const cleaned = { ...schema };
    delete cleaned.propertyNames;
    delete cleaned.$schema;
    delete cleaned.additionalProperties;
    
    for (const key in cleaned) {
        cleaned[key] = cleanSchemaForGemini(cleaned[key]);
    }
    return cleaned;
}

/**
 * MCP 서버에 연결하고 법률 도구 목록을 Gemini 포맷으로 변환합니다.
 */
export async function initMCP() {
    const transport = new StdioClientTransport({
        command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
        args: ['--no', 'korean-law-mcp'],
        env: { ...process.env }
    });

    await mcpClient.connect(transport);
    console.log("✅ 한국 법제처 MCP 서버가 안정적으로 연결되었습니다.");

    const toolsResult = await mcpClient.listTools();
    console.log(`✅ ${toolsResult.tools.length}개의 법률 도구를 장착했습니다!`);

    geminiTools = toolsResult.tools.map(tool => ({
        functionDeclarations: [{
            name: tool.name,
            description: tool.description || '법률 데이터 검색 도구',
            parameters: cleanSchemaForGemini(tool.inputSchema)
        }]
    }));
}

// ━━━ 로컬 커스텀 도구 정의 ━━━
const customTools = [
    {
        functionDeclarations: [{
            name: "read_website_url",
            description: "주어진 URL(http/https 링크)에 접속하여 웹페이지 본문을 찾아 읽어옵니다. 사용자가 기사, 블로그, 특정 뉴스 링크를 제공할 때 원문을 미리 요약/분석하기 위해 필수적으로 사용하세요.",
            parameters: {
                type: "object",
                properties: {
                    url: { type: "string", description: "읽어올 웹사이트의 전체 URL(https://...)" }
                },
                required: ["url"]
            }
        }]
    },
    {
        functionDeclarations: [{
            name: "search_web_news",
            description: "구글/덕덕고 웹 검색 엔진을 이용해 인터넷의 최신 뉴스나 정보를 검색합니다. 최근 사건, 뉴스, 인물 근황 등을 인터넷에서 찾을 때 사용하세요.",
            parameters: {
                type: "object",
                properties: {
                    query: { type: "string", description: "웹에서 검색할 핵심 키워드 (예: '권소영 근황', '딥페이크 처벌법 뉴스')" }
                },
                required: ["query"]
            }
        }]
    }
];

async function searchWebNews(query) {
    try {
        console.log(`  [웹 검색] 🔍 검색어: ${query}`);
        const { data } = await axios.get('https://html.duckduckgo.com/html/', {
            params: { q: query },
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 10000
        });
        const $ = cheerio.load(data);
        const results = [];
        $('.result').each((i, el) => {
            const title = $(el).find('.result__title').text().replace(/\s+/g, ' ').trim();
            const snippet = $(el).find('.result__snippet').text().replace(/\s+/g, ' ').trim();
            if (title && snippet) {
                results.push(`제목: ${title}\n내용: ${snippet}\n`);
            }
        });
        if (results.length === 0) return "검색 결과가 없습니다.";
        return results.slice(0, 5).join('\n---\n'); // 상위 5건만
    } catch (err) {
        console.error(`  [웹 검색 실패] ${err.message}`);
        return `검색에 실패했습니다: ${err.message}`;
    }
}

async function readWebsiteContent(url) {
    try {
        console.log(`  [웹 리더] 🌐 요청 중: ${url}`);
        const { data } = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 10000 // 10초 타임아웃
        });
        const $ = cheerio.load(data);
        
        // 의미없는 스크립트, 스타일, 네비게이션, 푸터 등 제거
        $('script, style, nav, footer, header, aside, iframe, noscript').remove();
        
        // 텍스트 변환 및 공백 정제
        const text = $('body').text().replace(/\s+/g, ' ').trim();
        const MAX_LENGTH = 10000;
        
        if (text.length === 0) return "웹사이트 본문을 파싱하지 못했습니다. (동적으로 렌더링되거나 차단된 사이트일 수 있습니다)";
        return text.substring(0, MAX_LENGTH);
    } catch (err) {
        console.error(`  [웹 리더 실패] ${err.message}`);
        return `웹사이트를 읽어오지 못했습니다. 에러: ${err.message}`;
    }
}

/**
 * 사용자 메시지를 Gemini에 전송하고, 도구 호출 루프를 거쳐 최종 답변을 반환합니다.
 * 
 * @param {string} userId - 텔레그램 유저 ID
 * @param {string} userMessage - 사용자 텍스트
 * @param {Array} imageParts - inlineData 배열 (사진/PDF)
 * @param {Function} onToolProgress - 도구 진행 콜백 (UI 업데이트용)
 * @returns {{ text: string, toolRounds: number }}
 */
export async function processQuery(userId, userMessage, imageParts = [], onToolProgress = null) {
    // ━━━ 세션 가져오기 또는 새로 생성 ━━━
    let session = sessions.get(userId);

    if (!session) {
        const chat = await getAI().chats.create({
            model: 'gemini-2.5-flash',
            config: {
                tools: [
                    ...geminiTools,
                    ...customTools
                ],
                systemInstruction: buildSystemPrompt()
            }
        });

        session = { chat, timer: null, turns: 0 };
        sessions.set(userId, session);
        console.log(`[세션] ✨ ${userId} 새 세션 생성 (활성 세션: ${sessions.size}개)`);
    }

    resetSessionTimer(userId);
    session.turns++;
    console.log(`[세션] 📝 ${userId} 턴 ${session.turns} | 활성 세션: ${sessions.size}개`);

    // ━━━ 1. 사용자 질문 전달 ━━━
    console.log(`[Gemini] ⏳ 모델에 질문 전송 중...${imageParts.length > 0 ? ` (이미지 ${imageParts.length}장 포함)` : ''}`);
    const geminiStart = Date.now();

    let messageContent;
    if (imageParts.length > 0) {
        messageContent = [
            ...imageParts,
            { text: userMessage || '이 이미지를 분석해주세요. 법적으로 관련된 내용이 있다면 법률 조언도 해주세요.' }
        ];
    } else {
        messageContent = userMessage;
    }

    let response = await session.chat.sendMessage({ message: messageContent });
    console.log(`[Gemini] ✅ 초기 응답 수신 (${Date.now() - geminiStart}ms)`);

    if (!response.functionCalls || response.functionCalls.length === 0) {
        console.log(`[⚠️ 경고] 🔧 도구 호출 없음! Gemini가 자체 지식으로만 답변합니다.`);
    }

    // ━━━ 2. 도구 호출 루프 ━━━
    const MAX_TOOL_ROUNDS = 8;
    let toolRound = 0;

    while (response.functionCalls && response.functionCalls.length > 0 && toolRound < MAX_TOOL_ROUNDS) {
        toolRound++;
        const allCalls = response.functionCalls;
        console.log(`\n[🔧 도구 라운드 ${toolRound}/${MAX_TOOL_ROUNDS}] ${allCalls.length}개 도구 호출`);
        console.log(`  → 호출 목록: ${allCalls.map(c => c.name).join(', ')}`);

        const functionResponses = [];

        for (const call of allCalls) {
            const toolStart = Date.now();
            console.log(`  [🐾 ${call.name}] 실행 시작...`);

            // UI 진행 콜백
            if (onToolProgress) {
                await onToolProgress(call.name);
            }

            // 커스텀 도구(웹 리더) 가로채기
            if (call.name === 'read_website_url') {
                const url = call.args.url;
                const textData = await readWebsiteContent(url);
                const toolElapsed = Date.now() - toolStart;
                console.log(`  [🐾 ${call.name}] ✅ 완료 (${toolElapsed}ms) | 데이터: ${textData.length}자`);
                
                functionResponses.push({
                    functionResponse: {
                        name: call.name,
                        response: { result: textData }
                    }
                });
                continue; // 아래 로직 건너뛰기
            }

            // 커스텀 도구(웹 검색) 가로채기
            if (call.name === 'search_web_news') {
                const query = call.args.query;
                const textData = await searchWebNews(query);
                const toolElapsed = Date.now() - toolStart;
                console.log(`  [🐾 ${call.name}] ✅ 완료 (${toolElapsed}ms)`);
                
                functionResponses.push({
                    functionResponse: {
                        name: call.name,
                        response: { result: textData }
                    }
                });
                continue; // 아래 MCP 법제처 로직 건너뛰기
            }

            // 법제처 인증 사전 확인
            const healthCheckRes = await fetch(`https://www.law.go.kr/DRF/lawSearch.do?OC=${process.env.LAW_OC}&target=law&type=XML&query=%EB%AF%BC%EB%B2%95`);
            const healthCheckText = await healthCheckRes.text();
            if (healthCheckText.includes("사용자 정보 검증에 실패") || healthCheckText.includes("등록되지 않은")) {
                throw new Error("법제처 서버 접근 거부. (마이페이지에서 서버 장비의 IP 주소를 등록하거나 갱신될 때까지 1시간 정도 기다려주세요)");
            }

            // MCP 도구 호출
            const mcpResult = await mcpClient.callTool({
                name: call.name,
                arguments: call.args
            });

            const toolElapsed = Date.now() - toolStart;
            console.log(`  [🐾 ${call.name}] 파라미터: ${JSON.stringify(call.args)}`);

            let mcpDataString = "결과 값이 없습니다.";
            if (mcpResult?.content?.length > 0) {
                mcpDataString = mcpResult.content.map(c => c.text).join('\n');
            }

            const dataSize = mcpDataString.length;
            console.log(`  [🐾 ${call.name}] ✅ 완료 (${toolElapsed}ms) | 데이터: ${dataSize}자`);

            // ━━━ 법제처 반환 데이터 상세 파싱 ━━━
            const lawArticles = mcpDataString.match(/[가-힣]+(?:법|령|규칙|규정|조례)\s*(?:시행[가-힣]*\s*)?(?:제\d+조(?:의\d+)?(?:\s*\([^)]+\))?)/g);
            if (lawArticles?.length > 0) {
                const unique = [...new Set(lawArticles)].slice(0, 10);
                console.log(`  [📜 발견된 법령/조문] ${unique.length}건:`);
                unique.forEach(a => console.log(`     • ${a}`));
            }

            const cases = mcpDataString.match(/\d{4}[가-힣]{1,3}\d+/g);
            if (cases?.length > 0) {
                const uniqueCases = [...new Set(cases)].slice(0, 5);
                console.log(`  [⚖️ 발견된 판례] ${uniqueCases.length}건:`);
                uniqueCases.forEach(c => console.log(`     • ${c}`));
            }

            const countMatch = mcpDataString.match(/(?:총\s*)?(\d+)\s*건/);
            if (countMatch) console.log(`  [📊 검색 결과] ${countMatch[0]}`);
            if (dataSize < 50) console.log(`  [⚠️ 경고] 검색 결과가 비어있거나 매우 적습니다! (${dataSize}자)`);
            
            console.log(`  [🐾 ${call.name}] 미리보기: "${mcpDataString.substring(0, 200).replace(/\n/g, ' ')}..."`);

            // 법제처 인증 실패 방어
            if (mcpDataString.includes("사용자 정보 검증에 실패") || mcpDataString.includes("등록되지 않은")) {
                throw new Error("법제처 서버 접근 거부. (마이페이지에서 서버 장비의 IP 주소를 등록하거나 갱신될 때까지 1시간 정도 기다려주세요)");
            }

            functionResponses.push({
                functionResponse: {
                    name: call.name,
                    response: { result: mcpDataString }
                }
            });
        }

        // 3. 모든 도구 결과를 한 번에 모델에게 돌려주기
        response = await session.chat.sendMessage({
            message: functionResponses
        });

        // 🔥 도구 라운드 후 응답이 비어있는 경우 즉시 복구
        if (!response.functionCalls?.length && !response.text) {
            console.warn(`[경고] 도구 라운드 ${toolRound} 후 응답이 비어있음! 즉시 답변 요청...`);
            try {
                const candidates = response.candidates;
                if (candidates?.[0]?.content?.parts) {
                    const extracted = candidates[0].content.parts
                        .filter(p => p.text)
                        .map(p => p.text)
                        .join('\n');
                    if (extracted) {
                        console.log(`[복구] candidates에서 ${extracted.length}자 추출 성공`);
                        response = { text: extracted, functionCalls: null };
                    }
                }
            } catch (e) { /* 무시 */ }

            if (!response.text) {
                console.log(`[복구] 모델에 최종 답변 강제 요청...`);
                response = await session.chat.sendMessage({
                    message: '위에서 호출한 도구의 결과를 모두 종합하여 고객님께 법률 의견을 제시하세요. 반드시 텍스트로 답변하세요.'
                });
            }
        }
    }

    // ━━━ 4. 최종 답변 추출 (3단계 복구) ━━━
    let finalReply = response.text;

    // 복구 1단계: candidates에서 추출
    if (!finalReply) {
        console.warn('[경고] response.text가 undefined! candidates에서 추출 시도...');
        try {
            const candidates = response.candidates;
            if (candidates?.[0]?.content?.parts) {
                finalReply = candidates[0].content.parts
                    .filter(p => p.text)
                    .map(p => p.text)
                    .join('\n');
            }
        } catch (e) {
            console.error('[candidates 추출 실패]', e.message);
        }
    }

    // 복구 2단계: 강제 답변 요청
    if (!finalReply) {
        console.warn('[경고] candidates에서도 텍스트 없음! 모델에 답변 강제 요청 중...');
        try {
            const retryResponse = await session.chat.sendMessage({
                message: "위에서 도구로 조사한 법령과 판례 결과를 종합하여, 고객님의 질문에 대해 '현 상황 분석 → 관련 법령/근거 → 구체적 해결 방안' 순서로 최종 답변을 작성해주세요."
            });
            finalReply = retryResponse.text;
            if (finalReply) {
                console.log('[복구 성공] ✅ 강제 요청으로 답변 추출 완료!');
            }
        } catch (retryErr) {
            console.error('[복구 실패]', retryErr.message);
        }
    }

    // 최종 fallback
    if (!finalReply) {
        finalReply = "앗, 푸숑이가 법전을 분석하다가 답변을 놓쳤어요... 같은 질문을 다시 한 번 해주시면 더 정확하게 답변드릴게요, 멍! 🐾";
    }

    return { text: finalReply, toolRounds: toolRound };
}

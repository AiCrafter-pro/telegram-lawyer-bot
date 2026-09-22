import test from 'node:test';
import assert from 'node:assert/strict';
import { getLawTools, callLawTool } from '../cloudflare/law.js';
import { parse } from '../cloudflare/law-worker-kordoc.js';
import { SimpleCache } from '../cloudflare/law-worker-cache.js';

test('Worker 어댑터가 최신 MCP 도구 10개와 원래 입력 검증을 유지한다', async () => {
    const tools = await getLawTools();
    assert.equal(tools.length, 10);
    assert.ok(tools.some(tool => tool.name === 'legal_research'));
    assert.ok(tools.some(tool => tool.name === 'legal_analysis'));
    for (const tool of tools) assert.equal('apiKey' in tool.inputSchema.properties, false);
    const discovery = await callLawTool('discover_tools', { intent: '법령검색' }, {});
    assert.equal(Boolean(discovery.isError), false);
    assert.match(discovery.content[0].text, /search_law/);
    const invalid = await callLawTool('legal_analysis', { mode: 'verify_citations' }, { LAW_OC: 'offline-test' });
    assert.equal(invalid.isError, true);
    assert.match(invalid.content[0].text, /text/);
    const nested = await callLawTool('execute_tool', { tool_name: 'legal_analysis', params: { mode: 'verify_citations' } }, { LAW_OC: 'offline-test' });
    assert.equal(nested.isError, true);
    assert.match(nested.content[0].text, /text/);
    const missingKey = await callLawTool('search_law', { query: '민법', apiKey: '모델이 주입한 값' }, {});
    assert.equal(missingKey.isError, true);
    assert.match(missingKey.content[0].text, /인증키/);
});

test('지원하지 않는 별표 추출은 원문 안내를 반환하고 캐시는 크기·만료를 제한한다', async () => {
    const result = await parse(new Uint8Array());
    assert.equal(result.success, false);
    assert.match(result.error, /원문 파일 링크/);
    const cache = new SimpleCache(1);
    cache.set('만료', '자료', -1);
    assert.equal(cache.get('만료'), null);
    cache.set('처음', '첫 자료');
    cache.set('나중', '둘째 자료');
    assert.equal(cache.get('처음'), null);
    assert.equal(cache.get('나중'), '둘째 자료');
});


test('동시 요청에서도 Worker 인증키가 분리되고 모델의 중첩 apiKey를 무시한다', async () => {
    const originalFetch = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (input) => {
        const url = new URL(input);
        requests.push({ lawId: url.searchParams.get('ID'), key: url.searchParams.get('OC') });
        // 업스트림 요청 직렬화만 확인하고 재시도 없는 400 응답을 돌려줍니다.
        await Promise.resolve();
        return new Response('테스트용 400 응답', { status: 400 });
    };
    try {
        await Promise.all([
            callLawTool('get_law_text', { lawId: 'offline-a', apiKey: '모델키-a' }, { LAW_OC: 'worker-a' }),
            callLawTool('execute_tool', { tool_name: 'get_law_text', params: { lawId: 'offline-b', apiKey: '모델키-b' } }, { LAW_OC: 'worker-b' })
        ]);
        assert.ok(requests.some(request => request.lawId === 'offline-a' && request.key === 'worker-a'));
        assert.ok(requests.some(request => request.lawId === 'offline-b' && request.key === 'worker-b'));
        assert.ok(requests.every(request => request.key === 'worker-a' || request.key === 'worker-b'));
    } finally {
        globalThis.fetch = originalFetch;
    }
});

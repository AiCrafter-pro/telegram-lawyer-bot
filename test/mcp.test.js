import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { GoogleGenAI } from '@google/genai';
import { createMcpTransport, toGeminiTools, toFunctionResponse, mcpResultToResponse, callMcpTool } from '../src/mcp.js';
import { buildSystemPrompt } from '../src/prompt.js';

test('MCP 오류·구조화 결과를 구분하고 호출 ID를 보존한다', async () => {
    const failure = mcpResultToResponse({ isError: true, content: [{ type: 'text', text: '잘못된 검색 조건' }] });
    assert.deepEqual(failure, { error: '잘못된 검색 조건', isError: true });
    assert.equal('result' in failure, false);
    assert.deepEqual(mcpResultToResponse({ structuredContent: { count: 2 } }), { result: '{"count":2}', isError: false });
    const part = toFunctionResponse({ name: 'search_law', id: 'call-1' }, failure);
    assert.equal(part.functionResponse.id, 'call-1');
    const transportFailure = await callMcpTool({ callTool: async () => { throw new Error('비밀 URL 포함 예외'); } }, { name: 'search_law' });
    assert.equal(transportFailure.isError, true);
    assert.doesNotMatch(transportFailure.error, /비밀 URL/);
});

test('설치된 MCP 도구 목록·입력 오류와 Gemini SDK 직렬화를 외부 호출 없이 검증한다', { timeout: 30000 }, async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), 'law-bot-mcp-test-'));
    const guard = path.join(scratch, 'block-network.mjs');
    await writeFile(guard, "globalThis.fetch = async () => { throw new Error('오프라인 테스트에서 네트워크 요청 금지'); };\n");
    const client = new Client({ name: 'law-bot-offline-test', version: '1.0.0' }, { capabilities: {} });
    const transport = createMcpTransport({ cwd: scratch, env: {
        LAW_OC: 'offline-test',
        NODE_OPTIONS: '--import=' + JSON.stringify(pathToFileURL(guard).href)
    } });
    try {
        await client.connect(transport);
        const { tools } = await client.listTools();
        assert.equal(tools.length, 10);
        const byName = new Map(tools.map(tool => [tool.name, tool]));
        for (const name of ['legal_research', 'legal_analysis', 'search_law', 'search_decisions', 'discover_tools', 'execute_tool']) assert.ok(byName.has(name), name);
        assert.ok(!tools.some(tool => tool.name.startsWith('chain_')));
        assert.ok(byName.get('legal_research').inputSchema.properties.task.enum.includes('full_research'));
        assert.ok(byName.get('legal_analysis').inputSchema.properties.mode.enum.includes('verify_citations'));
        assert.doesNotMatch(buildSystemPrompt(), /chain_\w+/);

        const invalid = await callMcpTool(client, { name: 'legal_analysis', args: { mode: 'verify_citations' } });
        assert.equal(invalid.isError, true);
        assert.match(invalid.error, /text/);
        const discovery = await callMcpTool(client, { name: 'discover_tools', args: { intent: '법령검색' } });
        assert.equal(discovery.isError, false);
        assert.match(discovery.result, /search_law/);

        const declarations = toGeminiTools(tools);
        const execute = declarations[0].functionDeclarations.find(tool => tool.name === 'execute_tool');
        assert.deepEqual(execute.parametersJsonSchema.properties.params.additionalProperties, {});
        assert.equal('propertyNames' in execute.parametersJsonSchema.properties.params, false);
        let requestBody;
        const ai = new GoogleGenAI({ apiKey: 'offline-test', httpOptions: {
            fetch: async (_url, init) => {
                requestBody = JSON.parse(init.body);
                return new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: '오프라인 직렬화 성공' }] } }] }), { headers: { 'content-type': 'application/json' } });
            }
        } });
        const chat = ai.chats.create({ model: 'gemini-2.5-flash', config: { tools: declarations, systemInstruction: buildSystemPrompt() } });
        const result = await chat.sendMessage({ message: '스키마 직렬화만 확인합니다.' });
        assert.equal(result.text, '오프라인 직렬화 성공');
        const sent = requestBody.tools[0].functionDeclarations.find(tool => tool.name === 'execute_tool');
        assert.deepEqual(sent.parametersJsonSchema.properties.params.additionalProperties, {});
    } finally {
        await client.close();
        // 생성한 임시 디렉터리의 절대 경계와 접두사를 확인한 후 정리합니다.
        assert.equal(path.dirname(path.resolve(scratch)), path.resolve(tmpdir()));
        assert.ok(path.basename(scratch).startsWith('law-bot-mcp-test-'));
        await rm(scratch, { recursive: true, force: true });
    }
});

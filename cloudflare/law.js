/** 최신 법률 MCP의 원래 도구·검증 로직을 Worker 안에서 직접 호출합니다. */
import { registerTools } from '../node_modules/korean-law-mcp/build/tool-registry.js';
import { LawApiClient } from 'korean-law-mcp/lib/api-client';
import { requestContext } from 'korean-law-mcp/lib/session-state';
import { readExecutionLimits, RequestExecutionBudget } from 'korean-law-mcp/lib/execution-limits';

const handlers = new Map();
const client = new LawApiClient({ apiKey: '' });
registerTools({
    setRequestHandler(schema, handler) {
        handlers.set(schema.shape.method.value, handler);
    }
}, client, readExecutionLimits({}));

export async function getLawTools() {
    const result = await handlers.get('tools/list')();
    return result.tools;
}

function withoutApiKey(value) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(withoutApiKey);
    return Object.fromEntries(Object.entries(value)
        .filter(([key]) => key !== 'apiKey')
        .map(([key, entry]) => [key, withoutApiKey(entry)]));
}

export async function callLawTool(name, args, env) {
    try {
        const budget = new RequestExecutionBudget(readExecutionLimits(env));
        // 모델이 임의 apiKey를 넣어도 운영자의 Worker Secret만 사용합니다.
        const apiKey = typeof env.LAW_OC === 'string' ? env.LAW_OC.trim() : '';
        if (!apiKey && name !== 'discover_tools') {
            return { isError: true, content: [{ type: 'text', text: '법제처 인증키가 설정되지 않아 법률 자료를 조회할 수 없습니다.' }] };
        }
        const signal = AbortSignal.timeout(60000);
        return await requestContext.run({ apiKey, budget, signal }, () => handlers.get('tools/call')({
            params: { name, arguments: withoutApiKey(args || {}) }
        }, { signal }));
    } catch {
        return { isError: true, content: [{ type: 'text', text: '법률 자료 조회가 중단되었습니다. 확인되지 않은 내용을 추측하지 말고 잠시 후 다시 시도하세요.' }] };
    }
}

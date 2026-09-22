/** 한국 법률 MCP와 Gemini 사이의 도구·응답 변환을 관리합니다. */
import { fileURLToPath } from 'node:url';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export function createMcpTransport(options = {}) {
    return new StdioClientTransport({
        command: process.execPath,
        args: [fileURLToPath(import.meta.resolve('korean-law-mcp'))],
        cwd: fileURLToPath(new URL('../', import.meta.url)),
        env: { ...process.env },
        ...options
    });
}

function cleanJsonSchema(schema) {
    if (!schema || typeof schema !== 'object') return schema;
    if (Array.isArray(schema)) return schema.map(cleanJsonSchema);
    return Object.fromEntries(Object.entries(schema)
        .filter(([key]) => key !== '$schema' && key !== 'propertyNames')
        .map(([key, value]) => [key, cleanJsonSchema(value)]));
}

export function toGeminiTools(tools) {
    return [{
        functionDeclarations: tools.map(tool => ({
            name: tool.name,
            description: tool.description || '법률 데이터 검색 도구',
            // execute_tool.params 같은 자유 형식 객체의 additionalProperties를 보존합니다.
            parametersJsonSchema: cleanJsonSchema(tool.inputSchema)
        }))
    }];
}

export function toFunctionResponse(call, response) {
    return {
        functionResponse: {
            name: call.name,
            ...(call.id ? { id: call.id } : {}),
            response
        }
    };
}

export function mcpResultToResponse(result) {
    const text = (result?.content || [])
        .filter(part => part.type === 'text' && typeof part.text === 'string')
        .map(part => part.text)
        .join('\n');
    const data = text || (result?.structuredContent ? JSON.stringify(result.structuredContent) : '결과 값이 없습니다.');

    // 실패를 정상 검색 결과로 포장하면 모델이 장애를 법률 근거로 오인합니다.
    if (result?.isError) return { error: data, isError: true };
    return { result: data, isError: false };
}

export async function callMcpTool(client, call) {
    try {
        const result = await client.callTool({ name: call.name, arguments: call.args || {} });
        return mcpResultToResponse(result);
    } catch {
        // 예외 객체에 URL·인증정보가 담길 수 있어 모델에 원문을 전달하지 않습니다.
        return { error: '법률 도구 호출에 실패했습니다. 연결 상태를 확인하거나 잠시 후 다시 시도하세요.', isError: true };
    }
}

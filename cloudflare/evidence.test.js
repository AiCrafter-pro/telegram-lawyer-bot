import test from 'node:test';
import assert from 'node:assert/strict';
import { isEvidenceLookup } from './evidence.js';
const result = text => ({content:[{type:'text',text}]});
const data = result('법령 또는 판례 조회 결과');
const nested = (name, args, levels) => {
    for (let i = 0; i < levels; i++) { args = {tool_name:name,params:args}; name = 'execute_tool'; }
    return [name, args];
};

test('자료 조회와 순수 보조 도구를 구분하고 허용하지 않은 이름은 거절한다', () => {
    for (const name of ['search_law','get_law_text','search_decisions','parse_article_links','summarize_precedent','extract_precedent_keywords','chain_full_research']) {
        assert.equal(isEvidenceLookup(name, {}, data), true, name);
    }
    for (const name of ['discover_tools','parse_jo_code','get_external_links','analyze_document','get_unknown_database']) {
        assert.equal(isEvidenceLookup(name, {}, data), false, name);
        assert.equal(isEvidenceLookup('execute_tool', {tool_name:name,params:{}}, data), false, name);
    }
    assert.equal(isEvidenceLookup('search_law', {}, {...data,isError:true}), false);
    assert.equal(isEvidenceLookup('search_law', {}, {content:[]}), false);
    assert.equal(isEvidenceLookup('search_law', {}, null), false);
});

test('execute_tool은 JSON 입력을 포함해 최대 8단계까지만 해석한다', () => {
    assert.equal(isEvidenceLookup(...nested('search_law', {query:'민법'}, 8), data), true);
    assert.equal(isEvidenceLookup(...nested('search_law', {query:'민법'}, 9), data), false);
    assert.equal(isEvidenceLookup('execute_tool', JSON.stringify({tool_name:'search_law',params:JSON.stringify({query:'민법'})}), data), true);
    assert.equal(isEvidenceLookup('execute_tool', {tool_name:'search_law',params:'잘못된 JSON'}, data), false);
    const cyclic = {tool_name:'execute_tool'}; cyclic.params = cyclic;
    assert.equal(isEvidenceLookup('execute_tool', cyclic, data), false);
});

test('인용이 없거나 모두 미확인인 결과는 법률 조회 성공으로 집계하지 않는다', () => {
    const none = result('[NO_CITATIONS_FOUND] 인용이 발견되지 않았습니다.');
    assert.equal(isEvidenceLookup('legal_analysis', {mode:'verify_citations'}, none), false);
    assert.equal(isEvidenceLookup('execute_tool', {tool_name:'verify_citations',params:{text:'인용 없음'}}, none), false);
    const unknown = result('[PARTIAL_VERIFIED]\n법령 인용 1건 | ✓ 0 실존 | ✗ 0 오류 | ⚠ 1 확인필요');
    assert.equal(isEvidenceLookup('verify_citations', {}, unknown), false);
    const verified = result('[PARTIAL_VERIFIED]\n법령 인용 2건 | ✓ 1 실존 | ✗ 0 오류 | ⚠ 1 확인필요');
    assert.equal(isEvidenceLookup('legal_analysis', {mode:'verify_citations'}, verified), true);
    const caseVerified = result('[VERIFIED]\n판례 인용 1건 | ✓ 1 실존 | ✗ 0 실존불가 | ⚠ 0 미확인');
    assert.equal(isEvidenceLookup('verify_citations', {}, caseVerified), true);
});

test('문서 리스크 분석이 추가 법률 검색을 생략한 경우와 실제 조사 결과를 구분한다', () => {
    const skipped = result('문서 리스크 분석\n특별한 리스크가 없어 추가 검색을 생략합니다.');
    assert.equal(isEvidenceLookup('legal_research', {task:'document_review'}, skipped), false);
    assert.equal(isEvidenceLookup('execute_tool', {tool_name:'chain_document_review',params:{}}, skipped), false);
    assert.equal(isEvidenceLookup('legal_research', {task:'document_review'}, data), true);
});

/** korean-law-mcp 4.13.1에서 자료 조회를 수행할 수 있는 도구 목록입니다. */
const LOOKUP_NAMES = new Set([
    "search_law",
    "search_law_bulk",
    "get_law_text",
    "get_article_detail",
    "search_all",
    "advanced_search",
    "suggest_law_names",
    "search_admin_rule",
    "get_admin_rule",
    "compare_admin_rule_old_new",
    "search_ordinance",
    "get_ordinance",
    "ordinance_radar",
    "get_linked_ordinances",
    "get_linked_ordinance_articles",
    "get_delegated_laws",
    "get_linked_laws_from_ordinance",
    "compare_old_new",
    "get_three_tier",
    "compare_articles",
    "get_annexes",
    "get_law_tree",
    "get_law_system_tree",
    "get_law_statistics",
    "parse_article_links",
    "get_article_history",
    "get_law_history",
    "get_historical_law",
    "search_historical_law",
    "search_precedents",
    "get_precedent_text",
    "summarize_precedent",
    "extract_precedent_keywords",
    "find_similar_precedents",
    "search_interpretations",
    "get_interpretation_text",
    "search_tax_tribunal_decisions",
    "get_tax_tribunal_decision_text",
    "search_customs_interpretations",
    "get_customs_interpretation_text",
    "search_constitutional_decisions",
    "get_constitutional_decision_text",
    "search_admin_appeals",
    "get_admin_appeal_text",
    "search_ftc_decisions",
    "get_ftc_decision_text",
    "search_pipc_decisions",
    "get_pipc_decision_text",
    "search_nlrc_decisions",
    "get_nlrc_decision_text",
    "search_acr_decisions",
    "get_acr_decision_text",
    "search_school_rules",
    "get_school_rule_text",
    "search_public_corp_rules",
    "get_public_corp_rule_text",
    "search_public_institution_rules",
    "get_public_institution_rule_text",
    "search_appeal_review_decisions",
    "get_appeal_review_decision_text",
    "search_acr_special_appeals",
    "get_acr_special_appeal_text",
    "search_treaties",
    "get_treaty_text",
    "search_english_law",
    "get_english_law_text",
    "search_legal_terms",
    "search_ai_law",
    "get_legal_term_kb",
    "get_legal_term_detail",
    "get_daily_term",
    "get_daily_to_legal",
    "get_legal_to_daily",
    "get_term_articles",
    "get_related_laws",
    "get_law_abbreviations",
    "get_batch_articles",
    "get_article_with_precedents",
    "legal_research",
    "legal_analysis",
    "chain_law_system",
    "chain_action_basis",
    "chain_dispute_prep",
    "chain_amendment_track",
    "chain_ordinance_compare",
    "chain_full_research",
    "chain_procedure_detail",
    "chain_document_review",
    "verify_citations",
    "impact_map",
    "cite_check",
    "applicable_law",
    "search_decisions",
    "get_decision_text"
]);

function asObject(value) {
    if (typeof value === 'string') {
        try { value = JSON.parse(value); } catch { return null; }
    }
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

/**
 * 보조 도구·무조회 결과를 성공한 법률 조회로 집계하지 않기 위한 판정입니다.
 * 도구 응답의 모든 사실과 최종 답변의 법적 정확성을 증명하는 검증은 아닙니다.
 */
export function isEvidenceLookup(name, args, result) {
    if (!result || result.isError) return false;
    let input = asObject(args) || {};
    let depth = 0;
    while (name === 'execute_tool') {
        if (depth++ >= 8 || typeof input.tool_name !== 'string') return false;
        name = input.tool_name;
        input = asObject(input.params);
        if (!input) return false;
    }
    if (!LOOKUP_NAMES.has(name)) return false;
    const text = (Array.isArray(result.content) ? result.content : [])
        .filter(part => part.type === 'text' && typeof part.text === 'string')
        .map(part => part.text).join('\n').trim();
    if (!text || text.includes('[NO_CITATIONS_FOUND]')) return false;

    const verifiesCitations = name === 'verify_citations'
        || (name === 'legal_analysis' && input.mode === 'verify_citations');
    if (verifiesCitations) {
        // 모두 미확인인 PARTIAL_VERIFIED도 성공으로 세지 않습니다.
        return /^(?:법령|판례) 인용 [^\n]*\|\s*✓\s*[1-9]\d*\s*실존/m.test(text);
    }
    const reviewsDocument = name === 'chain_document_review'
        || (name === 'legal_research' && input.task === 'document_review');
    if (reviewsDocument && /추가\s+검색을\s+생략/.test(text)) return false;
    return true;
}

/** Worker Secret은 요청 컨텍스트로 전달하며 로컬 .env 파일은 읽지 않습니다. */
export function getLawApiProtocol() { return 'https'; }
export function getLawApiBaseUrl() { return 'https://www.law.go.kr/DRF'; }
export function getLawSiteBaseUrl() { return 'https://www.law.go.kr'; }

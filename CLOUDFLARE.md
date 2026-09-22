# Cloudflare 운영 안내

> 새 운영자 설치는 [전달 및 설치 안내](DISTRIBUTION.md), MCP 정기 갱신·배포는 [자동 업데이트 안내](AUTO_UPDATE.md)를 참고하세요. 각 설치자는 본인의 계정과 Worker로 설정하고 검증해야 합니다.

구현은 단일 Worker와 Conversation Durable Object를 사용합니다. GPT 응답과 법률 조회를 모두 Worker 안에서 처리합니다.

## 실행 구조

~~~mermaid
flowchart LR
  T[Telegram] -->|인증된 웹훅| W[Cloudflare Worker]
  W -->|접수 저장| D[Conversation Durable Object]
  D -->|알람으로 작업 처리| G[OpenAI GPT Responses API]
  D -->|법률 도구 직접 호출| L[국가법령정보센터]
  D -->|답변 전송| T
  D --- S[영속 inbox·대화·작업 상태]
~~~

공개 설정의 Worker 이름은 예시값 `my-lawyer-bot`입니다. 실제 배포 대상은 개인 환경 또는 Actions Secret으로 지정합니다. 하나의 Conversation 클래스가 채팅·사용자 조합에 따라 별도 객체로 생성됩니다. 수신 업데이트와 작업 상태를 저장하고 알람을 예약한 뒤 웹훅 접수에 응답합니다. 처리 시간은 Telegram의 웹훅 응답 대기에 묶이지 않습니다.

GPT는 OpenAI Responses API를 사용하며 기본 모델 설정은 gpt-5.6-terra입니다. 모델은 cloudflare/wrangler.jsonc의 OPENAI_MODEL로 변경합니다. API 요청에는 store:false를 설정하고 다음 질문에 필요한 대화는 Conversation에서 관리합니다.

별도 Queue·D1·MCP 서버·컨테이너는 필요하지 않습니다. Docker 실행이나 이미지 빌드 단계도 없습니다.

## 법률 도구

cloudflare/law.js가 lockfile에 고정된 korean-law-mcp의 도구 레지스트리를 직접 사용합니다. 이 문서의 최초 검증 기준은 4.13.1이며 실제 버전은 package.json과 lockfile을 확인합니다. 프로세스를 실행하거나 외부 MCP 서비스에 인증키를 전달하지 않습니다.

직접 노출하는 도구는 10개입니다. legal_research의 8개 조사 유형, legal_analysis의 인용 검증·판례 분석·시점별 법령 검토를 포함합니다. 그 밖의 기능은 원래 discover_tools와 execute_tool 경로로 실행합니다. 입력 검증·업스트림 요청 예산·오류 표시도 패키지의 로직을 재사용합니다.

LAW_OC는 요청별 AsyncLocalStorage 컨텍스트로 전달합니다. 모델이 도구 입력에 넣은 apiKey는 제거하며, 동시 요청의 키를 전역 변수에 저장하지 않습니다. 법률 조회는 호출당 60초의 취소 신호와 요청 예산을 적용합니다.

Worker 호환을 위해 다음 세 모듈을 빌드에서 대체합니다.

| 원본 | Worker 대체 | 동작 |
| --- | --- | --- |
| kordoc | law-worker-kordoc.js | 네이티브 별표 파일 추출 제한과 원문 링크 확인 안내 |
| MCP lib/cache.js | law-worker-cache.js | 전역 타이머 없는 크기·만료 제한 캐시 |
| MCP lib/law-url-config.js | law-worker-config.js | 로컬 .env 로딩 없이 HTTPS 법제처 주소 사용 |

법제처 별표의 HWP/HWPX/PDF 파일 자동 추출은 지원하지 않습니다. 실패를 빈 정상 결과로 숨기지 않고 원문 파일 링크를 안내합니다. Telegram에 직접 첨부한 PDF는 별도로 GPT가 분석합니다.

## 접수와 대화 상태

- Telegram의 X-Telegram-Bot-Api-Secret-Token 헤더를 검증합니다.
- update_id로 중복 접수를 구분하고, 채팅·사용자별 작업을 순서대로 처리합니다.
- 사진 앨범은 media_group_id로 모읍니다. 첨부파일은 파일당 4MiB, 합계 8MiB, 최대 10개입니다.
- 대화는 마지막 답변 후 30분 동안 유지합니다. /start와 /clear는 이전 대화를 초기화하고 /help는 사용 방법을 안내합니다.
- 대화 저장 크기를 제한하고 이미지·PDF 바이너리를 대화 기록에서 제거합니다.
- 실패한 작업은 제한된 횟수로 재시도합니다. Telegram 전송과 저장은 하나의 트랜잭션이 아니므로 모든 장애에서 정확히 한 번만 전송한다고 보장하지 않습니다.

## 설치 및 로컬 개발

저장소 루트와 cloudflare 폴더에서 각각 npm ci로 의존성을 설치합니다. .dev.vars와 .env, .wrangler, .build는 Git에 포함하지 않습니다.

~~~powershell
# 저장소 루트
npm ci
npm test
cd cloudflare
npm ci
npm test
npm run check
npm run dev
~~~

개발 주소는 http://localhost:8787 입니다. esbuild로 사전 번들을 만들고 Wrangler가 .build/worker.js를 실행합니다. 로컬 개발 서버는 Telegram에서 직접 접근하는 공개 주소가 아니므로 실제 웹훅 수신은 배포 주소에서 별도로 검증합니다.

## Secret 및 배포

로컬 설정 파일은 cloudflare/.dev.vars입니다. 필요한 항목은 OPENAI_API_KEY, TELEGRAM_BOT_TOKEN, LAW_OC, TELEGRAM_WEBHOOK_SECRET입니다. 관리자 점검 API를 사용할 때는 ADMIN_API_SECRET도 별도로 설정합니다. 실제 값은 문서·명령 기록·Git에 넣지 않습니다.

운영 환경에는 Workers Secrets로 등록합니다. cloudflare 폴더에서 개인 환경에 배포 대상 이름을 설정한 뒤 다음 명령으로 값을 입력합니다. 실제 이름을 공개 문서에 저장하지 마세요.

~~~powershell
$env:CLOUDFLARE_WORKER_NAME = 'YOUR_WORKER_NAME'
npx wrangler secret put OPENAI_API_KEY --name $env:CLOUDFLARE_WORKER_NAME
npx wrangler secret put TELEGRAM_BOT_TOKEN --name $env:CLOUDFLARE_WORKER_NAME
npx wrangler secret put LAW_OC --name $env:CLOUDFLARE_WORKER_NAME
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --name $env:CLOUDFLARE_WORKER_NAME
npm run deploy -- --name $env:CLOUDFLARE_WORKER_NAME
~~~

Cloudflare 배포 권한은 Wrangler 로그인이나 계정 API 토큰으로 별도 관리합니다. 해당 자격증명을 법률봇의 Worker Secret에 넣을 필요는 없습니다. 배포에는 대상 계정의 Worker 및 Durable Object 관련 권한이 필요하며, 사용자 지정 도메인을 연결할 경우에는 해당 Zone 권한도 확인합니다.

## MCP 정기 업데이트

GitHub Actions는 매일 한국시간 05:37에 npm 최신 안정판을 확인하고, 새 버전 또는 미완료 배포가 있을 때 설치·테스트·번들 검사 후 기본 브랜치 커밋·push와 Worker 재배포를 수행합니다. 별도 PR 승인 단계는 없습니다. 일반 git push는 이 workflow의 실행 조건이 아닙니다.

GitHub 저장소 Actions Secrets의 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_WORKER_NAME`이 필요합니다. 실제 Worker 이름은 Secret으로만 지정하고 공개 wrangler 설정은 예시 이름으로 유지합니다. 기존 Worker 런타임 Secrets는 별도로 유지합니다. 같은 버전이 이미 배포됐으면 조회만 하고, 배포 성공 후에만 `.github/law-mcp-deployed-version.txt`를 기록합니다. 자동화 연결 완료는 실제 workflow의 배포·기록 작업 결과로 확인해야 합니다. 자세한 설정과 실패 후 재시도는 [자동 업데이트 안내](AUTO_UPDATE.md)를 참고하세요.

## Telegram 전환

1. 배포 후 /health, GPT 모델 접근, 법률 도구 목록과 실제 법령 조회를 확인합니다.
2. 같은 봇의 기존 로컬 long polling 프로세스가 실행 중이면 중단합니다.
3. Telegram setWebhook으로 배포 주소의 /telegram/webhook을 지정하고 secret_token을 TELEGRAM_WEBHOOK_SECRET과 일치시킵니다. 대기 중인 업데이트를 임의 삭제하지 않습니다.
4. 텍스트·후속 질문·/clear·사진·앨범·PDF 및 오류 응답을 확인합니다.
5. 로컬 실행으로 되돌릴 경우 웹훅을 해제하고 보관된 작업의 처리 상태를 확인한 뒤 long polling을 재개합니다.

## 비용과 운영 확인

비용은 Cloudflare Workers·Durable Objects 사용량과 OpenAI API 사용량으로 구성됩니다. 모델, 질문 수, 대화 길이, 첨부파일, 법률 도구 호출 횟수에 따라 달라집니다. 계정의 실제 요금제와 사용 한도를 확인하기 전에는 무료 운영이나 월 총액을 확정하지 않습니다.

배포 시 계정의 Workers·Durable Objects 사용 가능 여부, 실행 한도, 요청 실패와 재시도량을 확인합니다. 비밀 값과 상담 본문은 운영 로그에 남기지 않습니다.

- [Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/)
- [Durable Objects 요금](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Workers Node.js 호환성](https://developers.cloudflare.com/workers/runtime-apis/nodejs/)
- [Telegram 웹훅](https://core.telegram.org/bots/api#setwebhook)
- [법률 MCP 소스](https://github.com/chrisryugj/korean-law-mcp)

## 설치 환경 검증

각 운영자는 자신의 배포 URL에서 `/health`, 인증된 관리자 점검, 실제 법령 질문·후속 대화·첨부 처리를 확인합니다. 주소·계정·배포 버전·확인 시각·CI 실행 기록은 공개 문서에 넣지 말고 `.local/` 등 비공개 위치에 보관하세요.

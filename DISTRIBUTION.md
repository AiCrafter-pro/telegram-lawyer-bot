# 다른 사람에게 전달하고 설치하는 방법

이 안내는 소스의 Cloudflare 실행 경로를 기준으로 작성했습니다. 각 설치자는 본인 계정과 운영 환경을 별도로 준비합니다.

## 1. 폴더 통째로 넘겨도 되나요?

**개발 중인 원본 폴더를 그대로 압축해서 전달하지 마세요.** 소스 외에 API 키, 봇 토큰, 상담 로그, 개발용 저장소가 함께 있을 수 있습니다. `.gitignore`는 Git 추적을 제한할 뿐 탐색기 복사나 일반 압축에서 파일을 제외해 주지 않습니다.

다음 중 하나로 전달합니다.

- **함께 개발할 사람:** GitHub 저장소를 clone하거나 fork합니다. 비공개 저장소는 접근 권한이 필요합니다. 원 저장소에 직접 push할 권한이 없다면 자신의 포크·브랜치에서 수정한 뒤 PR로 제안합니다.
- **독립 설치할 사람:** `npm run package:release`로 생성한 전달용 ZIP을 줍니다. ZIP에는 커밋된 소스와 설정 예시가 담기며 기존 운영자의 비밀값·상담 기록·배포 상태·Git 이력을 제외합니다.
- GitHub의 “Download ZIP”은 추적된 파일을 내려받습니다. 아래 전용 ZIP과 달리 운영 인수인계 문서 및 공개 운영 주소도 포함될 수 있으므로, 실행용 전달에는 전용 ZIP이 더 간결합니다.
- ZIP은 **설치 가능한 소스 묶음**입니다. 계정 설정 없이 즉시 실행되는 설치 프로그램은 아닙니다.

| 포함할 항목 | 제외할 항목 |
| --- | --- |
| 소스, 테스트, package.json, package-lock.json | `.env`, `.env.*`의 실제 설정 |
| 빈 `.env.example`, `cloudflare/.dev.vars.example` | 실제 `.dev.vars`, 환경별 비밀파일 |
| wrangler 설정, 빌드 스크립트, 설치 안내 | `node_modules/`, `.build/`, `.check/` |
| 필요한 제3자 LICENSE·NOTICE | `.wrangler/`, `.git/`, 상담 `logs/` |
| 소스 커밋과 파일 해시 목록 | 작업용 `docs/`, `archive/`, `.local/` 및 개인 배포 기록 |

코드 저장과 자격증명 백업은 별도입니다. Git에 비밀값을 커밋하지 않으며, 계정 소유자가 비밀번호 관리자 등 별도 수단으로 관리합니다. [Cloudflare 비밀 설정 안내](https://developers.cloudflare.com/workers/configuration/secrets/)

## 2. 설치 방식과 소유자를 먼저 정하세요

| 방식 | 계정·비용·데이터 책임 |
| --- | --- |
| 다른 사람의 독립 운영 | 상대방의 Telegram 봇·OpenAI API·Cloudflare·법제처 OC를 사용합니다. 운영비와 데이터 관리도 상대방이 맡습니다. |
| 내가 운영하고 상대방은 이용만 함 | 소스 설치 없이 봇 링크로 이용할 수 있지만 내 API와 Cloudflare 사용량이 늘어납니다. 현재 사용자별 이용 제한 기능은 없습니다. |
| 내 서비스를 공동 개발 | GitHub 작업 권한과 운영 계정 권한은 별개입니다. 개발용 봇·키·Worker를 따로 마련하고 운영 자격증명을 저장소에 넣지 않습니다. |

기존 봇 토큰을 상대방 설치에 재사용하지 마세요. 같은 토큰으로 웹훅을 새 URL에 지정하면 기존 봇의 수신 경로가 바뀝니다. Telegram의 웹훅과 long polling은 동시 수신 방식이 아닙니다. [Telegram 수신 방식·웹훅](https://core.telegram.org/bots/api#setwebhook)

## 3. 받는 사람이 준비할 것

| 준비 항목 | 필요한 내용 |
| --- | --- |
| Node.js·npm | **Node.js 22 이상**. 이 프로젝트의 package.json과 설치된 Wrangler가 요구하는 최소 버전입니다. Node.js 24 사용을 권장합니다. |
| Git | GitHub clone·브랜치·PR 개발을 할 때 필요합니다. 전달 ZIP 설치 자체에는 필수 아님 |
| Telegram | 본인 계정에서 BotFather로 새 봇을 만들고 본인 토큰 준비 |
| OpenAI API | 본인 API 프로젝트·키·과금/사용 한도 확인. ChatGPT 로그인만으로 설정을 대신하지 않습니다. |
| Cloudflare | 본인 Workers 및 SQLite Durable Objects 사용 가능한 계정, 배포 권한 |
| 법제처 OPEN API | 본인 활용신청·승인 및 OC 인증값, 사용할 데이터 종류의 권한 확인 |

법제처는 활용신청 승인 및 API 인증값을 요구합니다. 새 OC의 실제 실행 환경에서 법령 조회가 되는지 확인해야 합니다. 서버 IP·도메인 등록 관련 검증에 실패하면 신청 설정을 확인하세요. Cloudflare 설치만으로 고정 출구 IP가 확보됐다고 가정하지 마세요. 기존 운영자의 성공이 상대방 OC의 승인·접속 성공을 보장하지 않습니다. [활용신청 안내](https://open.law.go.kr/LSO/information/guide.do), [인증·등록 IP 안내](https://open.law.go.kr/LSO/support/noticeView.do?seq=6)

현재 모델 설정은 `gpt-5.6-terra`입니다. 상대방 API 계정에서 이 모델과 Responses API, 도구 호출·이미지·PDF 입력이 가능한지 확인합니다. 모델을 바꾸는 경우 `reasoning.effort` 등 현재 요청 옵션과의 호환성도 확인합니다. 단순히 모델 이름만 바꾸고 검증을 생략하지 않습니다.

## 4. 설치와 개발

GitHub 저장소 주소를 사용하거나 전달받은 ZIP을 압축 해제한 프로젝트 루트에서 시작합니다.

~~~powershell
# GitHub에서 받을 경우: 권한 있는 저장소 또는 자신의 포크 주소
git clone https://github.com/OWNER/REPOSITORY.git
cd REPOSITORY

# ZIP이면 압축 해제된 프로젝트 폴더에서 아래부터 시작
node --version
npm ci
npm test

cd cloudflare
npm ci
npm test
npm run check
~~~

두 폴더의 package-lock.json을 함께 유지하세요. 받은 `node_modules`를 재사용하지 않고 각자 `npm ci`로 재설치합니다.

로컬 개발:

~~~powershell
# cloudflare 폴더
Copy-Item .dev.vars.example .dev.vars
# 편집기로 .dev.vars에 본인 값을 입력
npm run dev
~~~

개발 주소는 `http://localhost:8787`입니다. 로컬 개발 서버를 켰다고 Telegram 웹훅이 자동 연결되지는 않습니다. 기본 설치에는 Chrome CDP, Codex, Insane MCP, Docker가 필요하지 않습니다.

루트의 `start.bat`과 `npm run start:legacy`는 기존 Gemini 로컬판입니다. 새 Cloudflare 설치를 시작하는 방법으로 혼동하지 마세요.

## 5. 설정값과 Secret

`cloudflare/.dev.vars`는 로컬 전용입니다. Cloudflare 배포 환경에는 별도로 Workers Secrets를 등록해야 합니다.

| 변수 | 용도 | 필요 여부 |
| --- | --- | --- |
| TELEGRAM_BOT_TOKEN | 본인의 새 Telegram 봇 토큰 | 필수 |
| OPENAI_API_KEY | 본인의 OpenAI API 키 | 필수 |
| LAW_OC | 본인 법제처 인증값 | 필수 |
| TELEGRAM_WEBHOOK_SECRET | Telegram 웹훅 요청 인증용 임의 비밀값 | 필수 |
| ADMIN_API_SECRET | `/admin/check`, `/admin/query` 인증 | 선택; 운영 점검 시 권장 |
| OPENAI_MODEL | 모델 이름 | wrangler.jsonc의 vars로 설정; 비밀값 아님 |

웹훅 Secret은 32바이트 이상의 무작위값을 hex 등의 허용 문자로 생성하고, 관리자 Secret은 다른 값으로 생성합니다. 두 값과 토큰을 문서·스크린샷·명령줄 인수·Git에 남기지 마세요. Telegram은 웹훅 Secret의 문자·길이 제약을 명시합니다. [Telegram secret_token](https://core.telegram.org/bots/api#setwebhook)

`ADMIN_API_SECRET`이 없으면 관리자 점검 API는 401을 반환합니다. 일반 Telegram 봇 운영에 이 관리자 키가 필수인 것은 아닙니다. 관리자 점검 URL을 일반 사용자에게 제공하지 마세요.

## 6. 상대방 Cloudflare 계정에 새로 배포

1. 공개 `cloudflare/wrangler.jsonc`의 `name`은 예시값 `my-lawyer-bot`으로 유지합니다. 실제 Worker 이름은 개인 환경의 `CLOUDFLARE_WORKER_NAME`으로 설정하고 수동 명령의 `--name`으로 전달합니다. 실제 운영 이름을 소스에 커밋하지 마세요.
2. `OPENAI_MODEL` 접근 권한을 확인합니다.
3. `CONVERSATIONS` 바인딩과 `Conversation` 클래스 이름은 코드와 맞춰 유지합니다.
4. 아래 명령으로 본인 계정에 배포합니다. 기존 운영자 계정에 로그인된 상태라면 바로 배포하지 마세요.

~~~powershell
# cloudflare 폴더
npx wrangler login
npx wrangler whoami
$env:CLOUDFLARE_WORKER_NAME = 'YOUR_WORKER_NAME'
npm run check
npm run deploy -- --name $env:CLOUDFLARE_WORKER_NAME
# 각 명령의 입력창에서 본인의 값 입력
npx wrangler secret put OPENAI_API_KEY --name $env:CLOUDFLARE_WORKER_NAME
npx wrangler secret put TELEGRAM_BOT_TOKEN --name $env:CLOUDFLARE_WORKER_NAME
npx wrangler secret put LAW_OC --name $env:CLOUDFLARE_WORKER_NAME
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET --name $env:CLOUDFLARE_WORKER_NAME
# 관리자 점검을 사용할 경우
npx wrangler secret put ADMIN_API_SECRET --name $env:CLOUDFLARE_WORKER_NAME
~~~

최초 코드를 배포하고 Secrets를 모두 등록한 뒤 웹훅을 연결합니다. `wrangler secret put`은 운영 Worker 버전을 변경하므로 반드시 대상 이름을 확인합니다. [Workers Secrets 등록](https://developers.cloudflare.com/workers/configuration/secrets/)

새 배포 URL은 `https://본인-worker.본인-subdomain.workers.dev` 형태입니다. 다른 설치자의 주소나 배포 기록을 자신의 배포 완료 증거로 사용하지 않습니다. 실제 운영 기록은 `.local/` 등 비공개 위치에서 관리합니다.

## 7. 새 Telegram 봇과 연결

배포된 `/health`가 200을 반환하고, 설정·법령 조회를 확인한 뒤 본인의 봇에 `setWebhook`을 호출합니다.

- URL: `새 Worker URL/telegram/webhook`
- `secret_token`: Workers Secret과 같은 TELEGRAM_WEBHOOK_SECRET
- `allowed_updates`: `["message"]`
- 기존 대기 메시지를 지울 필요가 없으면 `drop_pending_updates`를 사용하지 않습니다.
- `getWebhookInfo`로 실제 연결 URL·대기 건수·최근 오류를 확인합니다.

다음은 본인의 `.dev.vars`에 저장한 값을 읽는 PowerShell 예시입니다. 봇 토큰이 들어간 URL을 출력하지 않습니다. **자신의 새 봇에만 실행**하세요.

~~~powershell
# cloudflare 폴더. 먼저 본인 새 배포 URL로 바꿉니다.
$env:NEW_WORKER_URL = 'https://my-lawyer-bot.YOUR-SUBDOMAIN.workers.dev'
@'
import fs from 'node:fs';
import dotenv from 'dotenv';
const v = dotenv.parse(fs.readFileSync('.dev.vars'));
try {
  const base = new URL(process.env.NEW_WORKER_URL);
  if (base.protocol !== 'https:' || !v.TELEGRAM_BOT_TOKEN || !v.TELEGRAM_WEBHOOK_SECRET) throw Error();
  const endpoint = 'https://api.telegram.org/bot' + v.TELEGRAM_BOT_TOKEN;
  const set = await fetch(endpoint + '/setWebhook', {
    method: 'POST', headers: {'content-type':'application/json'},
    body: JSON.stringify({
      url: base.origin + '/telegram/webhook',
      secret_token: v.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ['message']
    })
  }).then(r => r.json());
  const check = await fetch(endpoint + '/getWebhookInfo').then(r => r.json());
  console.log(JSON.stringify({
    connected: set.ok && check.ok, url: check.result?.url,
    pending: check.result?.pending_update_count,
    hasError: Boolean(check.result?.last_error_date)
  }, null, 2));
} catch { console.error('웹훅 설정 실패: 본인의 URL·Secret·토큰을 확인하세요.'); process.exitCode = 1; }
'@ | node --input-type=module
~~~

연결 후 실제 Telegram에서 `/start`, 인사, 법령 질문, 후속 질문, `/clear`, 이미지·PDF를 각각 확인합니다. `/health` 정상과 단위 테스트 통과만으로 전체 실제 사용 검증을 대신하지 않습니다.

## 8. 비용과 공개 운영 전 고려사항

- OpenAI API와 Cloudflare 사용량은 실제 키·계정 소유자에게 발생합니다. 질문 길이·대화 이력·첨부와 여러 도구 호출·재시도에 따라 달라집니다.
- 별도 개발용 API 프로젝트를 만들고 사용량 알림·접근 권한·실제 지출 한도를 확인하세요. 알림과 트래픽을 중단하는 지출 한도의 동작은 다릅니다. [OpenAI 운영 안내](https://developers.openai.com/api/docs/guides/production-best-practices)
- SQLite Durable Objects는 Workers Free 플랜에서 사용 가능한 범위가 있으나 무료 한도와 유료 과금은 계정·사용량에 따라 달라집니다. 무료 무제한이나 고정 월비용을 약속하지 마세요. [Durable Objects 요금](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/)
- **현재 봇에는 사용자 허용목록·사용자별 시간당 제한·애플리케이션 비용 상한이 없습니다.** 봇 링크를 안다는 이유만으로 허가된 사용자라고 판별하지 않습니다.
- 웹훅 Secret은 수신 요청 인증입니다. 봇을 이용할 사람을 제한하는 장치가 아닙니다. 대화별 큐 25개 제한도 비용 상한을 대신하지 않습니다.
- 불특정 다수에게 공개하기 전에 접근제어와 사용량 제한을 추가하고, 과금 책임·중단 기준·유지보수 담당자를 정하세요.

## 9. 상담 데이터와 답변 품질

현재 데이터 흐름은 Telegram → Worker/Durable Object → OpenAI·법률 조회 도구 → Telegram입니다. 법률 검색 도구에는 질문에서 만든 검색 조건이 전달될 수 있습니다. 외부 웹페이지 조회도 별도 네트워크 요청입니다.

- 30분은 Worker에서 다음 대화에 사용하는 문맥의 만료시간입니다. Telegram 채팅이나 모든 서비스 데이터가 30분 후 없어지는 뜻이 아닙니다.
- `/clear`는 Worker의 대화 세션을 초기화합니다. Telegram 메시지·첨부 원본 삭제 기능은 아닙니다.
- 작업 처리 중 inbox에 질문·파일 ID 등이 저장되고, 중복방지 업데이트 ID는 별도 만료 규칙을 사용합니다.
- 첨부 바이너리는 Worker 대화 이력에 보관하지 않지만, 파일 분석을 위해 OpenAI에 전송합니다. `store:false`가 모든 공급자 로그·보관을 없애는 보장은 아닙니다. [OpenAI 데이터 관리](https://developers.openai.com/api/docs/guides/your-data)
- 민감한 상담은 개인채팅에서 시험하세요. 현재 Worker는 그룹도 받으며 동일 그룹·동일 사용자의 여러 토픽이 같은 대화 문맥을 사용합니다. 그룹 답변은 그룹 구성원에게 보입니다.
- 기존 Gemini 로컬판은 같은 사용자의 다른 채팅까지 문맥이 공유될 수 있고 상담 내용을 로그에 기록합니다.
- 브랜드 “AI크래프터 법무팀/푸숑이”와 “수석 변호사”라는 표현이 프롬프트에 고정돼 있습니다. 상대방 운영 시 소개·브랜드 사용·AI 정보 안내를 검토하세요. 코드 저장소 공개와 브랜드 사용 허락은 별개입니다.
- 법률 도구 조회 성공은 최종 답변의 모든 법률 판단이 맞다는 보증이 아닙니다. 출처·사실관계·인용을 별도로 확인할 운영 절차가 필요합니다.

## 10. 현재 미완료·제한

- **인사 `안녕 푸숑아`를 법률 질문으로 오분류하는 버그가 미수정**입니다. `안녕`은 정상이며 두 경우를 구분해야 합니다.
- 법제처 별표 HWP/HWPX/PDF 자동 추출은 미지원입니다. 직접 첨부 PDF 분석은 별도 경로입니다.
- 첨부 한도: 파일당 4MiB, 총 8MiB, 최대 10개.
- 자동 테스트와 실제 Telegram 왕복 검증은 별개입니다. 설치 환경에서 두 검증을 모두 수행합니다.
- 새 설치자의 자격증명·과금·웹훅은 새로 검증해야 합니다. 이미지·앨범·PDF 실사용, 부하·장기 운영 시험은 별도입니다.
- 원 소스가 사용하는 `korean-law-mcp 4.13.1`의 NOTICE에 제3자 구현의 라이선스 확인 필요 사항이 남아 있습니다. 배포 ZIP도 이를 해결한 제품이라는 뜻은 아닙니다. [제3자 고지](THIRD_PARTY_NOTICES.md)를 읽으세요.

## 11. GitHub 협업과 업데이트

GitHub에 올리기 위해 실행 코드를 별도 형식으로 다시 작성할 필요는 없습니다. 비밀 설정 분리, 설치 안내, 고정 의존성, 테스트를 유지하면 됩니다.

~~~powershell
# 저장소를 받은 개발자
git switch -c feature/my-change
# 변경 후
npm test
npm --prefix cloudflare test
npm --prefix cloudflare run check
git add <검토한_소스_파일>
git commit -m "변경 내용"
git push -u origin feature/my-change
# GitHub에서 PR 작성
~~~

원 저장소에 쓰기 권한이 없다면 먼저 포크하고 자신의 포크로 push합니다. 비공개 저장소라면 먼저 소유자가 접근 권한을 부여해야 합니다.

Git commit은 로컬 이력 저장, git push는 GitHub 반영, npm run deploy는 Cloudflare 실행 코드 반영입니다. 일반 push 자체가 자동 배포되지는 않습니다. 별도의 MCP workflow는 매일 한국시간 05:37 또는 수동 실행 시 최신 안정판을 확인하고, 테스트·번들 검증 통과 후 PR 없이 커밋·push·Cloudflare 배포합니다. 동일 버전이 이미 배포됐으면 조회만 합니다. 본인 저장소에 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_WORKER_NAME` 세 Actions Secret을 설정하고 최초 연결은 force_deploy로 검증해야 합니다. 복사한 성공 버전 기록을 본인 배포 완료 증거로 사용하지 마세요. 설정·실패 처리·검증 범위는 [자동 업데이트 안내](AUTO_UPDATE.md)를 참고하세요.

## 12. 전달용 ZIP 다시 만들기

Windows 개발 환경에서 소스·설치 문서를 검토하고 커밋한 다음 프로젝트 루트에서:

~~~powershell
npm run package:release
~~~

- Git HEAD의 허용 목록만 패키징합니다. 미커밋 파일은 전달본에 들어가지 않습니다.
- `dist/`에 커밋 ID가 포함된 폴더와 ZIP이 생깁니다. 동일 커밋 출력이 이미 있으면 덮어쓰지 않고 중단합니다.
- 전달본의 Worker 이름은 `my-lawyer-bot` 예시값입니다. 실제 배포 대상은 설치자의 비공개 설정으로 지정합니다.
- 파일 목록과 SHA-256 해시가 포함된 manifest로 내용을 확인할 수 있습니다.
- 이 스크립트는 Windows PowerShell 압축 기능을 사용합니다. ZIP의 수령자는 Node.js 요구사항을 만족하는 다른 운영체제에서도 소스를 설치할 수 있습니다.
- 패키징 검사는 알려진 토큰 패턴과 로컬 비밀값을 검사하지만 모든 종류의 민감정보를 자동으로 찾아낸다는 보장은 아닙니다. 새로운 파일을 허용 목록에 추가할 때 내용을 검토하세요.

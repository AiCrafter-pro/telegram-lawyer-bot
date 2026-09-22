# 푸숑이 텔레그램 법률봇

> **타인 설치·GitHub 협업:** [전달 및 설치 안내](DISTRIBUTION.md), [MCP 자동 업데이트](AUTO_UPDATE.md), [제3자 고지](THIRD_PARTY_NOTICES.md)를 확인하세요. 원본 작업 폴더를 통째로 전달하지 말고 GitHub clone 또는 `npm run package:release`로 만든 ZIP을 사용하세요.

> **개발 안내:** [개발 인수인계](HANDOFF.md)에서 코드 구조와 알려진 제한을 확인하세요. 일반 대화가 법률 질문으로 오분류될 수 있는 문제는 개선 대상입니다.

텔레그램으로 받은 질문·사진·PDF를 GPT가 분석하고 국가법령정보센터에서 법령과 판례를 조회하는 봇입니다. 주 실행 경로는 **Cloudflare Worker + Conversation Durable Object**입니다. 사용자 PC를 켜 두지 않아도 배포된 Worker가 질문을 접수하고 응답합니다.

## Cloudflare에서 실행

응답 엔진은 OpenAI Responses API를 사용합니다. 기본 모델 설정은 gpt-5.6-terra이며 cloudflare/wrangler.jsonc의 OPENAI_MODEL로 변경합니다. 법률 도구는 package-lock.json에 고정된 korean-law-mcp의 코드를 Worker에 직접 번들링합니다. 최초 검증 기준은 4.13.1이며 실제 설치 버전은 package.json과 lockfile을 확인합니다. 별도의 MCP 서버 프로세스나 원격 MCP 서비스는 사용하지 않습니다.

- Worker가 Telegram 웹훅을 인증하고 Conversation의 영속 inbox에 질문을 저장합니다.
- Conversation은 알람으로 질문을 처리하며 채팅·사용자별 대화와 작업 상태를 관리합니다.
- 법률 도구의 최신 입력 검증, 다단계 조사, 인용 검증, 사건 당시 적용 법령 조회를 사용합니다.
- 사진·앨범·PDF를 분석하고 /start, /clear, /help 명령을 제공합니다.

설치 및 로컬 검증에는 Node.js 22 이상이 필요합니다. Node.js 24를 권장합니다.

~~~powershell
git clone https://github.com/OWNER/REPOSITORY.git
cd REPOSITORY
npm ci
cd cloudflare
npm ci
npm run dev
~~~

로컬 개발 주소는 http://localhost:8787 입니다. 실제 API를 사용하는 로컬 실행에는 cloudflare/.dev.vars에 다음 항목을 설정합니다. 키 값은 문서나 Git에 저장하지 않습니다.

| 항목 | 용도 |
| --- | --- |
| OPENAI_API_KEY | GPT 요청 인증 |
| TELEGRAM_BOT_TOKEN | 텔레그램 파일 다운로드·답변 전송 |
| LAW_OC | 법제처 API 인증 |
| TELEGRAM_WEBHOOK_SECRET | 텔레그램 웹훅 요청 인증 |
| ADMIN_API_SECRET | 선택: 관리자 연결 점검·질문 API 인증 |

배포 환경에는 같은 항목을 Workers Secrets로 등록합니다. Cloudflare 배포 자격증명은 별도로 관리합니다. 자세한 배포·전환 절차는 [CLOUDFLARE.md](CLOUDFLARE.md)를 참고하세요.

## 지원 범위

- 첨부파일은 **파일당 4MiB, 한 요청 합계 8MiB, 최대 10개**입니다. 지원 형식은 PDF와 JPG·PNG·WebP 이미지입니다.
- Telegram으로 받은 PDF는 GPT가 분석합니다. 법제처 별표의 HWP/HWPX/PDF 파일을 네이티브 파서로 자동 추출하는 기능은 Worker에서 지원하지 않습니다. 이 경우 원문 파일 링크와 추출 제한을 안내합니다.
- 대화는 마지막 답변 후 30분 동안 이어지며 /clear로 초기화합니다. 첨부파일의 원본 바이너리는 대화 기록에 보관하지 않습니다.
- 법령·판례 조회 실패와 미검증 인용은 정상 근거로 취급하지 않도록 처리합니다. 법률 자료와 확인된 근거를 구분해 제시합니다.

## 개발 및 검증

~~~powershell
# 저장소 루트: 법률 MCP·로컬 연동 테스트
npm test

# cloudflare 폴더: Worker 테스트와 배포 번들 검사
cd cloudflare
npm test
npm run check
~~~

Cloudflare 빌드는 esbuild로 호환 번들을 생성하며 Wrangler 진입점은 .build/worker.js입니다. 의존성은 검증한 버전과 package-lock.json으로 관리합니다. MCP 새 안정판은 GitHub Actions가 매일 한국시간 05:37에 확인하고 테스트·번들 검증을 통과하면 PR 없이 커밋·push 및 Cloudflare 배포를 수행하도록 구성돼 있습니다. 일반 push 자체는 자동 배포 트리거가 아닙니다. GitHub Actions Secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_WORKER_NAME` 설정과 실제 workflow 검증은 별도로 필요하며 [자동 업데이트 안내](AUTO_UPDATE.md)를 확인하세요. 개별 질문 처리 중에는 설치 버전이 바뀌지 않습니다.

단위 테스트는 가짜 API 응답을 사용하며 실제 Telegram 메시지나 유료 GPT 요청을 보내지 않습니다. 실제 법제처·GPT 연결과 웹훅 전환 상태는 배포 검증에서 별도로 확인합니다.

## 기존 로컬 Gemini 실행

기존 bot.js, src/gemini.js, start.bat은 로컬 개발용 실행 경로로 남아 있습니다. 이 경로는 Gemini 2.5 Flash와 로컬 MCP 프로세스를 사용합니다.

저장소 루트의 .env에 TELEGRAM_BOT_TOKEN, GEMINI_API_KEY, LAW_OC를 설정한 뒤 루트에서 npm run start:legacy 또는 start.bat을 실행합니다. Telegram 웹훅과 로컬 long polling은 같은 봇에서 동시에 사용할 수 없으므로 클라우드 운영 중에 바로 실행하지 마세요.

## 참고 프로젝트

- [korean-law-mcp](https://github.com/chrisryugj/korean-law-mcp): 국가법령정보센터 법률 도구와 검증 로직.
- [AiCrafter Code Snippets](https://github.com/AiCrafter-pro/aicrafter-code-snippets): 초기 봇의 코드 기반.

## 배포 확인

각 설치자는 본인 Worker와 Telegram 봇의 연결을 직접 검증합니다. 공개 wrangler 설정의 Worker 이름은 `my-lawyer-bot` 예시값이며 실제 이름은 개인 환경 또는 Actions Secret으로 관리합니다. 실제 주소·계정·배포 이력은 `.local/` 등 비공개 위치에 보관하세요.

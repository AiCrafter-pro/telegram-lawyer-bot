# 개발 인수인계

이 문서는 공개 가능한 코드 구조, 개발 절차, 알려진 제한을 정리합니다. 특정 운영자의 계정·URL·대화·배포 이력을 담지 않습니다. 실제 운영 기록과 개인 설정은 Git에서 제외된 `.local/` 등 별도 비공개 저장소에서 관리하세요.

## 주요 실행 경로

현재 주 실행 경로는 Cloudflare Workers + Conversation Durable Objects + OpenAI Responses API입니다. `cloudflare/worker.js`가 Telegram 웹훅을 접수하고 `cloudflare/engine.js`가 AI 응답과 법률 도구 호출을 처리합니다.

- Telegram 웹훅 Secret을 검증한 후 요청을 영속 inbox에 저장합니다.
- 채팅·사용자 조합별로 대화와 작업을 분리하고 순차 처리합니다.
- 중복 업데이트 방지, 사진 앨범 묶기, 제한된 실패 재시도를 제공합니다.
- 텍스트·사진·PDF, 긴 답변 분할, `/start`, `/clear`, `/help`를 지원합니다.
- 대화 문맥은 마지막 답변 후 30분 동안 유지합니다. Telegram 메시지 자체를 삭제하는 기능은 아닙니다.
- 첨부 한도는 파일당 4MiB, 합계 8MiB, 최대 10개입니다.
- `korean-law-mcp` 도구를 Worker에 직접 번들링하며 별도 MCP 서버나 Docker는 필요하지 않습니다.
- 실제 의존성 버전은 package.json과 package-lock.json에서 확인합니다.

기존 `bot.js`, `src/gemini.js`, `src/handlers.js`, `src/mcp.js`, `start.bat`은 Gemini 기반 로컬 실행 경로입니다. 같은 Telegram 봇의 웹훅과 long polling을 동시에 운영하지 마세요.

## 파일 위치

| 파일 | 역할 |
| --- | --- |
| `cloudflare/worker.js` | 웹훅 인증, 접수, Durable Object 상태·작업·답변 전송 |
| `cloudflare/engine.js` | OpenAI 요청, 파일 입력, 법률 조회, 대화 이력 |
| `cloudflare/law.js` | 법률 MCP 도구와 인증 컨텍스트 연결 |
| `cloudflare/evidence.js` | 법률 자료 조회 성공 여부 판정 |
| `cloudflare/build.mjs` | Worker 번들 생성 및 호환 모듈 대체 |
| `src/prompt.js` | 답변 원칙과 캐릭터 프롬프트 |
| `scripts/update-law-mcp.mjs` | 안정판 조회, 의존성 갱신, 테스트·번들 검사 |
| `.github/workflows/update-law-mcp.yml` | 정기 검증, 커밋, 자동배포, 성공 기록 |
| `scripts/package-release.mjs` | 허용된 소스로 전달용 ZIP 생성 |

## 알려진 제한과 다음 개선점

- **일반 인사 오분류:** `cloudflare/engine.js`의 `legalTopic`은 일부 인사 표현만 예외로 취급합니다. 예외 문장에 정확히 맞지 않는 인사·봇 소개 질문을 법률 질문으로 분류해 조회 실패 안내가 나올 수 있습니다. 법률 질문에 대한 근거 조회 요구는 유지하면서 일반 대화 분류를 보완해야 합니다.
- **회귀 검증 범위:** 인사·감사·봇 소개, 인사와 법률 질문이 섞인 문장, 앞 대화에 이어지는 법률 질문을 함께 검사해야 합니다.
- **법률 자료:** 법제처 별표 HWP/HWPX/PDF의 네이티브 본문 추출은 미지원입니다. Telegram에 직접 첨부한 PDF 분석은 별도 경로입니다. 자료 조회 성공이 답변 전체의 정확성을 보장하지는 않습니다.
- **표현과 안내:** 기존 캐릭터의 변호사 표현과 AI 정보 안내 사이에 일관성이 필요합니다. 운영자가 소개 문구와 브랜드 사용 범위를 검토해야 합니다.
- **접근 제어:** 사용자 허용목록·사용자별 호출 제한·애플리케이션 비용 상한은 없습니다.
- **그룹 대화:** Worker는 동일 그룹·동일 사용자의 여러 토픽을 같은 문맥으로 취급합니다. 기존 로컬판은 같은 사용자의 다른 채팅까지 문맥이 공유될 수 있습니다.
- **실사용 검증:** 사진·앨범·PDF, 명령, 만료·재시도·장애·부하·장기 운영은 각 설치 환경에서 별도로 확인해야 합니다.

## 개발 및 검증

Node.js 요구 버전과 설치 절차는 [README](README.md)를 확인하세요. 다음 명령은 프로젝트 루트에서 실행합니다.

~~~powershell
npm ci
npm --prefix cloudflare ci
npm test
npm --prefix cloudflare test
npm --prefix cloudflare run check
~~~

테스트는 가짜 API 응답을 사용합니다. `check`는 배포하지 않는 번들 검사입니다. 테스트 통과는 실제 계정의 모델 접근, 법제처 인증, Telegram 웹훅 연결을 대신하지 않습니다. 운영 환경에서의 점검 결과는 공개 문서에 기록하지 마세요.

## 배포와 업데이트

공개 `cloudflare/wrangler.jsonc`의 Worker 이름은 예시값 `my-lawyer-bot`입니다. 실제 운영 Worker 이름을 공개 설정에 커밋하지 마세요. 수동 배포에서는 개인 환경의 값을 `--name`으로 전달하고, GitHub Actions에서는 `CLOUDFLARE_WORKER_NAME` Secret을 사용합니다.

Actions에 필요한 배포용 Secret은 `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_WORKER_NAME`입니다. 봇 런타임 키는 Worker Secrets로 별도 등록합니다. 자세한 절차는 [Cloudflare 안내](CLOUDFLARE.md)와 [자동 업데이트 안내](AUTO_UPDATE.md)를 따르세요.

자동업데이트는 일정 또는 수동 실행 시 최신 안정판을 확인하고 테스트·번들 검사를 통과한 결과를 커밋·배포합니다. 일반 push 자체로 실행되지는 않습니다. 신규 설치자는 자신의 계정과 Worker에 `force_deploy=true`로 전체 과정을 검증해야 합니다.

## 공유할 때

[전달 및 설치 안내](DISTRIBUTION.md)와 [제3자 고지](THIRD_PARTY_NOTICES.md)를 확인하세요. 원본 작업 폴더 전체를 전달하지 말고 검토된 Git 저장소 또는 전달용 ZIP을 사용합니다.

비밀값뿐 아니라 실제 Worker·봇 주소, 계정 식별자, 배포·CI 실행 기록, 개인 경로, 브라우저 세션, 상담 내용도 공개 소스에 넣지 않습니다. 운영자의 개인 기록은 `.local/` 아래에서 관리하며 Git·공유 ZIP에 포함하지 않습니다.

# korean-law-mcp 자동 업데이트와 배포

이 workflow는 **테스트와 번들 검증을 통과하면 PR 없이 자동 커밋·푸시하고 Cloudflare에 배포**합니다. 각 설치자는 본인 계정·Worker·자격증명으로 설정하고 실제 실행 결과를 검증해야 합니다. 개인 운영 이력은 공개 문서가 아닌 `.local/` 등 비공개 위치에서 관리합니다.

## 무엇을 업데이트하나요?

현재 봇은 `korean-law-mcp` 코드를 Cloudflare Worker에 직접 번들링합니다. npm에 새 패키지가 나오는 것만으로 배포된 봇이 바뀌지 않습니다. 설치 버전과 lockfile을 갱신하고, 테스트·빌드 후 Worker를 다시 배포해야 합니다.

- 대상은 npm 공식 레지스트리의 `korean-law-mcp@latest`입니다.
- `X.Y.Z` 형태의 안정판을 허용하며 **메이저 버전 변경도 대상**입니다. prerelease, 버전 범위, 잘못된 응답은 거절합니다.
- 현재보다 낮은 버전으로 자동으로 되돌리지 않습니다.
- `package.json`에는 정확한 버전을 기록하고 `package-lock.json`도 함께 커밋합니다.
- 실행 중인 봇이 매 질문마다 패키지를 설치하는 구조는 아닙니다.
- 이 자동화는 npm 의존성 갱신입니다. 법제처 데이터의 최신성이나 법률 답변의 정확성을 보증하는 기능은 아닙니다.

실행 파일은 [업데이트 스크립트](scripts/update-law-mcp.mjs), [GitHub workflow](.github/workflows/update-law-mcp.yml)입니다.

## 실행 일정과 자동화 범위

매일 **한국시간 05:37**에 확인합니다. workflow cron은 UTC 기준 `37 20 * * *`입니다. GitHub Actions에서 `Update and deploy korean-law-mcp`를 선택해 수동 실행할 수도 있습니다.

**일반적인 git push만으로 이 workflow가 배포되지는 않습니다.** 트리거는 정기 일정과 수동 실행뿐입니다. 다만 MCP 업데이트가 필요해 배포할 때에는 선택된 기본 브랜치 커밋의 Worker 전체를 빌드하므로, 그 커밋에 포함된 다른 코드 변경도 함께 반영됩니다.

workflow는 저장소에 설정된 기본 브랜치를 사용합니다. 다른 브랜치를 선택한 수동 실행은 거절합니다. schedule workflow는 기본 브랜치에 파일이 존재해야 실행되며, GitHub 상황에 따라 지연되거나 누락될 수 있습니다. 공개 저장소에서 **60일 동안 저장소 활동이 없으면 예약 실행이 자동 비활성화**될 수 있으므로 Actions의 활성 상태와 최근 실행을 확인해야 합니다. [GitHub 일정 실행 조건](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

## 처리 순서

네 작업은 각각 별도 runner에서 실행됩니다. 새 의존성의 테스트 코드가 실행되는 작업에는 저장소 쓰기 토큰과 Cloudflare 배포 자격증명을 전달하지 않습니다.

| 작업 | 처리 내용 |
| --- | --- |
| `validate` | npm 최신 안정판 조회 → 필요한 경우 설치 → 루트 테스트 → Worker 테스트 → `wrangler deploy --dry-run` 번들 검사 |
| `commit` | 검증된 package.json과 package-lock.json만 새 runner에서 검사 → 기본 브랜치에 커밋·푸시 |
| `deploy` | 커밋된 정확한 SHA를 새 runner에서 checkout → lockfile로 재설치 → 브랜치 변경 확인 → `wrangler deploy` |
| `record-success` | 배포 성공 후 `.github/law-mcp-deployed-version.txt`를 갱신하고 커밋·푸시 |

동일 버전이 이미 성공 기록에 있으면 npm 최신 버전 조회만 하고 종료합니다. 이 경우 의존성 설치·테스트·Cloudflare 재배포는 하지 않습니다. GitHub runner 실행 자체는 남지만 테스트에서 GPT나 Telegram API를 호출하지 않습니다.

의존성 설치는 `--ignore-scripts`로 lifecycle scripts를 실행하지 않습니다. 필요한 프로젝트 테스트와 번들 검사는 명시적으로 실행합니다. GitHub Actions 의존성은 확인한 커밋 SHA로 고정돼 있습니다. [npm ignore-scripts와 정확한 버전 저장](https://docs.npmjs.com/cli/v11/commands/npm-install/)

`validated-law-dependency` artifact에는 검증된 두 package 파일만 들어가며 보관기간은 1일입니다. 소스·토큰·상담 내용 전체를 artifact로 전달하지 않습니다.

## GitHub에서 처음 연결하기

먼저 본인 Cloudflare Worker와 Telegram 봇의 최초 설치를 [전달 및 설치 안내](DISTRIBUTION.md)에 따라 완료합니다. 자동업데이트는 계정 생성, Worker 런타임 Secret 등록, Telegram 웹훅 연결을 대신하지 않습니다.

1. workflow를 포함한 소스를 본인의 GitHub 저장소 기본 브랜치에 올립니다.
2. 공개 `cloudflare/wrangler.jsonc`의 `name`은 예시값 `my-lawyer-bot`으로 유지합니다. 실제 배포 대상 이름은 `CLOUDFLARE_WORKER_NAME` Actions Secret에 저장합니다. 계정과 Worker 이름을 잘못 지정하면 다른 운영 코드에 영향을 줄 수 있습니다.
3. GitHub 저장소 **Settings → Secrets and variables → Actions → New repository secret**에서 아래 세 값을 등록합니다.
4. GitHub Actions가 활성화돼 있고 workflow의 `contents: write` 권한 및 기본 브랜치 직접 push가 저장소 정책에서 허용되는지 확인합니다. 보호 규칙이 PR을 필수로 요구하면 이 자동 커밋 방식은 실패합니다. workflow가 보호 규칙을 우회하거나 강제 push하지 않습니다.
5. Actions에서 해당 workflow의 **Run workflow**를 선택하고 기본 브랜치와 **force_deploy=true**로 실행합니다.
6. 네 작업의 완료, Cloudflare 배포 버전, `/health`, Telegram 실제 법령 질문·후속 응답을 확인합니다.

| GitHub Actions Secret | 내용 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 대상 계정의 Worker·Durable Object 배포에 필요한 권한을 가진 API 토큰 |
| `CLOUDFLARE_ACCOUNT_ID` | 배포할 Cloudflare 계정 ID |
| `CLOUDFLARE_WORKER_NAME` | 실제 배포 대상 Worker 이름; 공개 wrangler 설정에 기록하지 않음 |

workflow는 배포 시 Secret의 Worker 이름을 명시적으로 전달합니다. 이 Secret은 공개 소스의 예시 이름과 별도로 유지하며 누락하면 배포가 실패합니다. 실제 운영 주소·배포 ID·실행 로그는 공개 문서나 artifact에 복사하지 마세요.

Cloudflare API 토큰은 대상 계정과 필요한 권한으로 범위를 제한합니다. 토큰을 저장소 파일이나 명령줄에 붙여넣지 않습니다. 로컬 `wrangler login` 인증은 GitHub runner로 자동 이전되지 않으므로 Actions Secrets가 별도로 필요합니다. [Cloudflare GitHub Actions 인증 설정](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)

`OPENAI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `LAW_OC`, `TELEGRAM_WEBHOOK_SECRET`, 선택적인 `ADMIN_API_SECRET`은 기존처럼 **Worker의 런타임 Secrets**입니다. 위 세 GitHub 배포용 Secret과 역할이 다르며, 현재 workflow에는 봇 런타임 키를 등록할 필요가 없습니다.

### 다른 사람이 설치할 때

clone·fork·전달 ZIP에 성공 버전 기록 파일이 있더라도 본인 계정의 배포 완료 증거로 사용하지 마세요. 신규 설치자는 최초 Worker 설정을 끝낸 뒤 **force_deploy=true로 자동화 전체를 검증**하세요.

최신 버전이 같아 조회만 하고 끝난 초록색 실행 결과는 배포 자격증명 검증이 아닙니다. 실제로 `deploy`와 `record-success` 작업까지 실행됐는지 확인해야 합니다.

## 성공 기록과 실패 처리

성공 기록은 `.github/law-mcp-deployed-version.txt`입니다. 이것은 `wrangler deploy`가 성공하고 기록 커밋도 저장됐다는 표시이며, Telegram 실제 응답과 모든 법률 도구를 자동 시험했다는 뜻은 아닙니다. 배포 후 실제 연결·사용 검증은 별도로 확인합니다.

| 상황 | 동작과 다음 조치 |
| --- | --- |
| 새 버전 없음, 성공 기록 일치 | 조회만 하고 종료합니다. |
| 레지스트리 오류·잘못된 버전 | 실패로 종료합니다. 설치와 배포를 하지 않습니다. |
| 설치·테스트·번들 검사 실패 | 검증 단계에서 중단합니다. 커밋·운영 배포하지 않으며 다음 일정에 다시 시도합니다. |
| 검증 중 기본 브랜치 변경 또는 push 거절 | 검증한 결과를 다른 코드에 덮어씌우지 않고 중단합니다. 최신 기본 브랜치에서 재실행합니다. |
| 배포 자격증명 누락·권한 오류 | 실패로 표시합니다. package 변경 커밋이 이미 저장됐을 수 있으나 성공 버전 기록은 갱신하지 않습니다. 설정을 바로잡은 뒤 재실행합니다. |
| Cloudflare 배포 실패 | 성공 기록을 남기지 않습니다. 실제 배포 상태는 Cloudflare에서 확인합니다. 자동 rollback은 하지 않으며, 다음 일정에는 현재 커밋을 다시 검증하고 배포합니다. |
| 배포 후 브랜치 변경 또는 성공 기록 push 실패 | 배포됐더라도 전체 실행은 실패로 표시합니다. 기록은 이전 상태이므로 재실행해 맞춥니다. |

workflow는 중복 실행을 순서대로 처리하며 실행 중인 배포를 새 실행 때문에 취소하지 않습니다. GitHub 브랜치에 강제 push하거나 자동 rebase하지 않습니다. 저장소 쓰기 권한은 커밋과 성공 기록 작업에만 부여합니다. [GitHub 권한과 동시 실행 설정](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)

의존성 버전만 기록하므로 같은 버전의 일반 코드 수정까지 매일 다시 배포하지 않습니다. 코드 수정만 운영에 반영하려면 별도 배포하거나 이 workflow를 `force_deploy=true`로 실행합니다.

문제 버전으로 되돌아가야 하면 먼저 workflow를 비활성화해 자동 재업데이트를 멈추고, 검증했던 버전과 lockfile로 복원·검증·배포한 뒤 성공 기록도 실제 버전에 맞춥니다. 이 스크립트는 자동 downgrade를 제공하지 않습니다.

## 로컬에서 조회·업데이트하기

프로젝트 루트에서 실행합니다.

~~~powershell
# 최신 버전 비교만: package 파일 수정·테스트·배포 없음
npm run mcp:check

# 새 안정판이 있으면 설치하고 두 테스트·번들 검사
npm run mcp:update

# 동일 버전이어도 설치·검증을 다시 수행
npm run mcp:update -- --verify-current
~~~

로컬 스크립트는 Git 커밋·push·Cloudflare 배포를 직접 수행하지 않습니다. 변경을 검토해 커밋하고, 운영 반영은 별도 배포 절차를 따릅니다. Actions에서는 이 스크립트 검증 이후의 커밋·배포 단계를 workflow가 수행합니다.

검증 실패 시 원래의 package.json과 package-lock.json은 복원합니다. 이미 설치된 node_modules는 변경됐을 수 있으므로 원래 의존성을 다시 맞추려면 루트에서 `npm ci --ignore-scripts`를 실행합니다.

## 자동 검증의 범위와 고지

메이저 버전도 자동으로 반영하지만, 테스트가 upstream의 모든 기능·법률 정확성·외부 API 장애를 검증하지는 않습니다. 호환되지 않는 업데이트가 테스트나 빌드에서 실패하면 운영 반영이 멈추므로 원인에 맞춰 코드를 수정해야 합니다. 실패를 건너뛰거나 설치 스크립트를 강제로 허용하는 처리는 넣지 않았습니다.

[제3자 고지](THIRD_PARTY_NOTICES.md)와 `third_party/korean-law-mcp-LICENSE.txt`, `third_party/korean-law-mcp-NOTICE.txt`는 **4.13.1 설치본의 스냅샷**입니다. 자동업데이트는 이 고지를 새 버전의 내용으로 자동 교체하거나 라이선스를 심사하지 않습니다. 버전을 갱신해 외부에 다시 배포할 때는 설치된 `node_modules/korean-law-mcp/LICENSE`, `NOTICE` 및 upstream 변경사항을 확인하고 해당 버전의 고지를 보존하세요.

자동화 실패는 GitHub Actions 실행 결과에서 확인합니다. 이 workflow가 Telegram이나 이메일로 별도 알림을 보내지는 않습니다. GitHub 알림 설정과 최근 실행 기록을 운영자가 관리합니다.

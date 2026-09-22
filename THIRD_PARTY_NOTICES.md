# 제3자 구성요소와 배포 고지

확인일: 2026-09-22. 이 문서는 설치된 의존성 파일의 고지를 정리한 것으로, 상업 이용이나 재배포 권리가 모두 해결됐다는 판단이 아닙니다.

## 프로젝트 자체 표시

루트 package.json에는 `license: ISC`가 표시돼 있지만 현재 별도 루트 LICENSE 저작권 고지 파일은 없습니다. 이 작업에서 새로운 권리 허락이나 저작권자를 임의로 정하지 않았습니다. 외부 배포·상업 이용 범위를 정할 때 원저작자와 기여 코드의 출처·허락을 확인하세요.

## korean-law-mcp 4.13.1

- 출처: https://github.com/chrisryugj/korean-law-mcp
- 설치본 package.json의 라이선스 표기: MIT
- 설치본의 원문 [LICENSE](third_party/korean-law-mcp-LICENSE.txt)와 [NOTICE](third_party/korean-law-mcp-NOTICE.txt)를 함께 보존합니다.
- NOTICE에는 법제처 데이터 출처, OC 인증값 사용, 참조 구현의 출처·라이선스 확인 필요 사항이 있습니다.
- 특히 참조한 `LexLink-ko-mcp`의 라이선스 미표시 및 복제 표현이 있는 경우의 허락·독자 구현 검토에 관한 미해결 고지가 있습니다. 정확한 문구는 동봉 NOTICE를 읽으세요.
- 의존성을 npm에서 다시 설치하거나 node_modules·빌드 결과를 전달 ZIP에서 제외하는 것만으로 이 고지의 쟁점이 해소되지는 않습니다.

동봉한 third_party의 LICENSE·NOTICE는 **4.13.1 설치본의 스냅샷**입니다. MCP 자동업데이트는 이 파일을 새 버전으로 교체하거나 라이선스를 심사하지 않습니다. 업데이트 후 외부 재배포 시 설치본과 upstream의 해당 버전 원문을 확인하고 고지를 갱신하세요. [자동 업데이트 안내](AUTO_UPDATE.md)

Google GenAI, MCP SDK, Telegraf, Axios, Cheerio, dotenv, Wrangler, esbuild 및 전이 의존성은 각 패키지에 포함된 라이선스를 따릅니다. 정확한 버전은 루트와 cloudflare의 package-lock.json으로 확인합니다. 배포 형태가 소스에서 번들·실행파일로 바뀌면 포함되는 코드와 고지를 다시 점검하세요.

## 데이터·서비스·브랜드

법령·판례·해석례 등의 데이터 출처와 API 이용 조건은 각 제공처 및 upstream NOTICE를 확인합니다. 소스코드의 라이선스가 Telegram·Cloudflare·OpenAI·법제처 계정 사용권이나 브랜드 사용권을 대신하지 않습니다.

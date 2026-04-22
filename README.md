# Telegram Lawyer Bot (텔레그램 법률 봇)

이 프로젝트는 텔레그램을 통해 사용자와 소통하며, 한국 법제처 API와 연동하여 실시간으로 법률 정보를 찾아주는 AI 챗봇입니다. 구글 Gemini AI 모델을 활용하여 단순한 텍스트 질문을 넘어 **사진, PDF 문서, 외부 웹사이트 링크**를 텔레그램으로 전송하면 AI가 해당 내용을 읽고 분석하여 관련된 법령과 판례를 친절하게 설명해 줍니다.

## ✨ 주요 기능 (Features)
- **다양한 포맷 분석 (멀티모달)**: 텔레그램 대화창에 바로 사진, PDF 파일, 외부 웹사이트 링크를 전송하면 AI가 맥락을 파악하고 답변합니다.
- **실시간 법률 조회**: 국가법령정보센터(법제처) 오픈 API와 직접 연동하여 최신 법령 및 판례 정보를 정확하게 가져옵니다.
- **자연스러운 대화**: 어려운 법률 용어를 일반인의 눈높이에 맞게 풀어서 설명하며, 맥락을 유지한 채 이어지는 대화가 가능합니다.

## 💡 사용 예시 (Examples)

1. **문서(PDF) 분석**: 
   - 📄 (근로계약서 PDF 파일 전송)
   - *"이 계약서에서 나한테 불리한 독소조항이나 노동법에 위반되는 내용이 있는지 검토해 줘."*
2. **사진 이미지 분석**:
   - 📸 (주정차 위반 과태료 딱지 사진 전송)
   - *"이거 의견제출 기한이 언제까지고, 만약 이의제기 하려면 어떤 절차를 거쳐야 해?"*
3. **외부 링크 분석**:
   - 🔗 (특정 쇼핑몰의 환불 규정 링크 전송)
   - *"이 쇼핑몰에서 단순 변심은 환불 불가라고 적혀있는데, 이거 전자상거래법 위반 아니야?"*
4. **일반적인 법률 조언**:
   - 💬 *"전세금 반환을 못 받고 있는데, 내용증명은 어떻게 작성해야 하고 법적 효력이 어떻게 돼?"*

## 🚀 사용 방법 (How to Use)

### 1. 사전 준비 (Prerequisites)
- [Node.js](https://nodejs.org/) 환경 준비
- [텔레그램 BotFather](https://core.telegram.org/bots/features#botfather)를 통한 봇 토큰 발급
- [Google Gemini API Key](https://aistudio.google.com/app/apikey) 발급 (Gemini 2.5 Flash 권장)
- [법제처 오픈 API 인증키 (OC 키)](https://open.law.go.kr/) 발급

### 2. 설치 및 설정
```bash
# 프로젝트 클론 및 폴더 이동
git clone https://github.com/your-username/Telegram_Lawyer_Bot.git
cd Telegram_Lawyer_Bot

# 의존성 패키지 설치
npm install
```

루트 폴더에 `.env` 파일을 생성하고 발급받은 키를 입력합니다. (`.env.example` 파일 참고)
```env
TELEGRAM_BOT_TOKEN="나의_텔레그램_봇_토큰"
GEMINI_API_KEY="나의_제미나이_API_키"
LAW_OC="나의_법제처_인증키"
```

### 3. 봇 실행
```bash
# 실행
node bot.js 
# (또는 윈도우 환경에서는 제공된 start.bat 파일을 실행하셔도 됩니다.)
```
실행 후 텔레그램에서 본인의 봇을 검색하여 `/start`를 입력하면 봇과 바로 대화하실 수 있습니다.

## 🙏 감사의 글 및 추천 리소스

- **korean-law-mcp (한국 법제처 MCP)**: [https://github.com/chrisryugj/korean-law-mcp](https://github.com/chrisryugj/korean-law-mcp)
  이 봇이 실시간으로 정확한 법령과 판례를 조회할 수 있도록 훌륭한 법제처 오픈 API 연동 MCP 서버를 개발해주신 **광진구청 류주임님**께 깊은 감사를 전합니다.

- **빠른 봇 개발을 위한 코드 스니펫 (AiCrafter Code Snippets)**: [https://github.com/AiCrafter-pro/aicrafter-code-snippets](https://github.com/AiCrafter-pro/aicrafter-code-snippets)
  이 텔레그램 봇의 초기 세팅과 기본 뼈대는 제가 구축한 **AiCrafter 코드 스니펫**을 기반으로 작성되었습니다. 직접 나만의 AI 텔레그램 봇을 개발해 보고 싶으신 분들은 이 스니펫을 활용해 보세요. 복잡한 초기 설정 없이 훨씬 빠르고 안정적으로 프로젝트를 시작하실 수 있습니다!

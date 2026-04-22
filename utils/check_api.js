// 법제처 API 연결 상태 빠른 체크 스크립트
// 사용법: node check_api.js

import 'dotenv/config';

const OC = process.env.LAW_OC;
const url = `https://www.law.go.kr/DRF/lawSearch.do?OC=${OC}&target=law&type=XML&query=%EB%AF%BC%EB%B2%95`;

console.log(`\n🔍 법제처 API 헬스 체크`);
console.log(`   OC키: ${OC}`);
console.log(`   시각: ${new Date().toLocaleString('ko-KR')}\n`);

try {
    // 1) 내 IP 확인
    const ipRes = await fetch('https://api.ipify.org');
    const myIP = await ipRes.text();
    console.log(`   내 IP: ${myIP}`);

    // 2) 법제처 API 찔러보기
    const res = await fetch(url);
    const text = await res.text();

    if (text.includes('사용자 정보 검증에 실패')) {
        console.log(`\n   ❌ 실패 - IP(${myIP})가 아직 법제처에 승인되지 않았습니다.`);
        console.log(`   ⏳ 법제처 마이페이지에서 IP 등록 후 최대 1시간 대기 필요\n`);
    } else if (text.includes('<resultCode>00</resultCode>') || text.includes('<법령명_한글>')) {
        // resultCode 00 = 정상 응답
        const cntMatch = text.match(/<totalCnt>(\d+)<\/totalCnt>/);
        const cnt = cntMatch ? cntMatch[1] : '?';
        const nameMatch = text.match(/<법령명_한글>([^<]+)/);
        console.log(`\n   ✅ 성공! 법제처 API 정상 연결됨!`);
        console.log(`   📊 검색 결과: ${cnt}건`);
        if (nameMatch) console.log(`   📜 첫 번째 결과: ${nameMatch[1]}`);
        console.log(`\n   👉 이제 봇을 실행하세요: node bot.js\n`);
    } else if (res.status !== 200) {
        console.log(`\n   ❌ HTTP 에러: ${res.status} ${res.statusText}\n`);
    } else {
        console.log(`\n   ⚠️ 알 수 없는 응답:`);
        console.log(`   ${text.substring(0, 300)}\n`);
    }
} catch (e) {
    console.error(`\n   🚨 네트워크 오류: ${e.message}\n`);
}

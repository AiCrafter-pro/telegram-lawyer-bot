import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import util from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 최상위 폴더에 logs 디렉토리 생성
const logsDir = path.join(__dirname, '../logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

function getLogDate() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// 기존 콘솔 저장
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

// 로그 파일에 쓰기
function appendToLogFile(args) {
    try {
        const logFilePath = path.join(logsDir, `bot_log_${getLogDate()}.txt`);
        // util.format으로 객체 직렬화 및 ANSI 색상 코드 제거
        const message = util.format(...args).replace(/\x1b\[[0-9;]*m/g, '') + '\n';
        fs.appendFileSync(logFilePath, message, 'utf8');
    } catch (e) {
        originalError("로그 파일 쓰기 실패:", e);
    }
}

// 콘솔 전역 오버라이딩
console.log = (...args) => {
    originalLog(...args);
    appendToLogFile(args);
};

console.warn = (...args) => {
    originalWarn(...args);
    appendToLogFile(args);
};

console.error = (...args) => {
    originalError(...args);
    appendToLogFile(args);
};

/** Worker에서 사용할 수 없는 네이티브 별표 파서를 명시적인 원문 안내로 대체합니다. */
export async function parse() {
    return {
        success: false,
        fileType: 'unknown',
        error: '이 서버에서는 별표 HWP/HWPX/PDF 파일의 본문을 자동 추출할 수 없습니다. 함께 표시된 법제처 원문 파일 링크를 확인하세요. 표의 금액·기준을 추측하지 마세요.'
    };
}

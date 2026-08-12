/** 서버와 동일: Lv1-Lv2-Lv3-실적구분-그룹코드 (미리보기용, 최종 권한은 서버) */
export function composeIndicatorCode(lv1, lv2, lv3, perf, group) {
  const parts = [lv1, lv2, lv3, String(perf || '').toUpperCase(), String(group || '').toUpperCase()]
    .map(v => String(v || '').trim())
  if (parts.some(p => !p)) return ''
  return parts.join('-')
}

export const PERF_OPTIONS = ['NEW', 'OUT', 'NET', 'TOT', 'RAT', 'ETC']

export const PERF_DESC = {
  NEW: { kr: '연간신규', desc: '당해 연도 신규·유입·유치 실적' },
  OUT: { kr: '연간이탈', desc: '당해 연도 이탈·유출 실적' },
  NET: { kr: '연간순증', desc: '순증·순유입·순이동 실적' },
  TOT: { kr: '총량', desc: '현재 시점 총량·잔액·고객수' },
  RAT: { kr: '비율', desc: '비율·수익률·점수·지수' },
  ETC: { kr: '기타', desc: '평잔·평균·누적·손익 등' },
}

import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { CODEBOOK_META, NF_STRUCTURE } from '../src/data/kpiData.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const outFile = resolve(__dirname, '../src/data/kpiData.js')

const CATEGORIES = ['본원적 수익력', '건전성', '고객', '연결과 확장']
const CATEGORIES_2025 = ['재무', '고객', '전략']

const GROUPS = [
  '영업추진1그룹',
  '영업추진2그룹',
  '기관·제휴영업그룹',
  '고객솔루션그룹',
  '자산관리솔루션그룹',
  'CIB그룹',
  '자본시장그룹',
  '글로벌사업그룹',
]

const GROUPS_2025 = [
  '영업추진1그룹',
  '영업추진2그룹',
  '영업추진4그룹',
  '기관솔루션그룹',
  '고객솔루션그룹',
  '자산관리솔루션그룹',
  'CIB그룹',
  '자본시장그룹',
  '글로벌사업그룹',
]

const GROUP_MAPPING_2025 = {
  '기관·제휴영업그룹': ['영업추진4그룹', '기관솔루션그룹'],
}

const groupProfiles = [
  {
    group: '영업추진1그룹',
    legacyGroup: '영업추진1그룹',
    prefix: 'SL1',
    dept: '영업추진1부',
    scale: 1.0,
    scoreBase: 98,
    kpis: [
      p('리테일 이자이익', '이자이익', '리테일', '억원', '연간신규', 9, 1460),
      p('핵심예금 평잔 순증', '수신', '핵심예금', '억원', '총량', 8, 12800),
      p('가계대출 우량자산 순증', '대출', '우량가계', '억원', '총량', 8, 9300),
      p('WM 수수료이익', '비이자수익', 'WM', '억원', '연간신규', 7, 430),
      s('가계대출 30일 이상 연체율', '연체율', '가계', '%', '비율', 7, 0.42),
      s('고정이하여신비율', '자산건전성', 'NPL', '%', '비율', 7, 0.36),
      s('여신 사후관리 완료율', '사후관리', '점검완료', '%', '비율', 5, 96),
      s('대손비용률', '대손비용', 'CCR', '%', '비율', 5, 0.31),
      c('급여이체 신규 고객수', '결제성고객', '급여이체', '명', '연간신규', 7, 84000),
      c('주거래 고객 순증', '주거래', '활성고객', '명', '연간신규', 7, 62000),
      c('고객 이탈률', '이탈관리', '리테일', '%', '비율', 5, 1.9),
      c('고객만족도', '고객경험', 'NPS', '점', '비율', 5, 82),
      x('모바일뱅킹 활성고객 순증', '디지털채널', 'MAU', '명', '연간신규', 7, 116000),
      x('비대면 상품판매 비중', '디지털판매', '비대면', '%', '비율', 5, 58),
      x('AI 상담 추천 실행률', 'AI활용', '상담지원', '%', '비율', 4, 42),
      x('전자문서 전환율', '업무자동화', 'Paperless', '%', '비율', 4, 76),
    ],
  },
  {
    group: '영업추진2그룹',
    legacyGroup: '영업추진2그룹',
    prefix: 'SL2',
    dept: '영업추진2부',
    scale: 0.92,
    scoreBase: 96,
    kpis: [
      p('중소기업 이자이익', '이자이익', 'SME', '억원', '연간신규', 9, 1620),
      p('SOHO 우량대출 순증', '대출', 'SOHO', '억원', '총량', 8, 8100),
      p('기업 수수료이익', '비이자수익', '기업수수료', '억원', '연간신규', 7, 360),
      p('외환/무역금융 수익', '외환수익', '무역금융', '억원', '연간신규', 7, 280),
      s('기업대출 30일 이상 연체율', '연체율', '기업', '%', '비율', 8, 0.62),
      s('취약차주 조기경보 처리율', '조기경보', 'EWS', '%', '비율', 6, 94),
      s('담보 재평가 적시완료율', '담보관리', '재평가', '%', '비율', 5, 97),
      s('기업여신 대손비용률', '대손비용', 'CCR', '%', '비율', 5, 0.48),
      c('실거래 기업고객 순증', '실거래고객', '기업', '개', '연간신규', 7, 11800),
      c('급여/결제 법인 유치', '결제고객', '법인', '개', '연간신규', 6, 1850),
      c('기업고객 이탈률', '이탈관리', '기업', '%', '비율', 5, 1.3),
      c('기업고객 만족도', '고객경험', 'VOC', '점', '비율', 5, 80),
      x('기업 인터넷뱅킹 활성고객', '디지털채널', '기업IB', '개', '연간신규', 6, 15400),
      x('전자세금계산서 연계 실적', '플랫폼', 'B2B', '건', '연간신규', 4, 420000),
      x('비대면 기업여신 신청률', '디지털여신', '비대면', '%', '비율', 4, 36),
      x('기업 API 연계 거래건수', 'Open API', '기업연계', '천건', '연간신규', 3, 780),
    ],
  },
  {
    group: '기관·제휴영업그룹',
    legacyGroup: '영업추진4그룹',
    prefix: 'INS',
    dept: '기관제휴영업부',
    scale: 0.86,
    scoreBase: 97,
    kpis: [
      p('기관성 예금 평잔', '수신', '기관예금', '억원', '총량', 9, 18400),
      p('퇴직연금 적립금 순증', '퇴직연금', 'DB/DC', '억원', '총량', 8, 6700),
      p('공공금고 수수료수익', '수수료수익', '금고', '억원', '연간신규', 7, 210),
      p('제휴카드 이용액', '카드', '제휴카드', '억원', '연간신규', 7, 5200),
      s('기관여신 연체율', '연체율', '기관', '%', '비율', 7, 0.28),
      s('보증서 만기관리 완료율', '사후관리', '보증서', '%', '비율', 6, 98),
      s('제휴 정산 오류율', '운영리스크', '정산', '%', '비율', 5, 0.08),
      s('공공자금 운용한도 준수율', '한도관리', '공공자금', '%', '비율', 5, 100),
      c('급여이체 제휴기관 유치', '제휴고객', '급여기관', '개', '연간신규', 7, 420),
      c('공공기관 주거래 전환', '주거래', '공공기관', '개', '연간신규', 6, 95),
      c('제휴 회원 활성률', '활성고객', '제휴회원', '%', '비율', 5, 64),
      c('기관고객 만족도', '고객경험', '기관VOC', '점', '비율', 5, 84),
      x('제휴 플랫폼 송금건수', '플랫폼', '송금', '천건', '연간신규', 6, 940),
      x('공공기관 전자수납 전환율', '디지털수납', '전자수납', '%', '비율', 5, 72),
      x('제휴 API 장애 제로율', 'Open API', '안정성', '%', '비율', 4, 99.5),
      x('비대면 기관계좌 개설률', '디지털전환', '계좌개설', '%', '비율', 3, 44),
    ],
  },
  {
    group: '고객솔루션그룹',
    legacyGroup: '고객솔루션그룹',
    prefix: 'CUS',
    dept: '고객솔루션부',
    scale: 0.78,
    scoreBase: 95,
    kpis: [
      p('개인금융 패키지 수익', '패키지수익', '개인', '억원', '연간신규', 8, 720),
      p('카드 결제수수료 수익', '카드수익', '결제', '억원', '연간신규', 7, 510),
      p('마케팅 캠페인 순증 수익', '마케팅수익', '캠페인', '억원', '연간신규', 7, 260),
      p('고객생애가치 증대액', '고객가치', 'CLV', '억원', '연간신규', 6, 390),
      s('민원 재발률', '민원관리', '재발', '%', '비율', 7, 2.2),
      s('불완전판매 예방점검 완료율', '소비자보호', '점검', '%', '비율', 7, 98),
      s('고위험 민원 처리기한 준수율', '민원관리', '처리기한', '%', '비율', 6, 96),
      s('개인정보 오남용 점검 적합률', '정보보호', '개인정보', '%', '비율', 5, 99),
      c('MAU 활성 고객수', '활성고객', 'MAU', '명', '총량', 8, 2350000),
      c('마케팅 응답 고객수', '마케팅', '응답', '명', '연간신규', 6, 410000),
      c('고객 이탈 방어율', '이탈관리', '방어', '%', '비율', 6, 68),
      c('고객 추천지수', '고객경험', 'NPS', '점', '비율', 5, 43),
      x('앱 개인화 추천 클릭률', 'AI마케팅', '개인화', '%', '비율', 6, 18),
      x('상담 챗봇 자가해결률', 'AI상담', '챗봇', '%', '비율', 5, 61),
      x('디지털 온보딩 완료율', '온보딩', '디지털', '%', '비율', 4, 74),
      x('데이터 기반 캠페인 자동화율', '마케팅자동화', '캠페인', '%', '비율', 3, 52),
    ],
  },
  {
    group: '자산관리솔루션그룹',
    legacyGroup: '자산관리솔루션그룹',
    prefix: 'WM',
    dept: '자산관리솔루션부',
    scale: 0.82,
    scoreBase: 99,
    kpis: [
      p('WM 관리자산(AUM) 순증', '관리자산', 'AUM', '억원', '총량', 9, 15400),
      p('신탁/펀드 판매수수료', '수수료수익', '신탁펀드', '억원', '연간신규', 8, 520),
      p('퇴직연금 수익', '퇴직연금', '수익', '억원', '연간신규', 7, 310),
      p('외화자산 판매수익', '글로벌자산', '외화상품', '억원', '연간신규', 6, 180),
      s('고위험상품 사전점검 완료율', '소비자보호', '고위험상품', '%', '비율', 8, 99),
      s('투자성향 적합성 준수율', '적합성', '투자성향', '%', '비율', 7, 98),
      s('상품 리밸런싱 안내율', '사후관리', '리밸런싱', '%', '비율', 5, 92),
      s('펀드 손실구간 고객관리율', '사후관리', '손실관리', '%', '비율', 5, 95),
      c('PB 10억 이상 고객 순증', '고자산고객', 'PB', '명', '연간신규', 7, 3600),
      c('연금 신규 고객수', '연금고객', 'IRP', '명', '연간신규', 6, 42000),
      c('고자산고객 이탈률', '이탈관리', '고자산', '%', '비율', 5, 0.9),
      c('PB 상담 만족도', '고객경험', 'PB상담', '점', '비율', 5, 88),
      x('디지털 자산관리 가입자수', '디지털WM', '가입자', '명', '연간신규', 6, 98000),
      x('AI 포트폴리오 제안 활용률', 'AI활용', '포트폴리오', '%', '비율', 5, 47),
      x('비대면 연금 가입률', '디지털연금', '비대면', '%', '비율', 4, 54),
      x('세미나 후 상담전환율', '마케팅연계', '세미나', '%', '비율', 3, 22),
    ],
  },
  {
    group: 'CIB그룹',
    legacyGroup: 'CIB그룹',
    prefix: 'CIB',
    dept: 'CIB사업부',
    scale: 1.08,
    scoreBase: 97,
    kpis: [
      p('대기업 여신 이자이익', '이자이익', '대기업', '억원', '연간신규', 9, 1840),
      p('IB 주선 수수료', 'IB수수료', '주선', '억원', '연간신규', 8, 640),
      p('외환/파생 고객수익', '시장성수익', '외환파생', '억원', '연간신규', 7, 420),
      p('무역금융 취급액', '무역금융', '취급액', '억원', '연간신규', 6, 11200),
      s('CIB 여신 연체율', '연체율', 'CIB', '%', '비율', 8, 0.35),
      s('RAROC 기준 미달 익스포저 비중', '수익성위험', 'RAROC', '%', '비율', 7, 4.5),
      s('신용등급 하락 선제관리율', '조기경보', '등급하락', '%', '비율', 6, 93),
      s('약정조건 점검 완료율', '사후관리', 'Covenant', '%', '비율', 5, 97),
      c('우량 대기업 신규 거래처', '우량고객', '대기업', '개', '연간신규', 6, 180),
      c('복합거래 고객 비중', 'Cross-sell', '복합거래', '%', '비율', 6, 58),
      c('주관 딜 반복거래율', '관계관리', '반복거래', '%', '비율', 5, 42),
      c('CIB 고객 만족도', '고객경험', 'CIB VOC', '점', '비율', 5, 83),
      x('디지털 무역금융 신청률', '디지털무역', '신청', '%', '비율', 5, 49),
      x('심사자료 자동수집률', '업무자동화', '심사', '%', '비율', 4, 63),
      x('AI 기업분석 리포트 활용률', 'AI분석', '기업분석', '%', '비율', 4, 45),
      x('전자약정 체결률', '디지털계약', '전자약정', '%', '비율', 3, 71),
    ],
  },
  {
    group: '자본시장그룹',
    legacyGroup: '자본시장그룹',
    prefix: 'MKT',
    dept: '자본시장부',
    scale: 0.74,
    scoreBase: 94,
    kpis: [
      p('채권 운용손익', '운용손익', '채권', '억원', '연간신규', 9, 820),
      p('외환 트레이딩 손익', '트레이딩', '외환', '억원', '연간신규', 8, 360),
      p('파생상품 고객수익', '파생수익', '고객파생', '억원', '연간신규', 7, 290),
      p('유동성 운용수익', '유동성', '운용', '억원', '연간신규', 6, 240),
      s('시장 VaR 한도 준수율', '시장리스크', 'VaR', '%', '비율', 9, 100),
      s('손익 변동성 한도 초과일수', '시장리스크', '손익변동', '일', '낮을수록', 7, 3),
      s('운용자산 평가손실률', '평가손익', '손실률', '%', '비율', 6, 1.2),
      s('딜러 컴플라이언스 점검 적합률', '컴플라이언스', '딜러', '%', '비율', 5, 99),
      c('기관투자자 신규 거래처', '기관고객', '투자자', '개', '연간신규', 6, 85),
      c('고객 파생거래 활성계좌', '거래고객', '파생', '개', '연간신규', 5, 420),
      c('시장정보 리포트 구독고객', '고객서비스', '리포트', '개', '총량', 5, 1300),
      c('기관고객 만족도', '고객경험', '기관', '점', '비율', 5, 81),
      x('자동호가 처리율', '트레이딩자동화', '호가', '%', '비율', 5, 68),
      x('리스크 모니터링 자동탐지율', '리스크시스템', '탐지', '%', '비율', 4, 74),
      x('전자확인서 처리율', '업무자동화', '확인서', '%', '비율', 4, 83),
      x('시장데이터 품질 적합률', '데이터품질', '시장데이터', '%', '비율', 3, 98),
    ],
  },
  {
    group: '글로벌사업그룹',
    legacyGroup: '글로벌사업그룹',
    prefix: 'GLB',
    dept: '글로벌사업부',
    scale: 0.7,
    scoreBase: 96,
    kpis: [
      p('해외점포 세전이익', '해외손익', '점포', '억원', '연간신규', 9, 780),
      p('글로벌 외화대출 이자이익', '이자이익', '외화대출', '억원', '연간신규', 8, 620),
      p('무역금융 수수료수익', '무역금융', '수수료', '억원', '연간신규', 7, 260),
      p('외환송금 수수료', '외환수수료', '송금', '억원', '연간신규', 6, 190),
      s('해외여신 연체율', '연체율', '해외', '%', '비율', 8, 0.72),
      s('국가별 익스포저 한도 준수율', '국가리스크', '한도', '%', '비율', 7, 100),
      s('AML/KYC 점검 완료율', 'AML', 'KYC', '%', '비율', 6, 98),
      s('해외점포 운영리스크 조치율', '운영리스크', '조치', '%', '비율', 5, 95),
      c('글로벌 실거래 고객수', '실거래고객', '글로벌', '개', '총량', 6, 82000),
      c('외국인 고객 활성률', '외국인고객', '활성', '%', '비율', 5, 61),
      c('해외법인 신규 거래처', '기업고객', '해외법인', '개', '연간신규', 5, 520),
      c('글로벌 고객 만족도', '고객경험', '글로벌', '점', '비율', 5, 82),
      x('글로벌 모바일뱅킹 MAU', '디지털채널', '글로벌앱', '명', '총량', 5, 420000),
      x('해외송금 디지털 전환율', '디지털송금', '전환율', '%', '비율', 5, 69),
      x('글로벌 API 거래건수', 'Open API', '글로벌', '천건', '연간신규', 4, 360),
      x('AI 번역 상담 처리율', 'AI상담', '번역', '%', '비율', 3, 38),
    ],
  },
]

const bankKpis = [
  p('전행 이자이익', '이자이익', '전행', '억원', '연간신규', 10, 11800),
  p('전행 비이자이익', '비이자수익', '전행', '억원', '연간신규', 8, 3650),
  p('원화대출 평잔 순증', '대출', '원화대출', '억원', '총량', 7, 64500),
  p('핵심예금 평잔', '수신', '핵심예금', '억원', '총량', 7, 74200),
  p('ROA', '수익성', 'ROA', '%', '비율', 5, 0.62),
  s('전행 NPL비율', '자산건전성', 'NPL', '%', '비율', 9, 0.47),
  s('전행 연체율', '연체율', '총여신', '%', '비율', 8, 0.54),
  s('대손비용률', '대손비용', 'CCR', '%', '비율', 7, 0.38),
  s('고위험여신 선제관리율', '조기경보', 'EWS', '%', '비율', 6, 94),
  s('금융소비자보호 점검 완료율', '소비자보호', '점검', '%', '비율', 5, 98),
  c('활성 고객수', '활성고객', 'MAU', '만명', '총량', 7, 920),
  c('주거래 고객 순증', '주거래', '전행', '명', '연간신규', 6, 210000),
  c('고객 이탈률', '이탈관리', '전행', '%', '비율', 5, 1.6),
  c('고객 추천지수', '고객경험', 'NPS', '점', '비율', 5, 45),
  x('모바일뱅킹 MAU', '디지털채널', 'MAU', '만명', '총량', 6, 760),
  x('비대면 상품판매 비중', '디지털판매', '비대면', '%', '비율', 5, 61),
  x('AI 상담 자가해결률', 'AI상담', '자가해결', '%', '비율', 4, 58),
  x('오픈뱅킹/마이데이터 활성고객', '플랫폼', '마이데이터', '만명', '총량', 4, 240),
]

function p(name, categoryL2, categoryL3, unit, calcBasis, weight, annualTarget) {
  return { category: '본원적 수익력', categoryL2, categoryL3, name, unit, calcBasis, weight, annualTarget }
}
function s(name, categoryL2, categoryL3, unit, calcBasis, weight, annualTarget) {
  return { category: '건전성', categoryL2, categoryL3, name, unit, calcBasis, weight, annualTarget, lowerIsBetter: isLowerMetric(name, calcBasis) }
}
function c(name, categoryL2, categoryL3, unit, calcBasis, weight, annualTarget) {
  return { category: '고객', categoryL2, categoryL3, name, unit, calcBasis, weight, annualTarget, lowerIsBetter: isLowerMetric(name, calcBasis) }
}
function x(name, categoryL2, categoryL3, unit, calcBasis, weight, annualTarget) {
  return { category: '연결과 확장', categoryL2, categoryL3, name, unit, calcBasis, weight, annualTarget, lowerIsBetter: isLowerMetric(name, calcBasis) }
}
function isLowerMetric(name, calcBasis) {
  return calcBasis === '낮을수록' || /연체율|NPL|대손비용률|이탈률|오류율|손실률|초과일수|재발률|민원/.test(name)
}

const round = (value, digits = 1) => Number(Number(value).toFixed(digits))
const pad = (num, size = 3) => String(num).padStart(size, '0')
const sum = (arr) => arr.reduce((acc, value) => acc + value, 0)
const categoryCode = (category) => ({ '본원적 수익력': 'P', '건전성': 'S', '고객': 'C', '연결과 확장': 'X', 재무: 'F', 전략: 'T' })[category] ?? 'K'

function monthlyTargets(template, scale = 1) {
  const annual = template.annualTarget * scale
  const out = {}
  if (template.calcBasis === '연간신규') {
    const weights = [0.065, 0.072, 0.083, 0.079, 0.082, 0.086, 0.078, 0.081, 0.085, 0.088, 0.094, 0.107]
    weights.forEach((w, idx) => { out[idx + 1] = round(annual * w, annual >= 1000 ? 0 : 1) })
  } else if (template.calcBasis === '총량') {
    const steps = [0.94, 0.948, 0.956, 0.964, 0.972, 0.98, 0.985, 0.99, 0.994, 0.997, 0.999, 1]
    steps.forEach((r, idx) => { out[idx + 1] = round(annual * r, annual >= 1000 ? 0 : 1) })
  } else {
    Array.from({ length: 12 }, (_, idx) => { out[idx + 1] = round(annual, annual < 10 ? 2 : 1) })
  }
  return out
}

function scoreFor(seed, month, base, category, lowerIsBetter = false) {
  const wave = Math.sin((seed * 17 + month * 31) * 0.37) * 4.8
  const categoryBias = { '본원적 수익력': 1.2, 건전성: -0.6, 고객: 0.4, '연결과 확장': -1.0 }[category] ?? 0
  const monthLift = (month - 6) * 0.45
  const stress = seed % 11 === 0 && month >= 9 ? -10 : seed % 13 === 0 && month >= 7 ? -6 : 0
  const score = base + categoryBias + monthLift + wave + stress + (lowerIsBetter ? 1.5 : 0)
  return round(Math.max(62, Math.min(124, score)), 1)
}

function actualFor(target, achievement, template) {
  if (target == null) return null
  const lower = template.lowerIsBetter
  const raw = lower ? target * 100 / achievement : target * achievement / 100
  if (template.unit === '%' || template.unit === '%p') return round(raw, raw < 10 ? 2 : 1)
  if (template.unit === '점') return round(raw, 1)
  if (Math.abs(raw) >= 1000) return Math.round(raw)
  return round(raw, 1)
}

function makeDefinition(template, profile, idx, no, year = 2026) {
  const code = `${profile.prefix}-${categoryCode(template.category)}-${pad(idx + 1)}`
  const targets = monthlyTargets(template, profile.scale)
  return {
    no,
    group: profile.group,
    code,
    category: template.category,
    categoryL2: template.categoryL2,
    categoryL3: template.categoryL3,
    name: template.name,
    label26: template.name,
    unit: template.unit,
    calcBasis: template.calcBasis,
    lowerIsBetter: Boolean(template.lowerIsBetter),
    mgmtTool: 'KPI',
    weight: template.weight,
    dept: profile.dept,
    collectType: template.calcBasis === '연간신규' ? '수기' : 'AUTO',
    annualTarget: round(template.annualTarget * profile.scale, template.annualTarget < 10 ? 2 : 1),
    monthlyTargets: targets,
    ...(year === 2025 ? { year: 2025 } : {}),
  }
}

function makeResults(definitions, year, baseByGroup = new Map()) {
  let id = 1
  const rows = []
  definitions.forEach((def, defIdx) => {
    const base = baseByGroup.get(def.group) ?? 96
    for (let month = 1; month <= 12; month += 1) {
      const target = def.monthlyTargets?.[month] ?? null
      const achievement = target == null ? null : scoreFor(defIdx + id, month, base, def.category, def.lowerIsBetter)
      const actual = achievement == null ? null : actualFor(target, achievement, def)
      rows.push({
        id: id++,
        year,
        month,
        period: `${year}${String(month).padStart(2, '0')}`,
        group: def.group,
        code: def.code,
        category: def.category,
        categoryL2: def.categoryL2,
        categoryL3: def.categoryL3,
        name: def.name,
        label26: def.label26,
        unit: def.unit,
        mgmtTool: def.mgmtTool,
        weight: def.weight,
        target: null,
        actual,
        achievement: null,
        collectType: def.collectType,
        approvalStatus: month <= 6 ? '승인' : '미승인',
      })
    }
  })
  return rows
}

function makeReferenceDefinitions(profile, startNo) {
  const strategic = [
    ['AI 기반 영업기회 추천 고도화', '전략과제', 'AI Agent', '추진율'],
    ['내부통제/소비자보호 점검 자동화', '전략과제', '통제', '추진율'],
    ['월간 업무처리 SLA 준수율', '모니터링', '운영효율', 'SLA'],
    ['데이터 정합성 오류 건수', '모니터링', '데이터품질', '오류'],
  ]
  return strategic.map((item, idx) => ({
    no: startNo + idx,
    group: profile.group,
    code: `${profile.prefix}-R-${pad(idx + 1)}`,
    category: idx < 2 ? '연결과 확장' : '건전성',
    categoryL2: item[2],
    categoryL3: item[3],
    name: item[0],
    label26: item[0],
    unit: idx === 3 ? '건' : '%',
    calcBasis: idx === 3 ? '낮을수록' : '비율',
    mgmtTool: item[1],
    weight: 0,
    dept: profile.dept,
    collectType: idx === 3 ? 'AUTO' : '수기',
    annualTarget: null,
    monthlyTargets: null,
  }))
}

function makeReferenceResults(definitions, year) {
  let id = 100000
  const rows = []
  definitions.filter(def => def.mgmtTool !== 'KPI').forEach((def, idx) => {
    for (let month = 1; month <= 12; month += 1) {
      const isError = def.unit === '건'
      const actual = isError ? Math.max(0, Math.round(14 - month * 0.7 + (idx % 3))) : round(55 + month * 3.1 + (idx % 4) * 2, 1)
      rows.push({
        id: id++,
        year,
        month,
        period: `${year}${String(month).padStart(2, '0')}`,
        group: def.group,
        code: def.code,
        category: def.category,
        categoryL2: def.categoryL2,
        categoryL3: def.categoryL3,
        name: def.name,
        label26: def.label26,
        unit: def.unit,
        mgmtTool: def.mgmtTool,
        weight: 0,
        target: null,
        actual,
        achievement: null,
        collectType: def.collectType,
        approvalStatus: month <= 6 ? '승인' : '미승인',
      })
    }
  })
  return rows
}

function buildCurrentData() {
  const definitions = []
  const baseByGroup = new Map()
  let no = 1
  groupProfiles.forEach(profile => {
    baseByGroup.set(profile.group, profile.scoreBase)
    profile.kpis.forEach((template, idx) => {
      definitions.push(makeDefinition(template, profile, idx, no++))
    })
    makeReferenceDefinitions(profile, no).forEach(def => definitions.push(def))
    no += 4
  })
  const kpiResults = makeResults(definitions.filter(def => def.mgmtTool === 'KPI'), 2026, baseByGroup)
  const refResults = makeReferenceResults(definitions, 2026)
  return { definitions, results: [...kpiResults, ...refResults] }
}

function buildBankData() {
  const profile = { group: '은행KPI', prefix: 'BNK', dept: '은행KPI', scale: 1, scoreBase: 97 }
  const definitions = bankKpis.map((template, idx) => makeDefinition(template, profile, idx, idx + 1))
  const baseByGroup = new Map([['은행KPI', 97]])
  return { definitions, results: makeResults(definitions, 2026, baseByGroup) }
}

function buildPrevData() {
  const definitions = []
  const baseByGroup = new Map()
  let no = 1
  groupProfiles.forEach(profile => {
    const legacyProfile = { ...profile, group: profile.legacyGroup, prefix: profile.prefix.replace('INS', 'SL4'), scale: profile.scale * 0.92, scoreBase: profile.scoreBase - 1 }
    baseByGroup.set(legacyProfile.group, legacyProfile.scoreBase)
    profile.kpis.slice(0, 12).forEach((template, idx) => {
      const prevCategory = template.category === '고객' ? '고객' : template.category === '연결과 확장' ? '전략' : '재무'
      const prevTemplate = {
        ...template,
        category: prevCategory,
        name: `${template.name}(25)`,
      }
      const def = makeDefinition(prevTemplate, legacyProfile, idx, no++, 2025)
      def.label25 = template.name
      delete def.label26
      definitions.push(def)
    })
  })
  const results = makeResults(definitions, 2025, baseByGroup).map(row => ({
    ...row,
    label25: row.name.replace(/\(25\)$/, ''),
  }))
  return { definitions, results }
}

function buildCodebook(definitions) {
  return definitions
    .filter(def => def.mgmtTool === 'KPI')
    .map((def, idx) => ({
      id: idx + 1,
      no: idx + 1,
      kind: 'KPI',
      code21: def.code,
      financial21: def.category === '본원적 수익력' || def.category === '건전성' ? 'Y' : 'N',
      nonFinancial21: def.category === '고객' || def.category === '연결과 확장' ? 'Y' : 'N',
      financial13: def.category === '본원적 수익력' ? 'Y' : 'N',
      lv1: categoryCode(def.category),
      lv1Name: def.category,
      lv2: def.categoryL2,
      lv2Name: def.categoryL2,
      lv3: def.categoryL3,
      lv3Name: def.categoryL3,
      calcBasis: def.calcBasis,
      scopeCode: def.group,
      name: def.name,
      unit: def.unit,
    }))
}

function serialize(name, value) {
  return `export const ${name} = ${JSON.stringify(value, null, 2)};\n`
}

const current = buildCurrentData()
const bank = buildBankData()
const prev = buildPrevData()
const codebook = buildCodebook(current.definitions)

const output = [
  '// ── 2026년 현실화 KPI 데이터 ─────────────────────────────────',
  serialize('CATEGORIES', CATEGORIES),
  serialize('KPI_DEFINITIONS', current.definitions),
  serialize('KPI_RESULTS', current.results),
  serialize('GROUPS', GROUPS),
  '// ── 은행KPI (전행) ─────────────────────────────────────────',
  serialize('BANK_DEFINITIONS', bank.definitions),
  serialize('BANK_RESULTS', bank.results),
  '// ── 2025년 비교 데이터 ─────────────────────────────────────',
  serialize('CATEGORIES_2025', CATEGORIES_2025),
  serialize('GROUPS_2025', GROUPS_2025),
  serialize('GROUP_MAPPING_2025', GROUP_MAPPING_2025),
  serialize('PREV_KPI_DEFINITIONS', prev.definitions),
  serialize('PREV_KPI_RESULTS', prev.results),
  '// ── 지표 마스터/코드북 ─────────────────────────────────────',
  serialize('CODEBOOK_META', CODEBOOK_META),
  serialize('CODEBOOK', codebook),
  serialize('NF_STRUCTURE', NF_STRUCTURE),
].join('\n')

await writeFile(outFile, output, 'utf8')
console.log(`regenerated ${outFile}`)

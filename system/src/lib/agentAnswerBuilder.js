import { detectAnomalies, summarizeAnomalies } from './anomalyRules'
import { enrichKpiRows, formatPercent, summarizeKpiRows } from './kpiCalcEngine'
import { explainWeakDrivers, relationNarrative } from './kpiRelationEngine'
import { evalLabel } from './kpiDisplay'

const INTENT_LABELS = {
  llm: 'LLM 판단',
}

function formatMomDiff(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0.00%p'
  return `${n > 0 ? '+' : '△'}${Math.abs(n).toFixed(2)}%p`
}

export function classifyAgentIntent(question) {
  return 'llm'
}

export function buildAgentAnswer({ question, definitions, results, groups, categories, selectedMonth, selectedYear, currentUser }) {
  const intent = classifyAgentIntent(question)
  const filters = inferFilters(question, groups, categories, definitions)
  let scopedDefs = (definitions || []).filter(def => def.mgmtTool === 'KPI')
  if (filters.group) scopedDefs = scopedDefs.filter(def => def.group === filters.group)
  if (filters.category) scopedDefs = scopedDefs.filter(def => def.category === filters.category)
  if (filters.metricTerms.length > 0) {
    const metricScoped = scopedDefs.filter(def => matchesMetricTerms(def, filters.metricTerms))
    if (metricScoped.length > 0) scopedDefs = metricScoped
  }

  const rows = enrichKpiRows(scopedDefs, results, selectedMonth)
  const summary = summarizeKpiRows(rows)
  const anomalies = detectAnomalies({ definitions: scopedDefs, results, selectedMonth })
  const anomalySummary = summarizeAnomalies(anomalies)
  const weakRows = [...rows]
    .filter(row => (row.achievement ?? 100) < 100)
    .sort((a, b) => (a.achievement ?? 999) - (b.achievement ?? 999))
    .slice(0, 8)
  const evidenceSourceRows = rankEvidenceRows(rows, question).slice(0, 12)
  const relation = explainWeakDrivers({
    definitions: scopedDefs,
    results,
    selectedMonth,
    groupName: filters.group,
    category: filters.category,
  })

  const answer = renderAnswer({
    intent,
    question,
    filters,
    rows,
    summary,
    anomalies,
    anomalySummary,
    weakRows,
    evidenceSourceRows,
    relation,
    selectedMonth,
    selectedYear,
    currentUser,
  })

  return {
    intent,
    intentLabel: INTENT_LABELS[intent],
    filters,
    answer,
    evidenceRows: buildEvidenceRows(evidenceSourceRows, anomalies),
    anomalies,
    relation,
    summary,
  }
}

export function buildAgentLLMPrompt({ question, agentResult, selectedMonth, selectedYear, currentUser }) {
  const evidence = (agentResult.evidenceRows || [])
    .slice(0, 12)
    .map((row, idx) => `${idx + 1}. ${Object.entries(row).map(([k, v]) => `${k}: ${v}`).join(' / ')}`)
    .join('\n')
  const anomalies = (agentResult.anomalies || [])
    .slice(0, 8)
    .map((event, idx) => `${idx + 1}. [${event.title}] ${event.label}: ${event.message} (${event.evidence})`)
    .join('\n')
  const drivers = (agentResult.relation?.drivers || [])
    .slice(0, 5)
    .map((driver, idx) => `${idx + 1}. ${driver.label}: 달성률 ${formatPercent(driver.achievement)}, 비중 ${driver.weight}%`)
    .join('\n')

  return {
    systemPrompt: `당신은 은행 종합기획부의 성과평가 AI Agent입니다.
반드시 제공된 KPI 데이터와 근거만 사용해 답변하세요.
AI 답변은 보조수단이며 최종 판단은 임직원이 수행한다는 점을 명시하세요.
근거 없는 단정, 개인정보 추정, 권한 밖 데이터 요청 응답, SQL 생성은 금지됩니다.
답변은 한국어로 작성하고, 아래 구조를 지키세요:
1. 핵심 결론
2. 근거 데이터
3. 해석
4. 원인 후보
5. 추가 확인 필요 데이터
6. 제안 액션
7. 한계 및 유의사항`,
    userPrompt: `# 사용자 질문
${question}

# 기준
- 연도: ${selectedYear}
- 월: ${selectedMonth}
- 사용자: ${currentUser?.name || '-'} (${currentUser?.employeeNo || '-'})
- 의도: LLM이 사용자 질문을 직접 판단
- 검색된 그룹 필터: ${agentResult.filters?.group || '없음'}
- 검색된 카테고리 필터: ${agentResult.filters?.category || '없음'}
- 검색된 지표 키워드: ${agentResult.filters?.metricTerms?.join(', ') || '없음'}
- 근거 지표 수: ${agentResult.evidenceRows?.length ?? 0}

# 1차 데이터 요약
${agentResult.answer}

# 근거 데이터
${evidence || '근거 데이터 없음'}

# 이상치 이벤트
${anomalies || '감지된 이상치 없음'}

# 관계 해석 후보
${agentResult.relation?.summary || '관계 해석 없음'}
${drivers}

중요 지시:
- 사용자 질문의 대상 지표와 무관한 근거 데이터는 사용하지 마세요.
- 질문 대상 지표가 근거 데이터에 없으면, 없다고 말하고 추가 데이터가 필요하다고 답하세요.
- \"급여실적\"처럼 붙어 있는 표현은 \"급여\" 관련 KPI로 해석하세요.
- 위 자료만 근거로 임원/실무자가 바로 검토할 수 있는 형태로 답변하세요.`,
  }
}

function inferFilters(question, groups = [], categories = [], definitions = []) {
  const text = String(question || '')
  const group = groups.find(g => text.includes(g))
  const category = categories.find(c => text.includes(c))
  return {
    group: group || '',
    category: category || '',
    metricTerms: extractMetricTerms(text, definitions),
  }
}

function renderAnswer({ filters, summary, anomalies, anomalySummary, weakRows, evidenceSourceRows, relation, selectedMonth, selectedYear, currentUser }) {
  const scope = [filters.group || '권한 범위 전체', filters.category, filters.metricTerms?.length ? `지표키워드: ${filters.metricTerms.join(', ')}` : ''].filter(Boolean).join(' · ')
  const header = [
    `## 1. 핵심 결론`,
    `- 기준: ${selectedYear}년 ${selectedMonth}월, 조회범위: ${scope}`,
    `- 종합 가중 달성률은 ${formatPercent(summary.weightedAchievement)}이며, 100% 이상 ${summary.over100}개 / 80~99% ${summary.normal}개 / 80% 미만 ${summary.under80}개입니다.`,
  ]

  return [
    ...header,
    '',
    `## 2. 질문 관련 근거 지표`,
    ...(evidenceSourceRows.length
      ? evidenceSourceRows.slice(0, 8).map((row, idx) => `${idx + 1}. ${evalLabel(row.def)}: 달성률 ${formatPercent(row.achievement)}, 목표 ${row.target.toLocaleString()} / 실적 ${row.actual.toLocaleString()}${row.momDiff != null ? ` / 전월비 ${formatMomDiff(row.momDiff)}` : ''}`)
      : ['- 질문과 직접 매칭되는 KPI 근거를 찾지 못했습니다.']),
    '',
    `## 3. 부진 후보`,
    ...(weakRows.length
      ? weakRows.slice(0, 5).map((row, idx) => `${idx + 1}. ${evalLabel(row.def)}: ${formatPercent(row.achievement)}`)
      : ['- 현재 조건에서 100% 미만 관리 대상이 없습니다.']),
    '',
    `## 4. 이상치 요약`,
    `- 총 ${anomalySummary.total}건 감지: 위험 ${anomalySummary.high}건, 주의 ${anomalySummary.medium}건, 확인 ${anomalySummary.low}건`,
    ...(anomalies.length ? anomalies.slice(0, 4).map((event, idx) => `  - ${idx + 1}. ${event.title}: ${event.label} (${event.evidence})`) : []),
    '',
    `## 5. 관계 해석 후보`,
    `- ${relationNarrative(relation)}`,
    '',
    limitation(currentUser),
  ].join('\n')
}

function buildEvidenceRows(rows, anomalies) {
  const source = rows.length ? rows : []
  const rowEvidence = source.slice(0, 12).map(row => ({
    그룹: row.def.group,
    지표: evalLabel(row.def),
    카테고리: row.def.category,
    목표: row.target,
    실적: row.actual,
    달성률: formatPercent(row.achievement),
    전월비: row.momDiff == null ? '—' : formatMomDiff(row.momDiff),
  }))
  if (rowEvidence.length > 0) return rowEvidence
  return anomalies.slice(0, 10).map(event => ({
    구분: event.title,
    그룹: event.group,
    지표: event.label,
    근거: event.evidence,
    메시지: event.message,
  }))
}

function limitation(currentUser) {
  return [
    `## 4. 한계 및 유의사항`,
    `- 본 답변은 ${currentUser?.name ? `${currentUser.name} 사용자` : '현재 사용자'}의 권한 범위 내 데이터만 사용했습니다.`,
    `- 원인 해석은 현재 KPI 구조와 월별 실적에 기반한 후보이며, 최종 판단은 담당자가 확인해야 합니다.`,
    `- 운영 전환 시 DW View, SWING 권한, 행내 LLM, 서버 감사로그로 대체해야 합니다.`,
  ].join('\n')
}

const STOPWORDS = new Set([
  '이번', '이번달', '당월', '해당월', '실적', '부진', '이유', '사유', '원인', '분석', '알려줘',
  '알려', '설명', '해줘', '말해줘', '보고', '보고서', '작성', '초안', '현황', '왜', '뭐야',
  '무엇', '어떻게', '관련', '대해서', '좀', '제발',
])

const SUFFIXES = ['실적', '부진', '이유', '사유', '원인', '현황', '분석', '관련', '대상', '지표']

function extractMetricTerms(question, definitions = []) {
  const normalized = normalizeText(question)
  const tokens = normalized.split(/[^0-9a-zA-Z가-힣]+/).filter(Boolean)
  const terms = new Set()

  tokens.forEach(token => {
    addTerm(terms, token)
    let stripped = token
    SUFFIXES.forEach(suffix => {
      if (stripped.endsWith(suffix) && stripped.length > suffix.length + 1) {
        stripped = stripped.slice(0, -suffix.length)
        addTerm(terms, stripped)
      }
    })
  })

  ;(definitions || []).forEach(def => {
    const labels = [evalLabel(def), def.name, def.categoryL2, def.categoryL3].filter(Boolean)
    labels.forEach(label => {
      const compact = normalizeText(label).replace(/\s+/g, '')
      if (compact && normalized.replace(/\s+/g, '').includes(compact)) addTerm(terms, compact)
    })
  })

  return [...terms].filter(term => term.length >= 2 && !STOPWORDS.has(term))
}

function addTerm(terms, value) {
  const term = normalizeText(value).replace(/\s+/g, '')
  if (term.length >= 2 && !STOPWORDS.has(term)) terms.add(term)
}

function matchesMetricTerms(def, terms) {
  const haystack = [
    def.code,
    def.group,
    def.dept,
    def.category,
    def.categoryL2,
    def.categoryL3,
    def.name,
    def.label26,
    def.label25,
    evalLabel(def),
  ].filter(Boolean).map(v => normalizeText(v).replace(/\s+/g, '')).join(' ')
  return terms.some(term => haystack.includes(term))
}

function rankEvidenceRows(rows, question) {
  const terms = extractMetricTerms(question, rows.map(row => row.def))
  return [...rows].sort((a, b) => {
    const aMatch = matchesMetricTerms(a.def, terms) ? 0 : 1
    const bMatch = matchesMetricTerms(b.def, terms) ? 0 : 1
    if (aMatch !== bMatch) return aMatch - bMatch
    return (a.achievement ?? 999) - (b.achievement ?? 999)
  })
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

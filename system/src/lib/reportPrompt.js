/**
 * 그룹별 KPI → 현업형 실적 보고서 프롬프트.
 * 출력: 종합달성률 → Lv2 단위 실적/달성률 → Lv2당 분석 2줄(전월대비/부진원인)
 */
import { evalLabel } from './kpiDisplay'

const POOR_THRESHOLD = 70 // 부진 (대시보드 상태와 동일)
const NOTABLE_MOM_DROP = -10 // 전월비 급감 기준 (%p)
const NOTABLE_MOM_SPIKE = 15 // 전월비 급등 (특이 언급용)

function fmtNum(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('ko-KR')
}

function fmtAch(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(2)}%`
}

function fmtMom(diff) {
  const n = Number(diff)
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0.00%p'
  return `${n > 0 ? '+' : '△'}${Math.abs(n).toFixed(2)}%p`
}

function findResult(results, code, month) {
  return (results || []).find((r) => r.code === code && Number(r.month) === Number(month))
}

function isCoreDef(def) {
  return Boolean(def?.isCore || def?.is_core === 'Y' || def?.is_core === true)
}

function lv2Key(def) {
  const lv1 = def.category || '미분류'
  const lv2 = def.categoryL2 || '(미분류)'
  return `${lv1}||${lv2}`
}

function enrichDef(def, results, selectedMonth) {
  const curr = findResult(results, def.code, selectedMonth)
  const prev = selectedMonth > 1 ? findResult(results, def.code, selectedMonth - 1) : null
  const achievement = curr?.achievement != null ? Number(curr.achievement) : null
  const prevAch = prev?.achievement != null ? Number(prev.achievement) : null
  const momDiff = achievement != null && prevAch != null
    ? Math.round((achievement - prevAch) * 100) / 100
    : null
  return {
    def,
    label: evalLabel(def),
    unit: def.unit || '',
    weight: Number(def.weight) || 0,
    isCore: isCoreDef(def),
    actual: curr?.actual ?? null,
    target: curr?.target ?? null,
    achievement,
    prevAchievement: prevAch,
    momDiff,
    isPoor: achievement != null && achievement < POOR_THRESHOLD,
    isNotableDrop: momDiff != null && momDiff <= NOTABLE_MOM_DROP,
    isNotableSpike: momDiff != null && momDiff >= NOTABLE_MOM_SPIKE,
  }
}

/** 기본 서술 대상: Core ∪ 부진. 그 외는 급감/급등 특이만. */
function shouldIncludeRow(row) {
  if (row.isCore || row.isPoor) return true
  if (row.isNotableDrop || row.isNotableSpike) return true
  return false
}

function inclusionTag(row) {
  const tags = []
  if (row.isCore) tags.push('Core')
  if (row.isPoor) tags.push('부진')
  if (row.isNotableDrop) tags.push('전월급감')
  if (row.isNotableSpike) tags.push('전월급등')
  return tags.join(',')
}

export function buildReportPrompt({ group, categories, kpiDefs, refDefs, results, selectedMonth, selectedYear }) {
  const year = selectedYear || new Date().getFullYear()
  const monthLabel = `${selectedMonth}월`
  const defs = (kpiDefs || []).filter((d) => !d.mgmtTool || d.mgmtTool === 'KPI')

  const enrichedAll = defs.map((d) => enrichDef(d, results, selectedMonth))

  // 종합 달성률 (전체 KPI 가중 — Core만이 아님)
  let totalWs = 0
  let totalWt = 0
  let over100 = 0
  let mid = 0
  let underPoor = 0
  enrichedAll.forEach((row) => {
    if (row.achievement == null) return
    totalWs += row.achievement * row.weight
    totalWt += row.weight
    if (row.achievement >= 100) over100 += 1
    else if (row.achievement >= POOR_THRESHOLD) mid += 1
    else underPoor += 1
  })
  const overallAch = totalWt > 0 ? Math.round((totalWs / totalWt) * 10) / 10 : null

  // 전월 종합
  let prevWs = 0
  let prevWt = 0
  if (selectedMonth > 1) {
    defs.forEach((def) => {
      const r = findResult(results, def.code, selectedMonth - 1)
      if (r?.achievement == null) return
      const w = Number(def.weight) || 0
      prevWs += Number(r.achievement) * w
      prevWt += w
    })
  }
  const prevOverall = prevWt > 0 ? Math.round((prevWs / prevWt) * 10) / 10 : null
  const overallMom = overallAch != null && prevOverall != null
    ? Math.round((overallAch - prevOverall) * 100) / 100
    : null

  const included = enrichedAll.filter(shouldIncludeRow)
  const notableOnly = included.filter((r) => !r.isCore && !r.isPoor && (r.isNotableDrop || r.isNotableSpike))

  // Lv2 그룹핑 (평가 Lv1 → Lv2)
  const lv2Map = new Map()
  included.forEach((row) => {
    const key = lv2Key(row.def)
    if (!lv2Map.has(key)) {
      lv2Map.set(key, {
        lv1: row.def.category || '미분류',
        lv2: row.def.categoryL2 || '(미분류)',
        rows: [],
      })
    }
    lv2Map.get(key).rows.push(row)
  })

  // categories 순서로 Lv1 정렬, 그 안 Lv2는 첫 등장순
  const catOrder = (categories || []).length
    ? categories
    : [...new Set(defs.map((d) => d.category).filter(Boolean))]

  const lv2Blocks = []
  const seen = new Set()
  catOrder.forEach((lv1) => {
    ;[...lv2Map.values()]
      .filter((g) => g.lv1 === lv1)
      .forEach((g) => {
        const k = `${g.lv1}||${g.lv2}`
        if (seen.has(k)) return
        seen.add(k)
        lv2Blocks.push(g)
      })
  })
  ;[...lv2Map.values()].forEach((g) => {
    const k = `${g.lv1}||${g.lv2}`
    if (!seen.has(k)) {
      seen.add(k)
      lv2Blocks.push(g)
    }
  })

  const lv2DataText = lv2Blocks.map((g) => {
    let ws = 0
    let wt = 0
    g.rows.forEach((r) => {
      if (r.achievement == null) return
      ws += r.achievement * r.weight
      wt += r.weight
    })
    const lv2Ach = wt > 0 ? (Math.round((ws / wt) * 10) / 10).toFixed(1) : '—'
    const lines = g.rows
      .sort((a, b) => {
        if (a.isPoor !== b.isPoor) return a.isPoor ? -1 : 1
        if (a.isCore !== b.isCore) return a.isCore ? -1 : 1
        return (a.achievement ?? 999) - (b.achievement ?? 999)
      })
      .map((r) => {
        const mom = r.momDiff != null ? ` / 전월비 ${fmtMom(r.momDiff)}` : ''
        const tgt = r.target != null ? ` / 목표 ${fmtNum(r.target)}` : ''
        const dir = r.def.goalDirection || r.def.goal_direction || 'increase'
        return `  - [${inclusionTag(r)}] ${r.label} (${r.unit || '-'}, 방향:${dir === 'decrease' ? '하향' : '상향'}): 실적 ${fmtNum(r.actual)}${tgt} / 달성률 ${fmtAch(r.achievement)}${mom}`
      })
      .join('\n')

    // 같은 Lv2의 미포함 지표도 원인추론 참고로 제공
    const siblings = enrichedAll.filter((r) => (
      (r.def.category || '미분류') === g.lv1
      && (r.def.categoryL2 || '(미분류)') === g.lv2
      && !g.rows.some((x) => x.def.code === r.def.code)
    ))
    const siblingLines = siblings.slice(0, 8).map((r) => {
      const mom = r.momDiff != null ? `, 전월비 ${fmtMom(r.momDiff)}` : ''
      return `  · ${r.label}: 달성률 ${fmtAch(r.achievement)}${mom}`
    }).join('\n')

    return [
      `### ${g.lv1} > ${g.lv2} (Lv2 가중달성률 ${lv2Ach}%)`,
      `【본문 서술 지표】`,
      lines || '  - (해당 지표 없음)',
      siblings.length ? `【같은 Lv2 참고지표 — 원인추론용, 본문에 나열하지 말 것】\n${siblingLines}` : null,
    ].filter(Boolean).join('\n')
  }).join('\n\n')

  const notableBlock = notableOnly.length
    ? notableOnly.map((r) => (
      `  - ${r.def.category || ''} > ${r.def.categoryL2 || ''} · ${r.label}: 달성률 ${fmtAch(r.achievement)}, 전월비 ${fmtMom(r.momDiff)} (${inclusionTag(r)})`
    )).join('\n')
    : '  - 해당 없음'

  const systemPrompt = `당신은 은행 영업·기획 현장의 KPI 실적 코멘트 작성자입니다.
짧고 실무적인 실적 보고 문안만 씁니다. 장문 진단서·개선과제 나열·차월계획은 금지합니다.

【코멘트 문체】
- "전월대비:", "부진원인:", "(분석1)", "(분석2)" 같은 **표제/라벨을 붙이지 마세요.**
- Lv2마다 지표 나열 다음에 **자연스러운 문장 2줄**만 씁니다.
- 2줄의 내용은 전월 변화·부진/특이 원인이 있을 때 그걸 다루면 됩니다. 특이 없으면 핵심만 담담히.
- 금지(동어반복): "달성률이 낮아져서 부진", "전월비가 감소해서 부진"처럼 결과 수치를 원인처럼 말하는 문장.
- 허용: 신규취급·평잔·마진/가격·구성·이탈·캠페인·계절성·경쟁·상품믹스 등 현장 요인. 근거 약하면 "…로 추정".
- 없는 수치·사건·조직명은 만들지 말 것.`

  const userPrompt = `# ${group} ${year}년 ${monthLabel} KPI 실적 보고 작성

## 작성 규칙 (반드시 준수)
1. 맨 위 **종합 달성률** + 전월비.
2. 본문은 **평가 Lv2 단위**. Lv1 에세이·카테고리 총평 금지.
3. 각 Lv2:
   - 【본문 서술 지표】만 실적·달성률·전월비 나열 (참고지표는 본문에 나열 금지, 원인 추론에만 사용)
   - 이어서 **코멘트 2줄** (라벨 없이 문장만)
     · 전월 급변·부진·특이만 있을 때 그걸 중심으로
     · 특이 없으면 "양호 유지" 수준으로 짧게
4. 코멘트 불합격 예시:
   - ❌ "(분석1) 전월대비: … / (분석2) 부진원인: …" 라벨 붙이기
   - ❌ "전월비가 줄어 달성률이 낮아짐" (동어반복)
   - ✅ "신규여신 조정ROC는 금리경쟁·고수익 취급 비중 축소로 마진이 눌린 영향으로 보임."
5. 서술 대상: **Core + 부진(<${POOR_THRESHOLD}%)**. 그 외는 전월 급감(≤${NOTABLE_MOM_DROP}%p) 등 특이만.
6. 개선과제·차월계획·추진현황 섹션 금지.

## 종합 현황 (사실)
- 종합 가중 달성률: ${overallAch != null ? `${overallAch}%` : '—'}
- 전월 종합: ${prevOverall != null ? `${prevOverall}%` : '—'} / 전월비: ${fmtMom(overallMom)}
- 분포: 100%↑ ${over100}개 · ${POOR_THRESHOLD}~99% ${mid}개 · 부진(<${POOR_THRESHOLD}%) ${underPoor}개

## Lv2별 데이터
${lv2DataText || '(포함 지표 없음)'}

## Core·부진 외 특이 지표
${notableBlock}

---

출력 형식 예시 (라벨 금지):

# ${group} ${monthLabel} 실적

**종합 달성률: OO.O%** (전월비 +x.xx%p 또는 △x.xx%p)

## {Lv1} > {Lv2}
- 지표명: 실적 … / 달성률 …% / 전월비 …
- 지표명: …
우량여신 순증은 크게 회복됐으나, 조정ROC는 마진 압박으로 전월보다 둔화됨.
신규 유입 대비 초기 이탈이 커 유지율 지표가  lagged 훼손된 것으로 추정.`

  return { systemPrompt, userPrompt }
}

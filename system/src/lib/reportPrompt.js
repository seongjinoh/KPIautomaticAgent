/**
 * 그룹별 KPI 데이터를 기반으로 LLM 보고서 생성 프롬프트를 구성한다.
 * 평가 관점: L1~L3 카테고리 + 26년 레이블(관리용 지표명은 참고로 병기)
 */
import { evalLabel } from './kpiDisplay'

function catPath(def) {
  return [def.category, def.categoryL2, def.categoryL3].filter(Boolean).join(' > ')
}

export function buildReportPrompt({ group, categories, kpiDefs, refDefs, results, selectedMonth }) {
  const monthLabel = `${selectedMonth}월`

  // 카테고리별 KPI 실적 테이블
  const categoryBlocks = categories.map(cat => {
    const defs = kpiDefs.filter(d => d.category === cat)
    let ws = 0, wt = 0
    const rows = defs.map(def => {
      const r = results.find(r => r.code === def.code && r.month === selectedMonth && r.mgmtTool === 'KPI')
      const target = r?.target ?? 0
      const actual = r?.actual ?? 0
      const ach = r?.achievement ?? 0
      ws += ach * def.weight; wt += def.weight

      // 최근 3개월 추세
      const trend = [selectedMonth - 2, selectedMonth - 1, selectedMonth]
        .filter(m => m >= 1)
        .map(m => {
          const mr = results.find(r2 => r2.code === def.code && r2.month === m)
          return mr?.achievement != null ? `${m}월:${mr.achievement}%` : null
        }).filter(Boolean).join(' → ')

      const lab = evalLabel(def)
      const refName = lab !== def.name ? ` [관리용: ${def.name}]` : ''
      return `  - ${catPath(def)} · ${lab}${refName} (${def.unit}, 비중${def.weight}%): 목표 ${target.toLocaleString()} / 실적 ${actual.toLocaleString()} / 달성률 ${ach}% [추세: ${trend}]`
    }).join('\n')
    const catAch = wt > 0 ? Math.round(ws / wt * 10) / 10 : 0
    return `### ${cat} (카테고리 달성률: ${catAch}%)\n${rows}`
  }).join('\n\n')

  // 종합 달성률
  let totalWs = 0, totalWt = 0, over100 = 0, mid = 0, under80 = 0
  kpiDefs.forEach(def => {
    const r = results.find(r => r.code === def.code && r.month === selectedMonth)
    if (r?.achievement != null) {
      totalWs += r.achievement * def.weight; totalWt += def.weight
      if (r.achievement >= 100) over100++
      else if (r.achievement >= 80) mid++
      else under80++
    }
  })
  const overallAch = totalWt > 0 ? Math.round(totalWs / totalWt * 10) / 10 : 0

  // 월별 종합 추세
  const monthlyTrend = Array.from({ length: selectedMonth }, (_, i) => {
    const m = i + 1
    let ws2 = 0, wt2 = 0
    kpiDefs.forEach(def => {
      const r = results.find(r => r.code === def.code && r.month === m)
      if (r?.achievement != null) { ws2 += r.achievement * def.weight; wt2 += def.weight }
    })
    return `${m}월: ${wt2 > 0 ? Math.round(ws2 / wt2 * 10) / 10 : 0}%`
  }).join(', ')

  // 전략과제/모니터링 참고 데이터
  const refBlock = ['전략과제', '모니터링'].map(tool => {
    const items = refDefs.filter(d => d.mgmtTool === tool)
    if (items.length === 0) return ''
    const rows = items.map(def => {
      const latest = results.find(r => r.code === def.code && r.month === selectedMonth)
      const prev = results.find(r => r.code === def.code && r.month === Math.max(1, selectedMonth - 1))
      return `  - ${def.name} (${def.unit}): ${monthLabel} 실적 ${latest?.actual?.toLocaleString() ?? '-'} / 전월 ${prev?.actual?.toLocaleString() ?? '-'}`
    }).join('\n')
    return `[${tool}]\n${rows}`
  }).filter(Boolean).join('\n\n')

  // 부진 지표 (80% 미만) 상세
  const weakKpis = kpiDefs
    .map(def => {
      const r = results.find(r => r.code === def.code && r.month === selectedMonth)
      return { ...def, achievement: r?.achievement ?? 0, target: r?.target ?? 0, actual: r?.actual ?? 0 }
    })
    .filter(k => k.achievement < 80)
    .sort((a, b) => a.achievement - b.achievement)

  const weakBlock = weakKpis.length > 0
    ? weakKpis.map(k => `  - ${catPath(k)} · ${evalLabel(k)} (${k.name}): 달성률 ${k.achievement}%, 비중 ${k.weight}%`).join('\n')
    : '  - 해당 없음'

  const systemPrompt = `당신은 은행 종합기획부의 KPI 성과관리 전문 분석가입니다.
주어진 데이터를 기반으로 경영진 보고용 실적 진단 보고서를 작성하세요.
수치를 정확히 인용하고, 구체적이고 실행 가능한 개선과제를 제시하세요.
보고서는 마크다운 형식으로 작성하되, 간결하고 핵심적인 내용 위주로 작성하세요.
은행 경영진이 5분 내에 읽을 수 있는 분량으로 작성하세요.`

  const userPrompt = `# ${group} 2026년 ${monthLabel} KPI 실적 진단 보고서 작성 요청

## 종합 현황
- 종합 가중 달성률: ${overallAch}%
- 100% 이상: ${over100}개 / 80~99%: ${mid}개 / 80% 미만: ${under80}개
- 월별 추세: ${monthlyTrend}

## 카테고리별 KPI 실적
${categoryBlocks}

## 부진 지표 (80% 미만)
${weakBlock}

## 참고 데이터 (목표·달성률 없음, 추세 확인용)
${refBlock}

---

위 데이터를 분석하여 아래 구조로 보고서를 작성해주세요:

## 1. 종합 진단
- 전체적인 실적 수준 평가 (1~2문단)
- 전월 대비 추세 진단

## 2. 카테고리별 분석
- 본원적 수익력 / 건전성 / 고객 / 연결과 확장 각각에 대해:
  - 핵심 성과 요약
  - 우수 지표와 부진 지표 식별
  - 원인 분석 (가능한 범위에서)

## 3. 추진현황
- 양호하게 추진되고 있는 영역
- 주의가 필요한 영역
- 전략과제 및 모니터링 지표 시사점

## 4. 핵심 개선과제 (우선순위 순)
- 각 과제별: 과제명, 관련 KPI, 현재 수준, 목표 수준, 구체적 실행방안

## 5. 차월 추진방향
- 다음 달 중점 관리 사항
- 달성률 제고를 위한 액션 플랜`

  return { systemPrompt, userPrompt }
}

import { enrichKpiRows, formatPercent, weightedAchievementFromRows } from './kpiCalcEngine'
import { evalLabel } from './kpiDisplay'

export function buildRelationGroups(definitions, results, selectedMonth) {
  const rows = enrichKpiRows(
    (definitions || []).filter(def => def.mgmtTool === 'KPI'),
    results,
    selectedMonth,
  )
  const groups = new Map()

  rows.forEach(row => {
    const key = [
      row.def.group || '전체',
      row.def.category || '기타',
      row.def.categoryL2 || '기타',
    ].join('::')
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        group: row.def.group,
        category: row.def.category,
        categoryL2: row.def.categoryL2 || '기타',
        rows: [],
      })
    }
    groups.get(key).rows.push(row)
  })

  return [...groups.values()].map(group => ({
    ...group,
    achievement: weightedAchievementFromRows(group.rows),
    children: [...group.rows].sort((a, b) => (a.achievement ?? 999) - (b.achievement ?? 999)),
  }))
}

export function explainWeakDrivers({ definitions, results, selectedMonth, groupName, category }) {
  const relationGroups = buildRelationGroups(definitions, results, selectedMonth)
    .filter(item => (!groupName || item.group === groupName) && (!category || item.category === category))
    .sort((a, b) => (a.achievement ?? 999) - (b.achievement ?? 999))

  const weakGroup = relationGroups.find(item => (item.achievement ?? 100) < 100) || relationGroups[0]
  if (!weakGroup) {
    return {
      title: '관계 해석 대상 없음',
      summary: '현재 권한 범위와 선택 조건에서 해석 가능한 KPI 관계가 없습니다.',
      drivers: [],
    }
  }

  const drivers = weakGroup.children
    .filter(row => row.achievement != null)
    .slice(0, 5)
    .map(row => ({
      code: row.def.code,
      label: evalLabel(row.def),
      group: row.def.group,
      category: row.def.category,
      categoryL2: row.def.categoryL2,
      categoryL3: row.def.categoryL3,
      achievement: row.achievement,
      momDiff: row.momDiff,
      weight: row.def.weight,
      actual: row.actual,
      target: row.target,
    }))

  const primary = drivers[0]
  const summary = primary
    ? `${weakGroup.group} ${weakGroup.categoryL2} 영역의 달성률은 ${formatPercent(weakGroup.achievement)}이며, 가장 낮은 하위 지표는 ${primary.label}(${formatPercent(primary.achievement)})입니다.`
    : `${weakGroup.group} ${weakGroup.categoryL2} 영역의 하위 지표 데이터를 추가 확인해야 합니다.`

  return {
    title: `${weakGroup.group} · ${weakGroup.categoryL2} 관계 해석`,
    group: weakGroup.group,
    category: weakGroup.category,
    categoryL2: weakGroup.categoryL2,
    achievement: weakGroup.achievement,
    summary,
    drivers,
  }
}

export function relationNarrative(relation) {
  if (!relation?.drivers?.length) return relation?.summary ?? '관계 해석 결과가 없습니다.'
  const primary = relation.drivers[0]
  const second = relation.drivers[1]
  const secondText = second ? `, 다음으로 ${second.label}(${formatPercent(second.achievement)}) 영향도 확인됩니다` : ''
  return `${relation.summary} 주 기여 요인은 ${primary.label}로 보이며${secondText}. 단, 이는 현재 KPI 구조의 L2/L3 관계와 달성률 기준으로 생성한 후보 해석이므로 실제 원인은 유관부서 확인이 필요합니다.`
}

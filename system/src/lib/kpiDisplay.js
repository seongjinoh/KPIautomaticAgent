/**
 * KPI 표시 규칙
 * - name: 코드/관리용 지표명
 * - label26: 2026년 평가판 표시명 (평가 UI에서는 L1~L3 + label26 중심)
 */
export function evalLabel(def) {
  if (!def) return ''
  return def.label26 != null && def.label26 !== '' ? def.label26 : def.name
}

/** 평가판/대시보드용 지표 한 줄 설명 (L1 > L2 > L3 > 26년레이블) */
export function evalHierarchyLine(def) {
  if (!def) return ''
  const l1 = def.category || ''
  const l2 = def.categoryL2 || ''
  const l3 = def.categoryL3 || ''
  const lab = evalLabel(def)
  const parts = [l1, l2, l3].filter(Boolean)
  if (parts.length === 0) return lab
  return `${parts.join(' > ')} · ${lab}`
}

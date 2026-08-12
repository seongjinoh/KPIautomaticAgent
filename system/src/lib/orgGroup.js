/** owner_group 조직 레벨 — 피평가(BANK/GROUP) vs 코드용 본부(HQ) */

export const ORG_BANK = 'BANK'
export const ORG_GROUP = 'GROUP'
export const ORG_HQ = 'HQ'

export const ORG_LEVEL_OPTIONS = [
  { value: ORG_BANK, label: '전행' },
  { value: ORG_GROUP, label: '그룹' },
  { value: ORG_HQ, label: '본부' },
]

export function orgLevelLabel(level) {
  const v = String(level || ORG_GROUP).toUpperCase()
  return ORG_LEVEL_OPTIONS.find((o) => o.value === v)?.label || v
}

export function normalizeOrgLevel(raw) {
  const s = String(raw || ORG_GROUP).trim().toUpperCase()
  if (s === '전행') return ORG_BANK
  if (s === '그룹') return ORG_GROUP
  if (s === '본부') return ORG_HQ
  if ([ORG_BANK, ORG_GROUP, ORG_HQ].includes(s)) return s
  return ORG_GROUP
}

export function isActiveGroup(g) {
  return (g?.use_yn ?? g?.useYn ?? 'Y') !== 'N'
}

/** 피평가·실적·평가배치에 쓰이는 그룹 (본부 HQ 제외) */
export function isEvalOrgGroup(g) {
  const level = normalizeOrgLevel(g?.org_level ?? g?.orgLevel ?? ORG_GROUP)
  return level === ORG_BANK || level === ORG_GROUP
}

export function filterEvalGroups(groups, { activeOnly = true } = {}) {
  return (groups || []).filter((g) => {
    if (activeOnly && !isActiveGroup(g)) return false
    return isEvalOrgGroup(g)
  })
}

/** 지표코드 생성용 — 본부(HQ) 포함, 미사용 제외 */
export function filterCodeGroups(groups) {
  return (groups || []).filter((g) => isActiveGroup(g))
}

export function buildGroupTree(groups, { includeInactive = false } = {}) {
  const list = (groups || []).filter((g) => includeInactive || isActiveGroup(g))
  const byCode = new Map(list.map((g) => [g.code, { ...g, children: [] }]))
  const roots = []
  for (const g of list) {
    const node = byCode.get(g.code)
    const parent = String(g.parent_code ?? g.parentCode ?? '').trim().toUpperCase()
    if (parent && byCode.has(parent)) {
      byCode.get(parent).children.push(node)
    } else {
      roots.push(node)
    }
  }
  const sortFn = (a, b) =>
    Number(a.sort_order ?? a.sortOrder ?? 0) - Number(b.sort_order ?? b.sortOrder ?? 0)
    || String(a.code).localeCompare(String(b.code), 'ko')
  const sortTree = (nodes) => {
    nodes.sort(sortFn)
    nodes.forEach((n) => sortTree(n.children))
  }
  sortTree(roots)
  return roots
}

export function flattenGroupTree(roots, depth = 0) {
  const out = []
  for (const n of roots || []) {
    out.push({ ...n, depth })
    out.push(...flattenGroupTree(n.children, depth + 1))
  }
  return out
}

export function parentGroupOptions(groups, orgLevel, selfCode = '') {
  const level = normalizeOrgLevel(orgLevel)
  const self = String(selfCode || '').trim().toUpperCase()
  if (level === ORG_BANK) return []
  if (level === ORG_GROUP) {
    return (groups || []).filter((g) => {
      if (g.code === self) return false
      return normalizeOrgLevel(g.org_level ?? g.orgLevel) === ORG_BANK
    })
  }
  if (level === ORG_HQ) {
    return (groups || []).filter((g) => {
      if (g.code === self) return false
      return normalizeOrgLevel(g.org_level ?? g.orgLevel) === ORG_GROUP
    })
  }
  return []
}

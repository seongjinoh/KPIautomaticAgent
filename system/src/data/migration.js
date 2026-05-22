const MASTER_KEEP = [
  'kind', 'code21', 'financial21', 'nonFinancial21', 'financial13',
  'lv1', 'lv1Name', 'lv2', 'lv2Name', 'lv3', 'lv3Name',
  'measureCode', 'calcBasis', 'scopeCode', 'linkKpiCode', 'name',
]

export function buildMasterFromCodebook(codebook, kpiDefs = []) {
  const unitMap = new Map()
  kpiDefs.forEach(d => { if (d.code && d.unit) unitMap.set(d.code, d.unit) })
  return (codebook || []).map(cb => {
    const m = { id: cb.id ?? cb.no ?? 0 }
    MASTER_KEEP.forEach(k => { m[k] = cb[k] ?? '' })
    m.unit = cb.unit || unitMap.get(cb.linkKpiCode) || ''
    return m
  })
}

function matchKey(n) {
  return (n || '').replace(/\s*\(\d{2,4}년?\)\s*$/g, '').replace(/\s+/g, '').trim().toLowerCase()
}

export function buildEvalConfig(defs, master, year) {
  const byCode = new Map()
  const byName = new Map()
  ;(master || []).forEach(m => {
    if (m.linkKpiCode) byCode.set(m.linkKpiCode, m)
    const mk = matchKey(m.name)
    if (mk && !byName.has(mk)) byName.set(mk, m)
  })
  return (defs || []).map(d => {
    const m = byCode.get(d.code) || byName.get(matchKey(d.name))
    return {
      indicatorId: m?.id ?? null,
      year,
      code: d.code || '',
      mgmtTool: d.mgmtTool || 'KPI',
      weight: d.weight ?? 0,
      category: d.category || '',
      categoryL2: d.categoryL2 || '',
      categoryL3: d.categoryL3 || '',
      group: d.group || '',
      label: d.label26 || d.label25 || d.name || '',
      unit: d.unit || m?.unit || '',
      annualTarget: d.annualTarget ?? 0,
      monthlyTargets: d.monthlyTargets || {},
      collectType: d.collectType || '',
      dept: d.dept || '',
    }
  })
}

export function mergeToActiveDefs(master, evalConfig, year) {
  const byId = new Map()
  ;(master || []).forEach(m => byId.set(m.id, m))
  const lk = `label${String(year).slice(-2)}`
  return (evalConfig || []).map(cfg => {
    const m = byId.get(cfg.indicatorId)
    return {
      ...(m || {}),
      ...cfg,
      no: cfg.indicatorId ?? 0,
      name: m?.name || cfg.label || '',
      [lk]: cfg.label || '',
      unit: cfg.unit || m?.unit || '',
      calcBasis: m?.calcBasis || '',
    }
  }).filter(d => d.code)
}

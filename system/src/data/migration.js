import { enrichEvalConfigEntry, inferEvalCalcDefaults } from '../lib/achievementEngine'

function calcBasisToMeasureCode(calcBasis) {
  if (calcBasis === '연간신규') return 'NEW'
  if (calcBasis === '총량') return 'TOT'
  if (calcBasis === '연간이탈') return 'OUT'
  if (calcBasis === '연간순증') return 'NET'
  if (calcBasis === '비율' || calcBasis === '낮을수록') return 'RAT'
  return 'ETC'
}

function looksLikeLegacyOperationalCode(value) {
  return /^[A-Z]{2,4}-[A-Z]-\d{3}$/.test(String(value || '').trim())
}

const MASTER_KEEP = [
  'kind', 'code21', 'financial21', 'nonFinancial21', 'financial13',
  'lv1', 'lv1Name', 'lv2', 'lv2Name', 'lv3', 'lv3Name',
  'calcBasis', 'scopeCode', 'name',
]

export function sanitizeMasterRow(row) {
  const r = { ...row }
  delete r.linkKpiCode
  if (looksLikeLegacyOperationalCode(r.measureCode)) delete r.measureCode
  if (!r.calcBasis || looksLikeLegacyOperationalCode(r.calcBasis)) {
    r.calcBasis = r.calcBasis && !looksLikeLegacyOperationalCode(r.calcBasis) ? r.calcBasis : '기타'
  }
  r.measureCode = calcBasisToMeasureCode(r.calcBasis)
  return r
}

export function buildMasterFromCodebook(codebook, kpiDefs = []) {
  const unitMap = new Map()
  kpiDefs.forEach(d => { if (d.code && d.unit) unitMap.set(matchKey(d.name), d.unit) })
  return (codebook || []).map(cb => {
    const m = { id: cb.id ?? cb.no ?? 0 }
    MASTER_KEEP.forEach(k => { m[k] = cb[k] ?? '' })
    m.unit = cb.unit || unitMap.get(matchKey(cb.name)) || ''
    return sanitizeMasterRow(m)
  })
}

function matchKey(n) {
  return (n || '').replace(/\s*\(\d{2,4}년?\)\s*$/g, '').replace(/\s+/g, '').trim().toLowerCase()
}

export function sanitizeEvalConfigEntry(cfg, masterById) {
  const indicatorCode = cfg.indicatorCode || cfg.indicator_code || ''
  const customMonthlyTargets = cfg.customMonthlyTargets ?? cfg.custom_monthly_targets_json ?? null
  return enrichEvalConfigEntry({
    ...cfg,
    indicatorCode,
    code: indicatorCode || '',
    customMonthlyTargets,
  })
}

export function sanitizeEvalConfigs(configs, catalog) {
  const byCode = new Map((catalog || []).map(m => [m.indicatorCode || m.indicator_code, m]))
  const out = {}
  Object.entries(configs || {}).forEach(([year, list]) => {
    out[year] = (list || []).map(c => sanitizeEvalConfigEntry(c, byCode))
  })
  return out
}

function groupCodeFromName(codeCatalog, groupName) {
  const row = (codeCatalog || []).find(c => c.groupName === groupName || c.group_name === groupName)
  return row?.groupCode || row?.group_code || ''
}

function findIndicatorCodeForDef(def, codeCatalog = []) {
  const targetName = matchKey(def.label26 || def.label25 || def.name)
  const perfCode = calcBasisToMeasureCode(def.calcBasis)
  const groupCode = groupCodeFromName(codeCatalog, def.group)
  return codeCatalog.find(c => {
    const codeName = matchKey(c.displayName || c.display_name || c.lv3Name || c.lv3_name)
    const samePerf = String(c.perfCode || c.perf_code || '').toUpperCase() === perfCode
    const sameGroup = String(c.groupCode || c.group_code || '').toUpperCase() === groupCode
    return samePerf && sameGroup && codeName === targetName
  })
}

export function buildEvalConfig(defs, codeCatalog, year, month = 12) {
  return (defs || []).map(d => {
    const matched = findIndicatorCodeForDef(d, codeCatalog)
    return enrichEvalConfigEntry({
      year,
      month,
      indicatorCode: matched?.indicatorCode || matched?.indicator_code || '',
      code: matched?.indicatorCode || matched?.indicator_code || '',
      groupCode: matched?.groupCode || matched?.group_code || groupCodeFromName(codeCatalog, d.group),
      mgmtTool: d.mgmtTool || 'KPI',
      weight: d.weight ?? 0,
      evalCategoryLv1: d.category || '',
      evalCategoryLv2: d.categoryL2 || '',
      evalCategoryLv3: d.categoryL3 || '',
      category: d.category || '',
      categoryL2: d.categoryL2 || '',
      categoryL3: d.categoryL3 || '',
      group: d.group || '',
      label: d.label26 || d.label25 || d.name || '',
      unit: d.unit || matched?.unit || '',
      annualTarget: d.annualTarget ?? 0,
      monthlyTarget: d.monthlyTargets?.[month] ?? null,
      monthlyTargets: d.monthlyTargets || {},
      collectType: d.collectType || '',
      dept: d.dept || '',
      lowerIsBetter: Boolean(d.lowerIsBetter),
      ...inferEvalCalcDefaults(d),
    })
  }).filter(row => row.indicatorCode)
}

export function mergeToActiveDefs(master, evalConfig, year) {
  const byCode = new Map()
  ;(master || []).forEach(m => byCode.set(m.indicatorCode || m.indicator_code, m))
  const lk = `label${String(year).slice(-2)}`
  return (evalConfig || []).map(cfg => {
    const indicatorCode = cfg.indicatorCode || cfg.indicator_code || ''
    const m = byCode.get(indicatorCode)
    return enrichEvalConfigEntry({
      ...(m || {}),
      ...cfg,
      no: cfg.id ?? 0,
      name: m?.displayName || m?.display_name || cfg.label || '',
      code: indicatorCode || cfg.code || '',
      indicatorCode,
      [lk]: cfg.label || '',
      unit: cfg.unit || m?.unit || '',
      category: cfg.evalCategoryLv1 || cfg.eval_category_lv1 || cfg.category || '',
      categoryL2: cfg.evalCategoryLv2 || cfg.eval_category_lv2 || cfg.categoryL2 || '',
      categoryL3: cfg.evalCategoryLv3 || cfg.eval_category_lv3 || cfg.categoryL3 || '',
      group: cfg.groupName || cfg.group_name || m?.groupName || m?.group_name || cfg.group || cfg.groupCode || cfg.group_code || '',
      groupCode: cfg.groupCode || cfg.group_code || m?.groupCode || m?.group_code || '',
      mgmtTool: cfg.mgmtTool || cfg.mgmt_tool || m?.mgmtTool || 'KPI',
      contributionMode: String(cfg.contributionMode || cfg.contribution_mode || 'WEIGHT').toUpperCase() === 'ADJUST' ? 'ADJUST' : 'WEIGHT',
      weight: String(cfg.contributionMode || cfg.contribution_mode || 'WEIGHT').toUpperCase() === 'ADJUST'
        ? 0
        : (cfg.weight ?? m?.weight ?? 0),
      isCore: Boolean(cfg.isCore ?? (String(cfg.is_core || '').toUpperCase() === 'Y')),
      calcBasis: m?.perfCode || m?.perf_code || cfg.calcBasis || '',
      sortOrder: Number(cfg.sortOrder ?? cfg.sort_order ?? 0),
      adjBand: cfg.adjBand || cfg.adj_band || '',
      masterName: m?.lv3Name || m?.lv3_name || m?.displayName || m?.display_name || cfg.lv3Name || cfg.lv3_name || '',
      lv3Name: cfg.lv3Name || cfg.lv3_name || m?.lv3Name || m?.lv3_name || '',
    })
  }).filter(d => d.code || d.indicatorCode)
}

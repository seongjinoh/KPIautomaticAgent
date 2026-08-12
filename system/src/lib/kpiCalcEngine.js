import {
  calculateAchievementRate,
  computeMonthlyTarget,
  enrichEvalConfigEntry,
} from './achievementEngine'

export const CALC_RULES = {
  TOTAL: '총량',
  NEW: '연간신규',
  OUT: '연간이탈',
  NET: '연간순증',
  RATIO: '비율',
  ETC: '기타',
}

export function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null
  const unit = 10 ** digits
  return Math.round(value * unit) / unit
}

export function formatPercent(value, digits = 2) {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${Number(value).toFixed(digits)}%`
}

export function getMonthlyResult(results, code, month) {
  return (results || []).find(r => r.code === code && r.month === month)
}

export function getMonthlyTarget(def, month) {
  const computed = computeMonthlyTarget(def, month)
  if (computed != null) return computed
  const target = def?.monthlyTargets?.[month] ?? def?.monthlyTargets?.[String(month)]
  return Number(target ?? 0)
}

export function calculateAchievement(def, result, month) {
  const actual = result?.actual
  if (actual == null) return null
  const enriched = enrichEvalConfigEntry(def)
  return calculateAchievementRate(enriched, actual, month)
}

export function enrichKpiRows(definitions, results, selectedMonth) {
  return (definitions || []).map(def => {
    const result = getMonthlyResult(results, def.code, selectedMonth)
    const prevMonth = selectedMonth > 1 ? selectedMonth - 1 : null
    const prev = prevMonth ? getMonthlyResult(results, def.code, prevMonth) : null
    const target = getMonthlyTarget(def, selectedMonth)
    const calcAchievement = result?.actual != null ? calculateAchievement(def, result, selectedMonth) : null
    const prevCalc = prev?.actual != null && prevMonth ? calculateAchievement(def, prev, prevMonth) : null
    const achievement = calcAchievement ?? (result?.achievement != null ? round(Number(result.achievement), 2) : null)
    const prevAchievement = prevCalc ?? (prev?.achievement != null ? round(Number(prev.achievement), 2) : null)
    const momDiff = prevAchievement != null && achievement != null ? round(achievement - prevAchievement, 2) : null
    const annualProgress = def.annualTarget
      ? round((Number(result?.actual ?? 0) / Number(def.annualTarget)) * 100, 2)
      : null

    return {
      def,
      result,
      target,
      actual: result?.actual != null ? Number(result.actual) : null,
      achievement,
      calcAchievement,
      prevAchievement,
      momDiff,
      annualProgress,
      expectedProgress: round((selectedMonth / 12) * 100, 2),
    }
  })
}

export function weightedAchievementFromRows(rows) {
  let weightedSum = 0
  let totalWeight = 0
  rows.forEach(row => {
    const weight = Number(row.def?.weight ?? 0)
    if (row.achievement != null && weight > 0) {
      weightedSum += row.achievement * weight
      totalWeight += weight
    }
  })
  return totalWeight > 0 ? round(weightedSum / totalWeight, 2) : null
}

export function summarizeKpiRows(rows) {
  const total = rows.length
  const over100 = rows.filter(r => (r.achievement ?? 0) >= 100).length
  const normal = rows.filter(r => (r.achievement ?? 0) >= 80 && (r.achievement ?? 0) < 100).length
  const under80 = rows.filter(r => (r.achievement ?? 0) < 80).length
  return {
    total,
    weightedAchievement: weightedAchievementFromRows(rows),
    over100,
    normal,
    under80,
  }
}

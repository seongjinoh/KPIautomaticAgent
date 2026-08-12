import {
  calculateAchievementRate,
  computeMonthlyTarget,
  enrichEvalConfigEntry,
} from './achievementEngine'

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null
  const unit = 10 ** digits
  return Math.round(value * unit) / unit
}

/** code → 평가배치 정의 인덱스 */
export function buildDefByCode(definitions = []) {
  const map = new Map()
  definitions.forEach(def => {
    if (def?.code) map.set(def.code, enrichEvalConfigEntry(def))
  })
  return map
}

/**
 * 단일 실적 레코드에 월간목표·달성률을 산정 엔진으로 계산해 반영한다.
 * KPI가 아니거나 실적이 없으면 달성률은 null.
 */
export function resolveResultWithAchievement(def, rawResult) {
  if (!rawResult) return null

  const month = Number(rawResult.month)
  const isKpi = !rawResult.mgmtTool || rawResult.mgmtTool === 'KPI'

  if (!isKpi || !def) {
    return {
      ...rawResult,
      target: rawResult.target ?? null,
      achievement: null,
    }
  }

  const enrichedDef = enrichEvalConfigEntry(def)
  const target = computeMonthlyTarget(enrichedDef, month)
  const actual = rawResult.actual

  let achievement = null
  if (actual != null && actual !== '') {
    achievement = calculateAchievementRate(enrichedDef, actual, month)
  }

  return {
    ...rawResult,
    target,
    achievement,
    achievementSource: achievement != null ? 'computed' : null,
  }
}

/** 실적 배열 전체에 달성률 산정 엔진을 적용 */
export function resolveResultsWithAchievements(definitions = [], results = []) {
  const byCode = buildDefByCode(definitions)
  return (results || []).map(raw => resolveResultWithAchievement(byCode.get(raw.code), raw))
}

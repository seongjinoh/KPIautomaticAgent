/** 달성률 산정 엔진 — Linear / Flat / Custom */

export const ACHIEVEMENT_MODES = {
  LINEAR: 'linear',
  FLAT: 'flat',
  CUSTOM: 'custom',
}

export const GOAL_DIRECTIONS = {
  INCREASE: 'increase',
  DECREASE: 'decrease',
}

export const MODE_LABELS = {
  linear: 'Linear',
  flat: 'Flat',
  custom: 'Custom',
}

export const DIRECTION_LABELS = {
  increase: '증가',
  decrease: '감소',
}

/** Custom 모드용 달성률 산출식 프리셋 */
export const ACHIEVEMENT_PRESETS = [
  {
    id: 'standard_increase',
    label: '표준 달성률 (증가)',
    expr: '100 + (actual - target) / target * 100',
    direction: 'increase',
    hint: '100% + (실적-목표)/목표 × 100',
  },
  {
    id: 'standard_decrease',
    label: '표준 달성률 (감소)',
    expr: '100 + (target - actual) / target * 100',
    direction: 'decrease',
    hint: '100% + (목표-실적)/목표 × 100',
  },
  {
    id: 'ratio',
    label: '목표 대비 비율',
    expr: 'actual / target * 100',
    direction: 'increase',
    hint: '실적 ÷ 목표 × 100',
  },
  {
    id: 'capped_increase',
    label: '상한 120% (증가)',
    expr: 'min(120, 100 + (actual - target) / target * 100)',
    direction: 'increase',
    hint: '표준 달성률, 최대 120%',
  },
  {
    id: 'floor_decrease',
    label: '하한 80% (감소)',
    expr: 'max(80, 100 + (target - actual) / target * 100)',
    direction: 'decrease',
    hint: '표준 달성률, 최소 80%',
  },
]

export function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null
  const unit = 10 ** digits
  return Math.round(value * unit) / unit
}

function parsePercentLike(value, fallback = null) {
  if (value == null || value === '') return fallback
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  const cleaned = String(value).replace(/[%\s,]/g, '').trim()
  if (!cleaned) return fallback
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : fallback
}

export function applyAchievementPolicy(def, rawAchievement) {
  const raw = Number(rawAchievement)
  if (!Number.isFinite(raw)) return null

  const lowerCap = parsePercentLike(def?.capMin ?? def?.cap_min, 40)
  const upperCap = parsePercentLike(def?.capMax ?? def?.cap_max, 150)
  const scoreMultiplier = parsePercentLike(def?.scoreRule ?? def?.score_rule, 1)
  const adjustBand = parsePercentLike(def?.adjBand ?? def?.adj_band, 120)
  const adjustMultiplier = parsePercentLike(def?.penaltyRule ?? def?.penalty_rule, 0.1)

  // 승수는 100을 기준으로 초과/미달 폭에만 적용한다.
  let adjusted = 100 + ((raw - 100) * scoreMultiplier)

  if (adjusted < lowerCap) adjusted = lowerCap

  // 조정구간 이상이면 초과분에만 조정승수를 적용한다. 예: 130, band 120, x0.1 -> 121
  if (adjustBand != null && adjustMultiplier != null && adjusted >= adjustBand) {
    adjusted = adjustBand + ((adjusted - adjustBand) * adjustMultiplier)
  }

  if (adjusted > upperCap) adjusted = upperCap
  if (adjusted < lowerCap) adjusted = lowerCap
  return round(adjusted, 2)
}

export function normalizeGoalDirection(def) {
  if (def?.goalDirection === GOAL_DIRECTIONS.DECREASE || def?.goalDirection === 'decrease') {
    return GOAL_DIRECTIONS.DECREASE
  }
  if (def?.lowerIsBetter) return GOAL_DIRECTIONS.DECREASE
  return GOAL_DIRECTIONS.INCREASE
}

export function normalizeAchievementMode(def) {
  const mode = def?.achievementMode
  if (mode === ACHIEVEMENT_MODES.FLAT || mode === ACHIEVEMENT_MODES.CUSTOM) return mode
  return ACHIEVEMENT_MODES.LINEAR
}

export function isLeapYear(year) {
  const y = Number(year)
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

export function daysInYear(year) {
  return isLeapYear(year) ? 366 : 365
}

/** 연초(1/1) ~ 해당 월 말일까지의 일수 */
export function daysToMonthEnd(year, month) {
  const y = Number(year)
  const m = Number(month)
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null
  const end = new Date(y, m, 0) // month-end
  const start = new Date(y, 0, 1)
  return Math.round((end - start) / 86400000) + 1
}

export function daysInMonth(year, month) {
  const y = Number(year)
  const m = Number(month)
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) return null
  return new Date(y, m, 0).getDate()
}

/** 평가시작월 ~ 해당 월 말일까지의 일수 */
export function daysFromPeriodStart(year, month, startMonth = 1) {
  const y = Number(year)
  const m = Number(month)
  const start = Number(startMonth) || 1
  if (!Number.isFinite(y) || !Number.isFinite(m) || m < start || m > 12) return null
  let days = 0
  for (let mo = start; mo <= m; mo += 1) {
    const d = daysInMonth(y, mo)
    if (d == null) return null
    days += d
  }
  return days
}

/** 평가시작월 1일 ~ 평가종료월 말일까지의 일수 */
export function daysInEvalPeriod(year, startMonth = 1, endMonth = 12) {
  const y = Number(year)
  const start = Number(startMonth) || 1
  const end = Number(endMonth) || 12
  if (!Number.isFinite(y) || start < 1 || start > 12 || end < 1 || end > 12 || start > end) return null
  let days = 0
  for (let mo = start; mo <= end; mo += 1) {
    const d = daysInMonth(y, mo)
    if (d == null) return null
    days += d
  }
  return days
}

export function normalizeEvalPeriod(def = {}) {
  let start = Number(def?.targetStartMonth ?? def?.target_start_month ?? 1)
  let end = Number(def?.targetEndMonth ?? def?.target_end_month ?? 12)
  if (!Number.isFinite(start) || start < 1 || start > 12) start = 1
  if (!Number.isFinite(end) || end < 1 || end > 12) end = 12
  if (start > end) [start, end] = [end, start]
  return { start, end }
}

export function isMonthInEvalPeriod(month, def = {}) {
  const m = Number(month)
  if (!Number.isFinite(m) || m < 1 || m > 12) return false
  const { start, end } = normalizeEvalPeriod(def)
  return m >= start && m <= end
}

/** 미리보기/저장용 — 의미 있는 월간목표 override만 주입 (기본 0은 Linear 계산을 막지 않음) */
export function resolveMonthlyTargetOverride(draft, selectedMonth) {
  const mt = draft?.monthlyTarget
  if (mt != null && mt !== '' && Number.isFinite(Number(mt))) {
    return { [selectedMonth]: Number(mt) }
  }
  return draft?.customMonthlyTargets || undefined
}

/** 월간 목표 산출 */
export function computeMonthlyTarget(def, month, year = def?.year) {
  const m = Number(month)
  if (!Number.isFinite(m) || m < 1 || m > 12) return null

  const { start, end } = normalizeEvalPeriod(def)
  if (m < start || m > end) return null

  const mode = normalizeAchievementMode(def)
  const annual = Number(def?.annualTarget ?? 0)
  const baseline = Number(def?.baselineActual ?? 0)
  const digits = annual < 10 ? 2 : 1

  // DB에 저장된 월간목표가 있으면 우선 사용
  const custom = def?.customMonthlyTargets?.[m] ?? def?.customMonthlyTargets?.[String(m)]
  if (custom != null && custom !== '') return round(Number(custom), digits)
  const legacy = def?.monthlyTargets?.[m] ?? def?.monthlyTargets?.[String(m)]
  if (legacy != null && legacy !== '') return round(Number(legacy), digits)

  if (mode === ACHIEVEMENT_MODES.FLAT) {
    return round(annual, digits)
  }

  if (mode === ACHIEVEMENT_MODES.CUSTOM) {
    return round(annual, digits)
  }

  // Linear: 기준실적 + (연간-기준) / 평가기간일수 × 경과일수
  const y = Number(year) || new Date().getFullYear()
  const elapsed = daysFromPeriodStart(y, m, start)
  const periodDays = daysInEvalPeriod(y, start, end)
  if (elapsed == null || !periodDays) return null
  return round(baseline + (annual - baseline) * (elapsed / periodDays), digits)
}

/** 1~12월 월간 목표 미리보기 */
export function buildMonthlyTargetPreview(def, year = def?.year) {
  return Array.from({ length: 12 }, (_, idx) => {
    const month = idx + 1
    return { month, target: computeMonthlyTarget(def, month, year) }
  })
}

/** 달성률 산출 */
export function calculateAchievementRate(def, actual, month, year = def?.year, filterValues = null) {
  const actualNum = Number(actual)
  if (!Number.isFinite(actualNum)) return null

  const target = computeMonthlyTarget(def, month, year)
  if (target == null) return null
  if (target === 0) return actualNum === 0 ? 100 : null

  const mode = normalizeAchievementMode(def)
  const direction = normalizeGoalDirection(def)
  let rawAchievement = null

  if (mode === ACHIEVEMENT_MODES.CUSTOM && def?.customAchievementExpr?.trim()) {
    const vars = {
      actual: actualNum,
      target,
      month: Number(month),
      annualTarget: Number(def?.annualTarget ?? 0),
      baseline: Number(def?.baselineActual ?? 0),
      yearProgress: (() => {
        const { start, end } = normalizeEvalPeriod(def)
        const span = end - start + 1
        return span > 0 ? (Number(month) - start + 1) / span : Number(month) / 12
      })(),
    }
    if (filterValues && typeof filterValues === 'object') {
      Object.assign(vars, filterValues)
    } else if (def?.filters && typeof def.filters === 'object') {
      for (let i = 1; i <= 30; i += 1) {
        const v = def.filters[i] ?? def.filters[String(i)]
        vars[`filter${i}`] = Number(v) || 0
      }
    }
    rawAchievement = evaluateAchievementExpression(def.customAchievementExpr, vars)
    return applyAchievementPolicy(def, rawAchievement)
  }

  if (direction === GOAL_DIRECTIONS.DECREASE) {
    rawAchievement = round(100 + ((target - actualNum) / target) * 100, 2)
    return applyAchievementPolicy(def, rawAchievement)
  }
  rawAchievement = round(100 + ((actualNum - target) / target) * 100, 2)
  return applyAchievementPolicy(def, rawAchievement)
}

/** Custom 산출식 — 허용 변수/함수만 사용 */
export function evaluateAchievementExpression(expr, vars = {}) {
  const raw = String(expr ?? '').trim()
  if (!raw) return null
  if (!/^[0-9+\-*/().%,\s_a-zA-Z]+$/.test(raw)) return null

  const safeVars = {
    actual: Number(vars.actual ?? 0),
    target: Number(vars.target ?? 0),
    month: Number(vars.month ?? 0),
    annualTarget: Number(vars.annualTarget ?? 0),
    baseline: Number(vars.baseline ?? 0),
    yearProgress: Number(vars.yearProgress ?? 0),
  }
  for (let i = 1; i <= 30; i += 1) {
    safeVars[`filter${i}`] = Number(vars[`filter${i}`] ?? 0)
  }

  try {
    const filterArgs = Array.from({ length: 30 }, (_, i) => `filter${i + 1}`)
    const fn = new Function(
      'actual', 'target', 'month', 'annualTarget', 'baseline', 'yearProgress',
      ...filterArgs,
      'min', 'max', 'abs', 'round',
      `"use strict"; return (${raw});`,
    )
    const result = fn(
      safeVars.actual,
      safeVars.target,
      safeVars.month,
      safeVars.annualTarget,
      safeVars.baseline,
      safeVars.yearProgress,
      ...filterArgs.map(k => safeVars[k]),
      Math.min,
      Math.max,
      Math.abs,
      (v, d = 2) => round(v, d),
    )
    return Number.isFinite(result) ? round(result, 2) : null
  } catch {
    return null
  }
}

/** eval config 기본값 추론 (기존 데이터 마이그레이션) */
export function inferEvalCalcDefaults(def = {}) {
  const monthly = def.monthlyTargets || {}
  const values = Array.from({ length: 12 }, (_, i) => {
    const v = monthly[i + 1] ?? monthly[String(i + 1)]
    return v == null ? null : Number(v)
  }).filter(v => v != null)

  let achievementMode = ACHIEVEMENT_MODES.LINEAR
  if (values.length >= 2) {
    const first = values[0]
    const allSame = values.every(v => Math.abs(v - first) < 0.0001)
    if (allSame) achievementMode = ACHIEVEMENT_MODES.FLAT
  }

  const goalDirection = def.lowerIsBetter || def.goalDirection === 'decrease'
    ? GOAL_DIRECTIONS.DECREASE
    : GOAL_DIRECTIONS.INCREASE

  const month1 = monthly[1] ?? monthly['1']
  const baselineActual = def.baselineActual != null
    ? Number(def.baselineActual)
    : (month1 != null ? Number(month1) : 0)

  const { start, end } = normalizeEvalPeriod(def)
  return {
    achievementMode,
    goalDirection,
    baselineActual,
    customAchievementExpr: def.customAchievementExpr || '',
    customMonthlyTargets: def.customMonthlyTargets || null,
    customTargetMode: def.customTargetMode || 'auto',
    targetStartMonth: start,
    targetEndMonth: end,
  }
}

export function enrichEvalConfigEntry(cfg = {}) {
  const inferred = inferEvalCalcDefaults(cfg)
  return {
    ...cfg,
    achievementMode: cfg.achievementMode || inferred.achievementMode,
    goalDirection: cfg.goalDirection || inferred.goalDirection,
    baselineActual: cfg.baselineActual != null ? Number(cfg.baselineActual) : inferred.baselineActual,
    customAchievementExpr: cfg.customAchievementExpr ?? inferred.customAchievementExpr,
    customMonthlyTargets: cfg.customMonthlyTargets ?? inferred.customMonthlyTargets,
    customTargetMode: cfg.customTargetMode || inferred.customTargetMode,
    targetStartMonth: cfg.targetStartMonth ?? cfg.target_start_month ?? inferred.targetStartMonth,
    targetEndMonth: cfg.targetEndMonth ?? cfg.target_end_month ?? inferred.targetEndMonth,
  }
}

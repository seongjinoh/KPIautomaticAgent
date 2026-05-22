/** 월별 실적에서 달성률 조회·집계 */

export function achievementFor(results, code, month) {
  const r = results.find(x => x.code === code && x.month === month && x.mgmtTool === 'KPI')
  return r?.achievement ?? null
}

/** 선택월 기준 YTD(1~month) 평균 달성률 */
export function ytdAvgAchievement(results, code, month) {
  let s = 0
  let c = 0
  for (let m = 1; m <= month; m++) {
    const a = achievementFor(results, code, m)
    if (a != null) {
      s += a
      c += 1
    }
  }
  return c > 0 ? Math.round((s / c) * 10) / 10 : null
}

/** 지표 묶음 가중 평균 달성률 */
export function weightedAchievement(defs, results, month) {
  let ws = 0
  let wt = 0
  for (const d of defs) {
    const a = achievementFor(results, d.code, month)
    if (a != null && d.weight) {
      ws += a * d.weight
      wt += d.weight
    }
  }
  return wt > 0 ? Math.round((ws / wt) * 10) / 10 : null
}

/** 묶음별 YTD 평균 달성률의 가중평균 */
export function weightedYtdAchievement(defs, results, month) {
  let ws = 0
  let wt = 0
  for (const d of defs) {
    const y = ytdAvgAchievement(results, d.code, month)
    if (y != null && d.weight) {
      ws += y * d.weight
      wt += d.weight
    }
  }
  return wt > 0 ? Math.round((ws / wt) * 10) / 10 : null
}

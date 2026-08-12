import { enrichKpiRows, formatPercent, round } from './kpiCalcEngine'
import { evalLabel } from './kpiDisplay'

export const ANOMALY_SEVERITY = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low',
}

const SEVERITY_LABEL = {
  [ANOMALY_SEVERITY.HIGH]: '위험',
  [ANOMALY_SEVERITY.MEDIUM]: '주의',
  [ANOMALY_SEVERITY.LOW]: '확인',
}

export function severityLabel(severity) {
  return SEVERITY_LABEL[severity] ?? '확인'
}

export function detectAnomalies({ definitions, results, selectedMonth }) {
  const kpiDefs = (definitions || []).filter(def => def.mgmtTool === 'KPI')
  const rows = enrichKpiRows(kpiDefs, results, selectedMonth)
  const events = []

  rows.forEach(row => {
    const { def, result, achievement, momDiff, annualProgress, expectedProgress } = row
    const label = evalLabel(def)
    const base = {
      code: def.code,
      label,
      group: def.group,
      category: def.category,
      categoryL2: def.categoryL2,
      categoryL3: def.categoryL3,
      dept: def.dept,
      month: selectedMonth,
    }

    if (!result) {
      events.push({
        ...base,
        id: `${def.code}-missing-${selectedMonth}`,
        type: 'missing',
        severity: ANOMALY_SEVERITY.HIGH,
        title: '입력 누락',
        message: `${label}의 ${selectedMonth}월 실적이 없습니다.`,
        evidence: '월별 실적 레코드 미존재',
      })
      return
    }

    if (achievement != null && achievement < 80) {
      events.push({
        ...base,
        id: `${def.code}-under-${selectedMonth}`,
        type: 'underperform',
        severity: achievement < 70 ? ANOMALY_SEVERITY.HIGH : ANOMALY_SEVERITY.MEDIUM,
        title: '달성률 미달',
        message: `${label} 달성률이 ${formatPercent(achievement)}로 80% 미만입니다.`,
        evidence: `목표 ${Number(row.target).toLocaleString()} / 실적 ${Number(row.actual).toLocaleString()}`,
        value: achievement,
      })
    }

    if (momDiff != null && Math.abs(momDiff) >= 15) {
      events.push({
        ...base,
        id: `${def.code}-mom-${selectedMonth}`,
        type: 'mom_spike',
        severity: Math.abs(momDiff) >= 30 ? ANOMALY_SEVERITY.HIGH : ANOMALY_SEVERITY.MEDIUM,
        title: momDiff >= 0 ? '전월 대비 급등' : '전월 대비 급락',
        message: `${label}의 달성률이 전월 대비 ${momDiff === 0 ? '0.00' : `${momDiff > 0 ? '+' : '△'}${Math.abs(momDiff).toFixed(2)}`}%p 변동했습니다.`,
        evidence: `전월 ${formatPercent(row.prevAchievement)} → 당월 ${formatPercent(achievement)}`,
        value: momDiff,
      })
    }

    if (annualProgress != null && expectedProgress != null) {
      const progressGap = round(annualProgress - expectedProgress, 2)
      if (progressGap != null && progressGap < -20) {
        events.push({
          ...base,
          id: `${def.code}-progress-${selectedMonth}`,
          type: 'progress_lag',
          severity: progressGap < -35 ? ANOMALY_SEVERITY.HIGH : ANOMALY_SEVERITY.MEDIUM,
          title: '연간 목표 진척률 과소',
          message: `${label}의 연간 목표 진척률이 ${formatPercent(annualProgress)}로 월 기준 기대치 대비 낮습니다.`,
          evidence: `기대 진척 ${formatPercent(expectedProgress)} / 차이 ${progressGap.toFixed(2)}%p`,
          value: progressGap,
        })
      }
    }
  })

  return events.sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
}

function severityRank(severity) {
  if (severity === ANOMALY_SEVERITY.HIGH) return 0
  if (severity === ANOMALY_SEVERITY.MEDIUM) return 1
  return 2
}

export function summarizeAnomalies(events) {
  return {
    total: events.length,
    high: events.filter(e => e.severity === ANOMALY_SEVERITY.HIGH).length,
    medium: events.filter(e => e.severity === ANOMALY_SEVERITY.MEDIUM).length,
    low: events.filter(e => e.severity === ANOMALY_SEVERITY.LOW).length,
  }
}

/**
 * 그룹 상세 — 헤더와 실적트리 사이 시각화 존.
 *
 * 좌측: 종합달성률(L3) + 4부문 달성률 카드 + 내부통제(점) 보조 스트립
 *   - 영업그룹 4부문: 본원적 수익력·건전성·고객·연결과 확장
 *   - 전행(SHB): 연결과 확장 대신 디지털 (`vizCategoryKeys`)
 * 우측: Recharts
 *   - 디폴트: 1~선택월 종합+부문 달성률
 *   - Label 1개: 월별목표(1~12) + 월별실적(1~선택월), 동일 단위·단일 Y축
 *   - Label 복수 / L1·L2·L3: 선택 항목 1~선택월 달성률(또는 ADJUST 점)
 * 선택 규칙은 GroupDetailView의 chartSelection (동일 kind만 복수 선택)
 *
 * 행내: 부문 목록·히트맵 열이 바뀌면 여기와 DashboardView.HEATMAP_COLUMNS를 설정화할 것.
 */
import { useMemo } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BarChart3, ShieldCheck, UsersRound, Network, Cpu, Target } from 'lucide-react'
import { isBankWideGroup } from '../lib/authService'
import { weightedAchievement } from '../lib/kpiAchievements'
import { computeMonthlyTarget, enrichEvalConfigEntry } from '../lib/achievementEngine'
import { formatMetricNumber } from '../lib/numberFormat'
import { evalLabel } from '../lib/kpiDisplay'

const CHART_COLORS = ['#0b57d0', '#0d9488', '#d97706', '#7c3aed', '#e11d48', '#0284c7', '#059669', '#ea580c']

const CAT_CARD_META = {
  '본원적 수익력': {
    color: '#2563eb',
    soft: '#eff6ff',
    border: '#dbeafe',
    Icon: BarChart3,
  },
  '건전성': {
    color: '#7c3aed',
    soft: '#f5f3ff',
    border: '#ede9fe',
    Icon: ShieldCheck,
  },
  '고객': {
    color: '#ea580c',
    soft: '#fff7ed',
    border: '#ffedd5',
    Icon: UsersRound,
  },
  '연결과 확장': {
    color: '#0d9488',
    soft: '#f0fdfa',
    border: '#ccfbf1',
    Icon: Network,
  },
  '디지털': {
    color: '#0d9488',
    soft: '#f0fdfa',
    border: '#ccfbf1',
    Icon: Cpu,
  },
}

function isAdjustDef(def) {
  return String(def?.contributionMode || def?.contribution_mode || '').toUpperCase() === 'ADJUST'
}

function round1(n) {
  if (n == null || !Number.isFinite(Number(n))) return null
  return Math.round(Number(n) * 10) / 10
}

/** 실적 범위에 맞춘 Y축 domain (여유 패딩 포함) */
function computeYDomain(values, { padRatio = 0.15, asPercent = false } = {}) {
  const nums = (values || [])
    .map(Number)
    .filter((v) => Number.isFinite(v))
  if (!nums.length) return asPercent ? [70, 110] : [0, 1]
  let min = Math.min(...nums)
  let max = Math.max(...nums)
  if (min === max) {
    const d = Math.max(Math.abs(min) * 0.08, asPercent ? 5 : 1)
    min -= d
    max += d
  }
  const pad = (max - min) * padRatio
  min -= pad
  max += pad
  if (asPercent) {
    // 달성률은 너무 넓게 0~120 고정하지 않고, 데이터 주변을 보여줌
    return [Math.floor(min), Math.ceil(max)]
  }
  return [min, max]
}

function collectSeriesValues(data, keys) {
  const out = []
  for (const row of data || []) {
    for (const k of keys || []) {
      const v = row?.[k]
      if (v != null && Number.isFinite(Number(v))) out.push(Number(v))
    }
  }
  return out
}

function sumAdjustActual(defs, results, month) {
  let sum = 0
  let any = false
  for (const d of defs || []) {
    if (!isAdjustDef(d)) continue
    const r = (results || []).find((x) => x.code === d.code && Number(x.month) === Number(month))
    if (r?.actual == null || r.actual === '') continue
    const n = Number(r.actual)
    if (!Number.isFinite(n)) continue
    sum += n
    any = true
  }
  return any ? Math.round(sum * 100) / 100 : null
}

/** 좌측 카드·디폴트 차트용 부문 키. 전행만 디지털(연결과 확장 아님). 행내 카테고리 변경 시 설정화 권고. */
export function vizCategoryKeys(groupName) {
  if (isBankWideGroup(groupName)) {
    return ['본원적 수익력', '건전성', '고객', '디지털']
  }
  return ['본원적 수익력', '건전성', '고객', '연결과 확장']
}

function defsForCategory(defs, category) {
  return (defs || []).filter((d) => {
    const cat = d.category || d.evalCategoryLv1 || ''
    if (cat !== category) return false
    return !isAdjustDef(d)
  })
}

function adjustDefs(defs) {
  return (defs || []).filter(isAdjustDef)
}

function alignToDefUnit(value, resultUnit, defUnit) {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const from = String(resultUnit || '').trim()
  const to = String(defUnit || '').trim()
  if (!from || !to || from === to) return n
  if (to === '원') {
    if (from === '억원') return n * 1e8
    if (from === '만원') return n * 1e4
    if (from === '천원') return n * 1e3
    if (from === '조원') return n * 1e12
  }
  return n
}

export default function GroupVizPanel({
  group,
  defs = [],
  results = [],
  selectedMonth,
  selectedYear,
  groupScore = null,
  yearGroupScores = [],
  selection = { kind: null, items: [] },
  onClearSelection,
}) {
  const catKeys = useMemo(() => vizCategoryKeys(group), [group])
  const l3Now = groupScore?.ultimate_score ?? groupScore?.ultimateScore ?? null
  const adjustNow = sumAdjustActual(adjustDefs(defs), results, selectedMonth)

  const catCards = useMemo(() => {
    return catKeys.map((cat) => ({
      key: cat,
      label: cat,
      kind: 'rate',
      value: weightedAchievement(defsForCategory(defs, cat), results, selectedMonth),
    }))
  }, [catKeys, defs, results, selectedMonth])

  const adjustCard = useMemo(() => ({
    key: '내부통제',
    label: '내부통제',
    kind: 'points',
    value: adjustNow,
  }), [adjustNow])

  const chartModel = useMemo(() => {
    const items = selection?.items || []
    const kind = selection?.kind

    // 단일 Label: 월별목표(1~12) + 월별실적(1~해당월) — 동일 단위·단일 축
    if (kind === 'leaf' && items.length === 1) {
      const def = enrichEvalConfigEntry(items[0].def || {})
      const unit = def.unit || ''
      const data = []
      for (let m = 1; m <= 12; m += 1) {
        const target = computeMonthlyTarget(def, m, selectedYear)
        const r = results.find((x) => x.code === def.code && Number(x.month) === m)
        const actual = m <= selectedMonth
          ? alignToDefUnit(r?.actual, r?.unit, def.unit)
          : null
        data.push({
          month: `${m}월`,
          월별목표: target != null && Number.isFinite(Number(target)) ? Number(target) : null,
          월별실적: actual != null && Number.isFinite(Number(actual)) ? Number(actual) : null,
        })
      }
      return {
        mode: 'single-leaf',
        title: `${evalLabel(def)} · 월별목표 / 월별실적`,
        data,
        series: [
          { key: '월별목표', name: '월별목표', color: '#94a3b8', yAxisId: 'metric' },
          { key: '월별실적', name: '월별실적', color: '#0b57d0', yAxisId: 'metric' },
        ],
        dualAxis: false,
        unitHint: 'metric',
        metricUnit: unit,
      }
    }

    // 복수 Label / L1 / L2 / L3: 1~해당월 달성률
    if (kind && items.length >= 1) {
      const series = items.map((it, idx) => ({
        key: it.key,
        label: it.label,
        color: CHART_COLORS[idx % CHART_COLORS.length],
        defs: it.defs || (it.def ? [it.def] : []),
        isAdjust: Boolean(it.isAdjustOnly),
      }))
      const data = []
      for (let m = 1; m <= selectedMonth; m += 1) {
        const row = { month: `${m}월` }
        series.forEach((s) => {
          if (s.isAdjust) {
            row[s.key] = sumAdjustActual(s.defs, results, m)
          } else if (kind === 'leaf') {
            const r = results.find((x) => x.code === s.key && Number(x.month) === m)
            row[s.key] = r?.achievement != null ? round1(r.achievement) : null
          } else {
            row[s.key] = weightedAchievement(s.defs.filter((d) => !isAdjustDef(d)), results, m)
          }
        })
        data.push(row)
      }
      const unitHint = series.every((s) => s.isAdjust) ? '점' : '%'
      return {
        mode: 'selection',
        title: `${kindLabel(kind)} 선택 (${items.length}) · 1~${selectedMonth}월`,
        data,
        series: series.map((s) => ({ key: s.key, name: s.label, color: s.color, yAxisId: 'metric' })),
        dualAxis: false,
        unitHint,
      }
    }

    // 디폴트: L3 + 카테고리 달성률 (내부통제 제외)
    const series = [
      { key: '__l3__', name: '종합달성률', color: CHART_COLORS[0] },
      ...catKeys.map((cat, i) => ({
        key: cat,
        name: cat,
        color: CHART_COLORS[(i + 1) % CHART_COLORS.length],
      })),
    ]
    const scoreByMonth = new Map((yearGroupScores || []).map((r) => [Number(r.month), r]))
    const data = []
    for (let m = 1; m <= selectedMonth; m += 1) {
      const score = scoreByMonth.get(m)
      const row = {
        month: `${m}월`,
        __l3__: score?.ultimate_score != null ? round1(score.ultimate_score) : null,
      }
      catKeys.forEach((cat) => {
        row[cat] = weightedAchievement(defsForCategory(defs, cat), results, m)
      })
      data.push(row)
    }
    return {
      mode: 'default',
      title: `종합·부문 달성률 · 1~${selectedMonth}월`,
      data,
      series: series.map((s) => ({ key: s.key, name: s.name, color: s.color, yAxisId: 'metric' })),
      dualAxis: false,
      unitHint: '%',
    }
  }, [selection, defs, results, selectedMonth, selectedYear, catKeys, yearGroupScores])

  const axisDomains = useMemo(() => {
    const keys = (chartModel.series || []).map((s) => s.key)
    const vals = collectSeriesValues(chartModel.data, keys)
    const asPercent = chartModel.unitHint === '%'
    return {
      metric: computeYDomain(vals, { padRatio: 0.15, asPercent }),
    }
  }, [chartModel])

  const yTickFormatter = (v) => {
    if (chartModel.unitHint === 'metric') {
      return formatMetricNumber(v, chartModel.metricUnit || '').display
    }
    if (chartModel.unitHint === '점') return `${Number(v).toFixed(1)}`
    return `${Number(v).toFixed(0)}%`
  }

  return (
    <div className="grid grid-cols-1 gap-3 border-b border-slate-200 bg-[#f7f9fc] p-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <div className="flex min-h-[220px] min-w-0 flex-col gap-2.5">
        {/* 종합달성률 히어로 */}
        <div
          className="relative overflow-hidden rounded-2xl px-5 py-4 text-white shadow-sm"
          style={{
            background: 'linear-gradient(135deg, #0b2f6f 0%, #123f8a 55%, #0b57d0 100%)',
          }}
        >
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.12]"
            style={{
              backgroundImage: 'radial-gradient(circle at 20% 20%, #fff 0.6px, transparent 0.8px)',
              backgroundSize: '10px 10px',
            }}
          />
          <div className="relative flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold tracking-wide text-blue-100/90">종합달성률</p>
              <p className={`mt-1.5 text-[34px] font-black leading-none tabular-nums ${l3Now == null ? 'text-blue-200/70' : 'text-white'}`}>
                {l3Now == null ? '—' : `${Number(l3Now).toFixed(2)}%`}
              </p>
              <p className="mt-2 text-[10px] font-medium text-blue-100/75">
                {selectedYear}년 {selectedMonth}월
              </p>
            </div>
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/10">
              <Target className="h-7 w-7 text-white/80" strokeWidth={1.75} />
            </div>
          </div>
        </div>

        {/* 핵심 4개 부문 — 주 카드 */}
        <div className="grid grid-cols-2 gap-2">
          {catCards.map((card) => {
            const meta = CAT_CARD_META[card.key] || CAT_CARD_META['본원적 수익력']
            const Icon = meta.Icon
            const empty = card.value == null || !Number.isFinite(Number(card.value))
            return (
              <div
                key={card.key}
                className="flex items-center gap-2.5 rounded-xl border bg-white px-3 py-2.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
                style={{ borderColor: meta.border }}
              >
                <div
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                  style={{ background: meta.soft, color: meta.color }}
                >
                  <Icon className="h-4 w-4" strokeWidth={2.25} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[10px] font-semibold text-slate-500">{card.label}</p>
                  <p
                    className="mt-0.5 text-[16px] font-black tabular-nums leading-tight"
                    style={{ color: empty ? '#94a3b8' : meta.color }}
                  >
                    {empty ? '—' : `${Number(card.value).toFixed(2)}%`}
                  </p>
                </div>
              </div>
            )
          })}
        </div>

        {/* 내부통제 — 보조 스트립 (시각적 차등) */}
        <div className="flex items-center justify-between gap-3 rounded-md border border-dashed border-slate-200 bg-slate-50/90 px-3 py-1">
          <p className="truncate text-[11px] font-semibold text-slate-600">{adjustCard.label}</p>
          <p className={`shrink-0 text-[12px] font-bold tabular-nums ${
            adjustCard.value == null
              ? 'text-slate-400'
              : Number(adjustCard.value) > 0
                ? 'text-emerald-600'
                : Number(adjustCard.value) < 0
                  ? 'text-rose-600'
                  : 'text-slate-600'
          }`}>
            {adjustCard.value == null
              ? '—'
              : `${Number(adjustCard.value) > 0 ? '+' : ''}${Number(adjustCard.value).toFixed(2)}점`}
          </p>
        </div>
      </div>

      <div className="flex min-h-[220px] min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[11px] font-bold text-slate-800" title={chartModel.title}>{chartModel.title}</p>
            <p className="text-[9px] text-slate-400">
              {selection?.items?.length
                ? '동일 레벨만 복수 선택 · 다시 클릭하면 해제'
                : '트리에서 행을 선택하면 그래프가 바뀝니다'}
            </p>
          </div>
          {selection?.items?.length > 0 && (
            <button
              type="button"
              onClick={onClearSelection}
              className="shrink-0 rounded-md border border-slate-200 bg-white px-2 py-1 text-[9px] font-semibold text-slate-600 hover:bg-slate-50"
            >
              선택 해제
            </button>
          )}
        </div>
        <div className="h-[200px] w-full min-w-0 overflow-hidden">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={chartModel.data}
              margin={{ top: 8, right: 16, left: 8, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#64748b' }} />
              <YAxis
                yAxisId="metric"
                domain={axisDomains.metric}
                tick={{ fontSize: 9, fill: '#64748b' }}
                width={chartModel.unitHint === 'metric' ? 56 : 44}
                tickFormatter={yTickFormatter}
                allowDataOverflow
              />
              <Tooltip
                content={(
                  <VizTooltip
                    unitHint={chartModel.unitHint}
                    metricUnit={chartModel.metricUnit}
                  />
                )}
              />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {chartModel.series.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  name={s.name || s.key}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={{ r: 2.5 }}
                  connectNulls
                  yAxisId="metric"
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  )
}

function kindLabel(kind) {
  if (kind === 'l1') return 'L1'
  if (kind === 'l2') return 'L2'
  if (kind === 'l3') return 'L3'
  if (kind === 'leaf') return 'Label'
  return kind || ''
}

function VizTooltip({ active, payload, label, unitHint, metricUnit }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] shadow-sm">
      <p className="mb-1 font-bold text-slate-700">{label}</p>
      {payload.map((p) => {
        let display = '—'
        if (p.value != null && Number.isFinite(Number(p.value))) {
          if (unitHint === 'metric') {
            display = formatMetricNumber(p.value, metricUnit || '', { withUnit: true }).display
          } else if (unitHint === '점') {
            display = `${Number(p.value).toFixed(2)}점`
          } else {
            display = `${Number(p.value).toFixed(2)}%`
          }
        }
        return (
          <p key={p.dataKey} className="tabular-nums text-slate-600">
            <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
            {p.name}: {display}
          </p>
        )
      })}
    </div>
  )
}

import { useMemo } from 'react'
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { BarChart3, Info, ShieldCheck, UsersRound, Network, Cpu } from 'lucide-react'
import { formatMetricNumber, formatPercentFixed } from '../lib/numberFormat'
import { isBankWideGroup } from '../lib/authService'

const CATEGORY_META = {
  '본원적 수익력': { color: '#2563eb', soft: '#eff6ff', icon: BarChart3 },
  '건전성': { color: '#f59e0b', soft: '#fffbeb', icon: ShieldCheck },
  '고객': { color: '#2563eb', soft: '#eff6ff', icon: UsersRound },
  '연결과 확장': { color: '#0d9488', soft: '#f0fdfa', icon: Network },
  '디지털': { color: '#7c3aed', soft: '#f5f3ff', icon: Cpu },
  '재무': { color: '#2563eb', soft: '#eff6ff', icon: BarChart3 },
  '전략': { color: '#ef4444', soft: '#fef2f2', icon: Network },
}

/** Heat Map 고정 열. 전행 행·내부통제·디지털 열은 넣지 않음(상단 전행 카드가 담당). */
const HEATMAP_COLUMNS = [
  { key: '__l3__', label: '종합달성률', kind: 'l3' },
  { key: '본원적 수익력', label: '본원적 수익력', kind: 'category' },
  { key: '건전성', label: '건전성', kind: 'category' },
  { key: '고객', label: '고객', kind: 'category' },
  { key: '연결과 확장', label: '연결과 확장', kind: 'category' },
]

const DISTRIBUTION_META = [
  { key: 'normal', label: '정상', color: '#0284c7' },
  { key: 'attention', label: '관찰', color: '#059669' },
  { key: 'caution', label: '주의', color: '#d97706' },
  { key: 'poor', label: '부진', color: '#e11d48' },
]

const fmt = (value, digits = 2) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Number(n.toFixed(digits))
}

const signed = (value) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0.00%p'
  const prefix = n > 0 ? '+' : '△'
  return `${prefix}${Math.abs(n).toFixed(2)}%p`
}

const achColor = (value) => {
  if (value == null || !Number.isFinite(Number(value))) return '#94a3b8'
  const n = Number(value)
  if (n >= 95) return '#0284c7' // 정상
  if (n >= 85) return '#059669' // 관찰
  if (n >= 70) return '#d97706' // 주의
  return '#e11d48' // 부진
}

const statusLabel = (value) => {
  if (value == null || !Number.isFinite(Number(value))) return '—'
  const n = Number(value)
  if (n >= 95) return '정상'
  if (n >= 85) return '관찰'
  if (n >= 70) return '주의'
  return '부진'
}

const statusClass = (value) => {
  const n = Number(value)
  if (n >= 95) return 'bg-sky-600 text-white'
  if (n >= 85) return 'bg-emerald-600 text-white'
  if (n >= 70) return 'bg-amber-500 text-white'
  return 'bg-rose-600 text-white'
}

const getMetricName = (def) => def?.label || def?.name || def?.code || ''
const shortGroup = (name = '') => name.replace(/그룹$/, '').replace(/본부$/, '').trim()

export default function DashboardView({
  groupSummaries,
  categories,
  definitions = [],
  results = [],
  prevDefinitions = [],
  prevResults = [],
  bankScore = null,
  prevBankScore = null,
  selectedMonth,
  selectedYear,
  onGroupClick,
}) {
  // 상단 종합·부문카드·분포는 '전행' 그룹만 (타 그룹 Lv1이 전행 KPI로 섞이지 않게)
  const bankDefinitions = useMemo(() => {
    const bank = definitions.filter((d) => isBankWideGroup(d.group))
    return bank.length ? bank : definitions
  }, [definitions])

  const bankPrevDefinitions = useMemo(() => {
    const source = (prevDefinitions || []).length ? prevDefinitions : definitions
    const bank = source.filter((d) => isBankWideGroup(d.group))
    return bank.length ? bank : source
  }, [prevDefinitions, definitions])

  const bankCategories = useMemo(() => {
    const cats = [...new Set(bankDefinitions.map((d) => d.category).filter(Boolean))]
    return cats.length ? cats : categories
  }, [bankDefinitions, categories])

  const findPrevMonthResult = (code) => {
    if (selectedMonth <= 1) {
      return (prevResults || []).find((r) => r.code === code && Number(r.month) === 12)
    }
    return (results || []).find((r) => r.code === code && Number(r.month) === selectedMonth - 1)
  }

  const weightedAvgFor = (defs, sourceResults, month) => {
    let weighted = 0
    let weight = 0
    let simpleSum = 0
    let simpleCount = 0
    ;(defs || []).forEach((def) => {
      const result = (sourceResults || []).find((r) => (
        r.code === def.code
        && Number(r.month) === Number(month)
        && (!r.group || !def.group || r.group === def.group)
      ))
      if (result?.achievement == null) return
      const ach = Number(result.achievement)
      if (!Number.isFinite(ach)) return
      const w = Number(def.weight) || 0
      if (w > 0) {
        weighted += ach * w
        weight += w
      } else {
        simpleSum += ach
        simpleCount += 1
      }
    })
    if (weight > 0) return fmt(weighted / weight)
    if (simpleCount > 0) return fmt(simpleSum / simpleCount)
    return null
  }

  const currentRows = useMemo(() => bankDefinitions
    .map(def => {
      const result = results.find(r => r.code === def.code && r.month === selectedMonth)
      const prevResult = findPrevMonthResult(def.code)
      if (!result || result.achievement == null) return null
      return {
        def,
        code: def.code,
        name: getMetricName(def),
        group: def.group,
        category: def.category,
        actual: result.actual,
        target: result.target,
        unit: def.unit || '',
        achievement: Number(result.achievement),
        prevAchievement: prevResult?.achievement == null ? null : Number(prevResult.achievement),
        diff: prevResult?.achievement == null ? null : Number(result.achievement) - Number(prevResult.achievement),
      }
    })
    .filter(Boolean), [bankDefinitions, results, prevResults, selectedMonth])

  const hasAchievementData = currentRows.length > 0

  const overallAvg = useMemo(() => {
    // 지표 실적이 없으면 그룹점수만으로 종합을 보여주지 않음 (배치/실적 없음과 모순)
    if (!hasAchievementData) return null
    // 전행 종합 = SHB L1 (base_score)
    if (bankScore?.base_score != null && Number.isFinite(Number(bankScore.base_score))) {
      return fmt(bankScore.base_score)
    }
    const fromDefs = weightedAvgFor(bankDefinitions, results, selectedMonth)
    if (fromDefs != null) return fromDefs
    const bankSummary = groupSummaries.find((g) => isBankWideGroup(g.name))
    if (bankSummary) return fmt(bankSummary.wavg)
    const total = groupSummaries.reduce((sum, group) => sum + group.wavg, 0)
    return groupSummaries.length ? fmt(total / groupSummaries.length) : null
  }, [bankScore, hasAchievementData, bankDefinitions, results, selectedMonth, groupSummaries])

  const prevOverallAvg = useMemo(() => {
    if (selectedMonth <= 1) {
      return weightedAvgFor(bankPrevDefinitions, prevResults, 12)
    }
    return weightedAvgFor(bankDefinitions, results, selectedMonth - 1)
  }, [selectedMonth, bankPrevDefinitions, prevResults, bankDefinitions, results])

  const yoyOverallAvg = useMemo(() => {
    if (prevBankScore?.base_score != null && Number.isFinite(Number(prevBankScore.base_score))) {
      return fmt(prevBankScore.base_score)
    }
    const fromPrevPlan = weightedAvgFor(bankPrevDefinitions, prevResults, selectedMonth)
    if (fromPrevPlan != null) return fromPrevPlan
    return weightedAvgFor(bankDefinitions, prevResults, selectedMonth)
  }, [prevBankScore, bankPrevDefinitions, bankDefinitions, prevResults, selectedMonth])

  const momDelta = overallAvg == null || prevOverallAvg == null ? null : overallAvg - prevOverallAvg
  const yoyDelta = overallAvg == null || yoyOverallAvg == null ? null : overallAvg - yoyOverallAvg

  const categoryCards = useMemo(() => bankCategories.map(category => {
    const rows = currentRows.filter(row => row.category === category)
    if (!rows.length) return null
    const avg = fmt(rows.reduce((sum, row) => sum + row.achievement, 0) / rows.length)
    const diffRows = rows.filter(row => row.prevAchievement != null && row.diff != null)
    const diff = diffRows.length ? fmt(diffRows.reduce((sum, row) => sum + row.diff, 0) / diffRows.length, 2) : null
    return { category, avg, diff, count: rows.length }
  }).filter(Boolean), [bankCategories, currentRows])

  const distribution = useMemo(() => {
    const total = currentRows.length || 1
    const counts = currentRows.reduce((acc, row) => {
      if (row.achievement >= 95) acc.normal += 1
      else if (row.achievement >= 85) acc.attention += 1
      else if (row.achievement >= 70) acc.caution += 1
      else acc.poor += 1
      return acc
    }, { normal: 0, attention: 0, caution: 0, poor: 0 })
    return DISTRIBUTION_META.map(item => ({
      ...item,
      value: counts[item.key],
      percent: Math.round((counts[item.key] / total) * 100),
    }))
  }, [currentRows])

  const trendData = useMemo(() => {
    const monthCount = Math.max(selectedMonth, 1)
    return Array.from({ length: monthCount }, (_, idx) => {
      const month = idx + 1
      const row = { month: `${selectedYear}.${String(month).padStart(2, '0')}` }
      bankCategories.forEach(category => {
        const defs = bankDefinitions.filter(def => def.category === category)
        let weighted = 0
        let weight = 0
        defs.forEach(def => {
          const result = results.find(r => (
            r.code === def.code
            && Number(r.month) === month
            && (!r.group || r.group === def.group)
          ))
          if (result?.achievement == null) return
          const w = Number(def.weight) || 0
          weighted += Number(result.achievement) * w
          weight += w
        })
        if (weight > 0) {
          row[category] = fmt(weighted / weight)
        } else {
          // 비중 0만 있으면 단순평균
          const vals = defs.map(def => {
            const result = results.find(r => (
              r.code === def.code
              && Number(r.month) === month
              && (!r.group || r.group === def.group)
            ))
            return result?.achievement == null ? null : Number(result.achievement)
          }).filter(v => v != null && Number.isFinite(v))
          row[category] = vals.length ? fmt(vals.reduce((a, b) => a + b, 0) / vals.length) : null
        }
      })
      return row
    })
  }, [bankCategories, bankDefinitions, results, selectedMonth, selectedYear])

  const trendYDomain = useMemo(() => {
    let min = Infinity
    let max = -Infinity
    for (const row of trendData) {
      for (const cat of bankCategories) {
        const v = Number(row[cat])
        if (!Number.isFinite(v)) continue
        if (v < min) min = v
        if (v > max) max = v
      }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [80, 120]
    if (min === max) {
      const mid = Math.round(min)
      return [mid - 10, mid + 10]
    }
    const lo = Math.floor((min - 3) / 5) * 5
    const hi = Math.ceil((max + 3) / 5) * 5
    return [lo, Math.max(lo + 15, hi)]
  }, [trendData, bankCategories])

  const trendYTicks = useMemo(() => {
    const [lo, hi] = trendYDomain
    const span = hi - lo
    const rawStep = span / 4
    const step = rawStep <= 5 ? 5 : rawStep <= 10 ? 10 : 15
    const ticks = []
    for (let v = lo; v <= hi + 0.001; v += step) ticks.push(Math.round(v))
    if (ticks[ticks.length - 1] !== hi) ticks.push(hi)
    return ticks
  }, [trendYDomain])

  const weakRows = useMemo(() => [...currentRows]
    .sort((a, b) => a.achievement - b.achievement)
    .slice(0, 10), [currentRows])

  const movementRows = useMemo(() => {
    const rows = currentRows.filter(row => row.prevAchievement != null && row.diff != null)
    return {
      top: [...rows].sort((a, b) => b.diff - a.diff).slice(0, 5),
      bottom: [...rows].sort((a, b) => a.diff - b.diff).slice(0, 5),
    }
  }, [currentRows])

  return (
    <div className="space-y-4 bg-[#f7f9fc] pb-4 text-slate-900">
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-black tracking-tight text-slate-950">은행 KPI 종합 현황</h1>
        <Info className="h-4 w-4 text-slate-400" />
      </div>

      <section className="grid grid-cols-12 gap-3">
        <div className="col-span-4 rounded-xl bg-[#0b57d0] p-5 text-white shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-sm font-black">종합 달성률</p>
                <Info className="h-3.5 w-3.5 text-blue-100" />
              </div>
              <div className="mt-4 flex items-center gap-3">
                <p className="text-4xl font-black leading-none tabular-nums">
                  {overallAvg == null ? '—' : `${overallAvg}%`}
                </p>
                {overallAvg != null && (
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${statusClass(overallAvg)}`}>
                    {statusLabel(overallAvg)}
                  </span>
                )}
              </div>
              <p className="mt-3 text-xs font-bold text-blue-100">
                전월 대비&nbsp;{' '}
                {momDelta == null ? '—' : signed(momDelta)}
              </p>
              {!hasAchievementData && (
                <p className="mt-2 text-[11px] font-semibold text-blue-100/90">
                  {selectedYear}년 {selectedMonth}월 평가배치·실적이 없어 집계할 지표가 없습니다.
                  {results?.some((r) => Number(r.month) !== Number(selectedMonth) && r.achievement != null)
                    ? ' 다른 월은 추이 차트에 표시됩니다.'
                    : ''}
                </p>
              )}
            </div>
            <div className="flex h-20 w-20 items-center justify-center rounded-full border border-white/15 bg-white/10">
              <ShieldCheck className="h-12 w-12 text-white/40" />
            </div>
          </div>
        </div>

        <DeltaCard title="전월대비" value={momDelta} />
        <DeltaCard title="전년동기비" value={yoyDelta} />

        <div className="col-span-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-1 flex items-center gap-1.5">
            <p className="text-sm font-black">지표별 달성률 분포</p>
            <Info className="h-3.5 w-3.5 text-slate-400" />
          </div>
          <div className="grid grid-cols-[145px_1fr] items-center gap-2">
            <div className="relative h-[108px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={distribution} dataKey="value" innerRadius={33} outerRadius={50} paddingAngle={2}>
                    {distribution.map(item => <Cell key={item.key} fill={item.color} />)}
                  </Pie>
                  <Tooltip content={<DistributionTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-1">
                <span className="text-[10px] font-bold text-slate-500">전체</span>
                <span className="text-lg font-black tabular-nums">{currentRows.length}개</span>
              </div>
            </div>
            <div className="space-y-1.5">
              {distribution.map(item => (
                <div key={item.key} className="grid grid-cols-[52px_32px_1fr] items-center gap-2 text-xs">
                  <span className="flex items-center gap-1.5 font-bold text-slate-600">
                    <i className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} />
                    {item.label}
                  </span>
                  <span className="text-right font-black tabular-nums text-slate-800">{item.value}</span>
                  <span className="font-bold text-slate-400">({item.percent}%)</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-4 gap-3">
        {categoryCards.map(card => (
          <CategoryCard key={card.category} card={card} />
        ))}
      </section>

      <section className="grid grid-cols-12 items-stretch gap-3">
        <Panel className="col-span-5 flex flex-col">
          <PanelTitle title="부문별 달성률 추이" />
          <div className="mt-2 flex min-h-[260px] flex-1 flex-col min-w-0">
            <div className="relative min-h-[200px] flex-1">
              <div className="absolute inset-0">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 8, right: 10, left: 0, bottom: 4 }}>
                    <CartesianGrid stroke="#e5e7eb" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      tickLine={false}
                      axisLine={false}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      domain={trendYDomain}
                      ticks={trendYTicks}
                      tickFormatter={(value) => `${Math.round(Number(value))}%`}
                      tick={{ fontSize: 10, fill: '#64748b' }}
                      tickLine={false}
                      axisLine={false}
                      width={44}
                      allowDecimals={false}
                    />
                    <Tooltip content={<TrendTooltip />} />
                    {bankCategories.slice(0, 4).map(category => (
                      <Line
                        key={category}
                        type="monotone"
                        dataKey={category}
                        name={category}
                        stroke={CATEGORY_META[category]?.color ?? '#2563eb'}
                        strokeWidth={2.2}
                        dot={{ r: 2.5 }}
                        activeDot={{ r: 5 }}
                        connectNulls
                        isAnimationActive={false}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
              {bankCategories.slice(0, 4).map((category) => (
                <span key={category} className="inline-flex items-center gap-1.5 text-[10px] font-bold text-slate-600">
                  <i className="inline-block h-0.5 w-3 rounded-full" style={{ background: CATEGORY_META[category]?.color ?? '#2563eb' }} />
                  {category}
                </span>
              ))}
            </div>
          </div>
        </Panel>

        <Panel className="col-span-4 flex flex-col">
          <PanelTitle title="주의 · 부진지표 리스트" />
          <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200">
            <div className="grid shrink-0 grid-cols-[44px_minmax(0,1.4fr)_64px_54px_62px] gap-x-1 border-b border-slate-200 bg-slate-50 px-1.5 py-1 text-[10px] font-semibold text-slate-500">
              <span className="text-center">구분</span>
              <span>지표명</span>
              <span className="text-right">실적</span>
              <span className="text-right">달성률</span>
              <span className="text-right">전월비</span>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              {weakRows.map((row) => (
                <div
                  key={row.code}
                  className="grid min-h-[26px] flex-1 grid-cols-[44px_minmax(0,1.4fr)_64px_54px_62px] items-center gap-x-1 border-b border-slate-100 px-1.5 text-[11px] last:border-b-0"
                >
                  <span className="flex justify-center">
                    <span className={`inline-flex items-center justify-center whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-black leading-none ${statusClass(row.achievement)}`}>
                      {statusLabel(row.achievement)}
                    </span>
                  </span>
                  <span className="truncate font-bold text-slate-700" title={row.name}>{row.name}</span>
                  <span className="truncate text-right tabular-nums text-slate-600" title={formatMetricNumber(row.actual, row.unit).title}>
                    {formatMetricNumber(row.actual, row.unit).display}
                  </span>
                  <span className="text-right font-black tabular-nums" style={{ color: achColor(row.achievement) }}>
                    {formatPercentFixed(row.achievement)}
                  </span>
                  <span className="text-right font-bold tabular-nums" style={{ color: row.diff >= 0 ? '#059669' : '#dc2626' }}>
                    {row.prevAchievement == null ? '—' : signed(row.diff)}
                  </span>
                </div>
              ))}
              {weakRows.length === 0 && (
                <div className="flex flex-1 items-center justify-center text-xs text-slate-400">표시할 지표가 없습니다.</div>
              )}
            </div>
          </div>
        </Panel>

        <Panel className="col-span-3 flex flex-col">
          <PanelTitle title="전월대비 달성률 급등락 지표" />
          <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2">
            <MovementList title="급등 지표 Top 5" rows={movementRows.top} tone="up" />
            <MovementList title="급락 지표 Bottom 5" rows={movementRows.bottom} tone="down" />
          </div>
        </Panel>
      </section>

      <Panel>
        <PanelTitle title="그룹 KPI Heat Map" />
        <div className="mt-3 overflow-x-auto">
          <div className="min-w-[850px] overflow-hidden rounded-lg border border-slate-200">
            <div
              className="grid bg-[#0b2f6f] text-white"
              style={{ gridTemplateColumns: `150px repeat(${HEATMAP_COLUMNS.length}, minmax(105px, 1fr))` }}
            >
              <div className="px-3 py-2 text-center text-xs font-black">구분</div>
              {HEATMAP_COLUMNS.map((col) => (
                <div key={col.key} className="border-l border-white/10 px-3 py-2 text-center text-xs font-black">
                  {col.label}
                </div>
              ))}
            </div>
            {groupSummaries
              .filter((group) => !isBankWideGroup(group.name))
              .map((group) => (
              <div
                key={group.name}
                className="grid border-t border-slate-200 bg-white"
                style={{ gridTemplateColumns: `150px repeat(${HEATMAP_COLUMNS.length}, minmax(105px, 1fr))` }}
              >
                <button onClick={() => onGroupClick(group.name)} className="bg-slate-50 px-3 py-2 text-left text-xs font-black text-slate-700 hover:text-blue-700">
                  {shortGroup(group.name)}
                </button>
                {HEATMAP_COLUMNS.map((col) => {
                  const value = col.kind === 'l3'
                    ? (group.ultimateScore ?? group.wavg)
                    : group.catAchs?.[col.key]
                  const empty = value == null || !Number.isFinite(Number(value))
                  return (
                    <button
                      key={col.key}
                      onClick={() => onGroupClick(group.name)}
                      className="border-l border-slate-100 px-3 py-2 text-center text-xs font-black hover:ring-2 hover:ring-inset hover:ring-blue-300"
                      style={{ background: heatBg(empty ? null : value), color: heatText(empty ? null : value) }}
                    >
                      {empty ? '—' : `${Number(value).toFixed(2)}%`}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </div>
  )
}

function Panel({ children, className = '' }) {
  return (
    <section className={`min-w-0 h-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {children}
    </section>
  )
}

function PanelTitle({ title }) {
  return (
    <div className="flex items-center gap-1.5">
      <h2 className="text-sm font-black text-slate-900">{title}</h2>
      <Info className="h-3.5 w-3.5 text-slate-400" />
    </div>
  )
}

function DeltaCard({ title, value }) {
  const empty = value == null || !Number.isFinite(Number(value))
  const up = !empty && value >= 0
  return (
    <div className="col-span-2 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-sm font-black text-slate-700">{title}</p>
      <p className={`mt-8 text-2xl font-black tabular-nums ${empty ? 'text-slate-400' : up ? 'text-emerald-600' : 'text-red-600'}`}>
        {empty ? '—' : signed(value)}
      </p>
    </div>
  )
}

function CategoryCard({ card }) {
  const meta = CATEGORY_META[card.category] ?? CATEGORY_META['본원적 수익력']
  const Icon = meta.icon
  const empty = !card.count
  const hasDiff = card.diff != null && Number.isFinite(Number(card.diff))
  const up = hasDiff && card.diff >= 0
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-black text-slate-800">{card.category}</p>
            <Info className="h-3.5 w-3.5 text-slate-400" />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <p className="text-2xl font-black tabular-nums" style={{ color: empty ? '#94a3b8' : achColor(card.avg) }}>
              {empty ? '—' : `${card.avg}%`}
            </p>
            {!empty && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${statusClass(card.avg)}`}>
                {statusLabel(card.avg)}
              </span>
            )}
          </div>
          <p className="mt-2 flex items-center gap-1 text-[11px] font-bold text-slate-500">
            전월 대비
            {!hasDiff ? (
              <span className="text-slate-400">—</span>
            ) : (
              <span className={up ? 'text-emerald-600' : 'text-red-600'}>{signed(card.diff)}</span>
            )}
          </p>
        </div>
        <div className="flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: meta.soft, color: meta.color }}>
          <Icon className="h-7 w-7" />
        </div>
      </div>
    </div>
  )
}

function MovementList({ title, rows, tone }) {
  const up = tone === 'up'
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <p className={`mb-1.5 flex shrink-0 items-center gap-1 text-xs font-black ${up ? 'text-emerald-700' : 'text-red-700'}`}>
        {up ? '+' : '△'} {title}
      </p>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200">
        <div className="grid shrink-0 grid-cols-[minmax(0,1.5fr)_54px_62px] gap-x-1 border-b border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold text-slate-500">
          <span className="text-center">지표명</span>
          <span className="text-right">달성률</span>
          <span className="text-right">전월비</span>
        </div>
        <div className="flex min-h-0 flex-1 flex-col">
          {rows.map(row => (
            <div
              key={`${title}-${row.code}`}
              className="grid min-h-[24px] flex-1 grid-cols-[minmax(0,1.5fr)_54px_62px] items-center gap-x-1 border-b border-slate-100 px-2 text-[11px] last:border-b-0"
            >
              <span className="truncate font-bold text-slate-700" title={row.name}>{row.name}</span>
              <span className="text-right font-black tabular-nums">{formatPercentFixed(row.achievement)}</span>
              <span className={`text-right font-black tabular-nums ${row.diff >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{signed(row.diff)}</span>
            </div>
          ))}
          {rows.length === 0 && (
            <div className="flex flex-1 items-center justify-center text-[11px] text-slate-400">없음</div>
          )}
        </div>
      </div>
    </div>
  )
}

function DistributionTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const item = payload[0].payload
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-black text-slate-800">{item.label}</p>
      <p className="font-bold" style={{ color: item.color }}>{item.value}개 ({item.percent}%)</p>
    </div>
  )
}

function TrendTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-black text-slate-800">{label}</p>
      {payload.map(item => (
        <p key={item.dataKey} className="font-bold" style={{ color: item.color }}>
          {item.dataKey}: {item.value ?? '-'}%
        </p>
      ))}
    </div>
  )
}

function formatActual(value, unit = '') {
  return formatMetricNumber(value, unit).display
}

function heatBg(value) {
  if (value == null || !Number.isFinite(Number(value))) return '#f8fafc'
  if (value >= 95) return '#e0f2fe' // 정상 = 파랑
  if (value >= 85) return '#ecfdf5' // 관찰 = 초록
  if (value >= 70) return '#ffedd5'
  return '#fee2e2'
}

function heatText(value) {
  if (value == null || !Number.isFinite(Number(value))) return '#94a3b8'
  if (value >= 95) return '#0369a1' // 정상 = 파랑
  if (value >= 85) return '#047857' // 관찰 = 초록
  if (value >= 70) return '#c2410c'
  return '#be123c'
}

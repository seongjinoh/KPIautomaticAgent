import { useMemo, useState } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  ReferenceLine, LabelList,
} from 'recharts'

const CAT_META = {
  '본원적 수익력': { color: '#6366f1', gradient: ['#818cf8', '#4f46e5'], icon: '💰' },
  '건전성':        { color: '#10b981', gradient: ['#34d399', '#059669'], icon: '🛡️' },
  '고객':          { color: '#f59e0b', gradient: ['#fbbf24', '#d97706'], icon: '👥' },
  '연결과 확장':   { color: '#ef4444', gradient: ['#f87171', '#dc2626'], icon: '🔗' },
  '재무':          { color: '#6366f1', gradient: ['#818cf8', '#4f46e5'], icon: '💰' },
  '전략':          { color: '#ef4444', gradient: ['#f87171', '#dc2626'], icon: '🎯' },
}

const achColor = (v) => v >= 100 ? '#10b981' : v >= 90 ? '#3b82f6' : v >= 80 ? '#f59e0b' : '#ef4444'
const achBg = (v) => v >= 100 ? 'bg-emerald-50 border-emerald-200' : v >= 90 ? 'bg-blue-50 border-blue-200' : v >= 80 ? 'bg-amber-50 border-amber-200' : 'bg-rose-50 border-rose-200'

export default function DashboardView({
  groupSummaries,
  bankKpiSummary,
  categories,
  selectedMonth,
  selectedYear,
  onGroupClick,
}) {
  const is2026 = selectedYear === 2026
  const [selectedCat, setSelectedCat] = useState(null)

  const groupCatAvg = useMemo(() =>
    categories.map(cat => {
      const avg = groupSummaries.reduce((s, g) => s + (g.catAchs?.[cat] ?? 0), 0) / groupSummaries.length
      return { category: cat, avg: Math.round(avg * 10) / 10 }
    }), [groupSummaries, categories])

  const overallAvg = useMemo(() => {
    const total = groupSummaries.reduce((s, g) => s + g.wavg, 0)
    return groupSummaries.length ? Math.round(total / groupSummaries.length * 10) / 10 : 0
  }, [groupSummaries])

  const bankOverallAvg = useMemo(() => {
    if (!bankKpiSummary?.length) return 0
    const sum = bankKpiSummary.reduce((s, b) => s + b.achievement, 0)
    return Math.round(sum / bankKpiSummary.length * 10) / 10
  }, [bankKpiSummary])

  const chartData = useMemo(() =>
    groupSummaries.map(g => ({
      name: g.name.replace(/그룹$/, '').trim(),
      fullName: g.name,
      달성률: selectedCat ? (g.catAchs?.[selectedCat] ?? 0) : g.wavg,
    })), [groupSummaries, selectedCat])

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-400">{selectedYear}년 {selectedMonth}월 기준</p>

      {/* ━━ 1행: 은행KPI 종합 + 부문별 (2026 전용) ━━ */}
      {is2026 && (
        <section>
          <SectionHeader title="은행 KPI" />
          <div className="grid grid-cols-5 gap-3">
            {/* 종합 */}
            <SummaryCard label="종합 달성률" value={bankOverallAvg} accent="#0f172a" large />
            {/* 부문별 */}
            {bankKpiSummary.map(({ category, achievement }) => {
              const meta = CAT_META[category] ?? CAT_META['본원적 수익력']
              return (
                <SummaryCard key={category} label={category} value={achievement}
                  accent={meta.color} icon={meta.icon} gradient={meta.gradient} />
              )
            })}
          </div>
        </section>
      )}

      {/* ━━ 2행: 그룹KPI 평균 종합 + 부문별 ━━ */}
      <section>
        <SectionHeader title="그룹 KPI 평균" sub={is2026 ? `${groupSummaries.length}개 그룹` : '25년 체계'} />
        <div className="grid grid-cols-5 gap-3">
          <SummaryCard label="종합 달성률" value={overallAvg} accent="#0f172a" large
            onClick={() => setSelectedCat(null)}
            active={selectedCat === null} />
          {groupCatAvg.map(({ category, avg }) => {
            const meta = CAT_META[category] ?? CAT_META['본원적 수익력']
            const isActive = selectedCat === category
            return (
              <SummaryCard key={category} label={category} value={avg}
                accent={meta.color} icon={meta.icon} gradient={meta.gradient}
                onClick={() => setSelectedCat(isActive ? null : category)}
                active={isActive} />
            )
          })}
        </div>
      </section>

      {/* ━━ 3행: 그룹별 종합 달성률 차트 ━━ */}
      <section className="bg-white rounded-2xl border border-slate-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-slate-700">
              {selectedCat ? `그룹별 ${selectedCat} 달성률` : '그룹별 종합 달성률'}
            </h3>
            {selectedCat && (
              <>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-white"
                  style={{ background: CAT_META[selectedCat]?.color }}>{selectedCat}</span>
                <button onClick={() => setSelectedCat(null)}
                  className="text-[10px] text-slate-400 hover:text-slate-600 underline ml-1">해제</button>
              </>
            )}
          </div>
          <span className="text-[10px] text-slate-400">클릭 → 그룹 상세</span>
        </div>

        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} margin={{ top: 16, right: 12, left: -8, bottom: 0 }}
            onClick={(d) => d?.activePayload?.[0] && onGroupClick(d.activePayload[0].payload.fullName)}>
            <defs>
              <linearGradient id="barGreen" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#34d399" /><stop offset="100%" stopColor="#059669" />
              </linearGradient>
              <linearGradient id="barBlue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#60a5fa" /><stop offset="100%" stopColor="#2563eb" />
              </linearGradient>
              <linearGradient id="barYellow" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fbbf24" /><stop offset="100%" stopColor="#d97706" />
              </linearGradient>
              <linearGradient id="barRed" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f87171" /><stop offset="100%" stopColor="#dc2626" />
              </linearGradient>
              {Object.entries(CAT_META).map(([cat, m]) => (
                <linearGradient key={cat} id={`barCat-${cat.replace(/\s/g, '')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={m.gradient[0]} /><stop offset="100%" stopColor={m.gradient[1]} />
                </linearGradient>
              ))}
            </defs>
            <XAxis dataKey="name" fontSize={11} tickLine={false} axisLine={false}
              tick={{ fill: '#475569', fontWeight: 600 }} />
            <YAxis domain={[0, 130]} fontSize={10} tickLine={false} axisLine={false}
              tickFormatter={v => `${v}%`} tick={{ fill: '#94a3b8' }} />
            <Tooltip content={<ChartTooltip selectedCat={selectedCat} />}
              cursor={{ fill: '#f8fafc', radius: 8 }} />
            <ReferenceLine y={100} stroke="#cbd5e1" strokeDasharray="4 4" />
            <Bar dataKey="달성률" radius={[6, 6, 0, 0]} maxBarSize={56} cursor="pointer">
              {chartData.map((entry, i) => (
                <Cell key={i} fill={
                  selectedCat
                    ? `url(#barCat-${selectedCat.replace(/\s/g, '')})`
                    : entry.달성률 >= 100 ? 'url(#barGreen)'
                    : entry.달성률 >= 90 ? 'url(#barBlue)'
                    : entry.달성률 >= 80 ? 'url(#barYellow)' : 'url(#barRed)'
                } />
              ))}
              <LabelList dataKey="달성률" position="top" fontSize={11} fontWeight={700}
                formatter={v => `${v}%`} style={{ fill: '#334155' }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </section>

      {/* ━━ 4행: 그룹별 현재 달성률 카드 ━━ */}
      <section>
        <SectionHeader title="그룹별 현황" sub="카드를 클릭하면 상세 이동" />
        <div className="grid grid-cols-4 gap-3">
          {groupSummaries.map(g => (
            <button key={g.name} onClick={() => onGroupClick(g.name)}
              className={`text-left rounded-2xl border p-4 transition-all hover:shadow-md hover:-translate-y-0.5 ${achBg(g.wavg)}`}>
              <p className="text-xs font-semibold text-slate-600 mb-2 truncate">{g.name}</p>
              <p className="text-2xl font-black tabular-nums leading-none mb-3" style={{ color: achColor(g.wavg) }}>
                {g.wavg}<span className="text-xs font-semibold ml-0.5">%</span>
              </p>
              <div className="space-y-1">
                {categories.map(cat => {
                  const val = g.catAchs?.[cat] ?? 0
                  const meta = CAT_META[cat] ?? CAT_META['본원적 수익력']
                  return (
                    <div key={cat} className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: meta.color }} />
                      <span className="text-[10px] text-slate-500 flex-1 truncate">{cat}</span>
                      <span className="text-[10px] font-bold tabular-nums" style={{ color: achColor(val) }}>{val}%</span>
                    </div>
                  )
                })}
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

/* ── 공용 서브 컴포넌트 ── */

function SectionHeader({ title, sub }) {
  return (
    <div className="flex items-center gap-2 mb-2">
      <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">{title}</h3>
      {sub && <span className="text-[10px] text-slate-400">· {sub}</span>}
    </div>
  )
}

function SummaryCard({ label, value, accent, icon, gradient, large, onClick, active }) {
  const borderStyle = active ? { borderColor: accent, boxShadow: `0 0 0 1px ${accent}30` } : {}
  return (
    <button onClick={onClick}
      className={`text-left rounded-2xl border bg-white p-4 transition-all hover:shadow-md ${active ? '' : 'border-slate-100'}`}
      style={borderStyle}>
      <div className="flex items-center gap-1.5 mb-2">
        {icon && <span className="text-sm">{icon}</span>}
        <p className="text-[11px] font-semibold text-slate-500">{label}</p>
        {active && <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full text-white" style={{ background: accent }}>선택</span>}
      </div>
      <p className={`${large ? 'text-3xl' : 'text-2xl'} font-black tabular-nums leading-none mb-2`}
        style={{ color: achColor(value) }}>
        {value}<span className="text-xs font-semibold ml-0.5">%</span>
      </p>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{
          width: `${Math.min((value / 130) * 100, 100)}%`,
          background: gradient ? `linear-gradient(90deg, ${gradient[0]}, ${gradient[1]})` : accent,
        }} />
      </div>
    </button>
  )
}

function ChartTooltip({ active, payload, label, selectedCat }) {
  if (!active || !payload?.length) return null
  const val = payload[0]?.value
  return (
    <div className="bg-white/95 backdrop-blur border border-slate-200 rounded-xl shadow-xl px-3 py-2.5 text-xs">
      <p className="font-bold text-slate-700 mb-0.5">{label}</p>
      <p className="font-semibold text-base" style={{ color: achColor(val) }}>
        {selectedCat || '종합'}: {val}%
      </p>
    </div>
  )
}

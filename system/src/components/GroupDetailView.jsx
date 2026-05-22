import { useMemo, useState } from 'react'
import {
  ComposedChart, Line,
  XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts'
import StatusDot from './StatusDot'
import { evalLabel } from '../lib/kpiDisplay'
import { achievementFor, ytdAvgAchievement, weightedAchievement, weightedYtdAchievement } from '../lib/kpiAchievements'

const CAT_COLORS = {
  '본원적 수익력': '#6366f1',
  '건전성':        '#10b981',
  '고객':          '#f59e0b',
  '연결과 확장':   '#ef4444',
  '재무':          '#6366f1',
  '전략':          '#ef4444',
}
const CAT_STYLES = {
  '본원적 수익력': { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', dot: 'bg-indigo-500' },
  '건전성':       { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  '고객':         { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', dot: 'bg-amber-500' },
  '연결과 확장':   { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700', dot: 'bg-rose-500' },
  '재무':         { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-700', dot: 'bg-indigo-500' },
  '전략':         { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700', dot: 'bg-rose-500' },
}

const achColor = (v) => v >= 100 ? '#10b981' : v >= 80 ? '#f59e0b' : '#ef4444'
function achClass(v) { return v >= 100 ? 'text-emerald-600' : v >= 80 ? 'text-amber-600' : 'text-rose-600' }

export default function GroupDetailView({
  group, categories, definitions, results, selectedMonth, selectedYear,
  toolFilter, onReportClick,
  prevDefinitions = [], prevResults = [], groupMapping2025 = {},
  bankDefinitions = [], bankResults = [],
  detailTab = 'summary', selectedCustomTab = null,
  codebook = [],
}) {
  const [selectedBtn, setSelectedBtn] = useState('종합')
  const [bankOpen, setBankOpen] = useState(true)
  const isProtoGroup = group === '영업추진1그룹' && detailTab === 'summary'
  const code21ByLegacy = useMemo(() => {
    const map = new Map()
    ;(codebook || []).forEach((row) => {
      if (row?.linkKpiCode && row?.code21) map.set(row.linkKpiCode, row.code21)
    })
    return map
  }, [codebook])
  const resolveDisplayCode = (legacyCode) => code21ByLegacy.get(legacyCode) ?? legacyCode

  const kpiDefs = definitions.filter(d => d.mgmtTool === 'KPI')
  const refDefs = definitions.filter(d => d.mgmtTool !== 'KPI')
  const showKpi = toolFilter === '전체' || toolFilter === 'KPI'
  const showRef = toolFilter === '전체' || toolFilter === '전략과제' || toolFilter === '모니터링'


  /* ── 종합 요약 ── */
  const overallSummary = useMemo(() => {
    let ws = 0, wt = 0, o = 0, m = 0, u = 0
    kpiDefs.forEach(def => {
      const r = results.find(r => r.code === def.code && r.month === selectedMonth && r.mgmtTool === 'KPI')
      if (r?.achievement != null) {
        ws += r.achievement * def.weight; wt += def.weight
        if (r.achievement >= 100) o++; else if (r.achievement >= 80) m++; else u++
      }
    })
    const wavg = wt > 0 ? Math.round(ws / wt * 10) / 10 : 0
    return { wavg, over100: o, mid: m, under80: u, total: kpiDefs.length }
  }, [kpiDefs, results, selectedMonth])

  /* ── 카테고리별 이번달 달성률 ── */
  const catSummaries = useMemo(() => {
    return categories.map(cat => {
      const defs = kpiDefs.filter(d => d.category === cat)
      let ws = 0, wt = 0
      defs.forEach(def => {
        const r = results.find(r => r.code === def.code && r.month === selectedMonth)
        if (r?.achievement != null) { ws += r.achievement * def.weight; wt += def.weight }
      })
      const wavg = wt > 0 ? Math.round(ws / wt * 10) / 10 : 0
      const totalWeight = defs.reduce((s, d) => s + d.weight, 0)
      return { cat, wavg, count: defs.length, totalWeight }
    })
  }, [kpiDefs, results, selectedMonth, categories])

  /* ── 2025년 배경 데이터: 해당 그룹의 종합 달성률 ── */
  const prevGroups2025 = useMemo(() => {
    const mapped = groupMapping2025[group]
    return mapped || [group]
  }, [group, groupMapping2025])

  const prevKpiDefs2025 = useMemo(() => {
    return prevDefinitions.filter(d => d.mgmtTool === 'KPI' && prevGroups2025.includes(d.group))
  }, [prevDefinitions, prevGroups2025])

  const prevTrend2025 = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const mo = i + 1
      let ws = 0, wt = 0
      prevKpiDefs2025.forEach(def => {
        const r = prevResults.find(r => r.code === def.code && r.month === mo)
        if (r?.achievement != null) { ws += r.achievement * def.weight; wt += def.weight }
      })
      return wt > 0 ? Math.round(ws / wt * 10) / 10 : undefined
    })
  }, [prevKpiDefs2025, prevResults])

  /* ── 12개월 트렌드 데이터 (2025 배경 포함) ── */
  const trendData = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const mo = i + 1
      const entry = { month: `${mo}월`, _hasData: mo <= selectedMonth }
      let allWs = 0, allWt = 0
      categories.forEach(cat => {
        const defs = kpiDefs.filter(d => d.category === cat)
        let ws = 0, wt = 0
        defs.forEach(def => {
          const r = results.find(r => r.code === def.code && r.month === mo)
          if (r?.achievement != null) { ws += r.achievement * def.weight; wt += def.weight }
        })
        entry[cat] = wt > 0 ? Math.round(ws / wt * 10) / 10 : undefined
        if (wt > 0) { allWs += ws; allWt += wt }
      })
      entry['종합'] = allWt > 0 ? Math.round(allWs / allWt * 10) / 10 : undefined
      entry['prev25'] = prevTrend2025[i]
      return entry
    })
  }, [kpiDefs, results, selectedMonth, categories, prevTrend2025])

  /* ── 동적 Y축: 선택된 라인 값만 기준 (전체 카테고리 혼합 시 평탄화 방지) ── */
  const yDomain = useMemo(() => {
    const activeKey = selectedBtn === '종합' ? '종합' : selectedBtn
    const vals = []
    trendData.forEach(d => {
      if (d[activeKey] != null) vals.push(d[activeKey])
      if (d['prev25']  != null) vals.push(d['prev25'])
    })
    if (vals.length === 0) return [70, 120]
    const minV = Math.min(...vals)
    const maxV = Math.max(...vals)
    // 최소 표시 범위 10%p 확보 → 변동이 작아도 굴곡이 보이게
    const range = Math.max(maxV - minV, 10)
    const pad   = range * 0.5
    const lo = Math.floor(minV - pad)
    const hi = Math.ceil(maxV  + pad)
    return [lo, hi]
  }, [trendData, selectedBtn])

  /* ── 주요 지표 4개 (weight 상위) ── */
  const topKpis = useMemo(() => {
    return [...kpiDefs]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 4)
      .map(def => {
        const r = results.find(r => r.code === def.code && r.month === selectedMonth)
        return { def, ach: r?.achievement ?? 0, actual: r?.actual ?? 0, target: r?.target ?? 0 }
      })
  }, [kpiDefs, results, selectedMonth])

  const top8DashboardKpis = useMemo(() => {
    return [...kpiDefs]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 8)
      .map(def => {
        const monthResult = results.find(r => r.code === def.code && r.month === selectedMonth)
        const prevResult = selectedMonth > 1
          ? results.find(r => r.code === def.code && r.month === selectedMonth - 1)
          : null
        const trend = Array.from({ length: 12 }, (_, i) => {
          const r = results.find(x => x.code === def.code && x.month === i + 1)
          return r?.achievement ?? null
        })
        const isRatio = def.calcBasis === '비율' || ['%', '%p', '점'].includes(def.unit)
        const ach = monthResult?.achievement ?? 0
        const prevAch = prevResult?.achievement ?? null
        const ytdAch = ytdAvgAchievement(results, def.code, selectedMonth)
        const gap = (monthResult?.actual ?? 0) - (monthResult?.target ?? 0)
        const deltaMoM = prevAch == null ? null : Math.round((ach - prevAch) * 10) / 10
        const deltaVsYtd = ytdAch == null ? null : Math.round((ach - ytdAch) * 10) / 10
        const riskLevel = ach < 85 ? 'high' : ach < 95 ? 'medium' : 'low'
        return {
          def,
          isRatio,
          ach,
          prevAch,
          ytdAch,
          deltaMoM,
          deltaVsYtd,
          riskLevel,
          gap,
          actual: monthResult?.actual ?? 0,
          target: monthResult?.target ?? 0,
          trend,
        }
      })
  }, [kpiDefs, results, selectedMonth])

  const ALL_BTNS = ['종합', ...categories]
  const is2026 = (selectedYear ?? 2026) === 2026

  const bankCategories = ['본원적 수익력', '건전성', '고객', '연결과 확장']
  const bankKpiDefs = useMemo(() => bankDefinitions.filter(d => d.mgmtTool === 'KPI'), [bankDefinitions])

  const bankOverallSummary = useMemo(() => {
    let ws = 0, wt = 0, o = 0, m = 0, u = 0
    bankKpiDefs.forEach(def => {
      const r = bankResults.find(r => r.code === def.code && r.month === selectedMonth && r.mgmtTool === 'KPI')
      if (r?.achievement != null) {
        ws += r.achievement * def.weight; wt += def.weight
        if (r.achievement >= 100) o++; else if (r.achievement >= 80) m++; else u++
      }
    })
    const wavg = wt > 0 ? Math.round(ws / wt * 10) / 10 : 0
    return { wavg, over100: o, mid: m, under80: u, total: bankKpiDefs.length }
  }, [bankKpiDefs, bankResults, selectedMonth])

  const bankCatSummaries = useMemo(() => {
    return bankCategories.map(cat => {
      const defs = bankKpiDefs.filter(d => d.category === cat)
      let ws = 0, wt = 0
      defs.forEach(def => {
        const r = bankResults.find(r => r.code === def.code && r.month === selectedMonth)
        if (r?.achievement != null) { ws += r.achievement * def.weight; wt += def.weight }
      })
      const wavg = wt > 0 ? Math.round(ws / wt * 10) / 10 : 0
      const totalWeight = defs.reduce((s, d) => s + d.weight, 0)
      return { cat, wavg, count: defs.length, totalWeight }
    })
  }, [bankKpiDefs, bankResults, selectedMonth])

  const bankTrendData = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const mo = i + 1
      const entry = { month: `${mo}월`, _hasData: mo <= selectedMonth }
      let allWs = 0, allWt = 0
      bankCategories.forEach(cat => {
        const defs = bankKpiDefs.filter(d => d.category === cat)
        let ws = 0, wt = 0
        defs.forEach(def => {
          const r = bankResults.find(r => r.code === def.code && r.month === mo)
          if (r?.achievement != null) { ws += r.achievement * def.weight; wt += def.weight }
        })
        entry[cat] = wt > 0 ? Math.round(ws / wt * 10) / 10 : undefined
        if (wt > 0) { allWs += ws; allWt += wt }
      })
      entry['종합'] = allWt > 0 ? Math.round(allWs / allWt * 10) / 10 : undefined
      return entry
    })
  }, [bankKpiDefs, bankResults, selectedMonth])

  const bankActiveKey = selectedBtn === '종합' || bankCategories.includes(selectedBtn) ? selectedBtn : '종합'

  const bankYDomain = useMemo(() => {
    const vals = []
    bankTrendData.forEach(d => {
      if (d[bankActiveKey] != null) vals.push(d[bankActiveKey])
    })
    if (vals.length === 0) return [70, 120]
    const minV = Math.min(...vals)
    const maxV = Math.max(...vals)
    const range = Math.max(maxV - minV, 10)
    const pad = range * 0.5
    return [Math.floor(minV - pad), Math.ceil(maxV + pad)]
  }, [bankTrendData, bankActiveKey])

  const bankTopKpis = useMemo(() => {
    return [...bankKpiDefs]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 4)
      .map(def => {
        const r = bankResults.find(r => r.code === def.code && r.month === selectedMonth)
        return { def, ach: r?.achievement ?? 0, actual: r?.actual ?? 0, target: r?.target ?? 0 }
      })
  }, [bankKpiDefs, bankResults, selectedMonth])

  const agendaRows = useMemo(() => {
    return categories.map(cat => {
      const defs = kpiDefs.filter(d => d.category === cat).sort((a, b) => b.weight - a.weight).slice(0, 6)
      const rows = defs.map(def => {
        const r = results.find(x => x.code === def.code && x.month === selectedMonth)
        return {
          code: def.code,
          displayCode: resolveDisplayCode(def.code),
          group: def.group,
          name: evalLabel(def) || def.name,
          ach: r?.achievement ?? 0,
          target: r?.target ?? 0,
          actual: r?.actual ?? 0,
          unit: def.unit,
          weight: def.weight,
        }
      })
      const catAch = catSummaries.find(c => c.cat === cat)?.wavg ?? 0
      return { cat, catAch, rows }
    })
  }, [categories, kpiDefs, results, selectedMonth, catSummaries])

  const selectedCustomRows = useMemo(() => {
    if (!selectedCustomTab) return []
    return selectedCustomTab.metricCodes
      .map((code) => {
        const def = kpiDefs.find((k) => k.code === code)
        if (!def) return null
        const r = results.find((x) => x.code === code && x.month === selectedMonth)
        return {
          code,
          displayCode: resolveDisplayCode(code),
          group: def.group,
          category: def.category,
          name: evalLabel(def) || def.name,
          target: r?.target ?? 0,
          actual: r?.actual ?? 0,
          ach: r?.achievement ?? 0,
          unit: def.unit,
          weight: def.weight ?? 0,
        }
      })
      .filter(Boolean)
  }, [selectedCustomTab, kpiDefs, results, selectedMonth, resolveDisplayCode])

  const selectedCustomSummary = useMemo(() => {
    if (selectedCustomRows.length === 0) {
      return { wavg: 0, total: 0, over100: 0, caution: 0, risk: 0 }
    }
    let ws = 0
    let wt = 0
    selectedCustomRows.forEach((row) => {
      ws += row.ach * row.weight
      wt += row.weight
    })
    const wavg = wt > 0 ? Math.round((ws / wt) * 10) / 10 : 0
    const total = selectedCustomRows.length
    const over100 = selectedCustomRows.filter((row) => row.ach >= 100).length
    const caution = selectedCustomRows.filter((row) => row.ach >= 80 && row.ach < 100).length
    const risk = selectedCustomRows.filter((row) => row.ach < 80).length
    return { wavg, total, over100, caution, risk }
  }, [selectedCustomRows])

  const selectedCustomCatBars = useMemo(() => {
    const map = new Map()
    selectedCustomRows.forEach((row) => {
      const prev = map.get(row.category) ?? { ws: 0, wt: 0, count: 0 }
      prev.ws += row.ach * row.weight
      prev.wt += row.weight
      prev.count += 1
      map.set(row.category, prev)
    })
    return Array.from(map.entries())
      .map(([cat, v]) => ({
        cat,
        count: v.count,
        ach: v.wt > 0 ? Math.round((v.ws / v.wt) * 10) / 10 : 0,
      }))
      .sort((a, b) => b.ach - a.ach)
  }, [selectedCustomRows])


  return (
    <div className="space-y-4">
        {detailTab === 'bank' && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <button
              onClick={() => setBankOpen(v => !v)}
              className="w-full px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between"
            >
              <div className="text-left">
                <p className="text-sm font-bold text-slate-700">은행KPI</p>
                <p className="text-[11px] text-slate-400">{selectedMonth}월 기준 전행 KPI</p>
              </div>
              <span className="text-sm text-slate-500">{bankOpen ? '접기' : '펼치기'}</span>
            </button>
            {bankOpen && (
              <div className="p-4 space-y-4">
                {!is2026 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                    2025년 화면에서는 은행KPI를 제공하지 않습니다. 2026년으로 전환해서 확인해 주세요.
                  </div>
                )}
                {is2026 && (
                  <>
                    <div className="flex gap-2 flex-wrap">
                      {['종합', ...bankCategories].map(btn => {
                        const isActive = bankActiveKey === btn
                        const isCat = btn !== '종합'
                        const color = isCat ? CAT_COLORS[btn] : '#1e293b'
                        const val = btn === '종합'
                          ? bankOverallSummary.wavg
                          : (bankCatSummaries.find(c => c.cat === btn)?.wavg ?? 0)
                        return (
                          <button
                            key={btn}
                            onClick={() => setSelectedBtn(btn)}
                            className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border-2 transition-all text-left"
                            style={{
                              borderColor: isActive ? color : '#e2e8f0',
                              background: isActive ? color + '0f' : 'white',
                            }}
                          >
                            {isCat && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />}
                            {!isCat && <span className="w-2 h-2 rounded-full flex-shrink-0 bg-slate-700" />}
                            <span className="flex flex-col leading-tight">
                              <span className="text-[10px] font-medium" style={{ color: isActive ? color : '#64748b' }}>{btn}</span>
                              <span className="text-lg font-black tabular-nums leading-none" style={{ color: isActive ? color : achColor(val) }}>{val}%</span>
                            </span>
                          </button>
                        )
                      })}
                      <div className="ml-auto flex items-center gap-3">
                        <Stat label="전체" value={bankOverallSummary.total} unit="개" color="slate" />
                        <Stat label="100%↑" value={bankOverallSummary.over100} unit="개" color="emerald" />
                        <Stat label="80~99%" value={bankOverallSummary.mid} unit="개" color="amber" />
                        <Stat label="80%↓" value={bankOverallSummary.under80} unit="개" color="rose" />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white rounded-xl border border-slate-200 p-4">
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-sm font-bold text-slate-700">{bankActiveKey === '종합' ? '은행 KPI 종합 달성률' : `${bankActiveKey} 달성률`} 추이</h3>
                          {bankActiveKey !== '종합' && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full text-white" style={{ background: CAT_COLORS[bankActiveKey] }}>
                              {bankActiveKey}
                            </span>
                          )}
                        </div>
                        <ResponsiveContainer width="100%" height={200}>
                          <ComposedChart data={bankTrendData} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                            <XAxis dataKey="month" fontSize={10} tickLine={false} axisLine={false} tick={{ fill: '#94a3b8' }} />
                            <YAxis domain={bankYDomain} fontSize={10} tickLine={false} axisLine={false} tickCount={5} tickFormatter={v => `${v}%`} tick={{ fill: '#94a3b8' }} />
                            <ReferenceLine y={100} stroke="#94a3b8" strokeDasharray="4 4" />
                            <Tooltip
                              formatter={(v) => (v == null ? ['-'] : [`${v}%`, '2026년'])}
                              contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                            />
                            <Line
                              type="monotone"
                              dataKey={bankActiveKey}
                              stroke={bankActiveKey === '종합' ? '#1e293b' : (CAT_COLORS[bankActiveKey] ?? '#1e293b')}
                              strokeWidth={2.5}
                              dot={(p) => p.payload._hasData
                                ? <circle cx={p.cx} cy={p.cy} r={4} fill={bankActiveKey === '종합' ? '#1e293b' : (CAT_COLORS[bankActiveKey] ?? '#1e293b')} stroke="white" strokeWidth={1.5} />
                                : <g />
                              }
                              connectNulls={false}
                            />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>

                      <div className="bg-white rounded-xl border border-slate-200 p-4">
                        <div className="mb-3">
                          <h3 className="text-sm font-bold text-slate-700">은행KPI 주요 지표 이번달 달성률</h3>
                          <p className="text-[10px] text-slate-400">{selectedMonth}월 기준 · 비중 상위 4개 지표</p>
                        </div>
                        <div className="space-y-3">
                          {bankTopKpis.map(({ def, ach, actual, target }) => {
                            const catColor = CAT_COLORS[def.category] ?? '#64748b'
                            const bar = Math.min((ach / 130) * 100, 100)
                            return (
                              <div key={def.code} className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: catColor }} />
                                    <span className="text-[11px] font-medium text-slate-700 truncate max-w-[220px]">{evalLabel(def) || def.name}</span>
                                    <span className="text-[9px] text-slate-400 flex-shrink-0">{def.weight}%비중</span>
                                  </div>
                                  <span className="text-sm font-black tabular-nums flex-shrink-0 ml-2" style={{ color: achColor(ach) }}>{ach}%</span>
                                </div>
                                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                  <div className="h-full rounded-full transition-all" style={{ width: `${bar}%`, background: catColor }} />
                                </div>
                                <div className="flex items-center gap-3 text-[9px] text-slate-400">
                                  <span>목표 {target.toLocaleString()}</span>
                                  <span>실적 <span className="font-semibold text-slate-600">{actual.toLocaleString()}</span></span>
                                  <span className="ml-auto">{def.unit}</span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>

                    {bankCategories.map(cat => {
                      const defs = bankKpiDefs.filter(d => d.category === cat)
                      const cs = bankCatSummaries.find(c => c.cat === cat)
                      const st = CAT_STYLES[cat]
                      return (
                        <div key={cat} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                          <div className={`px-5 py-3 border-b ${st.border} flex items-center justify-between ${st.bg}`}>
                            <div className="flex items-center gap-2">
                              <span className={`w-2.5 h-2.5 rounded-full ${st.dot}`} />
                              <h3 className={`text-sm font-bold ${st.text}`}>{cat}</h3>
                              <span className="text-xs text-slate-500 ml-1">({defs.length}개 · 비중 {cs?.totalWeight}%)</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-500">카테고리 달성률</span>
                              <span className={`text-base font-bold ${cs.wavg >= 100 ? 'text-emerald-600' : cs.wavg >= 80 ? 'text-amber-600' : 'text-rose-600'}`}>
                                {cs?.wavg}%
                              </span>
                            </div>
                          </div>
                          <KpiGroupedTable defs={defs} results={bankResults} selectedMonth={selectedMonth} catKey={`bank-${cat}`} />
                        </div>
                      )
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {detailTab === 'summary' && (
          <>
            {showKpi && (
              <>
                <div className="flex gap-2 flex-wrap">
                  {ALL_BTNS.map(btn => {
                    const isActive = selectedBtn === btn
                    const isCat = btn !== '종합'
                    const color = isCat ? CAT_COLORS[btn] : '#1e293b'
                    const val = btn === '종합'
                      ? overallSummary.wavg
                      : (catSummaries.find(c => c.cat === btn)?.wavg ?? 0)
                    return (
                      <button
                        key={btn}
                        onClick={() => setSelectedBtn(btn)}
                        className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl border-2 transition-all text-left"
                        style={{
                          borderColor: isActive ? color : '#e2e8f0',
                          background: isActive ? color + '0f' : 'white',
                        }}
                      >
                        {isCat && <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />}
                        {!isCat && <span className="w-2 h-2 rounded-full flex-shrink-0 bg-slate-700" />}
                        <span className="flex flex-col leading-tight">
                          <span className="text-[10px] font-medium" style={{ color: isActive ? color : '#64748b' }}>{btn}</span>
                          <span className="text-lg font-black tabular-nums leading-none" style={{ color: isActive ? color : achColor(val) }}>{val}%</span>
                        </span>
                      </button>
                    )
                  })}
                  <div className="ml-auto flex items-center gap-3">
                    <Stat label="전체" value={overallSummary.total} unit="개" color="slate" />
                    <Stat label="100%↑" value={overallSummary.over100} unit="개" color="emerald" />
                    <Stat label="80~99%" value={overallSummary.mid} unit="개" color="amber" />
                    <Stat label="80%↓" value={overallSummary.under80} unit="개" color="rose" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-sm font-bold text-slate-700">{selectedBtn === '종합' ? '종합 달성률' : `${selectedBtn} 달성률`} 추이</h3>
                        <p className="text-[10px] text-slate-400">{selectedYear ?? 2026}년 1~12월{prevKpiDefs2025.length > 0 && <span className="text-slate-300"> · 옅은선 = 2025년</span>}</p>
                      </div>
                    </div>
                    <ResponsiveContainer width="100%" height={isProtoGroup ? 165 : 200}>
                      <ComposedChart data={trendData} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                        <XAxis dataKey="month" fontSize={10} tickLine={false} axisLine={false} tick={{ fill: '#94a3b8' }} />
                        <YAxis domain={yDomain} fontSize={10} tickLine={false} axisLine={false} tickCount={5} tickFormatter={v => `${v}%`} tick={{ fill: '#94a3b8' }} />
                        <ReferenceLine y={100} stroke="#94a3b8" strokeDasharray="4 4" />
                        <Tooltip
                          formatter={(v, name) => {
                            if (v == null) return ['-']
                            const label = name === 'prev25' ? '2025년' : `${selectedYear ?? 2026}년`
                            return [`${v}%`, label]
                          }}
                          contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #e2e8f0' }}
                        />
                        {prevKpiDefs2025.length > 0 && is2026 && (
                          <Line type="monotone" dataKey="prev25" stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="5 3" dot={{ r: 2.5, fill: '#94a3b8', stroke: 'white', strokeWidth: 1 }} connectNulls name="prev25" strokeOpacity={0.6} />
                        )}
                        <Line
                          type="monotone"
                          dataKey={selectedBtn === '종합' ? '종합' : selectedBtn}
                          stroke={selectedBtn === '종합' ? '#1e293b' : (CAT_COLORS[selectedBtn] ?? '#1e293b')}
                          strokeWidth={2.5}
                          dot={(p) => p.payload._hasData ? <circle cx={p.cx} cy={p.cy} r={4} fill={selectedBtn === '종합' ? '#1e293b' : (CAT_COLORS[selectedBtn] ?? '#1e293b')} stroke="white" strokeWidth={1.5} /> : <g />}
                          connectNulls={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="mb-3">
                      <h3 className="text-sm font-bold text-slate-700">주요 지표 이번달 달성률</h3>
                      <p className="text-[10px] text-slate-400">{selectedMonth}월 기준 · 비중 상위 4개 지표</p>
                    </div>
                    <div className={`space-y-3 ${isProtoGroup ? 'max-h-[165px] overflow-y-auto pr-1' : ''}`}>
                      {topKpis.map(({ def, ach, actual, target }) => {
                        const catColor = CAT_COLORS[def.category] ?? '#64748b'
                        const bar = Math.min((ach / 130) * 100, 100)
                        return (
                          <div key={def.code} className="space-y-1">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5 min-w-0">
                                <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: catColor }} />
                                <span className="text-[11px] font-medium text-slate-700 truncate max-w-[200px]">{evalLabel(def) || def.name}</span>
                                <span className="text-[9px] text-slate-400 flex-shrink-0">{def.weight}%비중</span>
                              </div>
                              <span className="text-sm font-black tabular-nums flex-shrink-0 ml-2" style={{ color: achColor(ach) }}>{ach}%</span>
                            </div>
                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all" style={{ width: `${bar}%`, background: catColor }} />
                            </div>
                            <div className="flex items-center gap-3 text-[9px] text-slate-400">
                              <span>목표 {target.toLocaleString()}</span>
                              <span>실적 <span className="font-semibold text-slate-600">{actual.toLocaleString()}</span></span>
                              <span className="ml-auto">{def.unit}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>

                {isProtoGroup && (
                  <div className="bg-white rounded-xl border border-slate-200 p-4">
                    <div className="flex items-end justify-between mb-3">
                      <div>
                        <h3 className="text-sm font-bold text-slate-700">주요 8지표 퍼포먼스 대시보드</h3>
                        <p className="text-[10px] text-slate-400">지표 특성별 맞춤 시각화 · {selectedMonth}월 기준</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 gap-3">
                      {top8DashboardKpis.map((item) => (
                        <MetricDashboardCard key={item.def.code} item={item} displayCode={resolveDisplayCode(item.def.code)} />
                      ))}
                    </div>
                  </div>
                )}

                {categories.map(cat => {
                  const defs = kpiDefs.filter(d => d.category === cat)
                  const cs = catSummaries.find(c => c.cat === cat)
                  const st = CAT_STYLES[cat]
                  return (
                    <div key={cat} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                      <div className={`px-5 py-3 border-b ${st.border} flex items-center justify-between ${st.bg}`}>
                        <div className="flex items-center gap-2">
                          <span className={`w-2.5 h-2.5 rounded-full ${st.dot}`} />
                          <h3 className={`text-sm font-bold ${st.text}`}>{cat}</h3>
                          <span className="text-xs text-slate-500 ml-1">({defs.length}개 · 비중 {cs?.totalWeight}%)</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-500">카테고리 달성률</span>
                          <span className={`text-base font-bold ${cs.wavg >= 100 ? 'text-emerald-600' : cs.wavg >= 80 ? 'text-amber-600' : 'text-rose-600'}`}>{cs?.wavg}%</span>
                        </div>
                      </div>
                      <KpiGroupedTable defs={defs} results={results} selectedMonth={selectedMonth} catKey={cat} displayCodeResolver={resolveDisplayCode} />
                    </div>
                  )
                })}
              </>
            )}

            {showRef && refDefs.length > 0 && (
              <>
                {['전략과제', '모니터링'].map(tool => {
                  const items = refDefs.filter(d => d.mgmtTool === tool)
                  if (items.length === 0) return null
                  if (toolFilter !== '전체' && toolFilter !== tool) return null
                  return (
                    <div key={tool} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                      <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${tool === '전략과제' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-600'}`}>{tool}</span>
                        <span className="text-sm font-semibold text-slate-600">참고 데이터</span>
                        <span className="text-xs text-slate-400">({items.length}개)</span>
                      </div>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-slate-50/50 text-slate-500 text-[11px]">
                            <th className="px-3 py-2 text-left font-medium w-6">NO</th>
                            <th className="px-3 py-2 text-left font-medium">지표코드</th>
                            <th className="px-3 py-2 text-left font-medium min-w-[180px]">지표명</th>
                            <th className="px-3 py-2 text-center font-medium">단위</th>
                            {Array.from({ length: Math.min(selectedMonth, 6) }, (_, i) => selectedMonth - 5 + i).filter(m => m >= 1).map(m => (
                              <th key={m} className="px-2 py-2 text-right font-medium">{m}월</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((def, i) => {
                            const monthsToShow = Array.from({ length: Math.min(selectedMonth, 6) }, (_, i) => selectedMonth - 5 + i).filter(m => m >= 1)
                            return (
                              <tr key={def.code} className={`border-t border-slate-100 ${i % 2 ? 'bg-slate-50/20' : ''}`}>
                                <td className="px-3 py-2 text-xs text-slate-400">{i + 1}</td>
                                <td className="px-3 py-2 text-xs font-mono text-slate-400">{resolveDisplayCode(def.code)}</td>
                                <td className="px-3 py-2 text-slate-700">{def.name}</td>
                                <td className="px-3 py-2 text-center text-slate-500">{def.unit}</td>
                                {monthsToShow.map(m => {
                                  const r = results.find(r => r.code === def.code && r.month === m)
                                  return (
                                    <td key={m} className="px-2 py-2 text-right text-slate-600 tabular-nums">
                                      {r?.actual != null ? r.actual.toLocaleString() : '-'}
                                    </td>
                                  )
                                })}
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )
                })}
              </>
            )}
          </>
        )}

        {detailTab === 'agenda' && (
          <div className="space-y-3">
            {agendaRows.map((row) => (
              <div key={row.cat} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: CAT_COLORS[row.cat] ?? '#64748b' }} />
                    <h3 className="text-sm font-bold text-slate-700">{row.cat}</h3>
                  </div>
                  <span className="text-sm font-black" style={{ color: achColor(row.catAch) }}>{row.catAch}%</span>
                </div>
                <div className="p-3 grid grid-cols-2 gap-2">
                  {row.rows.map(item => (
                    <div key={item.code} className="rounded-lg border border-slate-200 p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-700 truncate">{item.name}</p>
                        <span className="text-xs font-bold" style={{ color: achColor(item.ach) }}>{item.ach}%</span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">[{item.group}] {item.displayCode} · 비중 {item.weight}%</p>
                      <p className="text-[11px] text-slate-500 mt-1">목표 {item.target.toLocaleString()} / 실적 {item.actual.toLocaleString()} {item.unit}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedCustomTab && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 bg-indigo-50 flex items-center justify-between">
              <h3 className="text-sm font-bold text-indigo-800">{selectedCustomTab.title}</h3>
              <p className="text-[11px] text-indigo-500">선택 지표 {selectedCustomTab.metricCodes.length}개</p>
            </div>
            <div className="p-4 border-b border-slate-100 bg-slate-50/60">
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-[11px] font-semibold text-slate-600">탭 종합 달성률</p>
                  <p className="text-[10px] text-slate-400">{selectedMonth}월 기준</p>
                </div>
                <span className="text-2xl font-black tabular-nums" style={{ color: achColor(selectedCustomSummary.wavg) }}>
                  {selectedCustomSummary.wavg}%
                </span>
              </div>
              <div className="mt-2 h-2 bg-slate-100 rounded-full overflow-hidden relative">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.min((selectedCustomSummary.wavg / 130) * 100, 100)}%`,
                    background: achColor(selectedCustomSummary.wavg),
                  }}
                />
                <div className="absolute inset-y-0 border-l border-dashed border-slate-300" style={{ left: `${(100 / 130) * 100}%` }} />
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2">
                <div className="rounded-md bg-white border border-slate-200 px-2.5 py-2 text-center">
                  <p className="text-[10px] text-slate-500">전체</p>
                  <p className="text-sm font-bold text-slate-700">{selectedCustomSummary.total}개</p>
                </div>
                <div className="rounded-md bg-emerald-50 border border-emerald-200 px-2.5 py-2 text-center">
                  <p className="text-[10px] text-emerald-700">100% 이상</p>
                  <p className="text-sm font-bold text-emerald-700">{selectedCustomSummary.over100}개</p>
                </div>
                <div className="rounded-md bg-amber-50 border border-amber-200 px-2.5 py-2 text-center">
                  <p className="text-[10px] text-amber-700">80~99%</p>
                  <p className="text-sm font-bold text-amber-700">{selectedCustomSummary.caution}개</p>
                </div>
                <div className="rounded-md bg-rose-50 border border-rose-200 px-2.5 py-2 text-center">
                  <p className="text-[10px] text-rose-700">80% 미만</p>
                  <p className="text-sm font-bold text-rose-700">{selectedCustomSummary.risk}개</p>
                </div>
              </div>
              {selectedCustomCatBars.length > 0 && (
                <div className="mt-3 space-y-2">
                  {selectedCustomCatBars.map((bar) => (
                    <div key={bar.cat} className="grid grid-cols-[120px_1fr_58px] gap-2 items-center">
                      <p className="text-[11px] text-slate-600 truncate">{bar.cat} <span className="text-slate-400">({bar.count})</span></p>
                      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden relative">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${Math.min((bar.ach / 130) * 100, 100)}%`,
                            background: CAT_COLORS[bar.cat] ?? achColor(bar.ach),
                          }}
                        />
                        <div className="absolute inset-y-0 border-l border-dashed border-slate-300" style={{ left: `${(100 / 130) * 100}%` }} />
                      </div>
                      <p className="text-right text-xs font-bold tabular-nums" style={{ color: achColor(bar.ach) }}>{bar.ach}%</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-4 bg-white">
              {selectedCustomRows.length === 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                  표시할 지표가 없습니다.
                </div>
              )}
              {selectedCustomRows.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {selectedCustomRows.map((row) => (
                    <div key={row.code} className="rounded-xl border border-slate-200 p-3 bg-white">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] text-slate-500">{row.group} · {row.category}</p>
                          <p className="text-sm font-semibold text-slate-800 truncate">{row.name}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">{row.displayCode} · 비중 {row.weight}%</p>
                        </div>
                        <span className="text-sm font-black tabular-nums ml-2" style={{ color: achColor(row.ach) }}>
                          {row.ach}%
                        </span>
                      </div>

                      <div className="mt-2 relative">
                        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${Math.min((row.ach / 130) * 100, 100)}%`,
                              background: achColor(row.ach),
                            }}
                          />
                        </div>
                        <div className="absolute inset-y-0 border-l border-dashed border-slate-300" style={{ left: `${(100 / 130) * 100}%` }} />
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <div className="rounded-md bg-slate-50 px-2 py-1.5">
                          <p className="text-[10px] text-slate-500">목표</p>
                          <p className="text-xs font-semibold tabular-nums text-slate-700">{row.target.toLocaleString()}</p>
                        </div>
                        <div className="rounded-md bg-slate-50 px-2 py-1.5">
                          <p className="text-[10px] text-slate-500">실적</p>
                          <p className="text-xs font-semibold tabular-nums text-slate-800">{row.actual.toLocaleString()} <span className="text-[10px] text-slate-500">{row.unit}</span></p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
    </div>
  )
}

function MetricDashboardCard({ item, displayCode }) {
  const { def, isRatio, ach, actual, target, trend, gap, deltaMoM, deltaVsYtd, riskLevel } = item
  const insightText = riskLevel === 'high'
    ? '미달 리스크 높음: 즉시 액션 필요'
    : riskLevel === 'medium'
      ? '주의 구간: 변동성 모니터링 필요'
      : '안정 구간: 현재 추세 유지'
  return (
    <div className="rounded-xl border border-slate-200 bg-gradient-to-b from-white to-slate-50 p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{def.category}</span>
        <span className="text-[10px] text-slate-400">{def.weight}%</span>
      </div>
      <p className="text-[11px] font-semibold text-slate-700 truncate">{evalLabel(def) || def.name}</p>
      <p className="text-[10px] text-slate-400 mb-2">{displayCode ?? def.code}</p>

      {isRatio ? (
        <SemiGauge value={ach} target={100} />
      ) : (
        <MiniTrendBars values={trend} />
      )}

      <div className="mt-2 space-y-1">
        <div className="grid grid-cols-3 gap-1 text-[10px]">
          <InsightPill label="목표갭" value={gap} suffix={def.unit} />
          <InsightPill label="전월대비" value={deltaMoM} suffix="%p" />
          <InsightPill label="YTD대비" value={deltaVsYtd} suffix="%p" />
        </div>
        <div className="flex items-end justify-between">
          <div className="text-[10px] text-slate-500">
            목표 {target.toLocaleString()} / 실적 {actual.toLocaleString()}
          </div>
          <div className="text-lg font-black tabular-nums" style={{ color: achColor(ach) }}>
            {ach}%
          </div>
        </div>
        <p className={`text-[10px] font-medium ${riskLevel === 'high' ? 'text-rose-600' : riskLevel === 'medium' ? 'text-amber-600' : 'text-emerald-600'}`}>
          {insightText}
        </p>
      </div>
    </div>
  )
}

function InsightPill({ label, value, suffix }) {
  const hasValue = value != null
  const num = hasValue ? Math.round(value * 10) / 10 : null
  const positive = hasValue && num >= 0
  const tone = !hasValue ? 'text-slate-400 bg-slate-100' : positive ? 'text-emerald-700 bg-emerald-50' : 'text-rose-700 bg-rose-50'
  const sign = !hasValue ? '' : positive ? '+' : ''
  return (
    <div className={`px-1.5 py-1 rounded ${tone}`}>
      <p className="leading-none">{label}</p>
      <p className="font-bold tabular-nums mt-0.5 leading-none">{hasValue ? `${sign}${num}${suffix}` : '-'}</p>
    </div>
  )
}

function SemiGauge({ value, target = 100 }) {
  const clamped = Math.max(0, Math.min(140, value))
  const ratio = clamped / 140
  const targetRatio = Math.max(0, Math.min(1, target / 140))
  const endX = 10 + 80 * Math.cos(Math.PI * (1 - ratio))
  const endY = 50 - 40 * Math.sin(Math.PI * (1 - ratio))
  const markerX = 10 + 80 * Math.cos(Math.PI * (1 - targetRatio))
  const markerY = 50 - 40 * Math.sin(Math.PI * (1 - targetRatio))
  const tone = value >= target ? '#10b981' : value >= 80 ? '#f59e0b' : '#ef4444'
  return (
    <div className="w-full">
      <svg viewBox="0 0 100 56" className="w-full h-16">
        <path d="M10 50 A40 40 0 0 1 90 50" fill="none" stroke="#e2e8f0" strokeWidth="8" />
        <path
          d={`M10 50 A40 40 0 0 1 ${endX.toFixed(2)} ${endY.toFixed(2)}`}
          fill="none"
          stroke={tone}
          strokeWidth="8"
          strokeLinecap="round"
        />
        <circle cx={markerX} cy={markerY} r="2.2" fill="#0f172a" />
        <text x="50" y="44" textAnchor="middle" fontSize="9" fill="#64748b">적정 {target}%</text>
      </svg>
    </div>
  )
}

function MiniTrendBars({ values }) {
  const recent = values.slice(0, 12).filter(v => v != null).slice(-6)
  const maxV = recent.length ? Math.max(...recent, 100) : 100
  const avg = recent.length ? recent.reduce((s, v) => s + v, 0) / recent.length : 0
  return (
    <div className="h-16 rounded-lg bg-slate-100/70 px-2 py-1.5 flex items-end gap-1 relative">
      <div
        className="absolute left-2 right-2 border-t border-dashed border-slate-300"
        style={{ bottom: `${Math.max((avg / maxV) * 100, 8)}%` }}
      />
      {recent.map((v, idx) => (
        <div
          key={idx}
          className={`flex-1 rounded-sm ${idx === recent.length - 1 ? 'bg-indigo-600' : 'bg-indigo-400/80'}`}
          style={{ height: `${Math.max((v / maxV) * 100, 10)}%` }}
        />
      ))}
    </div>
  )
}

function Stat({ label, value, unit, color }) {
  return (
    <div className="text-center px-2">
      <p className="text-[10px] text-slate-400">{label}</p>
      <p className={`text-lg font-bold text-${color}-600`}>{value}<span className="text-xs font-normal ml-0.5">{unit}</span></p>
    </div>
  )
}

function KpiGroupedTable({ defs, results, selectedMonth, catKey, displayCodeResolver = (c) => c }) {
  const sorted = useMemo(() => {
    return [...defs].sort((a, b) =>
      (a.categoryL2 || '').localeCompare(b.categoryL2 || '', 'ko') ||
      (a.categoryL3 || '').localeCompare(b.categoryL3 || '', 'ko') ||
      a.code.localeCompare(b.code)
    )
  }, [defs])

  const bodyRows = useMemo(() => {
    const out = []
    let prevL2 = null, prevL3 = null, no = 0
    for (const def of sorted) {
      const l2 = def.categoryL2 || '기타'
      const l3 = def.categoryL3 || '—'
      if (l2 !== prevL2) {
        prevL2 = l2; prevL3 = null
        const inL2 = defs.filter(d => (d.categoryL2 || '기타') === l2)
        out.push({ kind: 'l2', key: `${catKey}-l2-${l2}`, l2, count: inL2.length,
          wMonth: weightedAchievement(inL2, results, selectedMonth),
          wYtd: weightedYtdAchievement(inL2, results, selectedMonth) })
      }
      if (l3 !== prevL3) {
        prevL3 = l3
        const inL3 = defs.filter(d => (d.categoryL2 || '기타') === l2 && (d.categoryL3 || '—') === l3)
        if (inL3.length > 1) {
          out.push({ kind: 'l3', key: `${catKey}-l3-${l2}-${l3}`, l2, l3, count: inL3.length,
            wMonth: weightedAchievement(inL3, results, selectedMonth),
            wYtd: weightedYtdAchievement(inL3, results, selectedMonth) })
        }
      }
      no += 1
      out.push({ kind: 'row', key: def.code, def, no })
    }
    return out
  }, [sorted, defs, results, selectedMonth, catKey])

  const prevMonth = selectedMonth > 1 ? selectedMonth - 1 : null

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-slate-50/70 text-slate-500 text-[11px]">
          <th className="px-3 py-2 text-left font-medium w-6">NO</th>
          <th className="px-3 py-2 text-left font-medium">L2</th>
          <th className="px-3 py-2 text-left font-medium">L3</th>
          <th className="px-3 py-2 text-left font-medium min-w-[128px]">26년 레이블</th>
          <th className="px-3 py-2 text-left font-medium">지표코드</th>
          <th className="px-3 py-2 text-left font-medium min-w-[100px]">관리용 지표명</th>
          <th className="px-3 py-2 text-center font-medium">단위</th>
          <th className="px-3 py-2 text-center font-medium">비중</th>
          <th className="px-3 py-2 text-center font-medium">수집</th>
          <th className="px-3 py-2 text-right font-medium">목표</th>
          <th className="px-3 py-2 text-right font-medium">실적</th>
          <th className="px-3 py-2 text-center font-medium">당월달성</th>
          <th className="px-3 py-2 text-center font-medium">전월달성</th>
          <th className="px-3 py-2 text-center font-medium">YTD평균</th>
          <th className="px-3 py-2 text-center font-medium w-8">상태</th>
        </tr>
      </thead>
      <tbody>
        {bodyRows.map((item) => {
          if (item.kind === 'l2') {
            return (
              <tr key={item.key} className="bg-indigo-50/90 border-t-2 border-indigo-200/80">
                <td colSpan={11} className="px-3 py-2.5 text-xs font-bold text-indigo-900">
                  <span className="text-indigo-400 mr-1">▸</span>L2 · {item.l2}
                  <span className="font-normal text-slate-500 ml-2">({item.count}개)</span>
                </td>
                <td className="px-2 py-2.5 text-center text-[11px] font-bold text-indigo-800 tabular-nums">
                  {item.wMonth != null ? `${item.wMonth}%` : '—'}
                </td>
                <td className="px-2 py-2.5 text-center text-[11px] text-slate-400">—</td>
                <td className="px-2 py-2.5 text-center text-[11px] font-semibold text-indigo-700 tabular-nums">
                  {item.wYtd != null ? `${item.wYtd}%` : '—'}
                </td>
                <td />
              </tr>
            )
          }
          if (item.kind === 'l3') {
            return (
              <tr key={item.key} className="bg-slate-50/80 border-t border-slate-200">
                <td colSpan={3} className="px-3 pl-8 py-1.5 text-[11px] text-slate-600">
                  └ L3 · <span className="font-medium">{item.l3}</span>
                  <span className="text-slate-400 ml-1">({item.count}개)</span>
                </td>
                <td colSpan={8} />
                <td className="px-2 py-1.5 text-center text-[11px] font-semibold text-slate-700 tabular-nums">
                  {item.wMonth != null ? `${item.wMonth}%` : '—'}
                </td>
                <td className="px-2 py-1.5 text-center text-[11px] text-slate-400">—</td>
                <td className="px-2 py-1.5 text-center text-[11px] font-semibold text-slate-600 tabular-nums">
                  {item.wYtd != null ? `${item.wYtd}%` : '—'}
                </td>
                <td />
              </tr>
            )
          }
          const def = item.def
          const r = results.find(x => x.code === def.code && x.month === selectedMonth)
          const target = r?.target ?? 0
          const actual = r?.actual ?? 0
          const ach = r?.achievement ?? 0
          const prevA = prevMonth != null ? achievementFor(results, def.code, prevMonth) : null
          const ytd = ytdAvgAchievement(results, def.code, selectedMonth)
          return (
            <tr key={item.key} className={`border-t border-slate-100 hover:bg-blue-50/30 ${item.no % 2 ? 'bg-slate-50/20' : ''}`}>
              <td className="px-3 py-2 text-xs text-slate-400">{item.no}</td>
              <td className="px-3 py-2 text-xs text-slate-600">{def.categoryL2 ?? '—'}</td>
              <td className="px-3 py-2 text-xs text-slate-600">{def.categoryL3 ?? '—'}</td>
              <td className="px-3 py-2 text-slate-800 font-medium">{evalLabel(def)}</td>
              <td className="px-3 py-2 text-xs font-mono text-slate-500">{displayCodeResolver(def.code)}</td>
              <td className="px-3 py-2 text-xs text-slate-500">{def.name}</td>
              <td className="px-3 py-2 text-center text-slate-500">{def.unit}</td>
              <td className="px-3 py-2 text-center text-slate-600">{def.weight}%</td>
              <td className="px-3 py-2 text-center">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${def.collectType === 'AUTO' ? 'bg-sky-100 text-sky-700' : 'bg-purple-100 text-purple-700'}`}>
                  {def.collectType}
                </span>
              </td>
              <td className="px-3 py-2 text-right text-slate-600 tabular-nums">{target.toLocaleString()}</td>
              <td className="px-3 py-2 text-right font-medium text-slate-800 tabular-nums">{actual.toLocaleString()}</td>
              <td className="px-3 py-2 text-center">
                <span className={`font-semibold tabular-nums ${achClass(ach)}`}>{ach}%</span>
              </td>
              <td className="px-3 py-2 text-center text-[11px] tabular-nums">
                {prevA != null ? <span className={achClass(prevA)}>{prevA}%</span> : '—'}
              </td>
              <td className="px-3 py-2 text-center text-[11px] font-medium tabular-nums">
                {ytd != null ? <span className={achClass(ytd)}>{ytd}%</span> : '—'}
              </td>
              <td className="px-3 py-2 text-center"><StatusDot value={ach} /></td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

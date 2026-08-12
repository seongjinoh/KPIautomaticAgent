/**
 * 그룹 KPI 상세 실적.
 * - 점수 요약 행: 종합(L1) / 내부통제 반영(L2, 전행 제외) / 협업성과(L3, 규칙 있을 때만)
 * - 내부통제(ADJUST only) Lv1은 기본 접힘, 실적란에 가감점 합산
 * - GroupVizPanel: 트리 행 클릭으로 차트 연동 (동일 레벨만 복수 선택)
 */
import { useMemo, useState, useEffect, useRef, useCallback } from 'react'
import { Download, Search } from 'lucide-react'
import { evalLabel } from '../lib/kpiDisplay'
import { weightedAchievement } from '../lib/kpiAchievements'
import { formatMetricNumber } from '../lib/numberFormat'
import { computeMonthlyTarget, enrichEvalConfigEntry } from '../lib/achievementEngine'
import GroupVizPanel from './GroupVizPanel'
import IndicatorDefinitionPopup from './IndicatorDefinitionPopup'
import { isBankWideGroup } from '../lib/authService'

function MetricNum({ value, unit = '', className = '', withUnit = true }) {
  const { display, title } = formatMetricNumber(value, unit, { withUnit })
  return <span className={className} title={title}>{display}</span>
}

function achClass(v) {
  if (v == null || !Number.isFinite(Number(v))) return 'text-slate-400'
  const n = Number(v)
  if (n >= 95) return 'text-sky-600'
  if (n >= 85) return 'text-emerald-600'
  if (n >= 70) return 'text-amber-600'
  return 'text-rose-600'
}

export default function GroupDetailView({
  group, categories, definitions, results, selectedMonth, selectedYear,
  toolFilter,
  prevResults = [],
  selectedCustomTab = null,
  codebook = [],
  scopeHint = null,
  groupScore = null,
  prevGroupScore = null,
  yearGroupScores = [],
}) {
  const [hierarchyView, setHierarchyView] = useState('tree')
  const [filterPoorOnly, setFilterPoorOnly] = useState(false)
  const [filterCoreOnly, setFilterCoreOnly] = useState(false)
  const [tableSearch, setTableSearch] = useState('')
  const [chartSelection, setChartSelection] = useState({ kind: null, items: [] })
  const [definitionSource, setDefinitionSource] = useState(null)
  const chartClickTimerRef = useRef(null)

  // Agenda 모드에서 L3 토글이 남아 있으면 그룹만 보기로 보정
  useEffect(() => {
    if (selectedCustomTab && hierarchyView === 'l3') setHierarchyView('l2')
  }, [selectedCustomTab, hierarchyView])

  useEffect(() => {
    setChartSelection({ kind: null, items: [] })
  }, [group, selectedYear, selectedCustomTab])

  useEffect(() => () => {
    if (chartClickTimerRef.current) clearTimeout(chartClickTimerRef.current)
  }, [])

  const toggleChartSelect = (item) => {
    if (!item?.kind || !item?.key) return
    setChartSelection((prev) => {
      if (prev.kind && prev.kind !== item.kind) {
        return { kind: item.kind, items: [item] }
      }
      const exists = prev.items.some((x) => x.key === item.key)
      if (exists) {
        const next = prev.items.filter((x) => x.key !== item.key)
        return next.length ? { kind: prev.kind, items: next } : { kind: null, items: [] }
      }
      return { kind: item.kind || prev.kind, items: [...prev.items, item] }
    })
  }

  /** 더블클릭(지표정의)과 분리: 단일 클릭만 짧은 지연 후 차트 선택 */
  const handleChartSelectClick = useCallback((item) => {
    if (chartClickTimerRef.current) clearTimeout(chartClickTimerRef.current)
    chartClickTimerRef.current = setTimeout(() => {
      chartClickTimerRef.current = null
      toggleChartSelect(item)
    }, 250)
  }, [])

  const openIndicatorDefinition = useCallback((def) => {
    if (chartClickTimerRef.current) {
      clearTimeout(chartClickTimerRef.current)
      chartClickTimerRef.current = null
    }
    setDefinitionSource(def)
  }, [])

  const kpiDefs = useMemo(() => {
    let defs = definitions.filter(d => d.mgmtTool === 'KPI')
    if (selectedCustomTab?.metricCodes?.length) {
      const allow = new Set(selectedCustomTab.metricCodes)
      defs = defs.filter(d => allow.has(d.code) || allow.has(d.indicatorCode))
    }
    return defs
  }, [definitions, selectedCustomTab])

  const refDefs = definitions.filter(d => d.mgmtTool !== 'KPI')
  const showKpi = toolFilter === '전체' || toolFilter === 'KPI'
  const showRef = toolFilter === '전체' || toolFilter === '전략과제' || toolFilter === '모니터링'

  const coreCodes = useMemo(() => {
    return new Set((kpiDefs || []).filter(d => d.isCore).map(d => d.code).filter(Boolean))
  }, [kpiDefs])

  const filteredKpiDefs = useMemo(() => {
    const q = tableSearch.trim().toLowerCase()
    return kpiDefs.filter(def => {
      if (filterCoreOnly && !coreCodes.has(def.code)) return false
      if (filterPoorOnly) {
        const r = results.find(x => x.code === def.code && x.month === selectedMonth)
        const ach = r?.achievement
        if (ach == null || ach >= 70) return false
      }
      if (!q) return true
      const hay = `${evalLabel(def)} ${def.code} ${def.category || ''} ${def.categoryL2 || ''} ${def.categoryL3 || ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [kpiDefs, coreCodes, filterCoreOnly, filterPoorOnly, tableSearch, results, selectedMonth])

  const activeFilterCount = Number(filterPoorOnly) + Number(filterCoreOnly) + Number(Boolean(tableSearch.trim()))

  return (
    <div className="space-y-3">
      {showKpi && (
        <section className="rounded-xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
            <div>
              <h3 className="text-[13px] font-bold text-slate-900">
                {selectedCustomTab?.title
                  ? `${selectedCustomTab.title} · Agenda 실적`
                  : `${group || ''} KPI 실적`}
              </h3>
              {groupScore && !selectedCustomTab && (
                <p className="mt-1 text-[11px] text-slate-500 tabular-nums">
                  종합 {groupScore.base_score != null ? `${Number(groupScore.base_score).toFixed(2)}%` : '—'}
                  {String(groupScore.group_code || '').toUpperCase() !== 'SHB' && (
                    <>
                      {' · '}
                      가감 {Number(groupScore.adjust_points || 0) > 0 ? '+' : ''}{Number(groupScore.adjust_points || 0).toFixed(2)}점
                      ({Number(groupScore.adjust_pp || 0) > 0 ? '+' : ''}{Number(groupScore.adjust_pp || 0).toFixed(2)}%p)
                      {' · '}
                      내부통제 반영 {groupScore.group_final_score != null ? `${Number(groupScore.group_final_score).toFixed(2)}%` : '—'}
                    </>
                  )}
                  {hasL3RollupLogic(groupScore) && (
                    <>
                      {' · '}
                      협업성과 반영 {groupScore.ultimate_score != null ? `${Number(groupScore.ultimate_score).toFixed(2)}%` : '—'}
                    </>
                  )}
                </p>
              )}
              <p className="mt-0.5 text-[10px] text-slate-500">
                {selectedYear}년 {selectedMonth}월 · {filteredKpiDefs.length}개 지표
                {selectedCustomTab && <span className="ml-1.5 text-slate-400">그룹 무관 · 선택 지표 전체</span>}
                {scopeHint && <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">{scopeHint}</span>}
                {activeFilterCount > 0 && <span className="ml-1 text-blue-600">· 필터 {activeFilterCount}개 적용</span>}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <HierarchyViewToggle
                value={hierarchyView}
                onChange={setHierarchyView}
                agendaMode={Boolean(selectedCustomTab)}
              />
              <button
                type="button"
                onClick={() => setFilterPoorOnly(v => !v)}
                aria-pressed={filterPoorOnly}
                className={`h-8 rounded-md border px-2.5 text-[10px] font-semibold transition-colors ${filterPoorOnly ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}
              >
                부진만
              </button>
              <button
                type="button"
                onClick={() => setFilterCoreOnly(v => !v)}
                aria-pressed={filterCoreOnly}
                className={`h-8 rounded-md border px-2.5 text-[10px] font-semibold transition-colors ${filterCoreOnly ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'}`}
              >
                Core만
              </button>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  type="search"
                  value={tableSearch}
                  onChange={e => setTableSearch(e.target.value)}
                  placeholder="지표 검색"
                  aria-label="지표 검색"
                  className="h-8 w-48 rounded-md border border-slate-200 bg-white pl-8 pr-2 text-[10px] text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                />
              </div>
              <button
                type="button"
                onClick={() => exportKpiCsv({
                  defs: filteredKpiDefs,
                  results,
                  prevResults,
                  selectedMonth,
                  selectedYear,
                  coreCodes,
                  group,
                })}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-[10px] font-semibold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" />
                CSV
              </button>
            </div>
          </div>
          {!selectedCustomTab && (
            <GroupVizPanel
              group={group}
              defs={filteredKpiDefs}
              results={results}
              selectedMonth={selectedMonth}
              selectedYear={selectedYear}
              groupScore={groupScore}
              yearGroupScores={yearGroupScores}
              selection={chartSelection}
              onClearSelection={() => setChartSelection({ kind: null, items: [] })}
            />
          )}
          <KpiGroupedTable
            defs={filteredKpiDefs}
            results={results}
            prevResults={prevResults}
            selectedMonth={selectedMonth}
            selectedYear={selectedYear}
            categories={categories}
            coreCodes={coreCodes}
            viewMode={hierarchyView}
            layout={selectedCustomTab ? 'groupLabel' : 'eval'}
            groupScore={selectedCustomTab ? null : groupScore}
            prevGroupScore={selectedCustomTab ? null : prevGroupScore}
            hideAdjustScore={
              isBankWideGroup(group)
              || String(groupScore?.group_code || '').toUpperCase() === 'SHB'
            }
            collapseScopeKey={selectedCustomTab ? 'agenda' : (group || 'group')}
            chartSelection={chartSelection}
            onChartSelect={selectedCustomTab ? undefined : handleChartSelectClick}
            onShowDefinition={openIndicatorDefinition}
          />
          {definitionSource && (
            <IndicatorDefinitionPopup
              source={definitionSource}
              codeCatalog={codebook}
              onClose={() => setDefinitionSource(null)}
            />
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-200 bg-slate-50/70 px-4 py-2 text-[9px] text-slate-500">
            <span className="inline-flex items-center gap-1">
              <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-bold text-amber-700">Core</span>
              평가배치 지정
            </span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-500" />정상 95% 이상</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />관찰 85~95%</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-amber-500" />주의 70~85%</span>
            <span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-rose-500" />부진 70% 미만</span>
            <span className="text-slate-400">지표명 더블클릭 → 지표정의</span>
            {!selectedCustomTab && (
              <span className="text-slate-400">행 클릭 → 차트 선택</span>
            )}
          </div>
        </section>
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
                          <td className="px-3 py-2 text-slate-700">{def.name}</td>
                          <td className="px-3 py-2 text-center text-slate-500">{def.unit}</td>
                          {monthsToShow.map(m => {
                            const r = results.find(r => r.code === def.code && r.month === m)
                            return (
                              <td key={m} className="px-2 py-2 text-right text-slate-600 tabular-nums">
                                <MetricNum value={r?.actual} unit={def.unit} />
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
    </div>
  )
}

function HierarchyViewToggle({ value, onChange, agendaMode = false }) {
  const options = agendaMode
    ? [
      { id: 'tree', label: '그룹·지표' },
      { id: 'l2', label: '그룹만' },
      { id: 'leaf', label: '지표만' },
    ]
    : [
      { id: 'tree', label: '전체 트리' },
      { id: 'l2', label: 'L2 집계' },
      { id: 'l3', label: 'L3 집계' },
      { id: 'leaf', label: '지표만' },
    ]
  return (
    <div className="flex h-8 items-center rounded-md border border-slate-200 bg-slate-50 p-0.5 text-[10px] font-semibold">
      {options.map(opt => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange(opt.id)}
          aria-pressed={value === opt.id}
          className={`h-6 rounded px-2.5 transition-colors ${
            value === opt.id ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-500 hover:bg-white hover:text-slate-800'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}


function KpiGroupedTable({
  defs,
  results,
  prevResults = [],
  selectedMonth,
  selectedYear,
  categories = [],
  coreCodes = new Set(),
  viewMode = 'tree',
  layout = 'eval',
  groupScore = null,
  hideAdjustScore = false,
  collapseScopeKey = '',
  prevGroupScore = null,
  chartSelection = { kind: null, items: [] },
  onChartSelect,
  onShowDefinition,
}) {
  const [collapsed, setCollapsed] = useState(() => new Set())
  const prevMonth = selectedMonth > 1 ? selectedMonth - 1 : null
  const monthLabel = `${selectedMonth}월`
  const isGroupLabel = layout === 'groupLabel'
  const defaultCollapseSigRef = useRef('')

  const tree = useMemo(() => {
    const defSort = (a, b) => {
      const ao = Number(a.sortOrder ?? a.sort_order ?? 0)
      const bo = Number(b.sortOrder ?? b.sort_order ?? 0)
      if (ao !== bo) return ao - bo
      return String(a.code || '').localeCompare(String(b.code || ''))
    }
    const minSort = (arr) => (arr.length ? Math.min(...arr.map(d => Number(d.sortOrder ?? d.sort_order ?? 0))) : 0)

    // Agenda: 그룹 → Label (Lv1/Lv2/Lv3 생략)
    if (isGroupLabel) {
      const byGroup = new Map()
      for (const def of defs) {
        const g = def.group || '미배정'
        if (!byGroup.has(g)) byGroup.set(g, [])
        byGroup.get(g).push(def)
      }
      return [...byGroup.entries()]
        .map(([groupName, leafDefs]) => {
          const sortedLeaves = [...leafDefs].sort(defSort)
          return withAdjustSums({
            kind: 'l1',
            key: `grp::${groupName}`,
            lv1: groupName,
            defs: sortedLeaves,
            weight: roundWeight(sortedLeaves),
            wMonth: weightedAchievement(sortedLeaves, results, selectedMonth),
            wPrev: prevMonth != null ? weightedAchievement(sortedLeaves, results, prevMonth) : null,
            children: [],
          }, results, selectedMonth, prevMonth, prevResults)
        })
        .sort((a, b) => minSort(a.defs) - minSort(b.defs) || a.lv1.localeCompare(b.lv1, 'ko'))
    }

    const catOrder = categories.length
      ? categories
      : [...new Set(defs.map(d => d.category || d.evalCategoryLv1 || '미분류'))]

    const byCat = new Map()
    for (const def of defs) {
      const lv1 = def.category || def.evalCategoryLv1 || '미분류'
      const l2 = def.categoryL2 || '기타'
      const l3 = def.categoryL3 || '—'
      if (!byCat.has(lv1)) byCat.set(lv1, new Map())
      const byL2 = byCat.get(lv1)
      if (!byL2.has(l2)) byL2.set(l2, new Map())
      const byL3 = byL2.get(l2)
      if (!byL3.has(l3)) byL3.set(l3, [])
      byL3.get(l3).push(def)
    }

    // leaf sortOrder 블록(minSort)이 Lv1 표시순서를 결정 — 평가배치에서 형제 이동 시 상속
    const orderedCats = [...byCat.keys()].sort((a, b) => {
      const da = minSort([...(byCat.get(a)?.values() || [])].flatMap(m => [...m.values()].flat()))
      const db = minSort([...(byCat.get(b)?.values() || [])].flatMap(m => [...m.values()].flat()))
      if (da !== db) return da - db
      const ia = catOrder.indexOf(a)
      const ib = catOrder.indexOf(b)
      if (ia >= 0 && ib >= 0 && ia !== ib) return ia - ib
      return a.localeCompare(b, 'ko')
    })

    return orderedCats.map(lv1 => {
      const byL2 = byCat.get(lv1)
      const l2Nodes = [...byL2.entries()]
        .map(([l2, byL3]) => {
          const l3Nodes = [...byL3.entries()]
            .map(([l3, leafDefs]) => {
              const sortedLeaves = [...leafDefs].sort(defSort)
              return withAdjustSums({
                kind: 'l3',
                key: `${lv1}::${l2}::${l3}`,
                lv1,
                l2,
                l3,
                defs: sortedLeaves,
                weight: roundWeight(sortedLeaves),
                wMonth: weightedAchievement(sortedLeaves, results, selectedMonth),
                wPrev: prevMonth != null ? weightedAchievement(sortedLeaves, results, prevMonth) : null,
              }, results, selectedMonth, prevMonth, prevResults)
            })
            .sort((a, b) => minSort(a.defs) - minSort(b.defs) || a.l3.localeCompare(b.l3, 'ko'))
          const l2Defs = l3Nodes.flatMap(n => n.defs)
          return withAdjustSums({
            kind: 'l2',
            key: `${lv1}::${l2}`,
            lv1,
            l2,
            defs: l2Defs,
            weight: roundWeight(l2Defs),
            wMonth: weightedAchievement(l2Defs, results, selectedMonth),
            wPrev: prevMonth != null ? weightedAchievement(l2Defs, results, prevMonth) : null,
            children: l3Nodes,
          }, results, selectedMonth, prevMonth, prevResults)
        })
        .sort((a, b) => minSort(a.defs) - minSort(b.defs) || a.l2.localeCompare(b.l2, 'ko'))
      const lv1Defs = l2Nodes.flatMap(n => n.defs)
      return withAdjustSums({
        kind: 'l1',
        key: `l1::${lv1}`,
        lv1,
        defs: lv1Defs,
        weight: roundWeight(lv1Defs),
        wMonth: weightedAchievement(lv1Defs, results, selectedMonth),
        wPrev: prevMonth != null ? weightedAchievement(lv1Defs, results, prevMonth) : null,
        children: l2Nodes,
      }, results, selectedMonth, prevMonth, prevResults)
    })
  }, [defs, results, prevResults, selectedMonth, prevMonth, categories, isGroupLabel])

  // 내부통제(ADJUST) Lv1은 기본 접힘 — 합산 실적만 보이고 펼치면 상세
  useEffect(() => {
    if (isGroupLabel) return
    const keys = tree
      .filter((n) => n.kind === 'l1' && (n.isAdjustOnly || String(n.lv1 || '').includes('내부통제')))
      .map((n) => n.key)
    const sig = `${collapseScopeKey}::${keys.join('|')}`
    if (!keys.length) return
    if (sig === defaultCollapseSigRef.current) return
    defaultCollapseSigRef.current = sig
    setCollapsed((prev) => {
      const next = new Set(prev)
      keys.forEach((k) => next.add(k))
      return next
    })
  }, [tree, isGroupLabel, collapseScopeKey])

  const toggle = (key) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const expandAll = () => setCollapsed(new Set())
  const collapseAll = () => {
    const keys = new Set()
    if (isGroupLabel) {
      tree.forEach(g => keys.add(g.key))
    } else {
      tree.forEach(l1 => {
        keys.add(l1.key)
        l1.children.forEach(l2 => {
          keys.add(l2.key)
          l2.children.forEach(l3 => keys.add(l3.key))
        })
      })
    }
    setCollapsed(keys)
  }

  const bodyRows = useMemo(() => {
    const out = []
    let no = 0

    if (isGroupLabel) {
      const mode = viewMode === 'l3' ? 'l2' : viewMode
      if (mode === 'l2') {
        tree.forEach(g => out.push({ ...g, depth: 0 }))
        return out
      }
      if (mode === 'leaf') {
        tree.forEach(g => {
          g.defs.forEach(def => {
            no += 1
            out.push({ kind: 'row', key: `${g.lv1}::${def.code}`, def, no, depth: 0, groupName: g.lv1 })
          })
        })
        return out
      }
      tree.forEach(g => {
        out.push({ ...g, depth: 0, collapsed: collapsed.has(g.key) })
        if (collapsed.has(g.key)) return
        g.defs.forEach(def => {
          no += 1
          out.push({ kind: 'row', key: `${g.lv1}::${def.code}`, def, no, depth: 1, groupName: g.lv1 })
        })
      })
      return out
    }

    if (viewMode === 'l2') {
      tree.forEach(l1 => {
        out.push({ ...l1, depth: 0 })
        l1.children.forEach(l2 => out.push({ ...l2, depth: 1 }))
      })
      return injectGroupScoreRows(out, groupScore, viewMode, isGroupLabel, hideAdjustScore, defs, prevGroupScore)
    }

    if (viewMode === 'l3') {
      tree.forEach(l1 => {
        out.push({ kind: 'l1-section', key: `${l1.key}::sec`, lv1: l1.lv1, count: l1.defs.length, isAdjustOnly: l1.isAdjustOnly })
        l1.children.forEach(l2 => {
          out.push({ kind: 'l2-section', key: `${l2.key}::sec`, l2: l2.l2, count: l2.defs.length })
          l2.children.forEach(l3 => out.push({ ...l3, depth: 2 }))
        })
      })
      return injectGroupScoreRows(out, groupScore, viewMode, isGroupLabel, hideAdjustScore, defs, prevGroupScore)
    }

    if (viewMode === 'leaf') {
      tree.forEach(l1 => {
        l1.children.forEach(l2 => {
          l2.children.forEach(l3 => {
            l3.defs.forEach(def => {
              no += 1
              out.push({ kind: 'row', key: def.code, def, no, depth: 0, lv1: l1.lv1, l2: l2.l2, l3: l3.l3 })
            })
          })
        })
      })
      return injectGroupScoreRows(out, groupScore, viewMode, isGroupLabel, hideAdjustScore, defs, prevGroupScore)
    }

    tree.forEach(l1 => {
      out.push({ ...l1, depth: 0, collapsed: collapsed.has(l1.key) })
      if (collapsed.has(l1.key)) return
      l1.children.forEach(l2 => {
        out.push({ ...l2, depth: 1, collapsed: collapsed.has(l2.key) })
        if (collapsed.has(l2.key)) return
        l2.children.forEach(l3 => {
          out.push({ ...l3, depth: 2, collapsed: collapsed.has(l3.key) })
          if (collapsed.has(l3.key)) return
          l3.defs.forEach(def => {
            no += 1
            out.push({ kind: 'row', key: def.code, def, no, depth: 3, lv1: l1.lv1, l2: l2.l2, l3: l3.l3 })
          })
        })
      })
    })
    return injectGroupScoreRows(out, groupScore, viewMode, isGroupLabel, hideAdjustScore, defs, prevGroupScore)
  }, [tree, viewMode, collapsed, isGroupLabel, groupScore, hideAdjustScore, defs, prevGroupScore])

  const showTreeControls = viewMode === 'tree'
  const colCount = 11
  const hierarchyHeader = isGroupLabel ? '그룹 / Label' : '평가체계'

  return (
    <div>
      {showTreeControls && (
        <div className="flex items-center justify-end gap-1 border-b border-slate-200 bg-slate-50/50 px-3 py-1">
          <button type="button" onClick={expandAll} className="rounded px-2 py-1 text-[9px] font-medium text-slate-500 hover:bg-white hover:text-slate-800">모두 펼치기</button>
          <span className="h-3 w-px bg-slate-200" />
          <button type="button" onClick={collapseAll} className="rounded px-2 py-1 text-[9px] font-medium text-slate-500 hover:bg-white hover:text-slate-800">모두 접기</button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] table-fixed border-separate border-spacing-0 text-[10px]">
          <colgroup>
            <col className="w-[220px]" />
            <col className="w-[52px]" />
            <col className="w-[84px]" />
            <col className="w-[84px]" />
            <col className="w-[84px]" />
            <col className="w-[84px]" />
            <col className="w-[84px]" />
            <col className="w-[84px]" />
            <col className="w-[168px]" />
            <col className="w-[72px]" />
            <col className="w-[64px]" />
          </colgroup>
          <thead>
            <tr className="text-[9px]">
              <th rowSpan={2} className="sticky left-0 z-10 border-b border-r border-slate-600 bg-slate-900 px-3 py-2 text-center font-semibold text-white align-middle">{hierarchyHeader}</th>
              <th rowSpan={2} className="border-b border-r border-slate-600 bg-slate-900 px-2 py-2 text-center font-semibold text-white align-middle">비중</th>
              <th rowSpan={2} className="border-b border-r border-slate-600 bg-slate-900 px-2 py-2 text-center font-semibold text-white align-middle">연간목표</th>
              <th rowSpan={2} className="border-b border-r border-slate-600 bg-slate-900 px-2 py-2 text-center font-semibold text-white align-middle">{monthLabel} 목표</th>
              <th rowSpan={2} className="border-b border-r border-slate-600 bg-slate-900 px-2 py-2 text-center font-semibold text-white align-middle">{monthLabel} 실적</th>
              <th colSpan={2} className="h-5 border-b border-r border-slate-600 bg-slate-800 px-2 py-1 text-center font-medium tracking-wide text-slate-300">실적 증감</th>
              <th rowSpan={2} className="border-b border-r border-slate-600 bg-slate-900 px-2 py-2 text-center font-semibold text-white align-middle">전년동월비</th>
              <th rowSpan={2} className="border-b border-r border-slate-600 bg-slate-900 px-2 py-2 text-center font-semibold text-white align-middle">환산달성률</th>
              <th className="h-5 border-b border-r border-slate-600 bg-slate-800 px-2 py-1 text-center font-medium tracking-wide text-slate-300">달성률 증감</th>
              <th rowSpan={2} className="sticky right-0 z-10 border-b border-l border-slate-600 bg-slate-900 px-2 py-2 text-center font-semibold text-white align-middle shadow-[-4px_0_8px_rgba(15,23,42,0.12)]">상태</th>
            </tr>
            <tr className="text-[9px]">
              <th className="border-b border-r border-slate-600 bg-slate-700 px-2 py-1.5 text-center font-medium text-slate-100">목표대비</th>
              <th className="border-b border-r border-slate-600 bg-slate-700 px-2 py-1.5 text-center font-medium text-slate-100">전월비</th>
              <th className="border-b border-r border-slate-600 bg-slate-700 px-2 py-1.5 text-center font-medium text-slate-100" title="전월 환산달성률 대비 (%p)">전월비</th>
            </tr>
          </thead>
          <tbody>
            {bodyRows.length === 0 && (
              <tr>
                <td colSpan={colCount} className="px-4 py-10 text-center text-sm text-slate-400">표시할 지표가 없습니다.</td>
              </tr>
            )}
            {bodyRows.map((item) => {
              if (item.kind === 'score-summary') {
                const tdBorder = 'border-b border-r border-slate-700 px-2 py-2.5 align-middle'
                const statusTd = 'sticky right-0 z-[1] border-b border-l border-slate-700 px-2 py-2.5 align-middle text-center bg-[#0f2744] shadow-[-4px_0_8px_rgba(15,23,42,0.18)]'
                return (
                  <tr key={item.key} className="bg-[#0f2744] text-white">
                    <td className={`sticky left-0 z-[1] ${tdBorder} pl-3 bg-[#0f2744]`}>
                      <span className="text-[12px] font-bold tracking-tight text-white">
                        {item.label}
                      </span>
                    </td>
                    <td className={`${tdBorder} whitespace-nowrap text-right text-[11px] font-bold tabular-nums text-slate-200`}>
                      {fmtWeight(item.weight)}%
                    </td>
                    <td className={`${tdBorder} text-right text-[10px] text-slate-500`}>—</td>
                    <td className={`${tdBorder} text-right text-[10px] text-slate-500`}>—</td>
                    <td className={`${tdBorder} text-right text-[10px] text-slate-500`}>—</td>
                    <td className={`${tdBorder} text-right text-[10px] text-slate-500`}>—</td>
                    <td className={`${tdBorder} text-right text-[10px] text-slate-500`}>—</td>
                    <td className={`${tdBorder} text-right text-[10px] text-slate-500`}>—</td>
                    <td className={`${tdBorder} text-right align-middle`}>
                      <AchievementPct value={item.score} light size="lg" />
                    </td>
                    <td className={`${tdBorder} whitespace-nowrap text-right text-[10px] tabular-nums align-middle`}>
                      <MomCell value={item.scoreMom} light />
                    </td>
                    <td className={statusTd}>
                      <span className="text-[10px] text-slate-500">—</span>
                    </td>
                  </tr>
                )
              }

              if (item.kind === 'l1-section' || item.kind === 'l2-section') {
                return (
                  <tr key={item.key} className="bg-slate-50/70">
                    <td colSpan={colCount} className="px-3 py-1.5 text-[10px] font-bold tracking-wide text-slate-400">
                      {item.kind === 'l1-section' ? item.lv1 : item.l2}
                      <span className="ml-1 font-normal">({item.count}개)</span>
                    </td>
                  </tr>
                )
              }

              if (item.kind === 'l1' || item.kind === 'l2' || item.kind === 'l3') {
                const isL1 = item.kind === 'l1'
                const isL2 = item.kind === 'l2'
                const isAdjustOnly = Boolean(item.isAdjustOnly)
                const pad = isL1 ? 'pl-3' : isL2 ? 'pl-7' : 'pl-11'
                const canToggle = viewMode === 'tree'
                const achMom = momDiff(item.wMonth, item.wPrev)
                const label = isL1 ? item.lv1 : isL2 ? item.l2 : item.l3
                const tdBorder = isAdjustOnly
                  ? 'border-b border-r border-slate-200 px-2 py-1 align-middle'
                  : isL1 ? TD_L1 : isL2 ? TD_L2 : TD_L3
                // 내부통제(ADJUST)는 보조 행 · 일반 Lv1만 진한 남색
                const rowBg = isAdjustOnly
                  ? 'bg-slate-100 text-slate-700'
                  : isL1
                    ? 'bg-slate-800 text-white'
                    : isL2
                      ? 'bg-slate-200 text-slate-800'
                      : 'bg-slate-100 text-slate-700'
                const stickyBg = isAdjustOnly
                  ? 'bg-slate-100'
                  : isL1 ? 'bg-slate-800' : isL2 ? 'bg-slate-200' : 'bg-slate-100'
                const muted = 'text-slate-400'
                const dash = <td className={`${tdBorder} text-right text-[10px] ${muted}`}>—</td>
                const adjustUnit = item.defs?.[0]?.unit || '점'
                const adjustMom = (item.adjustSum != null && item.adjustSumPrev != null)
                  ? Math.round((item.adjustSum - item.adjustSumPrev) * 100) / 100
                  : null
                const adjustYoy = (item.adjustSum != null && item.adjustSumYoy != null)
                  ? Math.round((item.adjustSum - item.adjustSumYoy) * 100) / 100
                  : null
                const labelCls = isAdjustOnly
                  ? 'text-slate-600'
                  : isL1 ? 'text-white' : isL2 ? 'text-slate-900' : 'text-slate-700'
                const countCls = isAdjustOnly
                  ? 'text-slate-500'
                  : isL1 ? 'text-slate-300' : isL2 ? 'text-slate-600' : 'text-slate-500'
                const weightTextCls = isAdjustOnly
                  ? 'text-slate-600'
                  : isL1 ? 'text-white' : 'text-slate-700'
                const selectKind = item.kind
                const selected = Boolean(onChartSelect) && chartSelection?.kind === selectKind
                  && (chartSelection.items || []).some((x) => x.key === item.key)
                const selectPayload = {
                  kind: selectKind,
                  key: item.key,
                  label,
                  defs: item.defs || [],
                  isAdjustOnly,
                }
                return (
                  <tr
                    key={item.key}
                    className={`${rowBg} ${selected ? 'ring-2 ring-inset ring-blue-400' : ''} ${onChartSelect ? 'cursor-pointer' : ''}`}
                    onClick={() => onChartSelect?.(selectPayload)}
                  >
                    <td className={`sticky left-0 z-[1] ${tdBorder} ${pad} ${stickyBg}`}>
                      <button
                        type="button"
                        disabled={!canToggle}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (canToggle) toggle(item.key)
                        }}
                        aria-expanded={canToggle ? !item.collapsed : undefined}
                        aria-label={`${label} ${item.collapsed ? '펼치기' : '접기'}`}
                        className={`flex w-full items-center gap-1.5 text-left ${canToggle ? 'cursor-pointer' : 'cursor-default'}`}
                      >
                        {canToggle && (
                          <span className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border text-[8px] ${
                            isAdjustOnly
                              ? 'border-slate-300 bg-white text-slate-500'
                              : isL1
                                ? 'border-slate-500 bg-slate-700 text-white'
                                : isL2
                                  ? 'border-slate-400 bg-slate-100 text-slate-600'
                                  : 'border-slate-300 bg-white text-slate-500'
                          }`}>
                            {item.collapsed ? '▸' : '▾'}
                          </span>
                        )}
                        <span className={`text-[10px] font-semibold ${labelCls}`}>
                          {label}
                        </span>
                        <span className={`text-[9px] font-medium ${countCls}`}>
                          ({item.defs.length})
                        </span>
                      </button>
                    </td>
                    <td className={`${tdBorder} whitespace-nowrap text-right text-[10px] font-semibold tabular-nums ${weightTextCls}`}>
                      {fmtWeight(item.weight)}%
                    </td>
                    {dash}
                    {dash}
                    {isAdjustOnly ? (
                      <td className={`${tdBorder} whitespace-nowrap text-right text-[10px] font-semibold tabular-nums text-slate-800`}>
                        <MetricNum value={item.adjustSum} unit={adjustUnit} />
                      </td>
                    ) : dash}
                    {isAdjustOnly ? (
                      <td className={`${tdBorder} whitespace-nowrap text-right text-[10px] tabular-nums`}>
                        <DeltaCell value={item.adjustSum} goalDirection="increase" unit={adjustUnit} />
                      </td>
                    ) : dash}
                    {isAdjustOnly ? (
                      <td className={`${tdBorder} whitespace-nowrap text-right text-[10px] tabular-nums`}>
                        <DeltaCell value={adjustMom} goalDirection="increase" unit={adjustUnit} />
                      </td>
                    ) : dash}
                    {isAdjustOnly ? (
                      <td className={`${tdBorder} whitespace-nowrap text-right text-[10px] tabular-nums`}>
                        <DeltaCell value={adjustYoy} goalDirection="increase" unit={adjustUnit} />
                      </td>
                    ) : (
                      <td className={`${tdBorder} whitespace-nowrap text-right text-[10px] ${muted}`}>—</td>
                    )}
                    <td className={`${tdBorder} text-right align-middle`}>
                      {isAdjustOnly ? (
                        <span className={`text-[10px] ${muted}`}>—</span>
                      ) : (
                        <AchievementPct value={item.wMonth} light={isL1} />
                      )}
                    </td>
                    <td className={`${tdBorder} whitespace-nowrap text-right text-[10px] tabular-nums align-middle`}>
                      {isAdjustOnly ? (
                        <span className={`text-[10px] ${muted}`}>—</span>
                      ) : (
                        <MomCell value={achMom} light={isL1} />
                      )}
                    </td>
                    <td className={isAdjustOnly
                      ? 'sticky right-0 z-[1] border-b border-l border-slate-200 px-2 py-1 align-middle text-center bg-slate-100 shadow-[-4px_0_8px_rgba(15,23,42,0.06)]'
                      : isL1 ? TD_STATUS_L1 : isL2 ? TD_STATUS_L2 : TD_STATUS_L3}>
                      {isAdjustOnly ? (
                        <span className={`text-[10px] ${muted}`}>—</span>
                      ) : (
                        <StatusBadge value={item.wMonth} light={isL1} />
                      )}
                    </td>
                  </tr>
                )
              }

              const def = item.def
              const metrics = leafMetrics({
                def,
                results,
                prevResults,
                selectedMonth,
                prevMonth,
                selectedYear,
              })
              const depthPad = item.depth === 3 ? 'pl-14' : item.depth === 1 ? 'pl-7' : 'pl-3'
              const isCore = coreCodes.has(def.code)
              const goalDirection = def.goalDirection || 'increase'
              const leafKey = item.key
              const leafSelected = Boolean(onChartSelect) && chartSelection?.kind === 'leaf'
                && (chartSelection.items || []).some((x) => x.key === leafKey || x.key === def.code)
              const leafPayload = {
                kind: 'leaf',
                key: def.code,
                label: evalLabel(def),
                def,
              }

              return (
                <tr
                  key={item.key}
                  className={`group/row bg-white transition-colors hover:bg-blue-50/40 ${leafSelected ? 'bg-blue-50 ring-2 ring-inset ring-blue-400' : ''} ${onChartSelect ? 'cursor-pointer' : ''}`}
                  onClick={() => onChartSelect?.(leafPayload)}
                >
                  <td className={`sticky left-0 z-[1] ${leafSelected ? 'bg-blue-50' : 'bg-white'} group-hover/row:bg-blue-50 ${TD} ${depthPad}`}>
                    <div className="flex min-w-0 items-center gap-1">
                      {isCore && (
                        <span className="shrink-0 rounded px-1 py-0.5 text-[8px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                          Core
                        </span>
                      )}
                      <p
                        className="truncate text-[11px] font-medium leading-tight text-slate-800 cursor-help"
                        title="더블클릭: 지표정의 보기"
                        onDoubleClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          onShowDefinition?.(def)
                        }}
                      >
                        {evalLabel(def)}
                      </p>
                    </div>
                  </td>
                  <td className={`${TD} whitespace-nowrap text-right text-[10px] tabular-nums text-slate-600`}>{fmtWeight(def.weight)}%</td>
                  <td className={`${TD} whitespace-nowrap text-right text-[10px] tabular-nums text-slate-600`}><MetricNum value={metrics.annual} unit={def.unit} /></td>
                  <td className={`${TD} whitespace-nowrap text-right text-[10px] tabular-nums text-slate-600`}><MetricNum value={metrics.target} unit={def.unit} /></td>
                  <td className={`${TD} whitespace-nowrap text-right text-[10px] font-semibold tabular-nums text-slate-800`}>
                    <MetricNum value={metrics.actual} unit={def.unit} />
                  </td>
                  <td className={`${TD} whitespace-nowrap text-right text-[10px] tabular-nums`}>
                    <DeltaCell value={metrics.gap} goalDirection={goalDirection} unit={def.unit} />
                  </td>
                  <td className={`${TD} whitespace-nowrap text-right text-[10px] tabular-nums`}>
                    <DeltaCell value={metrics.momDelta} goalDirection={goalDirection} unit={def.unit} />
                  </td>
                  <td className={`${TD} whitespace-nowrap text-right text-[10px] tabular-nums`}>
                    <DeltaCell value={metrics.yoyDelta} goalDirection={goalDirection} unit={def.unit} />
                  </td>
                  <td className={`${TD} text-right align-middle`}>
                    <AchievementBar value={metrics.ach} />
                  </td>
                  <td className={`${TD} whitespace-nowrap text-right text-[10px] tabular-nums align-middle`}>
                    <MomCell value={metrics.achMom} />
                  </td>
                  <td className={`${TD_STATUS} ${leafSelected ? 'bg-blue-50' : 'bg-white'} group-hover/row:bg-blue-50`}>
                    <StatusBadge value={metrics.ach} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function alignToDefUnit(value, resultUnit, defUnit) {
  if (value == null || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const from = String(resultUnit || '').trim()
  const to = String(defUnit || '').trim()
  if (!from || !to || from === to) return n
  // 실적테이블이 구단위(억원 등)로 남아 있고 평가배치는 기본단위(원)인 경우
  if (to === '원') {
    if (from === '억원') return n * 1e8
    if (from === '만원') return n * 1e4
    if (from === '천원') return n * 1e3
    if (from === '조원') return n * 1e12
  }
  return n
}

function leafMetrics({ def, results, prevResults, selectedMonth, prevMonth, selectedYear }) {
  const r = results.find(x => x.code === def.code && x.month === selectedMonth)
  const prev = prevMonth != null ? results.find(x => x.code === def.code && x.month === prevMonth) : null
  const yoy = (prevResults || []).find(x => x.code === def.code && x.month === selectedMonth)
  const enriched = enrichEvalConfigEntry(def)
  const annual = Number(def.annualTarget ?? 0)
  // 월목표는 평가배치 기준으로 재산정 (구 실적행의 억원 스케일 오염 방지)
  const computedTarget = computeMonthlyTarget(enriched, selectedMonth, selectedYear ?? def.year)
  const target = computedTarget != null
    ? Number(computedTarget)
    : alignToDefUnit(r?.target, r?.unit, def.unit)
  const actual = alignToDefUnit(r?.actual, r?.unit, def.unit)
  const prevActual = alignToDefUnit(prev?.actual, prev?.unit ?? r?.unit, def.unit)
  const yoyActual = alignToDefUnit(yoy?.actual, yoy?.unit, def.unit)
  const ach = r?.achievement != null ? Number(r.achievement) : null
  const prevAch = prev?.achievement != null ? Number(prev.achievement) : null
  const gap = actual != null && target != null ? actual - target : null
  // 실적 전월비·전년동월비 = 절대 증감 (비율 아님)
  const momDelta = (actual != null && prevActual != null && Number.isFinite(actual) && Number.isFinite(prevActual))
    ? Math.round((actual - prevActual) * 100) / 100
    : null
  const yoyDelta = (actual != null && yoyActual != null && Number.isFinite(actual) && Number.isFinite(yoyActual))
    ? Math.round((actual - yoyActual) * 100) / 100
    : null
  const achMom = momDiff(ach, prevAch)
  return { annual, target, actual, prevActual, yoyActual, ach, prevAch, gap, momDelta, yoyDelta, achMom }
}

function isAdjustDef(def) {
  return String(def?.contributionMode || def?.contribution_mode || '').toUpperCase() === 'ADJUST'
}

function isAdjustOnlyDefs(defs = []) {
  return defs.length > 0 && defs.every(isAdjustDef)
}

/** 내부통제(ADJUST) 묶음 실적 = 가감점 합산 */
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

function withAdjustSums(node, results, selectedMonth, prevMonth, prevResults) {
  if (!isAdjustOnlyDefs(node.defs)) {
    return { ...node, isAdjustOnly: false, adjustSum: null, adjustSumPrev: null, adjustSumYoy: null }
  }
  return {
    ...node,
    isAdjustOnly: true,
    adjustSum: sumAdjustActual(node.defs, results, selectedMonth),
    adjustSumPrev: prevMonth != null ? sumAdjustActual(node.defs, results, prevMonth) : null,
    adjustSumYoy: sumAdjustActual(node.defs, prevResults || [], selectedMonth),
  }
}

/** L3 UI 행 표시 여부: 해당 그룹에 롤업 규칙이 매핑되어 rollup_set_id가 채워진 경우 */
function hasL3RollupLogic(groupScore) {
  if (!groupScore) return false
  const id = groupScore.rollup_set_id ?? groupScore.rollupSetId
  return id != null && id !== ''
}

/** 내부통제(ADJUST only) 블록 시작 여부 — 점수 요약 행 삽입 앵커 */
function isInternalControlBlockStart(item) {
  if (!item) return false
  if (item.kind === 'l1' || item.kind === 'l1-section') {
    if (item.isAdjustOnly) return true
    return String(item.lv1 || '').includes('내부통제')
  }
  return false
}

function findInternalControlBlockEnd(rows, start, viewMode) {
  let end = start
  for (let i = start + 1; i < rows.length; i++) {
    const r = rows[i]
    if (viewMode === 'l3') {
      if (r.kind === 'l1-section') break
    } else if (viewMode === 'l2') {
      if (r.kind === 'l1') break
    } else if (viewMode === 'tree') {
      if (r.kind === 'l1') break
    } else {
      break
    }
    end = i
  }
  return end
}

/**
 * 실적트리에 그룹 점수 요약 행을 끼워 넣는다.
 * 순서: …WEIGHT 카테고리… → L1(종합) → 내부통제 블록 → L2 → (규칙 시) L3
 * 내부통제 뒤에 남은 카테고리는 L1 앞으로 올려 L3 아래에 지표가 오지 않게 함.
 */
function injectGroupScoreRows(rows, groupScore, viewMode, isGroupLabel, hideAdjustScore = false, defs = [], prevGroupScore = null) {
  if (isGroupLabel || !groupScore || !rows.length) return rows

  const weight = roundWeight((defs || []).filter((d) => !isAdjustDef(d)))
  const currBase = groupScore.base_score ?? groupScore.baseScore ?? null
  const currL2 = groupScore.group_final_score ?? groupScore.groupFinalScore ?? null
  const currL3 = groupScore.ultimate_score ?? groupScore.ultimateScore ?? null
  const prevBase = prevGroupScore?.base_score ?? prevGroupScore?.baseScore ?? null
  const prevL2 = prevGroupScore?.group_final_score ?? prevGroupScore?.groupFinalScore ?? null
  const prevL3 = prevGroupScore?.ultimate_score ?? prevGroupScore?.ultimateScore ?? null

  const scoreL1 = {
    kind: 'score-summary',
    level: 'L1',
    key: 'score::l1',
    label: '종합 달성률',
    score: currBase,
    scoreMom: momDiff(currBase, prevBase),
    weight,
  }
  const scoreL2 = hideAdjustScore
    ? null
    : {
      kind: 'score-summary',
      level: 'L2',
      key: 'score::l2',
      label: '내부통제 반영 달성률',
      score: currL2,
      scoreMom: momDiff(currL2, prevL2),
      weight,
    }
  const scoreL3 = hasL3RollupLogic(groupScore)
    ? {
      kind: 'score-summary',
      level: 'L3',
      key: 'score::l3',
      label: '협업성과 반영 달성률',
      score: currL3,
      scoreMom: momDiff(currL3, prevL3),
      weight,
    }
    : null

  const appendScoreBlock = (base, adjustBlock = []) => {
    const out = [...base, scoreL1, ...adjustBlock]
    if (scoreL2) out.push(scoreL2)
    if (scoreL3) out.push(scoreL3)
    return out
  }

  if (viewMode === 'leaf') {
    return appendScoreBlock(rows)
  }

  const start = rows.findIndex(isInternalControlBlockStart)
  if (start < 0) {
    return appendScoreBlock(rows)
  }

  const end = findInternalControlBlockEnd(rows, start, viewMode)
  const before = rows.slice(0, start)
  const adjustBlock = rows.slice(start, end + 1)
  const after = rows.slice(end + 1)
  // 내부통제 뒤에 남은 카테고리가 있으면 점수 블록 앞으로 올려 L3 아래에 지표가 안 나오게
  return appendScoreBlock([...before, ...after], adjustBlock)
}

function roundWeight(defs = []) {
  const sum = defs.reduce((s, d) => s + Number(d.weight || 0), 0)
  return Math.round(sum * 100) / 100
}

function fmtWeight(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '0.00'
  return (Math.round(n * 100) / 100).toFixed(2)
}

function signedPrefix(value) {
  if (value == null || !Number.isFinite(Number(value)) || Number(value) === 0) return ''
  return Number(value) > 0 ? '+' : '△'
}

const TD = 'border-b border-r border-slate-200 px-2 py-1 align-middle'
const TD_L1 = 'border-b border-r border-slate-700 px-2 py-1 align-middle'
const TD_L2 = 'border-b border-r border-slate-200 px-2 py-1 align-middle'
const TD_L3 = 'border-b border-r border-slate-200 px-2 py-1 align-middle'
const TD_STATUS = 'sticky right-0 z-[1] border-b border-l border-slate-200 px-2 py-1 align-middle text-center shadow-[-4px_0_8px_rgba(15,23,42,0.06)]'
const TD_STATUS_L1 = 'sticky right-0 z-[1] border-b border-l border-slate-700 px-2 py-1 align-middle text-center bg-slate-800 shadow-[-4px_0_8px_rgba(15,23,42,0.18)]'
const TD_STATUS_L2 = 'sticky right-0 z-[1] border-b border-l border-slate-200 px-2 py-1 align-middle text-center bg-slate-200 shadow-[-4px_0_8px_rgba(15,23,42,0.06)]'
const TD_STATUS_L3 = 'sticky right-0 z-[1] border-b border-l border-slate-200 px-2 py-1 align-middle text-center bg-slate-100 shadow-[-4px_0_8px_rgba(15,23,42,0.06)]'

function momDiff(curr, prev) {
  if (curr == null || prev == null) return null
  return Math.round((curr - prev) * 100) / 100
}

function MomCell({ value, light = false }) {
  if (value == null) return <span className={light ? 'text-slate-400' : 'text-slate-400'}>—</span>
  const tone = value >= 0
    ? (light ? 'text-emerald-300' : 'text-emerald-600')
    : (light ? 'text-rose-300' : 'text-rose-600')
  return (
    <span className={`text-[10px] font-semibold tabular-nums ${tone}`}>
      {signedPrefix(value)}{Math.abs(value).toFixed(2)}%p
    </span>
  )
}

function isFavorableChange(value, goalDirection = 'increase') {
  if (value == null || !Number.isFinite(value) || value === 0) return null
  const decrease = goalDirection === 'decrease'
  // 증가목표: 상승이 유리 / 감소목표: 하락이 유리
  return decrease ? value < 0 : value > 0
}

function DeltaCell({ value, goalDirection = 'increase', unit = '' }) {
  if (value == null || !Number.isFinite(value)) return <span className="text-slate-400">—</span>
  const favorable = isFavorableChange(value, goalDirection)
  const color = favorable == null
    ? 'text-slate-600'
    : favorable
      ? 'text-emerald-600'
      : 'text-rose-600'
  const { display, title } = formatMetricNumber(Math.abs(value), unit, { withUnit: true })
  return (
    <span className={`font-medium tabular-nums ${color}`} title={title}>
      {signedPrefix(value)}{display}
    </span>
  )
}

function statusLabel(value) {
  if (value == null || !Number.isFinite(Number(value))) return null
  const v = Number(value)
  if (v >= 95) return '정상'
  if (v >= 85) return '관찰'
  if (v >= 70) return '주의'
  return '부진'
}

function StatusBadge({ value, light = false }) {
  const label = statusLabel(value)
  if (!label) {
    return <span className={`text-[10px] ${light ? 'text-slate-400' : 'text-slate-400'}`}>—</span>
  }
  const cls = label === '정상'
    ? (light ? 'bg-sky-400/20 text-sky-200' : 'bg-sky-50 text-sky-700')
    : label === '관찰'
      ? (light ? 'bg-emerald-400/20 text-emerald-200' : 'bg-emerald-50 text-emerald-700')
      : label === '주의'
        ? (light ? 'bg-amber-400/20 text-amber-200' : 'bg-amber-50 text-amber-700')
        : (light ? 'bg-rose-400/20 text-rose-200' : 'bg-rose-50 text-rose-700')
  return <span className={`inline-flex min-w-8 justify-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${cls}`}>{label}</span>
}

function AchievementPct({ value, light = false, size = 'sm' }) {
  if (value == null || !Number.isFinite(Number(value))) {
    return <span className={`block text-right text-[10px] ${light ? 'text-slate-400' : 'text-slate-400'}`}>—</span>
  }
  const v = Number(value)
  const textCls = light
    ? (v >= 95 ? 'text-sky-300' : v >= 85 ? 'text-emerald-300' : v >= 70 ? 'text-amber-300' : 'text-rose-300')
    : achClass(v)
  const sizeCls = size === 'lg' ? 'text-[13px] font-black' : 'text-[10px] font-semibold'
  return (
    <span className={`block text-right tabular-nums ${sizeCls} ${textCls}`}>
      {v.toFixed(2)}%
    </span>
  )
}

function achievementBarGradient(value) {
  if (value >= 95) return 'linear-gradient(90deg, #7dd3fc 0%, #38bdf8 42%, #0284c7 100%)'
  if (value >= 85) return 'linear-gradient(90deg, #6ee7b7 0%, #34d399 42%, #059669 100%)'
  if (value >= 70) return 'linear-gradient(90deg, #fcd34d 0%, #fbbf24 42%, #d97706 100%)'
  return 'linear-gradient(90deg, #fda4af 0%, #fb7185 42%, #e11d48 100%)'
}

function AchievementBar({ value }) {
  if (value == null || !Number.isFinite(value)) {
    return <span className="block text-right text-[11px] text-slate-400">—</span>
  }

  const width = `${Math.min(Math.max(value, 0), 130) / 130 * 100}%`
  const formatted = Number(value).toFixed(2)

  return (
    <div className="flex w-full items-center gap-1.5">
      <div className="relative h-3.5 min-w-0 flex-1 overflow-hidden rounded-[5px] bg-slate-100/90 shadow-inner ring-1 ring-inset ring-slate-200/70">
        <div
          className="h-full rounded-[5px] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"
          style={{
            width,
            backgroundImage: achievementBarGradient(value),
          }}
        />
      </div>
      <span className={`w-[46px] shrink-0 text-right text-[10px] font-semibold tabular-nums leading-none ${achClass(value)}`}>
        {formatted}%
      </span>
    </div>
  )
}

function exportKpiCsv({ defs, results, prevResults, selectedMonth, selectedYear, coreCodes, group }) {
  const prevMonth = selectedMonth > 1 ? selectedMonth - 1 : null
  const header = [
    '그룹', 'Lv1', 'Lv2', 'Lv3', '표시명', '지표코드', '단위', '비중', 'Core',
    '연간목표', `${selectedMonth}월목표`, `${selectedMonth}월실적`, '목표대비증감',
    '전월비_실적', '전년동월비', '환산달성률', '전월비_환산달성률(%p)', '상태',
  ]
  const lines = [header.join(',')]
  defs.forEach(def => {
    const m = leafMetrics({ def, results, prevResults, selectedMonth, prevMonth, selectedYear })
    const status = statusLabel(m.ach) || ''
    const row = [
      group,
      def.category || '',
      def.categoryL2 || '',
      def.categoryL3 || '',
      evalLabel(def),
      def.code || '',
      def.unit || '',
      fmtWeight(def.weight),
      coreCodes.has(def.code) ? 'Y' : '',
      m.annual != null ? Number(m.annual).toFixed(2) : '',
      m.target != null ? Number(m.target).toFixed(2) : '',
      m.actual != null ? Number(m.actual).toFixed(2) : '',
      m.gap != null ? Number(m.gap).toFixed(2) : '',
      m.momDelta != null ? Number(m.momDelta).toFixed(2) : '',
      m.yoyDelta != null ? Number(m.yoyDelta).toFixed(2) : '',
      m.ach != null ? Number(m.ach).toFixed(2) : '',
      m.achMom != null ? Number(m.achMom).toFixed(2) : '',
      status,
    ].map(v => `"${String(v ?? '').replace(/"/g, '""')}"`)
    lines.push(row.join(','))
  })
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${group || 'group'}_kpi_${selectedYear}_${String(selectedMonth).padStart(2, '0')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

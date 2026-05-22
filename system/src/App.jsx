import { useState, useMemo, useEffect } from 'react'
import {
  KPI_DEFINITIONS, KPI_RESULTS, GROUPS, CATEGORIES,
  CODEBOOK, CODEBOOK_META, NF_STRUCTURE,
  BANK_DEFINITIONS, BANK_RESULTS,
  PREV_KPI_DEFINITIONS, PREV_KPI_RESULTS, GROUPS_2025, CATEGORIES_2025, GROUP_MAPPING_2025,
} from './data/kpiData'
import { buildMasterFromCodebook, buildEvalConfig, mergeToActiveDefs } from './data/migration'
import Sidebar from './components/Sidebar'
import DashboardView from './components/DashboardView'
import GroupDetailView from './components/GroupDetailView'
import ReportView from './components/ReportView'
import CodebookAdminView from './components/CodebookAdminView'
import Header from './components/Header'

const AGENDA_KEY_PREFIX = 'agenda.customTabs.'
const LEGACY_AGENDA_SHARED_KEY = 'agenda.customTabs'
const LEGACY_GROUP_DETAIL_PREFIX = 'groupDetail.customTabs.'
const CODEBOOK_STORAGE_KEY = 'codebook.rows.v1'
const STRUCTURE_STORAGE_KEY = 'codebook.structure.v1'
const MASTER_STORAGE_KEY = 'indicator.master.v1'
const EVAL_CONFIG_PREFIX = 'eval.config.'

const normalizeTab = (tab, fallbackId) => {
  if (!tab || typeof tab !== 'object') return null
  const title = typeof tab.title === 'string' ? tab.title.trim() : ''
  const metricCodesRaw = Array.isArray(tab.metricCodes) ? tab.metricCodes : []
  const metricCodes = [...new Set(metricCodesRaw.filter(code => typeof code === 'string' && code.trim() !== ''))]
  if (!title || metricCodes.length === 0) return null
  const id = typeof tab.id === 'string' && tab.id.trim() ? tab.id.trim() : fallbackId
  return {
    id,
    title,
    metricCodes,
    pinToBottom: Boolean(tab.pinToBottom),
  }
}

const parseTabs = (raw) => {
  if (!raw) return []
  const parsed = JSON.parse(raw)
  if (!Array.isArray(parsed)) return []
  return parsed
    .map((tab, idx) => normalizeTab(tab, `migrated_${Date.now()}_${idx}`))
    .filter(Boolean)
}

const readAgendaTabsWithMigration = (year) => {
  const currentKey = `${AGENDA_KEY_PREFIX}${year}`
  const migratedFrom = []

  try {
    const currentRaw = window.localStorage.getItem(currentKey)
    const currentTabs = parseTabs(currentRaw)
    if (currentTabs.length > 0 || currentRaw) {
      return { tabs: currentTabs, migratedFrom }
    }
  } catch {
    // current key 파싱 실패 시 레거시 탐색 진행
  }

  const collected = []
  const seenIds = new Set()
  const legacyKeys = []
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)
      if (!key) continue
      const isLegacyGroupKey = key.startsWith(`${LEGACY_GROUP_DETAIL_PREFIX}${year}.`)
      const isLegacySharedKey = key === LEGACY_AGENDA_SHARED_KEY
      if (!isLegacyGroupKey && !isLegacySharedKey) continue
      legacyKeys.push(key)
      const raw = window.localStorage.getItem(key)
      let tabs = []
      try {
        tabs = parseTabs(raw)
      } catch {
        tabs = []
      }
      tabs.forEach((tab, idx) => {
        const normalized = normalizeTab(tab, `migrated_${Date.now()}_${idx}`)
        if (!normalized || seenIds.has(normalized.id)) return
        seenIds.add(normalized.id)
        collected.push(normalized)
      })
    }
  } catch {
    return { tabs: [], migratedFrom }
  }

  if (collected.length > 0) {
    try {
      window.localStorage.setItem(currentKey, JSON.stringify(collected))
      migratedFrom.push(...legacyKeys)
    } catch {
      // ignore
    }
  }

  return { tabs: collected, migratedFrom }
}

function initMaster() {
  if (typeof window === 'undefined') return buildMasterFromCodebook(CODEBOOK, KPI_DEFINITIONS)
  try {
    const raw = window.localStorage.getItem(MASTER_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch { /* ignore */ }
  let cb = CODEBOOK
  try {
    const raw = window.localStorage.getItem(CODEBOOK_STORAGE_KEY)
    if (raw) {
      const p = JSON.parse(raw)
      if (Array.isArray(p) && p.length > 0) cb = p
    }
  } catch { /* ignore */ }
  return buildMasterFromCodebook(cb, KPI_DEFINITIONS)
}

function initEvalConfigs(master) {
  const configs = {}
  const yearDefs = [[2026, KPI_DEFINITIONS], [2025, PREV_KPI_DEFINITIONS]]
  for (const [year, defaultDefs] of yearDefs) {
    if (typeof window !== 'undefined') {
      try {
        const raw = window.localStorage.getItem(`${EVAL_CONFIG_PREFIX}${year}`)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed) && parsed.length > 0) { configs[year] = parsed; continue }
        }
      } catch { /* ignore */ }
    }
    configs[year] = buildEvalConfig(defaultDefs, master, year)
  }
  return configs
}

export default function App() {
  const [view, setView] = useState('dashboard')
  const [selectedGroup, setSelectedGroup] = useState(null)
  const [selectedMonth, setSelectedMonth] = useState(12)
  const [toolFilter, setToolFilter] = useState('전체')
  const [selectedYear, setSelectedYear] = useState(2026)
  const [detailTab, setDetailTab] = useState('summary')
  const [customTabs, setCustomTabs] = useState([])
  const [tabsHydratedKey, setTabsHydratedKey] = useState(null)

  const [indicatorMaster, setIndicatorMaster] = useState(initMaster)
  const [evalConfigs, setEvalConfigs] = useState(() => initEvalConfigs(initMaster()))

  const [structureRows, setStructureRows] = useState(() => {
    if (typeof window === 'undefined') return NF_STRUCTURE
    try {
      const raw = window.localStorage.getItem(STRUCTURE_STORAGE_KEY)
      if (!raw) return NF_STRUCTURE
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed : NF_STRUCTURE
    } catch {
      return NF_STRUCTURE
    }
  })

  const is2026 = selectedYear === 2026
  const activeCats = is2026 ? CATEGORIES : CATEGORIES_2025
  const activeGroups = is2026 ? GROUPS : GROUPS_2025

  const activeDefs = useMemo(
    () => mergeToActiveDefs(indicatorMaster, evalConfigs[selectedYear] || [], selectedYear),
    [indicatorMaster, evalConfigs, selectedYear],
  )
  const activeResults = is2026 ? KPI_RESULTS : PREV_KPI_RESULTS

  const detailStorageKey = useMemo(
    () => `agenda.customTabs.${selectedYear}`,
    [selectedYear],
  )

  const kpiDefs = useMemo(() => activeDefs.filter(d => d.mgmtTool === 'KPI'), [activeDefs])
  const isAgendaMode = detailTab === 'agenda' || detailTab.startsWith('custom:')
  const detailDefinitions = useMemo(() => {
    if (isAgendaMode) return activeDefs.filter(d => d.mgmtTool === 'KPI')
    return activeDefs.filter(k => k.group === selectedGroup)
  }, [isAgendaMode, activeDefs, selectedGroup])
  const detailResults = useMemo(() => {
    if (isAgendaMode) return activeResults.filter(r => r.mgmtTool === 'KPI')
    return activeResults.filter(r => r.group === selectedGroup)
  }, [isAgendaMode, activeResults, selectedGroup])

  useEffect(() => {
    setDetailTab('summary')
  }, [selectedGroup, selectedYear])

  useEffect(() => {
    setTabsHydratedKey(null)
    try {
      const { tabs } = readAgendaTabsWithMigration(selectedYear)
      setCustomTabs(tabs)
    } catch {
      setCustomTabs([])
    }
    setTabsHydratedKey(detailStorageKey)
  }, [detailStorageKey, selectedYear])

  useEffect(() => {
    if (tabsHydratedKey !== detailStorageKey) return
    try {
      window.localStorage.setItem(detailStorageKey, JSON.stringify(customTabs))
    } catch {
      // ignore
    }
  }, [customTabs, detailStorageKey, tabsHydratedKey])

  useEffect(() => {
    try {
      window.localStorage.setItem(MASTER_STORAGE_KEY, JSON.stringify(indicatorMaster))
    } catch { /* ignore */ }
  }, [indicatorMaster])

  useEffect(() => {
    try {
      Object.entries(evalConfigs).forEach(([year, config]) => {
        window.localStorage.setItem(`${EVAL_CONFIG_PREFIX}${year}`, JSON.stringify(config))
      })
    } catch { /* ignore */ }
  }, [evalConfigs])

  useEffect(() => {
    try {
      window.localStorage.setItem(STRUCTURE_STORAGE_KEY, JSON.stringify(structureRows))
    } catch {
      // ignore
    }
  }, [structureRows])

  const bankKpiSummary = useMemo(() => {
    if (!is2026) return []
    return CATEGORIES.map(cat => {
      const catItems = BANK_RESULTS.filter(b => b.month === selectedMonth && b.category === cat)
      const tw = catItems.reduce((s, b) => s + (b.weight ?? 0), 0)
      const ws = catItems.reduce((s, b) => s + (b.achievement ?? 0) * (b.weight ?? 0), 0)
      return { category: cat, achievement: tw > 0 ? Math.round(ws / tw * 10) / 10 : 0 }
    })
  }, [selectedMonth, is2026])

  const groupSummaries = useMemo(() => {
    return activeGroups.map(g => {
      const defs = kpiDefs.filter(k => k.group === g)
      const monthResults = activeResults.filter(r => r.group === g && r.month === selectedMonth && r.mgmtTool === 'KPI')

      let weightedSum = 0, totalWeight = 0, over100 = 0, mid = 0, under80 = 0
      const catAchs = {}

      activeCats.forEach(cat => {
        const catDefs = defs.filter(d => d.category === cat)
        let cw = 0, cs = 0
        catDefs.forEach(def => {
          const r = monthResults.find(r => r.code === def.code)
          if (r && r.achievement != null) {
            cs += r.achievement * def.weight; cw += def.weight
            weightedSum += r.achievement * def.weight; totalWeight += def.weight
            if (r.achievement >= 100) over100++
            else if (r.achievement >= 80) mid++
            else under80++
          }
        })
        catAchs[cat] = cw > 0 ? Math.round(cs / cw * 10) / 10 : 0
      })

      const wavg = totalWeight > 0 ? Math.round(weightedSum / totalWeight * 10) / 10 : 0

      return { name: g, kpiCount: defs.length, wavg, over100, mid, under80, catAchs }
    })
  }, [selectedMonth, kpiDefs, activeGroups, activeCats, activeResults])

  const handleGroupClick = (groupName) => {
    setSelectedGroup(groupName)
    setView('detail')
    setDetailTab('summary')
  }

  const handleReportClick = (groupName) => {
    setSelectedGroup(groupName || selectedGroup)
    setView('report')
  }

  const handleBankKpiOpen = () => {
    if (!selectedGroup) setSelectedGroup(GROUPS[0] ?? null)
    setDetailTab('bank')
    setView('detail')
  }

  const handleSaveCustomTab = (payload) => {
    const title = (payload?.title ?? '').trim()
    const metricCodes = Array.isArray(payload?.metricCodes) ? payload.metricCodes : []
    const pinToBottom = Boolean(payload?.pinToBottom)
    const editId = payload?.id ?? null
    if (!title || metricCodes.length === 0) return { ok: false, reason: 'invalid' }
    if (customTabs.some(t => t.title === title && t.id !== editId)) return { ok: false, reason: 'duplicate_title' }
    if (editId) {
      setCustomTabs(prev => prev.map(t => t.id === editId ? { ...t, title, metricCodes, pinToBottom } : t))
      setDetailTab(`custom:${editId}`)
      return { ok: true }
    }
    if (customTabs.length >= 8) return { ok: false, reason: 'limit' }
    const id = `tab_${Date.now()}`
    setCustomTabs(prev => [...prev, { id, title, metricCodes, pinToBottom }])
    setDetailTab(`custom:${id}`)
    return { ok: true }
  }

  const handleDeleteCustomTab = (id) => {
    setCustomTabs(prev => prev.filter(t => t.id !== id))
    if (detailTab === `custom:${id}`) setDetailTab('summary')
  }

  const selectedCustomTab = detailTab.startsWith('custom:')
    ? customTabs.find(t => t.id === detailTab.replace('custom:', '')) ?? null
    : null

  const defaultMaster = useMemo(() => buildMasterFromCodebook(CODEBOOK, KPI_DEFINITIONS), [])
  const defaultEvalConfigs = useMemo(() => ({
    2026: buildEvalConfig(KPI_DEFINITIONS, defaultMaster, 2026),
    2025: buildEvalConfig(PREV_KPI_DEFINITIONS, defaultMaster, 2025),
  }), [defaultMaster])

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        groups={GROUPS}
        view={view}
        selectedGroup={selectedGroup}
        selectedYear={selectedYear}
        detailTab={detailTab}
        customTabs={customTabs}
        detailMetricOptions={activeDefs.filter(d => d.mgmtTool === 'KPI').map(def => ({
          code: def.code,
          name: def.name,
          label: def.label26 || def.name,
          category: def.category,
          group: def.group,
          weight: def.weight,
        }))}
        onViewChange={setView}
        onGroupSelect={handleGroupClick}
        onDetailTabChange={setDetailTab}
        onSaveCustomTab={handleSaveCustomTab}
        onDeleteCustomTab={handleDeleteCustomTab}
        onBankKpiOpen={handleBankKpiOpen}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          view={view}
          selectedGroup={selectedGroup}
          selectedMonth={selectedMonth}
          selectedYear={selectedYear}
          toolFilter={toolFilter}
          onMonthChange={setSelectedMonth}
          onYearChange={setSelectedYear}
          onToolFilterChange={setToolFilter}
          onBack={() =>
            setView(view === 'report' ? 'detail' : 'dashboard')}
          onReportClick={() => handleReportClick()}
        />
        <main className="flex-1 overflow-y-auto p-6 bg-slate-50">
          {view === 'codebook' && (
            <CodebookAdminView
              indicatorMaster={indicatorMaster}
              meta={CODEBOOK_META}
              structure={structureRows}
              evalConfigs={evalConfigs}
              onMasterChange={setIndicatorMaster}
              onStructureChange={setStructureRows}
              onEvalConfigChange={setEvalConfigs}
              defaultMaster={defaultMaster}
              defaultEvalConfigs={defaultEvalConfigs}
              defaultStructure={NF_STRUCTURE}
            />
          )}
          {view === 'dashboard' && (
            <DashboardView
              groupSummaries={groupSummaries}
              bankKpiSummary={bankKpiSummary}
              categories={activeCats}
              definitions={kpiDefs}
              results={activeResults.filter(r => r.mgmtTool === 'KPI')}
              selectedMonth={selectedMonth}
              selectedYear={selectedYear}
              onGroupClick={handleGroupClick}
            />
          )}
          {view === 'detail' && (
            <GroupDetailView
              group={selectedGroup}
              categories={activeCats}
              definitions={detailDefinitions}
              results={detailResults}
              selectedMonth={selectedMonth}
              selectedYear={selectedYear}
              toolFilter={toolFilter}
              onReportClick={() => handleReportClick()}
              prevDefinitions={PREV_KPI_DEFINITIONS}
              prevResults={PREV_KPI_RESULTS}
              groupMapping2025={GROUP_MAPPING_2025}
              bankDefinitions={BANK_DEFINITIONS}
              bankResults={BANK_RESULTS}
              detailTab={detailTab}
              selectedCustomTab={selectedCustomTab}
              codebook={indicatorMaster}
            />
          )}
          {view === 'report' && (
            <ReportView
              group={selectedGroup}
              categories={activeCats}
              definitions={activeDefs.filter(k => k.group === selectedGroup)}
              results={activeResults.filter(r => r.group === selectedGroup)}
              selectedMonth={selectedMonth}
            />
          )}
        </main>
      </div>
    </div>
  )
}

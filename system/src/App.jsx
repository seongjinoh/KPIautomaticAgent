import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import {
  KPI_DEFINITIONS,
  CODEBOOK,
} from './data/kpiData'
import { filterEvalGroups } from './lib/orgGroup'
import { buildMasterFromCodebook, buildEvalConfig, mergeToActiveDefs } from './data/migration'
import { enrichEvalConfigEntry } from './lib/achievementEngine'
import { api } from './lib/apiClient'
import Sidebar from './components/Sidebar'
import DashboardView from './components/DashboardView'
import GroupDetailView from './components/GroupDetailView'
import ReportView from './components/ReportView'
import CodebookAdminView from './components/CodebookAdminView'
import EvalConfigView from './components/EvalConfigView'
import LoginView from './components/LoginView'
import UserAdminView from './components/UserAdminView'
import AgentQueryView from './components/AgentQueryView'
import AnomalyCenterView from './components/AnomalyCenterView'
import FactsAdminView from './components/FactsAdminView'
import DeptFactEntryView from './components/DeptFactEntryView'
import HomeWelcomeView from './components/HomeWelcomeView'
import Header from './components/Header'
import {
  allowedGroupsForUser,
  canAccessAdminMenu,
  canAccessDashboard,
  canAccessDeptFactEntry,
  canAccessTopMenu,
  filterDefinitionsForUser,
  filterResultsForUser,
  getCurrentSession,
  logout,
  resolveHomeForUser,
  ROLES,
} from './lib/authService'

const DEFAULT_CATEGORIES = ['본원적 수익력', '건전성', '고객', '연결과 확장']
const AGENDA_KEY_PREFIX = 'agenda.customTabs.'
const LEGACY_AGENDA_SHARED_KEY = 'agenda.customTabs'
const LEGACY_GROUP_DETAIL_PREFIX = 'groupDetail.customTabs.'
const AGENDA_TABS_PURGE_KEY = 'agenda.customTabs.purged.v1'

/** 테스트용 잔여 탭(예: dd) 제거 — 1회만 실행 */
const purgeStaleAgendaTabsOnce = () => {
  if (typeof window === 'undefined') return
  try {
    if (window.localStorage.getItem(AGENDA_TABS_PURGE_KEY) === '1') return
    const keysToRemove = []
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)
      if (!key) continue
      if (
        key.startsWith(AGENDA_KEY_PREFIX)
        || key === LEGACY_AGENDA_SHARED_KEY
        || key.startsWith(LEGACY_GROUP_DETAIL_PREFIX)
      ) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach((key) => window.localStorage.removeItem(key))
    window.localStorage.setItem(AGENDA_TABS_PURGE_KEY, '1')
  } catch {
    // ignore
  }
}

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
  purgeStaleAgendaTabsOnce()
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
  // 평가배치·대시보드용 레거시 마스터 (CODEBOOK 시드). 코드체계 관리는 API/SQLite.
  return buildMasterFromCodebook(CODEBOOK, KPI_DEFINITIONS)
}

const monthKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`

/** 대시보드·그룹 상세 등에서만 월별 실적/점수를 미리 불러온다 (코드북·권한관리 등에서는 제외) */
const VIEWS_PREFETCH_METRICS = new Set(['dashboard', 'detail', 'home', 'agent', 'anomaly', 'report', 'deptFacts'])

/** 평가셋이 있는 연도 + 올해/내년 + (최대연도+1) — 새 연도 배치를 만들 수 있게 */
const expandSelectableYears = (existingYears = [], selectedYear) => {
  const now = new Date().getFullYear()
  const existing = [...new Set((existingYears || []).map(Number).filter(y => Number.isFinite(y) && y >= 2000 && y <= 2100))]
  const set = new Set(existing)
  set.add(now)
  set.add(now + 1)
  if (existing.length) set.add(Math.max(...existing) + 1)
  const sel = Number(selectedYear)
  if (Number.isFinite(sel) && sel >= 2000 && sel <= 2100) set.add(sel)
  return [...set].sort((a, b) => b - a)
}

const parseCustomTargets = (value) => {
  if (!value) return null
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }
  return value
}

const parseIsCore = (value) => {
  if (value === true || value === 1) return true
  if (value === false || value === 0 || value == null || value === '') return false
  const s = String(value).trim().toUpperCase()
  return ['Y', 'YES', '1', 'TRUE', 'T', 'CORE', 'O', '예'].includes(s)
}

const normalizeEvalRow = (row = {}) => {
  let filters = row.filters || null
  if (!filters && row.filters_json) {
    try {
      filters = typeof row.filters_json === 'string' ? JSON.parse(row.filters_json) : row.filters_json
    } catch {
      filters = null
    }
  }
  return enrichEvalConfigEntry({
    ...row,
    indicatorCode: row.indicatorCode || row.indicator_code || '',
    code: row.indicatorCode || row.indicator_code || row.code || '',
    mgmtTool: row.mgmtTool || row.mgmt_tool || 'KPI',
    groupCode: row.groupCode || row.group_code || '',
    groupName: row.groupName || row.group_name || '',
    group: row.group || row.groupName || row.group_name || '',
    contributionMode: String(row.contributionMode || row.contribution_mode || 'WEIGHT').toUpperCase() === 'ADJUST' ? 'ADJUST' : 'WEIGHT',
    displayName: row.displayName || row.display_name || '',
    evalCategoryLv1: row.evalCategoryLv1 || row.eval_category_lv1 || '',
    evalCategoryLv2: row.evalCategoryLv2 || row.eval_category_lv2 || '',
    evalCategoryLv3: row.evalCategoryLv3 || row.eval_category_lv3 || '',
    weight: row.weight ?? 0,
    isCore: parseIsCore(row.isCore ?? row.is_core ?? row.Core),
    monthlyTarget: row.monthlyTarget ?? row.monthly_target ?? null,
    annualTarget: row.annualTarget ?? row.annual_target ?? 0,
    baselineActual: row.baselineActual ?? row.baseline_actual ?? 0,
    dataSource: row.dataSource || row.data_source || '',
    definitionText: row.definitionText || row.definition_text || '',
    calcLogicText: row.calcLogicText || row.calc_logic_text || '',
    h1Target: row.h1Target ?? row.h1_target ?? null,
    h2Target: row.h2Target ?? row.h2_target ?? null,
    scoreRule: row.scoreRule || row.score_rule || 1,
    penaltyRule: row.penaltyRule || row.penalty_rule || 0.1,
    adjBand: row.adjBand || row.adj_band || 120,
    capMax: row.capMax ?? row.cap_max ?? 150,
    capMin: row.capMin ?? row.cap_min ?? 40,
    remark: row.remark || '',
    lv3Name: row.lv3Name || row.lv3_name || '',
    sortOrder: Number(row.sortOrder ?? row.sort_order ?? 0),
    filters,
    filtersJson: row.filters_json || (filters ? JSON.stringify(filters) : null),
    formulaId: row.formulaId ?? row.formula_id ?? null,
    achievementMode: row.achievementMode || row.achievement_mode || 'linear',
    goalDirection: row.goalDirection || row.goal_direction || 'increase',
    customAchievementExpr: row.customAchievementExpr || row.custom_achievement_expr || '',
    customMonthlyTargets: row.customMonthlyTargets || parseCustomTargets(row.custom_monthly_targets_json) || null,
    targetStartMonth: row.targetStartMonth ?? row.target_start_month ?? 1,
    targetEndMonth: row.targetEndMonth ?? row.target_end_month ?? 12,
  })
}

const mapAchievementItems = (items = [], year, month) => (items || []).map((row) => ({
  code: row.indicator_code || row.indicatorCode || row.code,
  group: row.group_name || row.groupName || row.group_code || row.groupCode || '',
  month: Number(month),
  year: Number(year),
  period: `${year}${String(month).padStart(2, '0')}`,
  actual: row.actual,
  target: row.monthly_target ?? row.monthlyTarget ?? null,
  achievement: row.converted_achievement ?? row.convertedAchievement ?? row.simple_achievement ?? null,
  mgmtTool: row.mgmt_tool || row.mgmtTool || 'KPI',
  weight: row.weight ?? 0,
  category: row.eval_category_lv1 || row.evalCategoryLv1 || row.category || '',
  categoryL2: row.eval_category_lv2 || row.evalCategoryLv2 || '',
  categoryL3: row.eval_category_lv3 || row.evalCategoryLv3 || '',
  name: row.label || row.display_name || '',
  unit: row.unit || '',
}))

const normalizeResolvedEvalConfig = (payload = {}) => ({
  planSetId: payload.plan_set_id ?? payload.planSetId ?? null,
  year: payload.year ?? null,
  month: payload.month ?? null,
  resolvedFromMonth: payload.resolved_from_month ?? payload.resolvedFromMonth ?? null,
  isInherited: Boolean(payload.is_inherited ?? payload.isInherited),
  changeReason: payload.change_reason ?? payload.changeReason ?? '',
  items: (payload.items || []).map(normalizeEvalRow),
})

export default function App() {
  const [currentUser, setCurrentUser] = useState(() => getCurrentSession())
  const [view, setView] = useState(() => resolveHomeForUser(getCurrentSession(), []).view)
  const [selectedGroup, setSelectedGroup] = useState(() => resolveHomeForUser(getCurrentSession(), []).selectedGroup)
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date()
    return now.getMonth() === 0 ? 12 : now.getMonth() // 직전월 (1월이면 12월)
  })
  const [toolFilter, setToolFilter] = useState('전체')
  const [selectedYear, setSelectedYear] = useState(() => {
    const now = new Date()
    return now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear()
  })
  const [evalYearsExisting, setEvalYearsExisting] = useState([])
  const yearOptions = useMemo(
    () => expandSelectableYears(evalYearsExisting, selectedYear),
    [evalYearsExisting, selectedYear],
  )
  const [detailTab, setDetailTab] = useState('summary')
  const [customTabs, setCustomTabs] = useState([])
  const [tabsHydratedKey, setTabsHydratedKey] = useState(null)

  const [indicatorMaster] = useState(initMaster)
  const [evalCodeCatalog, setEvalCodeCatalog] = useState([])
  const [ownerGroupRows, setOwnerGroupRows] = useState([])
  const [resolvedEvalConfigsByMonth, setResolvedEvalConfigsByMonth] = useState({})
  const [evalHistoryByYear, setEvalHistoryByYear] = useState({})
  const [achievementsByMonth, setAchievementsByMonth] = useState({})
  const [groupScoresByMonth, setGroupScoresByMonth] = useState({})
  const [factsRefreshing, setFactsRefreshing] = useState(false)
  const [factsMessage, setFactsMessage] = useState('')
  const evalHistoryLoadedRef = useRef(new Set())

  const prevYear = selectedYear - 1
  const currentEvalKey = useMemo(() => monthKey(selectedYear, selectedMonth), [selectedYear, selectedMonth])
  const currentResolvedEval = resolvedEvalConfigsByMonth[currentEvalKey] || { items: [] }
  const activeDefs = useMemo(
    () => mergeToActiveDefs(evalCodeCatalog, currentResolvedEval.items || [], selectedYear).map(d => ({ ...d, year: selectedYear })),
    [evalCodeCatalog, currentResolvedEval, selectedYear],
  )
  const prevEvalKey = useMemo(() => monthKey(prevYear, selectedMonth), [prevYear, selectedMonth])
  const prevResolvedEval = resolvedEvalConfigsByMonth[prevEvalKey] || { items: [] }
  const prevActiveDefs = useMemo(
    () => mergeToActiveDefs(evalCodeCatalog, prevResolvedEval.items || [], prevYear).map(d => ({ ...d, year: prevYear })),
    [evalCodeCatalog, prevResolvedEval, prevYear],
  )
  const activeResultsRaw = achievementsByMonth[currentEvalKey] || []
  const scopedDefs = useMemo(
    () => filterDefinitionsForUser(currentUser, activeDefs),
    [currentUser, activeDefs],
  )
  const activeResults = useMemo(() => {
    return filterResultsForUser(currentUser, activeResultsRaw, activeDefs)
  }, [currentUser, activeResultsRaw, activeDefs])
  const yearResultsRaw = useMemo(() => {
    const out = []
    for (let m = 1; m <= 12; m += 1) {
      out.push(...(achievementsByMonth[monthKey(selectedYear, m)] || []))
    }
    return out
  }, [achievementsByMonth, selectedYear])

  const resolvedPrevResults = useMemo(() => {
    const out = []
    for (let m = 1; m <= 12; m += 1) {
      out.push(...(achievementsByMonth[monthKey(prevYear, m)] || []))
    }
    return out
  }, [achievementsByMonth, prevYear])

  const groupNameByCode = useMemo(() => {
    const map = {}
    ;(ownerGroupRows || []).forEach((g) => {
      const code = String(g.code || '').trim().toUpperCase()
      if (code) map[code] = String(g.name || '').trim()
    })
    return map
  }, [ownerGroupRows])

  const groupCodeByName = useMemo(() => {
    const map = {}
    Object.entries(groupNameByCode).forEach(([code, name]) => {
      if (name) map[name] = code
    })
    return map
  }, [groupNameByCode])

  const currentGroupScores = groupScoresByMonth[currentEvalKey] || []
  const prevGroupScores = groupScoresByMonth[prevEvalKey] || []
  const bankGroupScore = useMemo(() => {
    return (currentGroupScores || []).find((r) => String(r.group_code || '').toUpperCase() === 'SHB') || null
  }, [currentGroupScores])
  const prevBankGroupScore = useMemo(() => {
    return (prevGroupScores || []).find((r) => String(r.group_code || '').toUpperCase() === 'SHB') || null
  }, [prevGroupScores])

  const scoreByGroupName = useMemo(() => {
    const map = {}
    ;(currentGroupScores || []).forEach((r) => {
      const name = r.group_name || groupNameByCode[String(r.group_code || '').toUpperCase()]
      if (name) map[name] = r
    })
    return map
  }, [currentGroupScores, groupNameByCode])

  const prevScoreByGroupName = useMemo(() => {
    const map = {}
    ;(prevGroupScores || []).forEach((r) => {
      const name = r.group_name || groupNameByCode[String(r.group_code || '').toUpperCase()]
      if (name) map[name] = r
    })
    return map
  }, [prevGroupScores, groupNameByCode])

  // 달성률 전월비: 직전 월 group_score (1월은 전년 12월). YoY용 prevEvalKey와 다름.
  const momEvalKey = useMemo(() => (
    selectedMonth > 1
      ? monthKey(selectedYear, selectedMonth - 1)
      : monthKey(prevYear, 12)
  ), [selectedYear, selectedMonth, prevYear])
  const momGroupScores = groupScoresByMonth[momEvalKey] || []
  const momScoreByGroupName = useMemo(() => {
    const map = {}
    ;(momGroupScores || []).forEach((r) => {
      const name = r.group_name || groupNameByCode[String(r.group_code || '').toUpperCase()]
      if (name) map[name] = r
    })
    return map
  }, [momGroupScores, groupNameByCode])

  /** 선택 그룹의 연내 월별 L1/L2/L3 — 시각화 디폴트 차트용 */
  const yearGroupScoresForSelected = useMemo(() => {
    if (!selectedGroup) return []
    const out = []
    for (let m = 1; m <= 12; m += 1) {
      const items = groupScoresByMonth[monthKey(selectedYear, m)] || []
      const row = items.find((r) => {
        const name = r.group_name || groupNameByCode[String(r.group_code || '').toUpperCase()]
        return name === selectedGroup
      }) || null
      out.push({
        month: m,
        ultimate_score: row?.ultimate_score ?? null,
        base_score: row?.base_score ?? null,
        group_final_score: row?.group_final_score ?? null,
        adjust_points: row?.adjust_points ?? null,
      })
    }
    return out
  }, [selectedGroup, selectedYear, groupScoresByMonth, groupNameByCode])

  const activeCats = useMemo(() => {
    const fromDefs = [...new Set(
      (scopedDefs.length ? scopedDefs : activeDefs)
        .map(d => d.category || d.evalCategoryLv1 || d.eval_category_lv1)
        .filter(Boolean),
    )]
    return fromDefs.length ? fromDefs : DEFAULT_CATEGORIES
  }, [scopedDefs, activeDefs])

  // 사용자 권한 배정용: 코드마스터 전체 그룹
  const evalOwnerGroupRows = useMemo(
    () => filterEvalGroups(ownerGroupRows),
    [ownerGroupRows],
  )

  const masterGroupNames = useMemo(() => {
    const fromApi = evalOwnerGroupRows.map(g => g.name).filter(Boolean)
    if (fromApi.length) return fromApi
    return [...new Set(activeDefs.map(d => d.group).filter(Boolean))]
  }, [evalOwnerGroupRows, activeDefs])

  // 해당 연·월 평가배치 캐시 로딩 여부 (미로딩 시 빈 배열로 착각하지 않도록)
  const isCurrentEvalResolved = Object.prototype.hasOwnProperty.call(
    resolvedEvalConfigsByMonth,
    currentEvalKey,
  )

  // 사이드바용: 선택 연도의 평가배치에 등장한 그룹 (월 단위로 목록이 깜빡이지 않게 연 단위 union)
  const yearEvalGroupNames = useMemo(() => {
    const sortIndex = new Map(
      (ownerGroupRows || []).map((g, i) => [g.name, g.sort_order ?? g.sortOrder ?? i]),
    )
    const nameSet = new Set()
    const yearPrefix = `${selectedYear}-`
    for (const [key, cfg] of Object.entries(resolvedEvalConfigsByMonth || {})) {
      if (!String(key).startsWith(yearPrefix)) continue
      const defs = mergeToActiveDefs(evalCodeCatalog, cfg.items || [], selectedYear)
      for (const d of defs) {
        if (d.mgmtTool && d.mgmtTool !== 'KPI') continue
        if (d.group) nameSet.add(d.group)
      }
    }
    // 현재 월이 아직 캐시에 없으면 activeDefs도 비어 있을 수 있음 → 위 union만 사용
    if (isCurrentEvalResolved) {
      for (const d of activeDefs || []) {
        if (d.mgmtTool && d.mgmtTool !== 'KPI') continue
        if (d.group) nameSet.add(d.group)
      }
    }
    return [...nameSet].sort((a, b) => {
      const ai = sortIndex.has(a) ? Number(sortIndex.get(a)) : Number.MAX_SAFE_INTEGER
      const bi = sortIndex.has(b) ? Number(sortIndex.get(b)) : Number.MAX_SAFE_INTEGER
      if (ai !== bi) return ai - bi
      return String(a).localeCompare(String(b), 'ko')
    })
  }, [
    activeDefs,
    ownerGroupRows,
    resolvedEvalConfigsByMonth,
    selectedYear,
    evalCodeCatalog,
    isCurrentEvalResolved,
  ])

  const activeGroups = useMemo(
    () => allowedGroupsForUser(currentUser, yearEvalGroupNames),
    [currentUser, yearEvalGroupNames],
  )

  const detailStorageKey = useMemo(
    () => `agenda.customTabs.${selectedYear}`,
    [selectedYear],
  )

  const kpiDefs = useMemo(() => scopedDefs.filter(d => d.mgmtTool === 'KPI'), [scopedDefs])
  const isAgendaMode = detailTab.startsWith('custom:')
  const selectedCustomTab = useMemo(() => {
    if (!isAgendaMode) return null
    const id = detailTab.replace('custom:', '')
    return customTabs.find(t => t.id === id) ?? null
  }, [isAgendaMode, detailTab, customTabs])

  const detailDefinitions = useMemo(() => {
    if (isAgendaMode) {
      let defs = scopedDefs.filter(d => d.mgmtTool === 'KPI')
      const codes = selectedCustomTab?.metricCodes
      if (codes?.length) {
        const allow = new Set(codes)
        defs = defs.filter(d => allow.has(d.code) || allow.has(d.indicatorCode))
      } else {
        defs = []
      }
      return defs
    }
    return scopedDefs.filter(k => k.group === selectedGroup)
  }, [isAgendaMode, scopedDefs, selectedGroup, selectedCustomTab])

  const detailCategories = useMemo(() => {
    const fromDefs = [...new Set(
      detailDefinitions
        .map(d => d.category || d.evalCategoryLv1 || d.eval_category_lv1)
        .filter(Boolean),
    )]
    return fromDefs.length ? fromDefs : activeCats
  }, [detailDefinitions, activeCats])

  const detailResults = useMemo(() => {
    const scoped = filterResultsForUser(currentUser, yearResultsRaw, activeDefs)
    if (isAgendaMode) {
      const allow = new Set(selectedCustomTab?.metricCodes || [])
      if (!allow.size) return []
      return scoped.filter(r => r.mgmtTool === 'KPI' && (allow.has(r.code) || allow.has(r.indicatorCode)))
    }
    return scoped.filter(r => r.group === selectedGroup)
  }, [isAgendaMode, currentUser, yearResultsRaw, activeDefs, selectedGroup, selectedCustomTab])

  const dashboardResults = useMemo(() => {
    return filterResultsForUser(currentUser, yearResultsRaw, activeDefs)
      .filter(r => r.mgmtTool === 'KPI')
  }, [currentUser, yearResultsRaw, activeDefs])

  const dashboardPrevResults = useMemo(() => {
    const defs = (prevActiveDefs || []).length ? prevActiveDefs : activeDefs
    return filterResultsForUser(currentUser, resolvedPrevResults, defs)
      .filter(r => r.mgmtTool === 'KPI')
  }, [currentUser, resolvedPrevResults, prevActiveDefs, activeDefs])

  const dashboardPrevDefs = useMemo(() => {
    const defs = filterDefinitionsForUser(currentUser, prevActiveDefs || [])
    return defs.filter(d => d.mgmtTool === 'KPI')
  }, [currentUser, prevActiveDefs])

  // 연도 변경 시에만 상세 탭 초기화 (그룹 클릭은 handleGroupClick에서 처리)
  useEffect(() => {
    setDetailTab('summary')
  }, [selectedYear])

  useEffect(() => {
    if (!currentUser) return

    const applyHome = () => {
      const home = resolveHomeForUser(currentUser, activeGroups)
      setView(home.view)
      setSelectedGroup(home.selectedGroup)
      if (home.view === 'detail') setDetailTab('summary')
    }

    if ((view === 'codebook' || view === 'evalConfig' || view === 'users' || view === 'facts') && !canAccessAdminMenu(currentUser)) {
      applyHome()
      return
    }
    if (view === 'deptFacts' && !canAccessDeptFactEntry(currentUser)) {
      applyHome()
      return
    }
    if ((view === 'dashboard' || view === 'agent' || view === 'anomaly') && !canAccessTopMenu(currentUser)) {
      applyHome()
      return
    }
    // 월 전환 직후 평가배치 미로딩이면 그룹이 비어 보이므로 화면 이동하지 않음
    if (!isCurrentEvalResolved) return

    // Agenda 모드가 아닌데 그룹이 비면 첫 그룹으로 보정
    if (
      view === 'detail'
      && !String(detailTab || '').startsWith('custom:')
      && !selectedGroup
      && activeGroups.length > 0
    ) {
      setSelectedGroup(activeGroups[0])
      setDetailTab('summary')
      return
    }

    // 연도 전환 등으로 선택 그룹이 그 해 배치에 없을 때만 보정 (월 변경으로 메인 튕김 방지)
    if (selectedGroup && !activeGroups.includes(selectedGroup)) {
      if (activeGroups.length > 0) {
        setSelectedGroup(activeGroups[0])
        setDetailTab('summary')
      } else {
        setSelectedGroup(null)
        if (view === 'detail' && !String(detailTab || '').startsWith('custom:')) {
          applyHome()
        }
      }
    }
  }, [currentUser, view, selectedGroup, activeGroups, selectedYear, isCurrentEvalResolved, detailTab])

  const applyRoleHome = (user, groups = activeGroups) => {
    const home = resolveHomeForUser(user, groups)
    setView(home.view)
    setSelectedGroup(home.selectedGroup)
    if (home.view === 'detail') setDetailTab('summary')
  }

  const handleLogin = (user) => {
    setCurrentUser(user)
    applyRoleHome(user, [])
  }

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

  const reloadEvalYears = async () => {
    try {
      const res = await api.listEvalYears()
      const existing = (res.years || []).map(Number).filter(Boolean)
      setEvalYearsExisting(existing)
      setSelectedYear(prev => {
        const years = expandSelectableYears(existing, prev)
        // 새 연도(아직 평가셋 없음) 선택 유지. 확장 목록에도 없을 때만 최신으로.
        if (years.length && !years.includes(prev)) return years[0]
        return prev
      })
      return expandSelectableYears(existing)
    } catch {
      setEvalYearsExisting([])
      return []
    }
  }

  useEffect(() => {
    reloadEvalYears().then(() => { /* ignore */ })
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        reloadEvalYears().then(() => { /* ignore */ })
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadCatalog = () => {
      api.listCodes()
        .then((res) => { if (!cancelled) setEvalCodeCatalog(res.items || []) })
        .catch(() => { if (!cancelled) setEvalCodeCatalog([]) })
    }
    const loadGroups = () => {
      api.listGroups()
        .then((res) => { if (!cancelled) setOwnerGroupRows(res.items || []) })
        .catch(() => { if (!cancelled) setOwnerGroupRows([]) })
    }
    loadCatalog()
    loadGroups()
    return () => { cancelled = true }
  }, [])

  const reloadEvalCodeCatalog = useCallback(async () => {
    try {
      const res = await api.listCodes()
      setEvalCodeCatalog(res.items || [])
      return res.items || []
    } catch {
      setEvalCodeCatalog([])
      return []
    }
  }, [])

  const reloadOwnerGroups = useCallback(async () => {
    try {
      const res = await api.listGroups()
      setOwnerGroupRows(res.items || [])
      return res.items || []
    } catch {
      setOwnerGroupRows([])
      return []
    }
  }, [])

  /** 평가배치·실적·그룹점수 메모리 캐시 무효화 → useEffect가 다시 fetch */
  const invalidateLiveCaches = useCallback((keys) => {
    const targetKeys = Array.isArray(keys) && keys.length
      ? keys
      : [currentEvalKey, prevEvalKey].filter(Boolean)
    const dropKeys = (prev) => {
      let changed = false
      const next = { ...prev }
      for (const k of targetKeys) {
        if (Object.prototype.hasOwnProperty.call(next, k)) {
          delete next[k]
          changed = true
        }
      }
      return changed ? next : prev
    }
    setResolvedEvalConfigsByMonth(dropKeys)
    setAchievementsByMonth(dropKeys)
    setGroupScoresByMonth(dropKeys)
    evalHistoryLoadedRef.current.delete(selectedYear)
  }, [currentEvalKey, prevEvalKey, selectedYear])

  /** 저장 후: 해당 연도의 fromMonth~12월 실적·점수 캐시만 비움 */
  const invalidateMetricsFromMonth = useCallback((year, fromMonth) => {
    const start = Math.max(1, Math.min(12, Number(fromMonth) || 1))
    const keys = []
    for (let m = start; m <= 12; m += 1) keys.push(monthKey(year, m))
    setAchievementsByMonth((prev) => {
      let changed = false
      const next = { ...prev }
      for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(next, k)) {
          delete next[k]
          changed = true
        }
      }
      return changed ? next : prev
    })
    setGroupScoresByMonth((prev) => {
      let changed = false
      const next = { ...prev }
      for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(next, k)) {
          delete next[k]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [])

  // 탭 복귀/창 포커스 시 최신 데이터로 맞춤 (폴링 없음)
  useEffect(() => {
    if (!currentUser) return undefined
    let lastAt = 0
    const syncIfVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const now = Date.now()
      if (now - lastAt < 2500) return
      lastAt = now
      invalidateLiveCaches()
      reloadEvalCodeCatalog()
      reloadOwnerGroups()
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') syncIfVisible()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', syncIfVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', syncIfVisible)
    }
  }, [currentUser, invalidateLiveCaches, reloadEvalCodeCatalog, reloadOwnerGroups])

  // 코드북 등에서 나가면 지표 마스터 카탈로그 갱신
  const prevViewRef = useRef(view)
  useEffect(() => {
    const prev = prevViewRef.current
    prevViewRef.current = view
    if (prev === 'codebook' && view !== 'codebook') {
      reloadEvalCodeCatalog()
      reloadOwnerGroups()
    }
    if ((prev === 'deptFacts' || prev === 'facts') && view !== prev) {
      invalidateLiveCaches([currentEvalKey, prevEvalKey])
    }
  }, [view, reloadEvalCodeCatalog, reloadOwnerGroups, invalidateLiveCaches, currentEvalKey, prevEvalKey])

  useEffect(() => {
    if (view === 'evalConfig') {
      reloadEvalCodeCatalog()
    }
  }, [view, reloadEvalCodeCatalog])

  useEffect(() => {
    // 구버전: 실패/빈 응답을 truthy 캐시로 고정 → 평가배치가 영구 빈 화면이 되던 문제 복구
    setResolvedEvalConfigsByMonth((prev) => {
      let changed = false
      const next = { ...prev }
      Object.entries(prev).forEach(([key, val]) => {
        const empty = !val || !Array.isArray(val.items) || val.items.length === 0
        if (empty && val?._loadStatus !== 'ok') {
          delete next[key]
          changed = true
        }
      })
      return changed ? next : prev
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    const targets = [currentEvalKey, prevEvalKey]
    const jobs = targets.map(async (key) => {
      const cached = resolvedEvalConfigsByMonth[key]
      if (cached && Array.isArray(cached.items) && cached.items.length > 0) return
      if (cached && cached._loadStatus === 'ok') return
      // error 캐시는 월 변경 전까지 재시도하지 않음(무한루프 방지). evalConfig 화면 진입 시 아래에서 클리어
      if (cached && cached._loadStatus === 'error' && view !== 'evalConfig') return
      const [year, month] = key.split('-').map(Number)
      try {
        const res = await api.listEvalConfigs({ year, month })
        if (!cancelled) {
          const next = { ...normalizeResolvedEvalConfig(res), _loadStatus: 'ok' }
          setResolvedEvalConfigsByMonth((prev) => {
            const cur = prev[key]
            if (cur && Array.isArray(cur.items) && cur.items.length > 0 && !(next.items || []).length) {
              return prev
            }
            return { ...prev, [key]: next }
          })
        }
      } catch {
        if (!cancelled) {
          setResolvedEvalConfigsByMonth((prev) => {
            if (prev[key] && Array.isArray(prev[key].items) && prev[key].items.length > 0) return prev
            return {
              ...prev,
              [key]: { year, month, items: [], _loadStatus: 'error' },
            }
          })
        }
      }
    })
    Promise.all(jobs)
    return () => { cancelled = true }
  }, [currentEvalKey, prevEvalKey, resolvedEvalConfigsByMonth, view])

  useEffect(() => {
    // 평가배치 화면 진입 시 실패 캐시 해제 → 재조회
    if (view !== 'evalConfig') return undefined
    setResolvedEvalConfigsByMonth((prev) => {
      let changed = false
      const next = { ...prev }
      Object.entries(prev).forEach(([key, val]) => {
        if (val && val._loadStatus === 'error') {
          delete next[key]
          changed = true
        } else if (val && Array.isArray(val.items) && val.items.length === 0 && val._loadStatus !== 'ok') {
          // 구버전 빈 고착 캐시
          delete next[key]
          changed = true
        }
      })
      return changed ? next : prev
    })
    evalHistoryLoadedRef.current.delete(selectedYear)
    return undefined
  }, [view, selectedYear])

  useEffect(() => {
    let cancelled = false
    if (evalHistoryLoadedRef.current.has(selectedYear)) return undefined
    api.listEvalConfigHistory({ year: selectedYear })
      .then((res) => {
        if (cancelled) return
        evalHistoryLoadedRef.current.add(selectedYear)
        setEvalHistoryByYear((prev) => ({ ...prev, [selectedYear]: res.items || [] }))
      })
      .catch(() => {
        // 실패 시 loaded 표시 안 함 → evalConfig 진입/연도 변경 시 재시도
      })
    return () => { cancelled = true }
  }, [selectedYear, evalHistoryByYear, view])

  useEffect(() => {
    if (!VIEWS_PREFETCH_METRICS.has(view)) return undefined
    let cancelled = false
    const targets = []
    for (const year of [selectedYear, prevYear]) {
      for (let month = 1; month <= 12; month += 1) {
        targets.push(monthKey(year, month))
      }
    }
    const jobs = targets.map(async (key) => {
      const isCurrent = key === currentEvalKey || key === prevEvalKey
      if (Object.prototype.hasOwnProperty.call(achievementsByMonth, key)) {
        const cached = achievementsByMonth[key]
        // 현재/전년동월은 빈 캐시도 재조회. 그 외는 데이터 있으면 유지
        if (Array.isArray(cached) && cached.length > 0) return
        if (!isCurrent && Array.isArray(cached)) return
      }
      const [year, month] = key.split('-').map(Number)
      try {
        const res = await api.listAchievements({ year, month })
        if (!cancelled) {
          setAchievementsByMonth(prev => {
            const existing = prev[key]
            const next = mapAchievementItems(res.items || [], year, month)
            if (
              Array.isArray(existing)
              && existing.length === next.length
              && existing.length === 0
            ) return prev
            return { ...prev, [key]: next }
          })
        }
      } catch {
        if (!cancelled) {
          setAchievementsByMonth(prev => (
            Object.prototype.hasOwnProperty.call(prev, key) ? prev : { ...prev, [key]: [] }
          ))
        }
      }
    })
    Promise.all(jobs)
    return () => { cancelled = true }
  }, [view, selectedYear, prevYear, currentEvalKey, prevEvalKey, achievementsByMonth])

  useEffect(() => {
    if (!VIEWS_PREFETCH_METRICS.has(view)) return undefined
    let cancelled = false
    const targets = []
    for (const year of [selectedYear, prevYear]) {
      for (let month = 1; month <= 12; month += 1) {
        targets.push(monthKey(year, month))
      }
    }
    const jobs = targets.map(async (key) => {
      const isCurrent = key === currentEvalKey || key === prevEvalKey
      if (Object.prototype.hasOwnProperty.call(groupScoresByMonth, key)) {
        const cached = groupScoresByMonth[key]
        if (Array.isArray(cached) && cached.length > 0) return
        if (!isCurrent && Array.isArray(cached)) return
      }
      const [year, month] = key.split('-').map(Number)
      try {
        const res = await api.listGroupScores({ year, month })
        if (!cancelled) {
          setGroupScoresByMonth((prev) => {
            const existing = prev[key]
            const next = res.items || []
            if (Array.isArray(existing) && existing.length === next.length && existing.length === 0) return prev
            return { ...prev, [key]: next }
          })
        }
      } catch {
        if (!cancelled) {
          setGroupScoresByMonth((prev) => (
            Object.prototype.hasOwnProperty.call(prev, key) ? prev : { ...prev, [key]: [] }
          ))
        }
      }
    })
    Promise.all(jobs)
    return () => { cancelled = true }
  }, [view, selectedYear, prevYear, currentEvalKey, prevEvalKey, groupScoresByMonth])

  const handleRefreshFacts = async () => {
    setFactsRefreshing(true)
    setFactsMessage('')
    try {
      // 실적 새로고침 직전에 연도 목록을 다시 받아, 평가셋 복구 후에도 2026이 안 보이는 상태를 막는다
      const years = await reloadEvalYears()
      const year = (years.length && !years.includes(selectedYear)) ? years[0] : selectedYear
      const key = monthKey(year, selectedMonth)
      const result = await api.refreshFacts({ year, month: selectedMonth })
      const res = await api.listAchievements({ year, month: selectedMonth })
      setAchievementsByMonth(prev => ({
        ...prev,
        [key]: mapAchievementItems(res.items || [], year, selectedMonth),
      }))
      try {
        const scores = await api.listGroupScores({ year, month: selectedMonth })
        setGroupScoresByMonth(prev => ({ ...prev, [key]: scores.items || [] }))
      } catch {
        // ignore
      }
      const collect = Number(result.collect || 0)
      const achievement = Number(result.achievement || 0)
      if (achievement === 0 && collect > 0) {
        setFactsMessage(`원천실적 ${collect}건 수신 · 평가배치 없어 달성률 산정 0건`)
      } else if (achievement === 0 && collect === 0) {
        setFactsMessage('동기화 완료 · 취합·달성률 모두 0건')
      } else {
        setFactsMessage(`실적 동기화 완료 (취합 ${collect} · 달성률 ${achievement})`)
      }
    } catch (e) {
      setFactsMessage(e?.message || '실적 동기화 실패')
    } finally {
      setFactsRefreshing(false)
    }
  }

  const groupSummaries = useMemo(() => {
    return activeGroups.map(g => {
      const defs = kpiDefs.filter(k => k.group === g)
      const monthResults = activeResults.filter(r => r.group === g && r.month === selectedMonth && r.mgmtTool === 'KPI')
      const scoreRow = scoreByGroupName[g]

      let weightedSum = 0, totalWeight = 0, over100 = 0, mid = 0, under80 = 0
      const catAchs = {}

      activeCats.forEach(cat => {
        const catDefs = defs.filter(d => d.category === cat && String(d.contributionMode || d.contribution_mode || 'WEIGHT').toUpperCase() !== 'ADJUST')
        let cw = 0, cs = 0
        catDefs.forEach(def => {
          const r = monthResults.find(r => r.code === def.code)
          if (r && r.achievement != null) {
            const w = Number(def.weight) || 0
            if (w <= 0) return
            cs += r.achievement * w; cw += w
            weightedSum += r.achievement * w; totalWeight += w
            if (r.achievement >= 100) over100++
            else if (r.achievement >= 80) mid++
            else under80++
          }
        })
        catAchs[cat] = cw > 0 ? Math.round(cs / cw * 10) / 10 : null
      })

      const fallback = totalWeight > 0 ? Math.round(weightedSum / totalWeight * 10) / 10 : 0
      const ultimate = scoreRow?.ultimate_score
      const wavg = ultimate != null && Number.isFinite(Number(ultimate))
        ? Math.round(Number(ultimate) * 10) / 10
        : fallback

      return {
        name: g,
        kpiCount: defs.length,
        wavg,
        over100,
        mid,
        under80,
        catAchs,
        baseScore: scoreRow?.base_score ?? null,
        adjustPoints: scoreRow?.adjust_points ?? 0,
        adjustPp: scoreRow?.adjust_pp ?? 0,
        groupFinalScore: scoreRow?.group_final_score ?? null,
        ultimateScore: scoreRow?.ultimate_score ?? null,
      }
    })
  }, [selectedMonth, kpiDefs, activeGroups, activeCats, activeResults, scoreByGroupName])

  const handleGroupClick = (groupName) => {
    if (!activeGroups.includes(groupName)) return
    setSelectedGroup(groupName)
    setView('detail')
    setDetailTab('summary')
  }

  /** Agenda는 그룹과 독립 — 그룹 선택 해제 후 테마 지표만 표시 */
  const handleAgendaSelect = (tabId) => {
    setSelectedGroup(null)
    setView('detail')
    setDetailTab(`custom:${tabId}`)
  }

  const handleReportClick = (groupName) => {
    setSelectedGroup(groupName || selectedGroup)
    setView('report')
  }

  const handleViewChange = (nextView) => {
    if ((nextView === 'codebook' || nextView === 'evalConfig' || nextView === 'users' || nextView === 'facts') && !canAccessAdminMenu(currentUser)) {
      applyRoleHome(currentUser)
      return
    }
    if (nextView === 'deptFacts' && !canAccessDeptFactEntry(currentUser)) {
      applyRoleHome(currentUser)
      return
    }
    if ((nextView === 'dashboard' || nextView === 'agent' || nextView === 'anomaly') && !canAccessTopMenu(currentUser)) {
      applyRoleHome(currentUser)
      return
    }
    if (nextView === 'home' && canAccessTopMenu(currentUser)) {
      applyRoleHome(currentUser)
      return
    }
    setView(nextView)
  }

  const handleLogout = () => {
    logout()
    setCurrentUser(null)
    setView('home')
    setSelectedGroup(null)
  }

  const handleSaveCustomTab = (payload) => {
    if (!canAccessAdminMenu(currentUser)) return { ok: false, reason: 'forbidden' }
    const title = (payload?.title ?? '').trim()
    const metricCodes = Array.isArray(payload?.metricCodes) ? payload.metricCodes : []
    const editId = payload?.id ?? null
    if (!title || metricCodes.length === 0) return { ok: false, reason: 'invalid' }
    if (customTabs.some(t => t.title === title && t.id !== editId)) return { ok: false, reason: 'duplicate_title' }
    if (editId) {
      setCustomTabs(prev => prev.map(t => t.id === editId ? { ...t, title, metricCodes } : t))
      setSelectedGroup(null)
      setView('detail')
      setDetailTab(`custom:${editId}`)
      return { ok: true }
    }
    if (customTabs.length >= 8) return { ok: false, reason: 'limit' }
    const id = `tab_${Date.now()}`
    setCustomTabs(prev => [...prev, { id, title, metricCodes }])
    setSelectedGroup(null)
    setView('detail')
    setDetailTab(`custom:${id}`)
    return { ok: true }
  }

  const handleDeleteCustomTab = (id) => {
    if (!canAccessAdminMenu(currentUser)) return
    setCustomTabs(prev => prev.filter(t => t.id !== id))
    if (detailTab === `custom:${id}`) {
      setDetailTab('summary')
      if (!selectedGroup && activeGroups[0]) {
        setSelectedGroup(activeGroups[0])
      }
    }
  }

  const defaultMaster = useMemo(() => buildMasterFromCodebook(CODEBOOK, KPI_DEFINITIONS), [])
  const buildDefaultEvalRows = useMemo(() => {
    return (year, month) => buildEvalConfig(KPI_DEFINITIONS, evalCodeCatalog, year, month)
  }, [evalCodeCatalog])

  if (!currentUser) {
    return <LoginView onLogin={handleLogin} />
  }

  const deptScopeHint = currentUser.role === ROLES.DEPT_ADMIN
    ? `${(currentUser.allowedDepartments?.length ? currentUser.allowedDepartments.join(', ') : currentUser.department) || '배정부서'} · 부서 스코프`
    : null
  const agendaTitle = selectedCustomTab?.title || null

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        groups={activeGroups}
        view={view}
        selectedGroup={selectedGroup}
        selectedYear={selectedYear}
        detailTab={detailTab}
        customTabs={customTabs}
        detailMetricOptions={scopedDefs.filter(d => d.mgmtTool === 'KPI').map(def => ({
          code: def.code,
          name: def.name,
          label: def.label26 || def.name,
          category: def.category,
          group: def.group,
          weight: def.weight,
        }))}
        onViewChange={handleViewChange}
        onGroupSelect={handleGroupClick}
        onAgendaSelect={handleAgendaSelect}
        onSaveCustomTab={handleSaveCustomTab}
        onDeleteCustomTab={handleDeleteCustomTab}
        currentUser={currentUser}
        onLogout={handleLogout}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          view={view}
          selectedGroup={selectedGroup}
          agendaTitle={agendaTitle}
          selectedMonth={selectedMonth}
          selectedYear={selectedYear}
          toolFilter={toolFilter}
          onMonthChange={setSelectedMonth}
          onYearChange={setSelectedYear}
          yearOptions={yearOptions}
          onToolFilterChange={setToolFilter}
          onBack={() => {
            if (view === 'report') {
              setView('detail')
              return
            }
            applyRoleHome(currentUser)
          }}
          onReportClick={() => handleReportClick()}
          currentUser={currentUser}
          onRefreshFacts={handleRefreshFacts}
          factsRefreshing={factsRefreshing}
          factsMessage={factsMessage}
        />
        <main className={`flex-1 overflow-y-auto bg-transparent ${view === 'home' ? 'p-0' : 'p-6'}`}>
          {view === 'codebook' && canAccessAdminMenu(currentUser) && (
            <CodebookAdminView />
          )}
          {view === 'evalConfig' && canAccessAdminMenu(currentUser) && (
            <EvalConfigView
              yearOptions={yearOptions}
              selectedYear={selectedYear}
              selectedMonth={selectedMonth}
              onYearChange={setSelectedYear}
              onMonthChange={setSelectedMonth}
              resolvedMeta={currentResolvedEval}
              evalRows={currentResolvedEval.items || []}
              historyRows={evalHistoryByYear[selectedYear] || []}
              templateUrl={api.getEvalTemplateUrl()}
              exportUrl={selectedYear ? api.getEvalExportUrl({ year: selectedYear, month: selectedMonth }) : ''}
              codeCatalog={evalCodeCatalog}
              onRefreshCodeCatalog={reloadEvalCodeCatalog}
              ownerGroupRows={evalOwnerGroupRows}
              onSaveEvalSet={async ({ effectiveMonth, items, changeReason }) => {
                const payloadItems = (items || []).map((row, idx) => {
                  const sortOrder = Number(row.sortOrder ?? row.sort_order)
                  const safeSort = Number.isFinite(sortOrder) ? sortOrder : idx
                  return {
                    ...row,
                    indicator_code: row.indicatorCode || row.indicator_code,
                    group_code: row.groupCode || row.group_code,
                    mgmt_tool: row.mgmtTool || row.mgmt_tool,
                    eval_category_lv1: row.evalCategoryLv1 || row.eval_category_lv1,
                    eval_category_lv2: row.evalCategoryLv2 || row.eval_category_lv2,
                    eval_category_lv3: row.evalCategoryLv3 || row.eval_category_lv3,
                    is_core: row.isCore ? 'Y' : 'N',
                    annual_target: row.annualTarget ?? row.annual_target,
                    baseline_actual: row.baselineActual ?? row.baseline_actual,
                    achievement_mode: row.achievementMode || row.achievement_mode,
                    goal_direction: row.goalDirection || row.goal_direction,
                    custom_achievement_expr: row.customAchievementExpr || row.custom_achievement_expr,
                    custom_monthly_targets_json: row.customMonthlyTargets || row.custom_monthly_targets_json,
                    filters_json: row.filters || row.filters_json,
                    data_source: row.dataSource || row.data_source,
                    h1_target: row.h1Target ?? row.h1_target,
                    h2_target: row.h2Target ?? row.h2_target,
                    score_rule: row.scoreRule || row.score_rule,
                    penalty_rule: row.penaltyRule || row.penalty_rule,
                    adj_band: row.adjBand || row.adj_band || '',
                    cap_max: row.capMax ?? row.cap_max,
                    cap_min: row.capMin ?? row.cap_min,
                    formula_id: row.formulaId ?? row.formula_id,
                    contribution_mode: String(row.contributionMode || row.contribution_mode || 'WEIGHT').toUpperCase() === 'ADJUST' ? 'ADJUST' : 'WEIGHT',
                    weight: String(row.contributionMode || row.contribution_mode || 'WEIGHT').toUpperCase() === 'ADJUST'
                      ? 0
                      : (row.weight ?? 0),
                    sortOrder: safeSort,
                    sort_order: safeSort,
                    target_start_month: row.targetStartMonth ?? row.target_start_month ?? 1,
                    target_end_month: row.targetEndMonth ?? row.target_end_month ?? 12,
                  }
                })
                const saved = await api.saveEvalConfigSet({ year: selectedYear, effectiveMonth, items: payloadItems, changeReason })
                const normalized = normalizeResolvedEvalConfig(saved)
                // 조회월 기준으로 다시 읽어 상속/적용월 차이를 반영 (저장 응답은 effectiveMonth 기준)
                let viewed = normalized
                if (selectedMonth !== effectiveMonth) {
                  try {
                    const res = await api.listEvalConfigs({ year: selectedYear, month: selectedMonth })
                    viewed = normalizeResolvedEvalConfig(res)
                  } catch {
                    viewed = selectedMonth >= effectiveMonth ? normalized : (resolvedEvalConfigsByMonth[currentEvalKey] || normalized)
                  }
                }
                setResolvedEvalConfigsByMonth(prev => {
                  const next = { ...prev }
                  for (let m = Math.min(effectiveMonth, selectedMonth); m <= 12; m += 1) {
                    delete next[monthKey(selectedYear, m)]
                  }
                  next[currentEvalKey] = viewed
                  if (selectedMonth !== effectiveMonth && selectedMonth >= effectiveMonth) {
                    next[monthKey(selectedYear, effectiveMonth)] = normalized
                  }
                  return next
                })
                invalidateMetricsFromMonth(selectedYear, Math.min(effectiveMonth, selectedMonth))
                const history = await api.listEvalConfigHistory({ year: selectedYear })
                setEvalHistoryByYear(prev => ({ ...prev, [selectedYear]: history.items || [] }))
                await reloadEvalYears()
              }}
              onSeedDefaults={async () => {
                const items = buildDefaultEvalRows(selectedYear, selectedMonth)
                const saved = await api.seedEvalDefaults({ year: selectedYear, month: selectedMonth, items, changeReason: '기본값 생성' })
                const normalized = normalizeResolvedEvalConfig(saved)
                setResolvedEvalConfigsByMonth(prev => ({ ...prev, [currentEvalKey]: normalized }))
                invalidateMetricsFromMonth(selectedYear, selectedMonth)
                const history = await api.listEvalConfigHistory({ year: selectedYear })
                setEvalHistoryByYear(prev => ({ ...prev, [selectedYear]: history.items || [] }))
                await reloadEvalYears()
              }}
              onImportEvalSet={async (file) => {
                const saved = await api.importEvalConfigSet({ year: selectedYear, month: selectedMonth, file })
                const normalized = normalizeResolvedEvalConfig(saved)
                setResolvedEvalConfigsByMonth(prev => ({ ...prev, [currentEvalKey]: normalized }))
                invalidateMetricsFromMonth(selectedYear, selectedMonth)
                const history = await api.listEvalConfigHistory({ year: selectedYear })
                setEvalHistoryByYear(prev => ({ ...prev, [selectedYear]: history.items || [] }))
                await reloadEvalYears()
              }}
              onDeleteEvalSet={async (row) => {
                const deleted = await api.deleteEvalConfigSet({ planSetId: row.plan_set_id })
                const effectiveMonth = Number(deleted.effective_from_month ?? row.effective_from_month ?? selectedMonth)
                setResolvedEvalConfigsByMonth(prev => {
                  const next = { ...prev }
                  for (let m = effectiveMonth; m <= 12; m += 1) {
                    delete next[monthKey(selectedYear, m)]
                  }
                  return next
                })
                invalidateMetricsFromMonth(selectedYear, effectiveMonth)
                const [history, currentRes, prevRes] = await Promise.all([
                  api.listEvalConfigHistory({ year: selectedYear }),
                  api.listEvalConfigs({ year: selectedYear, month: selectedMonth }),
                  api.listEvalConfigs({ year: selectedYear, month: selectedMonth > 1 ? selectedMonth - 1 : selectedMonth }),
                ])
                setEvalHistoryByYear(prev => ({ ...prev, [selectedYear]: history.items || [] }))
                setResolvedEvalConfigsByMonth(prev => ({
                  ...prev,
                  [currentEvalKey]: normalizeResolvedEvalConfig(currentRes),
                  [prevEvalKey]: normalizeResolvedEvalConfig(prevRes),
                }))
                await reloadEvalYears()
              }}
            />
          )}
          {view === 'facts' && canAccessAdminMenu(currentUser) && (
            <FactsAdminView
              selectedYear={selectedYear}
              selectedMonth={selectedMonth}
              yearOptions={yearOptions}
              onYearChange={setSelectedYear}
              onMonthChange={setSelectedMonth}
              groups={evalOwnerGroupRows}
            />
          )}
          {view === 'deptFacts' && canAccessDeptFactEntry(currentUser) && (
            <DeptFactEntryView
              currentUser={currentUser}
              selectedYear={selectedYear}
              selectedMonth={selectedMonth}
              yearOptions={yearOptions}
              onYearChange={setSelectedYear}
              onMonthChange={setSelectedMonth}
              onFactsMutated={() => invalidateMetricsFromMonth(selectedYear, selectedMonth)}
            />
          )}
          {view === 'users' && canAccessAdminMenu(currentUser) && (
            <UserAdminView groups={masterGroupNames} />
          )}
          {view === 'home' && !canAccessTopMenu(currentUser) && (
            <HomeWelcomeView
              currentUser={currentUser}
              groups={activeGroups}
              selectedYear={selectedYear}
              selectedMonth={selectedMonth}
              onGroupClick={handleGroupClick}
            />
          )}
          {view === 'dashboard' && canAccessDashboard(currentUser) && (
            <DashboardView
              groupSummaries={groupSummaries}
              categories={activeCats}
              definitions={kpiDefs}
              results={dashboardResults}
              prevDefinitions={dashboardPrevDefs}
              prevResults={dashboardPrevResults}
              bankScore={bankGroupScore}
              prevBankScore={prevBankGroupScore}
              selectedMonth={selectedMonth}
              selectedYear={selectedYear}
              onGroupClick={handleGroupClick}
            />
          )}
          {view === 'agent' && canAccessTopMenu(currentUser) && (
            <AgentQueryView
              definitions={scopedDefs}
              results={activeResults}
              groups={activeGroups}
              categories={activeCats}
              selectedMonth={selectedMonth}
              selectedYear={selectedYear}
              currentUser={currentUser}
            />
          )}
          {view === 'anomaly' && canAccessTopMenu(currentUser) && (
            <AnomalyCenterView
              definitions={scopedDefs}
              results={activeResults}
              groups={activeGroups}
              categories={activeCats}
              selectedMonth={selectedMonth}
              selectedYear={selectedYear}
            />
          )}
          {view === 'detail' && (
            <GroupDetailView
              group={isAgendaMode ? null : selectedGroup}
              categories={detailCategories}
              definitions={detailDefinitions}
              results={detailResults}
              selectedMonth={selectedMonth}
              selectedYear={selectedYear}
              toolFilter={toolFilter}
              onReportClick={() => handleReportClick()}
              prevDefinitions={prevActiveDefs}
              prevResults={resolvedPrevResults}
              detailTab={detailTab}
              selectedCustomTab={selectedCustomTab}
              codebook={indicatorMaster}
              scopeHint={isAgendaMode ? null : deptScopeHint}
              groupScore={isAgendaMode ? null : (scoreByGroupName[selectedGroup] || null)}
              prevGroupScore={isAgendaMode ? null : (momScoreByGroupName[selectedGroup] || null)}
              yearGroupScores={isAgendaMode ? [] : yearGroupScoresForSelected}
            />
          )}
          {view === 'report' && (
            <ReportView
              group={selectedGroup}
              categories={detailCategories}
              definitions={scopedDefs.filter(k => k.group === selectedGroup)}
              results={detailResults}
              selectedMonth={selectedMonth}
              selectedYear={selectedYear}
            />
          )}
        </main>
      </div>
    </div>
  )
}

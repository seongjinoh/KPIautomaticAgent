import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Download, Lock, RefreshCw, Save, Search, Snowflake, Unlock, Upload } from 'lucide-react'
import { filterEvalGroups } from '../lib/orgGroup'
import { api } from '../lib/apiClient'
import { formatMetricNumber } from '../lib/numberFormat'
import {
  ROLES,
  canConfirmGroupFacts,
  canFreezePeriod,
  resolveAllowedGroupList,
} from '../lib/authService'

function departmentsForUser(user) {
  if (!user) return []
  if (user.role === ROLES.ADMIN) return null
  const list = user.allowedDepartments?.length
    ? user.allowedDepartments
    : (user.department ? [user.department] : [])
  return list.filter(Boolean)
}

function defaultScopeMode(user) {
  if (user?.role === ROLES.ADMIN) return 'all'
  if (user?.role === ROLES.GROUP_ADMIN) return 'group'
  if (user?.role === ROLES.DEPT_ADMIN) return 'dept'
  return 'group'
}

export default function DeptFactEntryView({
  currentUser,
  selectedYear,
  selectedMonth,
  yearOptions = [],
  onYearChange,
  onMonthChange,
  onFactsMutated,
}) {
  const isAdmin = currentUser?.role === ROLES.ADMIN
  const allowedDepts = useMemo(() => departmentsForUser(currentUser), [currentUser])
  const [scopeMode, setScopeMode] = useState(() => defaultScopeMode(currentUser))
  const [ownerGroups, setOwnerGroups] = useState([])
  const [deptOptions, setDeptOptions] = useState([])
  const [dept, setDept] = useState('')
  const [groupCode, setGroupCode] = useState('')
  const [items, setItems] = useState([])
  const [drafts, setDrafts] = useState({})
  const [period, setPeriod] = useState(null)
  const [groupConfirmStatus, setGroupConfirmStatus] = useState('open')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [dirtyOnly, setDirtyOnly] = useState(false)
  const [missingOnly, setMissingOnly] = useState(false)
  const [filterOwnGroup, setFilterOwnGroup] = useState('')
  const [filterOwnDept, setFilterOwnDept] = useState('')
  const [filterEvalGroup, setFilterEvalGroup] = useState('')
  const fileRef = useRef(null)

  const actorLabel = currentUser?.employeeNo || currentUser?.name || 'ui'
  const periodFrozen = period?.period_status === 'frozen'
  const groupConfirmed = groupConfirmStatus === 'confirmed'
  const canEditRow = (row) => {
    if (periodFrozen) return false
    if (isAdmin) return true
    return !(row?.locked_for_non_admin || row?.group_confirmed)
  }
  const canEditAny = isAdmin
    ? !periodFrozen
    : !periodFrozen && (scopeMode === 'group' ? !groupConfirmed : items.some((r) => canEditRow(r)))

  const showScopeToggle = isAdmin || (
    currentUser?.role === ROLES.DEPT_ADMIN && resolveAllowedGroupList(currentUser).length > 0
  )

  const allowedGroupOptions = useMemo(() => {
    if (!ownerGroups.length) return []
    const evalGroups = filterEvalGroups(ownerGroups)
    if (isAdmin) return evalGroups.filter((g) => g.use_yn !== 'N')
    const names = new Set(resolveAllowedGroupList(currentUser))
    return evalGroups.filter((g) => names.has(g.name) || names.has(g.code))
  }, [ownerGroups, currentUser, isAdmin])

  const selectedGroupName = useMemo(() => {
    const hit = ownerGroups.find((g) => g.code === groupCode)
    return hit?.name || groupCode
  }, [ownerGroups, groupCode])

  const canConfirm = canConfirmGroupFacts(currentUser, selectedGroupName)
    || canConfirmGroupFacts(currentUser, groupCode)

  useEffect(() => {
    let cancelled = false
    api.listGroups({ evalOnly: true })
      .then((res) => {
        if (!cancelled) setOwnerGroups(res.items || [])
      })
      .catch(() => {
        if (!cancelled) setOwnerGroups([])
      })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    setScopeMode(defaultScopeMode(currentUser))
  }, [currentUser?.role])

  useEffect(() => {
    if (!allowedGroupOptions.length) {
      setGroupCode('')
      return
    }
    setGroupCode((prev) => (
      allowedGroupOptions.some((g) => g.code === prev)
        ? prev
        : allowedGroupOptions[0].code
    ))
  }, [allowedGroupOptions])

  useEffect(() => {
    let cancelled = false
    const loadDepts = async () => {
      if (scopeMode !== 'dept' && currentUser?.role === ROLES.GROUP_ADMIN) return
      try {
        if (allowedDepts) {
          if (!cancelled) {
            setDeptOptions(allowedDepts)
            setDept((prev) => (allowedDepts.includes(prev) ? prev : (allowedDepts[0] || '')))
          }
          return
        }
        const res = await api.listDeptFactDepts({ year: selectedYear, month: selectedMonth })
        const list = res.items || []
        if (!cancelled) {
          setDeptOptions(list)
          setDept((prev) => (list.includes(prev) ? prev : (list[0] || '')))
        }
      } catch (e) {
        if (!cancelled) setError(e?.data?.message || e?.message || '부서 목록 조회 실패')
      }
    }
    loadDepts()
    return () => { cancelled = true }
  }, [allowedDepts, selectedYear, selectedMonth, scopeMode, currentUser?.role])

  const loadPeriod = async () => {
    try {
      const res = await api.getFactPeriodStatus({ year: selectedYear, month: selectedMonth })
      setPeriod(res)
      if (scopeMode === 'group' && groupCode) {
        const g = (res.groups || []).find((x) => x.group_code === groupCode)
        setGroupConfirmStatus(g?.status || 'open')
      }
    } catch {
      setPeriod(null)
    }
  }

  const load = async () => {
    if (scopeMode === 'dept' && !dept) {
      setItems([])
      setDrafts({})
      return
    }
    if (scopeMode === 'group' && !groupCode) {
      setItems([])
      setDrafts({})
      return
    }
    setLoading(true)
    setError('')
    try {
      const [res] = await Promise.all([
        api.listDeptFactEntries({
          year: selectedYear,
          month: selectedMonth,
          scope: scopeMode === 'all' ? 'all' : undefined,
          dept: scopeMode === 'dept' ? dept : undefined,
          group: scopeMode === 'group' ? groupCode : undefined,
        }),
        loadPeriod(),
      ])
      const rows = res.items || []
      setItems(rows)
      if (res.group_confirm_status) setGroupConfirmStatus(res.group_confirm_status)
      if (res.period_status) {
        setPeriod((prev) => ({ ...(prev || {}), period_status: res.period_status }))
      }
      const next = {}
      for (const r of rows) {
        next[r.indicator_code] = r.actual == null || r.actual === '' ? '' : String(r.actual)
      }
      setDrafts(next)
      const scopeLabel = scopeMode === 'all'
        ? '전체'
        : scopeMode === 'dept'
          ? dept
          : `${selectedGroupName}(${groupCode})`
      setMessage(`${res.eval_ym || ''} · ${scopeLabel} · ${rows.length}건`)
    } catch (e) {
      setItems([])
      setDrafts({})
      setError(e?.data?.message || e?.message || '실적 목록 조회 실패')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setFilterOwnGroup('')
    setFilterOwnDept('')
    setFilterEvalGroup('')
  }, [selectedYear, selectedMonth, scopeMode])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dept, groupCode, scopeMode, selectedYear, selectedMonth])

  const dirtyCodes = useMemo(() => {
    const set = new Set()
    for (const r of items) {
      if (!canEditRow(r)) continue
      const raw = drafts[r.indicator_code]
      const cur = raw === '' || raw == null ? null : Number(raw)
      const prev = r.actual == null || r.actual === '' ? null : Number(r.actual)
      if (raw === '' || raw == null) {
        if (prev != null) set.add(r.indicator_code)
        continue
      }
      if (Number.isNaN(cur)) {
        set.add(r.indicator_code)
        continue
      }
      if (prev == null || Math.abs(cur - prev) > 1e-9) set.add(r.indicator_code)
    }
    return set
  }, [items, drafts, periodFrozen, isAdmin, groupConfirmed])

  // Ownership: 지표마스터 Lv3(+마스터 덮어쓰기) 필드. 피평가그룹과는 별개.
  const ownershipGroupOptions = useMemo(() => {
    const codes = new Set()
    for (const r of items) {
      const c = String(r.ownership_group_code || '').trim().toUpperCase()
      if (c) codes.add(c)
    }
    const fromItems = allowedGroupOptions.filter((g) => codes.has(g.code))
    return fromItems.length ? fromItems : allowedGroupOptions
  }, [allowedGroupOptions, items])

  const ownershipDeptOptions = useMemo(() => {
    const set = new Set()
    for (const r of items) {
      const d = String(r.ownership_dept || r.dept || '').trim()
      if (d) set.add(d)
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'))
  }, [items])

  const evalGroupOptions = useMemo(() => {
    if (period?.groups?.length) {
      return period.groups.map((g) => ({
        code: g.group_code,
        name: g.group_name || g.group_code,
      }))
    }
    const map = new Map()
    for (const r of items) {
      const codes = r.group_codes || []
      const names = r.group_names || []
      codes.forEach((c, i) => {
        if (c && !map.has(c)) map.set(c, names[i] || c)
      })
    }
    return [...map.entries()].map(([code, name]) => ({ code, name }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'))
  }, [period, items])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((r) => {
      if (dirtyOnly && !dirtyCodes.has(r.indicator_code)) return false
      if (missingOnly && r.has_fact) return false
      if (filterOwnDept && String(r.ownership_dept || r.dept || '').trim() !== filterOwnDept) return false
      if (filterOwnGroup) {
        const own = String(r.ownership_group_code || '').trim().toUpperCase()
        if (own !== filterOwnGroup) return false
      }
      if (filterEvalGroup) {
        const codes = r.group_codes || []
        if (!codes.includes(filterEvalGroup)) return false
      }
      if (!q) return true
      const hay = [
        r.indicator_code, r.label, r.dept, r.ownership_dept, r.ownership_group_code,
        ...(r.group_names || []),
      ].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [
    items, query, dirtyOnly, missingOnly, dirtyCodes,
    filterOwnDept, filterOwnGroup, filterEvalGroup,
  ])

  const setDraft = (code, value) => {
    setDrafts((prev) => ({ ...prev, [code]: value }))
  }

  const saveDirty = async () => {
    const updates = []
    for (const code of dirtyCodes) {
      const raw = drafts[code]
      if (raw === '' || raw == null || Number.isNaN(Number(raw))) {
        setError(`${code}: 실적은 숫자로 입력해 주세요`)
        return
      }
      updates.push({ indicator_code: code, actual: Number(raw) })
    }
    if (!updates.length) {
      setMessage('변경된 실적이 없습니다')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await api.saveDeptFactEntries({
        year: selectedYear,
        month: selectedMonth,
        scope: scopeMode === 'all' ? 'all' : undefined,
        dept: scopeMode === 'dept' ? dept : undefined,
        group: scopeMode === 'group' ? groupCode : undefined,
        updates,
        actedBy: actorLabel,
        actorRole: currentUser?.role || '',
      })
      setMessage(
        `저장 완료 · ${res.counts?.rows_ok ?? updates.length}건`
        + (res.counts?.rows_changed != null ? ` (변경 ${res.counts.rows_changed} · 신규 ${res.counts.rows_new})` : ''),
      )
      await load()
      onFactsMutated?.()
    } catch (e) {
      setError(e?.data?.message || e?.message || '실적 저장 실패')
    } finally {
      setSaving(false)
    }
  }

  const onExport = () => {
    if (scopeMode === 'dept' && !dept) return
    if (scopeMode === 'group' && !groupCode) return
    window.location.href = api.getDeptFactExportUrl({
      year: selectedYear,
      month: selectedMonth,
      scope: scopeMode === 'all' ? 'all' : undefined,
      dept: scopeMode === 'dept' ? dept : undefined,
      group: scopeMode === 'group' ? groupCode : undefined,
    })
  }

  const onImportFile = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (scopeMode === 'dept' && !dept) return
    if (scopeMode === 'group' && !groupCode) return
    setSaving(true)
    setError('')
    try {
      const res = await api.importDeptFactEntries(file, {
        year: selectedYear,
        month: selectedMonth,
        scope: scopeMode === 'all' ? 'all' : undefined,
        dept: scopeMode === 'dept' ? dept : undefined,
        group: scopeMode === 'group' ? groupCode : undefined,
        actorRole: currentUser?.role || '',
      })
      setMessage(`엑셀 반영 · ${res.counts?.rows_ok ?? 0}건`)
      await load()
      onFactsMutated?.()
    } catch (err) {
      setError(err?.data?.message || err?.message || '엑셀 업로드 실패')
    } finally {
      setSaving(false)
    }
  }

  const onConfirmGroup = async () => {
    if (!groupCode) return
    if (!window.confirm(`${selectedGroupName}(${groupCode}) 실적을 확인 처리할까요?\n확인 후 Admin 외에는 수정할 수 없습니다.`)) return
    setSaving(true)
    setError('')
    try {
      await api.confirmGroupFacts({
        year: selectedYear,
        month: selectedMonth,
        group: groupCode,
        actedBy: actorLabel,
      })
      setMessage(`${selectedGroupName} 지표 확인 완료`)
      await load()
      onFactsMutated?.()
    } catch (e) {
      setError(e?.data?.message || e?.message || '지표 확인 실패')
    } finally {
      setSaving(false)
    }
  }

  const onRevokeGroup = async () => {
    if (!groupCode || !isAdmin) return
    if (!window.confirm(`${selectedGroupName} 확인을 철회할까요?`)) return
    setSaving(true)
    setError('')
    try {
      await api.revokeGroupFacts({
        year: selectedYear,
        month: selectedMonth,
        group: groupCode,
        actedBy: actorLabel,
      })
      setMessage(`${selectedGroupName} 확인 철회`)
      await load()
      onFactsMutated?.()
    } catch (e) {
      setError(e?.data?.message || e?.message || '확인 철회 실패')
    } finally {
      setSaving(false)
    }
  }

  const onFreeze = async () => {
    if (!window.confirm(`${selectedYear}-${String(selectedMonth).padStart(2, '0')} 실적을 최종 확정(Freeze)할까요?\n확정 후에는 해당월 실적을 수정할 수 없습니다.\n(행내 전송은 입력분 자정 배치로 Freeze와 무관하게 진행됩니다)`)) return
    setSaving(true)
    setError('')
    try {
      await api.freezeFactPeriod({
        year: selectedYear,
        month: selectedMonth,
        actedBy: actorLabel,
      })
      setMessage('최종 확정(Freeze) 완료')
      await load()
      onFactsMutated?.()
    } catch (e) {
      setError(e?.data?.message || e?.message || 'Freeze 실패')
    } finally {
      setSaving(false)
    }
  }

  const onUnfreeze = async () => {
    if (!window.confirm('최종 확정을 해동할까요?')) return
    setSaving(true)
    setError('')
    try {
      await api.unfreezeFactPeriod({
        year: selectedYear,
        month: selectedMonth,
        actedBy: actorLabel,
      })
      setMessage('해동 완료')
      await load()
      onFactsMutated?.()
    } catch (e) {
      setError(e?.data?.message || e?.message || '해동 실패')
    } finally {
      setSaving(false)
    }
  }

  const statusBadge = () => {
    if (periodFrozen) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2 py-1 text-[11px] font-semibold text-white">
          <Snowflake className="h-3.5 w-3.5" />
          최종 확정(Freeze)
        </span>
      )
    }
    if (scopeMode === 'group' && groupConfirmed) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-900">
          <Lock className="h-3.5 w-3.5" />
          그룹 확인됨 (Admin만 수정)
        </span>
      )
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800">
        <Unlock className="h-3.5 w-3.5" />
        입력 가능
      </span>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">실적 입력 · 확인</h3>
            <p className="mt-1 text-xs text-slate-500">
              Admin은 전체 실적을 조회·수정할 수 있습니다.
              그룹 관리자는 본인 그룹 실적을 수정·「지표 확인」할 수 있습니다.
              확인 후에는 Admin만 수정 가능하며, Admin 「최종 확정(Freeze)」는 해당월 수정 마감입니다.
              입력된 실적은 Freeze와 무관하게 자정 배치로 행내 DB에 전송됩니다.
              {currentUser?.name ? ` · 입력자 ${currentUser.name}` : ''}
            </p>
          </div>
          {statusBadge()}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedYear ?? ''}
            onChange={(e) => onYearChange?.(Number(e.target.value))}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            {(yearOptions.length ? yearOptions : [selectedYear]).map((y) => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>
          <select
            value={selectedMonth}
            onChange={(e) => onMonthChange?.(Number(e.target.value))}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{m}월</option>
            ))}
          </select>

          {showScopeToggle && (
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5 text-xs">
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => setScopeMode('all')}
                  className={`rounded-md px-2.5 py-1.5 ${scopeMode === 'all' ? 'bg-slate-800 text-white' : 'text-slate-600'}`}
                >
                  전체
                </button>
              )}
              <button
                type="button"
                onClick={() => setScopeMode('group')}
                className={`rounded-md px-2.5 py-1.5 ${scopeMode === 'group' ? 'bg-slate-800 text-white' : 'text-slate-600'}`}
              >
                그룹
              </button>
              <button
                type="button"
                onClick={() => setScopeMode('dept')}
                className={`rounded-md px-2.5 py-1.5 ${scopeMode === 'dept' ? 'bg-slate-800 text-white' : 'text-slate-600'}`}
              >
                부서
              </button>
            </div>
          )}

          {scopeMode === 'group' ? (
            <select
              value={groupCode}
              onChange={(e) => setGroupCode(e.target.value)}
              disabled={allowedGroupOptions.length <= 1}
              className="min-w-[200px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              {!allowedGroupOptions.length && <option value="">그룹 없음</option>}
              {allowedGroupOptions.map((g) => (
                <option key={g.code} value={g.code}>{g.name} ({g.code})</option>
              ))}
            </select>
          ) : scopeMode === 'dept' ? (
            <select
              value={dept}
              onChange={(e) => setDept(e.target.value)}
              disabled={Boolean(allowedDepts && allowedDepts.length <= 1)}
              className="min-w-[180px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              {!deptOptions.length && <option value="">부서 없음</option>}
              {deptOptions.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          ) : (
            <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
              전 그룹·부서 실적
            </span>
          )}
        </div>

        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-2">
            <span className="text-[11px] font-semibold text-slate-500">지표 검색</span>
            <select
              value={filterOwnGroup}
              onChange={(e) => setFilterOwnGroup(e.target.value)}
              className="min-w-[160px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
              title="Ownership 그룹 (Lv3·마스터 주관그룹)"
            >
              <option value="">Ownership 그룹 (전체)</option>
              {ownershipGroupOptions.map((g) => (
                <option key={g.code} value={g.code}>{g.name} ({g.code})</option>
              ))}
            </select>
            <select
              value={filterOwnDept}
              onChange={(e) => setFilterOwnDept(e.target.value)}
              className="min-w-[150px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
              title="Ownership 부서 (Lv3·마스터 주관부서)"
            >
              <option value="">Ownership 부서 (전체)</option>
              {ownershipDeptOptions.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <select
              value={filterEvalGroup}
              onChange={(e) => setFilterEvalGroup(e.target.value)}
              className="min-w-[160px] rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm"
              title="피평가그룹 (평가배치 group_code)"
            >
              <option value="">피평가그룹 (전체)</option>
              {evalGroupOptions.map((g) => (
                <option key={g.code} value={g.code}>{g.name} ({g.code})</option>
              ))}
            </select>
            {(filterOwnGroup || filterOwnDept || filterEvalGroup) && (
              <button
                type="button"
                onClick={() => {
                  setFilterOwnGroup('')
                  setFilterOwnDept('')
                  setFilterEvalGroup('')
                }}
                className="rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-white hover:text-slate-800"
              >
                필터 초기화
              </button>
            )}
            <span className="text-[11px] text-slate-400">
              {filtered.length}/{items.length}건
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="지표코드·명 검색"
              className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm"
            />
          </div>

          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} />
            미입력만
          </label>
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={dirtyOnly} onChange={(e) => setDirtyOnly(e.target.checked)} />
            변경만
          </label>

          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            새로고침
          </button>
          <button
            type="button"
            onClick={onExport}
            disabled={scopeMode === 'dept' ? !dept : scopeMode === 'group' ? !groupCode : false}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4" />
            엑셀 다운로드
          </button>
          <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={onImportFile} />
          <button
            type="button"
            disabled={!canEditAny || saving || (scopeMode === 'dept' ? !dept : scopeMode === 'group' ? !groupCode : false)}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            엑셀 업로드
          </button>
          <button
            type="button"
            disabled={!canEditAny || saving || dirtyCodes.size === 0}
            onClick={saveDirty}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? '저장 중…' : `변경 저장 (${dirtyCodes.size})`}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          {scopeMode === 'group' && canConfirm && !periodFrozen && !groupConfirmed && (
            <button
              type="button"
              disabled={saving || !groupCode}
              onClick={onConfirmGroup}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              지표 확인
            </button>
          )}
          {scopeMode === 'group' && isAdmin && !periodFrozen && groupConfirmed && (
            <button
              type="button"
              disabled={saving || !groupCode}
              onClick={onRevokeGroup}
              className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            >
              <Unlock className="h-4 w-4" />
              확인 철회
            </button>
          )}
          {canFreezePeriod(currentUser) && !periodFrozen && (
            <button
              type="button"
              disabled={saving}
              onClick={onFreeze}
              className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-700 px-3 py-2 text-sm text-white hover:bg-indigo-600 disabled:opacity-50"
            >
              <Snowflake className="h-4 w-4" />
              최종 확정 (Freeze)
            </button>
          )}
          {canFreezePeriod(currentUser) && periodFrozen && (
            <button
              type="button"
              disabled={saving}
              onClick={onUnfreeze}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              <Unlock className="h-4 w-4" />
              해동
            </button>
          )}
        </div>
      </div>

      {isAdmin && period?.groups?.length > 0 && (
        <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-slate-700">
            그룹별 확인 현황 · {period.eval_ym}
            {period.frozen_by ? ` · Freeze: ${period.frozen_by}` : ''}
          </div>
          <table className="min-w-full text-[11px]">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                {['그룹', '코드', '상태', '확인자', '확인시각'].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {period.groups.map((g) => (
                <tr key={g.group_code} className="border-t border-slate-100">
                  <td className="px-3 py-1.5">{g.group_name}</td>
                  <td className="px-3 py-1.5 font-mono text-slate-500">{g.group_code}</td>
                  <td className="px-3 py-1.5">
                    {periodFrozen ? (
                      <span className="text-slate-800">Freeze</span>
                    ) : g.status === 'confirmed' ? (
                      <span className="text-amber-800 font-semibold">확인</span>
                    ) : (
                      <span className="text-slate-500">미확인</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-slate-500">{g.confirmed_by || '—'}</td>
                  <td className="px-3 py-1.5 text-slate-500">{g.confirmed_at || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(message || error) && (
        <div className="space-y-1">
          {message && <p className="text-xs text-emerald-700">{message}</p>}
          {error && <p className="text-xs text-rose-600 whitespace-pre-wrap">{error}</p>}
        </div>
      )}

      <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-[11px]">
          <thead className="sticky top-0 bg-slate-900 text-white">
            <tr>
              {['지표코드', '지표명(Label)', '단위', '실적', '주관부서', '담당자', '그룹', '상태'].map((h) => (
                <th key={h} className="whitespace-nowrap border-r border-slate-700 px-2 py-2 text-left font-semibold last:border-r-0">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const dirty = dirtyCodes.has(r.indicator_code)
              const editable = canEditRow(r)
              const { display: prevDisplay } = formatMetricNumber(r.actual, r.unit, { withUnit: false })
              return (
                <tr
                  key={r.indicator_code}
                  className={`border-b border-slate-100 ${dirty ? 'bg-amber-50/70' : 'hover:bg-blue-50/40'} ${!editable ? 'opacity-80' : ''}`}
                >
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[10px] text-slate-600">{r.indicator_code}</td>
                  <td className="max-w-[240px] truncate px-2 py-1.5 font-medium text-slate-800" title={r.label}>{r.label || '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">{r.unit || '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={drafts[r.indicator_code] ?? ''}
                      onChange={(e) => setDraft(r.indicator_code, e.target.value)}
                      disabled={!editable}
                      placeholder={r.has_fact ? prevDisplay : '미입력'}
                      className="w-28 rounded border border-slate-200 bg-white px-2 py-1 text-right tabular-nums outline-none focus:border-blue-400 disabled:bg-slate-100 disabled:text-slate-500"
                    />
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-slate-600">{r.dept || '—'}</td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">
                    {r.manager_name || currentUser?.name || '—'}
                  </td>
                  <td className="max-w-[160px] truncate px-2 py-1.5 text-slate-500" title={(r.group_names || []).join(', ')}>
                    {(r.group_names || []).join(', ') || '—'}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {periodFrozen ? (
                      <span className="text-slate-700">확정</span>
                    ) : r.locked_for_non_admin || r.group_confirmed ? (
                      <span className="text-amber-800">확인잠금</span>
                    ) : !r.has_fact ? (
                      <span className="text-amber-700">미입력</span>
                    ) : dirty ? (
                      <span className="text-amber-800 font-semibold">수정됨</span>
                    ) : (
                      <span className="text-emerald-700">입력됨</span>
                    )}
                  </td>
                </tr>
              )
            })}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-10 text-center text-slate-400">
                  {scopeMode === 'all'
                    ? '해당월 평가배치 지표가 없습니다.'
                    : scopeMode === 'dept'
                      ? (dept ? '해당 부서 주관 지표가 없습니다.' : '부서를 선택해 주세요.')
                      : (groupCode ? '해당 그룹 지표가 없습니다.' : '그룹을 선택해 주세요.')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

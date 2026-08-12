import { useEffect, useMemo, useState } from 'react'
import { Database, RefreshCw, Search, Upload } from 'lucide-react'
import { api } from '../lib/apiClient'
import { formatMetricNumber, formatPercentFixed } from '../lib/numberFormat'

const TABS = [
  { id: 'achievements', label: '달성률 산정' },
  { id: 'collect', label: '실적 취합' },
  { id: 'calc', label: '실적 산출' },
  { id: 'bank', label: '은행 적재' },
]

function ymKey(year, month) {
  return `${year}${String(month).padStart(2, '0')}`
}

function CellNum({ value, unit = '', percent = false }) {
  if (percent) {
    return <span className="tabular-nums">{value == null || value === '' ? '—' : formatPercentFixed(value)}</span>
  }
  const { display, title } = formatMetricNumber(value, unit, { withUnit: Boolean(unit) })
  return <span className="tabular-nums" title={title}>{display}</span>
}

function CalcKindBadge({ kind }) {
  const k = String(kind || '').toUpperCase()
  if (k === 'DERIVED') {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold bg-indigo-100 text-indigo-800">
        가공
      </span>
    )
  }
  if (k === 'DIRECT') {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-600">
        직접
      </span>
    )
  }
  return <span className="text-slate-500">{kind || '—'}</span>
}

function parseCounts(raw) {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    return JSON.parse(raw) || {}
  } catch {
    return {}
  }
}

export default function FactsAdminView({
  selectedYear,
  selectedMonth,
  yearOptions = [],
  onYearChange,
  onMonthChange,
  groups = [],
}) {
  const [tab, setTab] = useState('achievements')
  const [groupFilter, setGroupFilter] = useState('')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [meta, setMeta] = useState('')
  const [bankHistory, setBankHistory] = useState([])
  const [bankBusy, setBankBusy] = useState(false)
  const [bankMsg, setBankMsg] = useState('')
  const [selectedBatchId, setSelectedBatchId] = useState(null)
  const [batchItems, setBatchItems] = useState([])
  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const ym = ymKey(selectedYear, selectedMonth)
      if (tab === 'achievements') {
        const res = await api.listAchievements({
          year: selectedYear,
          month: selectedMonth,
          group: groupFilter || undefined,
        })
        setRows(res.items || [])
        setMeta(`${ym} · ${(res.items || []).length}건`)
      } else if (tab === 'collect') {
        const res = await api.listFactCollect({ ym })
        const items = res.items || []
        setRows(items)
        setMeta(`${ym} · ${items.length}건`)
      } else if (tab === 'calc') {
        const res = await api.listFactCalc({ ym, group: groupFilter || undefined })
        setRows(res.items || [])
        setMeta(`${ym} · ${(res.items || []).length}건`)
      } else {
        const res = await api.listBankExportHistory({ year: selectedYear })
        setBankHistory(res.items || [])
        setRows([])
        setMeta(`${selectedYear}년 적재 이력 ${(res.items || []).length}건`)
      }
    } catch (e) {
      setRows([])
      setBankHistory([])
      setError(e?.data?.message || e?.message || '실적 조회 실패')
      setMeta('')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if ((tab === 'collect' || tab === 'bank') && groupFilter) setGroupFilter('')
  }, [tab, groupFilter])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, selectedYear, selectedMonth, groupFilter])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      const hay = [
        r.indicator_code, r.indicatorCode, r.code,
        r.label, r.name, r.display_name, r.formula_name,
        r.group_code, r.groupCode, r.group_name, r.groupName, r.group,
        r.eval_category_lv1, r.eval_category_lv2, r.eval_category_lv3,
        r.unit, r.calc_kind, r.batch_id, r.fetched_at, r.formula_id,
      ].filter(Boolean).join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [rows, query])

  const groupOptions = useMemo(() => {
    if (groups?.length) {
      return groups.map((g) => {
        if (typeof g === 'string') return { code: g, name: g }
        return {
          code: String(g.code || g.group_code || g.name || '').trim(),
          name: String(g.name || g.group_name || g.code || '').trim(),
        }
      }).filter((g) => g.code)
    }
    const map = new Map()
    for (const r of rows) {
      const code = String(r.group_code || r.groupCode || '').trim()
      if (!code || map.has(code)) continue
      map.set(code, {
        code,
        name: String(r.group_name || r.groupName || code).trim(),
      })
    }
    return [...map.values()].sort((a, b) => a.code.localeCompare(b.code, 'ko'))
  }, [groups, rows])

  const runBankExport = async () => {
    setBankBusy(true)
    setBankMsg('')
    setError('')
    try {
      const res = await api.runBankExport({
        year: selectedYear,
        month: selectedMonth,
        triggeredBy: 'ui',
      })
      setBankMsg(`적재 완료 · 배치 ${res.batch_id} · ${res.counts?.items ?? 0}건`)
      await load()
    } catch (e) {
      setError(e?.data?.message || e?.message || '은행 적재 실패')
    } finally {
      setBankBusy(false)
    }
  }

  const openBatchItems = async (batchId) => {
    setSelectedBatchId(batchId)
    try {
      const res = await api.listBankExportItems(batchId)
      setBatchItems(res.items || [])
    } catch (e) {
      setBatchItems([])
      setError(e?.data?.message || e?.message || '적재 항목 조회 실패')
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
            <Database className="h-4 w-4 text-slate-500" />
            <select
              value={selectedYear ?? ''}
              onChange={(e) => onYearChange?.(Number(e.target.value))}
              className="bg-transparent text-sm font-semibold text-slate-800 outline-none"
            >
              {(yearOptions.length ? yearOptions : [selectedYear]).map((y) => (
                <option key={y} value={y}>{y}년</option>
              ))}
            </select>
            <select
              value={selectedMonth}
              onChange={(e) => onMonthChange?.(Number(e.target.value))}
              className="bg-transparent text-sm text-slate-700 outline-none"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{m}월</option>
              ))}
            </select>
          </div>

        {tab !== 'collect' && tab !== 'bank' && (
          <select
            value={groupFilter}
            onChange={(e) => setGroupFilter(e.target.value)}
            className="min-w-[140px] rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
          >
            <option value="">전체 그룹</option>
            {groupOptions.map((g) => (
              <option key={g.code} value={g.code}>
                {g.name && g.name !== g.code ? `${g.code} ${g.name}` : g.code}
              </option>
            ))}
          </select>
        )}

        {tab !== 'bank' && (
          <div className="relative min-w-[220px] flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tab === 'collect' ? '지표코드 검색' : '지표코드, 표시명, 그룹 검색'}
              className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm"
            />
          </div>
        )}

        <button
          type="button"
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          새로고침
        </button>
      </div>

      <div className="flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
              tab === t.id ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        실적 DB 조회 · {meta || '—'}
        {tab !== 'bank' && query.trim() ? ` · 검색결과 ${filtered.length}건` : ''}
      </div>
      {tab === 'calc' && (
        <p className="text-xs text-slate-500">
          취합 후 실적 새로고침 시 직접실적 → 가공식 순으로 적재됩니다.
        </p>
      )}
      {error && <p className="text-xs text-rose-600 whitespace-pre-wrap">{error}</p>}
      {bankMsg && <p className="text-xs text-emerald-700">{bankMsg}</p>}

      {tab === 'bank' ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-sm">
            <p className="text-sm text-slate-700">
              선택 연월의 산출·달성률 스냅샷을 은행 적재용 스테이징 테이블에 넣습니다.
              실제 은행 DB 연결은 추후 어댑터로 교체합니다. 운영에서는 매일 자정에 같은 API를 호출하면 됩니다.
            </p>
            <button
              type="button"
              disabled={bankBusy}
              onClick={runBankExport}
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              {bankBusy ? '적재 중…' : `${selectedYear}-${String(selectedMonth).padStart(2, '0')} 이번 월 적재 실행`}
            </button>
          </div>

          <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="min-w-full text-[11px]">
              <thead className="sticky top-0 bg-slate-900 text-white">
                <tr>
                  {['배치번호', '연월', '상태', '건수', '실행경로', '시작', '종료', '항목'].map((h) => (
                    <th key={h} className="whitespace-nowrap border-r border-slate-700 px-2 py-2 text-left font-semibold last:border-r-0">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bankHistory.map((b) => {
                  const counts = parseCounts(b.counts_json)
                  return (
                    <tr key={b.id} className="border-b border-slate-100 hover:bg-blue-50/40">
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{b.id}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono">{b.eval_ym}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <span className={b.status === 'ok' ? 'text-emerald-700' : b.status === 'error' ? 'text-rose-600' : 'text-slate-600'}>
                          {b.status === 'ok' ? '성공' : b.status === 'error' ? '실패' : b.status === 'running' ? '진행중' : (b.status || '—')}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{counts.items ?? '—'}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">
                        {b.triggered_by === 'ui' ? '화면' : b.triggered_by === 'api' ? 'API' : b.triggered_by === 'smoke' ? '테스트' : (b.triggered_by || '—')}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">{b.started_at || '—'}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">{b.finished_at || '—'}</td>
                      <td className="whitespace-nowrap px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => openBatchItems(b.id)}
                          className="text-violet-700 hover:underline"
                        >
                          보기
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {!loading && bankHistory.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">적재 이력이 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {selectedBatchId != null && (
            <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="px-3 py-2 text-xs font-semibold text-slate-700 border-b bg-slate-50">
                배치 #{selectedBatchId} 항목 ({batchItems.length}건)
              </div>
              <table className="min-w-full text-[11px]">
                <thead className="bg-slate-800 text-white">
                  <tr>
                    {['그룹', '지표코드', '실적', '산출종류', '월목표', '달성률'].map((h) => (
                      <th key={h} className="whitespace-nowrap px-2 py-2 text-left">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {batchItems.map((r, i) => (
                    <tr key={`${r.indicator_code}-${i}`} className="border-b border-slate-100">
                      <td className="px-2 py-1.5">{r.group_code}</td>
                      <td className="px-2 py-1.5 font-mono text-[10px]">{r.indicator_code}</td>
                      <td className="px-2 py-1.5 text-right"><CellNum value={r.actual} /></td>
                      <td className="px-2 py-1.5"><CalcKindBadge kind={r.calc_kind} /></td>
                      <td className="px-2 py-1.5 text-right"><CellNum value={r.monthly_target} /></td>
                      <td className="px-2 py-1.5 text-right"><CellNum value={r.converted_achievement} percent /></td>
                    </tr>
                  ))}
                  {batchItems.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">항목 없음</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          {tab === 'achievements' && (
            <table className="min-w-full text-[11px]">
              <thead className="sticky top-0 bg-slate-900 text-white">
                <tr>
                  {['그룹', '지표코드', '표시명', '단위', '연간목표', '월목표', '실적', '달성률', '모드', 'Lv1', '비중'].map((h) => (
                    <th key={h} className="whitespace-nowrap border-r border-slate-700 px-2 py-2 text-left font-semibold last:border-r-0">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const unit = r.unit || ''
                  const code = r.indicator_code || r.indicatorCode || ''
                  return (
                    <tr key={`${code}-${i}`} className="border-b border-slate-100 hover:bg-blue-50/40">
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-600">{r.group_code || r.groupCode || '—'}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[10px] text-slate-500">{code || '—'}</td>
                      <td className="max-w-[220px] truncate px-2 py-1.5 font-medium text-slate-800">{r.label || '—'}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">{unit || '—'}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right"><CellNum value={r.annual_target} unit={unit} /></td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right"><CellNum value={r.monthly_target} unit={unit} /></td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right"><CellNum value={r.actual} unit={unit} /></td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">
                        <CellNum value={r.converted_achievement ?? r.simple_achievement} percent />
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">{r.achievement_mode || '—'}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-600">{r.eval_category_lv1 || '—'}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums text-slate-600">
                        {r.weight != null ? Number(r.weight).toFixed(2) : '—'}
                      </td>
                    </tr>
                  )
                })}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={11} className="px-3 py-8 text-center text-slate-400">조회된 실적이 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          )}

          {tab === 'collect' && (
            <table className="min-w-full text-[11px]">
              <thead className="sticky top-0 bg-slate-900 text-white">
                <tr>
                  {['연월', '지표코드', '실적', '수집시각', '배치번호'].map((h) => (
                    <th key={h} className="whitespace-nowrap border-r border-slate-700 px-2 py-2 text-left font-semibold last:border-r-0">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={`${r.indicator_code}-${i}`} className="border-b border-slate-100 hover:bg-blue-50/40">
                    <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">{r.eval_ym || '—'}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[10px] text-slate-500">{r.indicator_code || '—'}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums"><CellNum value={r.actual} /></td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">{r.fetched_at || '—'}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 text-slate-400" title="실적 새로고침 동기화 배치 번호">{r.batch_id ?? '—'}</td>
                  </tr>
                ))}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">조회된 취합 실적이 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          )}

          {tab === 'calc' && (
            <table className="min-w-full text-[11px]">
              <thead className="sticky top-0 bg-slate-900 text-white">
                <tr>
                  {['연월', '그룹', '지표코드', '실적', '산출종류', '식번호', '식이름', '배치번호'].map((h) => (
                    <th key={h} className="whitespace-nowrap border-r border-slate-700 px-2 py-2 text-left font-semibold last:border-r-0">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  const derived = String(r.calc_kind || '').toUpperCase() === 'DERIVED'
                  return (
                    <tr
                      key={`${r.indicator_code}-${r.group_code}-${i}`}
                      className={`border-b border-slate-100 hover:bg-blue-50/40 ${derived ? 'bg-indigo-50/50' : ''}`}
                    >
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-500">{r.eval_ym || '—'}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-600">{r.group_code || '—'}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 font-mono text-[10px] text-slate-500">{r.indicator_code || '—'}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right tabular-nums"><CellNum value={r.actual} /></td>
                      <td className="whitespace-nowrap px-2 py-1.5"><CalcKindBadge kind={r.calc_kind} /></td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-400">{r.formula_id ?? '—'}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-700">{r.formula_name || '—'}</td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-slate-400" title="실적 새로고침 동기화 배치 번호">{r.batch_id ?? '—'}</td>
                    </tr>
                  )
                })}
                {!loading && filtered.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-slate-400">조회된 산출 실적이 없습니다.</td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

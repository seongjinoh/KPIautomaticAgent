import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Filter, Search, ShieldAlert } from 'lucide-react'
import { ANOMALY_SEVERITY, detectAnomalies, severityLabel, summarizeAnomalies } from '../lib/anomalyRules'

const SEVERITY_TONE = {
  [ANOMALY_SEVERITY.HIGH]: 'bg-rose-50 text-rose-700 border-rose-100',
  [ANOMALY_SEVERITY.MEDIUM]: 'bg-amber-50 text-amber-700 border-amber-100',
  [ANOMALY_SEVERITY.LOW]: 'bg-blue-50 text-blue-700 border-blue-100',
}

export default function AnomalyCenterView({ definitions, results, selectedMonth, selectedYear, groups, categories }) {
  const [severity, setSeverity] = useState('전체')
  const [group, setGroup] = useState('전체')
  const [category, setCategory] = useState('전체')
  const [query, setQuery] = useState('')

  const events = useMemo(
    () => detectAnomalies({ definitions, results, selectedMonth }),
    [definitions, results, selectedMonth],
  )
  const summary = useMemo(() => summarizeAnomalies(events), [events])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return events.filter(event => {
      if (severity !== '전체' && event.severity !== severity) return false
      if (group !== '전체' && event.group !== group) return false
      if (category !== '전체' && event.category !== category) return false
      if (!q) return true
      return [event.label, event.group, event.category, event.categoryL2, event.categoryL3, event.message, event.evidence]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [events, severity, group, category, query])

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-rose-600" />
              <h3 className="text-lg font-black text-slate-800">이상치 센싱 센터</h3>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {selectedYear}년 {selectedMonth}월 기준 전월 급등락, 미달, 입력누락, 진척률 이상을 룰 기반으로 탐지합니다.
            </p>
          </div>
          <div className="rounded-xl bg-slate-50 px-3 py-2 text-right text-xs text-slate-500">
            <p>총 이벤트 {summary.total}건</p>
            <p>위험 {summary.high} · 주의 {summary.medium} · 확인 {summary.low}</p>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <SummaryCard label="위험" value={summary.high} tone="rose" />
        <SummaryCard label="주의" value={summary.medium} tone="amber" />
        <SummaryCard label="확인" value={summary.low} tone="blue" />
        <SummaryCard label="전체" value={summary.total} tone="slate" />
      </section>

      <section className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Filter className="h-4 w-4 text-slate-400" />
          <select value={severity} onChange={e => setSeverity(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="전체">전체 심각도</option>
            <option value={ANOMALY_SEVERITY.HIGH}>위험</option>
            <option value={ANOMALY_SEVERITY.MEDIUM}>주의</option>
            <option value={ANOMALY_SEVERITY.LOW}>확인</option>
          </select>
          <select value={group} onChange={e => setGroup(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="전체">전체 그룹</option>
            {(groups || []).map(g => <option key={g} value={g}>{g}</option>)}
          </select>
          <select value={category} onChange={e => setCategory(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="전체">전체 카테고리</option>
            {(categories || []).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="ml-auto flex min-w-[240px] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="지표/근거 검색"
              className="w-full bg-transparent text-sm outline-none"
            />
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-3">
          <h4 className="text-sm font-bold text-slate-700">센싱 이벤트 {filtered.length}건</h4>
        </div>
        <div className="divide-y divide-slate-100">
          {filtered.length ? filtered.map(event => (
            <article key={event.id} className="grid grid-cols-1 gap-3 px-5 py-4 hover:bg-slate-50/70 lg:grid-cols-[120px_1fr_220px]">
              <div>
                <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold ${SEVERITY_TONE[event.severity]}`}>
                  {severityLabel(event.severity)}
                </span>
              </div>
              <div>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h5 className="text-sm font-black text-slate-800">{event.title}</h5>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{event.group}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{event.category}</span>
                </div>
                <p className="text-sm text-slate-700">{event.label}</p>
                <p className="mt-1 text-xs leading-5 text-slate-500">{event.message}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                <p className="font-semibold text-slate-600">근거</p>
                <p className="mt-1 leading-5">{event.evidence}</p>
              </div>
            </article>
          )) : (
            <div className="px-5 py-12 text-center text-slate-400">
              <CheckCircle2 className="mx-auto mb-3 h-8 w-8" />
              <p className="text-sm">현재 필터 조건에서 센싱 이벤트가 없습니다.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function SummaryCard({ label, value, tone }) {
  const toneMap = {
    rose: 'text-rose-700 bg-rose-50 border-rose-100',
    amber: 'text-amber-700 bg-amber-50 border-amber-100',
    blue: 'text-blue-700 bg-blue-50 border-blue-100',
    slate: 'text-slate-700 bg-slate-50 border-slate-100',
  }
  return (
    <div className={`rounded-2xl border p-4 ${toneMap[tone]}`}>
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold">{label}</p>
        <AlertTriangle className="h-4 w-4 opacity-60" />
      </div>
      <p className="mt-2 text-3xl font-black tabular-nums">{value}</p>
    </div>
  )
}

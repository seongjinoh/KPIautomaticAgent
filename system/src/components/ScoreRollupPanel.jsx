import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/apiClient'

/**
 * 연·시행월 단위 L3 종합산정 규칙 편집.
 * 미등록 그룹은 서버에서 L3=L2.
 */
export default function ScoreRollupPanel({
  selectedYear,
  selectedMonth,
  ownerGroupRows = [],
}) {
  const [effectiveMonth, setEffectiveMonth] = useState(selectedMonth)
  const [rules, setRules] = useState([])
  const [history, setHistory] = useState([])
  const [changeReason, setChangeReason] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const ownerGroups = useMemo(() => (
    (ownerGroupRows || [])
      .filter((g) => String(g?.code || '').trim().toUpperCase() !== 'SHB')
      .sort((a, b) => Number(a.sort_order ?? a.sortOrder ?? 0) - Number(b.sort_order ?? b.sortOrder ?? 0))
  ), [ownerGroupRows])

  const load = async () => {
    setError('')
    try {
      const res = await api.listScoreRollups({ year: selectedYear, month: effectiveMonth })
      setHistory(res.items || [])
      const active = res.item
      if (active?.rules?.length) {
        setRules(active.rules.map((r) => ({
          targetGroupCode: r.target_group_code,
          enabled: true,
          selfWeight: Number((r.terms || []).find((t) => String(t.term_type).toUpperCase() === 'SELF')?.weight) || 0.7,
          avgWeight: Number((r.terms || []).find((t) => String(t.term_type).toUpperCase() === 'AVG_GROUPS')?.weight) || 0.3,
          avgGroups: (r.terms || []).find((t) => String(t.term_type).toUpperCase() === 'AVG_GROUPS')?.groups || [],
        })))
      } else {
        setRules([])
      }
    } catch (e) {
      setError(e?.message || '롤업 규칙 조회 실패')
    }
  }

  useEffect(() => {
    setEffectiveMonth(selectedMonth)
  }, [selectedMonth, selectedYear])

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedYear, effectiveMonth])

  const addRule = () => {
    const first = ownerGroups[0]
    if (!first) return
    setRules((prev) => [...prev, {
      targetGroupCode: String(first.code).toUpperCase(),
      enabled: true,
      selfWeight: 0.7,
      avgWeight: 0.3,
      avgGroups: [String(first.code).toUpperCase()],
    }])
  }

  const updateRule = (idx, patch) => {
    setRules((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  const removeRule = (idx) => {
    setRules((prev) => prev.filter((_, i) => i !== idx))
  }

  const save = async () => {
    setSaving(true)
    setMessage('')
    setError('')
    try {
      for (const r of rules) {
        const sum = Number(r.selfWeight) + Number(r.avgWeight)
        if (Math.abs(sum - 1) > 0.001) {
          throw new Error(`${r.targetGroupCode}: SELF+AVG 가중 합이 1이어야 합니다 (현재 ${sum})`)
        }
        if (!(r.avgGroups || []).length) {
          throw new Error(`${r.targetGroupCode}: 평균 대상 그룹을 선택하세요`)
        }
      }
      const payload = rules.map((r) => ({
        target_group_code: r.targetGroupCode,
        terms: [
          { term_type: 'SELF', weight: Number(r.selfWeight), sort_order: 0 },
          { term_type: 'AVG_GROUPS', weight: Number(r.avgWeight), sort_order: 1, groups: r.avgGroups },
        ],
      }))
      await api.saveScoreRollups({
        year: selectedYear,
        month: effectiveMonth,
        rules: payload,
        changeReason: changeReason || `${selectedYear}-${String(effectiveMonth).padStart(2, '0')} L3 규칙`,
      })
      setMessage(`${selectedYear}년 ${effectiveMonth}월부터 적용 규칙을 저장했습니다.`)
      await load()
    } catch (e) {
      setError(e?.message || '저장 실패')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-black text-slate-900">종합산정(L3) 규칙</h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            등록한 그룹만 L2를 블렌딩합니다. 미등록 그룹은 L3=L2. 전행(SHB)은 대상에서 제외됩니다.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[11px] text-slate-600">
            시행월
            <select
              value={effectiveMonth}
              onChange={(e) => setEffectiveMonth(Number(e.target.value))}
              className="ml-1 px-2 py-1.5 rounded border border-slate-200 text-xs bg-white"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <option key={m} value={m}>{m}월</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={addRule} className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            규칙 추가
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={save}
            className="px-2.5 py-1.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50"
          >
            {saving ? '저장 중…' : '규칙 저장'}
          </button>
        </div>
      </div>

      <label className="block text-[11px] text-slate-600">
        변경 사유
        <input
          value={changeReason}
          onChange={(e) => setChangeReason(e.target.value)}
          className="mt-1 w-full max-w-xl px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm"
          placeholder="선택"
        />
      </label>

      {error && <p className="text-xs text-rose-600">{error}</p>}
      {message && <p className="text-xs text-emerald-700">{message}</p>}

      <div className="space-y-2">
        {rules.length === 0 && (
          <p className="text-xs text-slate-400 py-4 text-center border border-dashed border-slate-200 rounded-lg">
            설정된 L3 규칙이 없습니다. 모든 그룹은 L2=L3로 집계됩니다.
          </p>
        )}
        {rules.map((rule, idx) => (
          <div key={`${rule.targetGroupCode}-${idx}`} className="rounded-lg border border-slate-200 p-3 grid grid-cols-1 md:grid-cols-12 gap-2 items-start">
            <label className="md:col-span-2 text-[11px] text-slate-600 space-y-1">
              <span>대상 그룹</span>
              <select
                value={rule.targetGroupCode}
                onChange={(e) => updateRule(idx, { targetGroupCode: e.target.value })}
                className="w-full px-2 py-1.5 rounded border border-slate-200 text-xs bg-white"
              >
                {ownerGroups.map((g) => (
                  <option key={g.code} value={String(g.code).toUpperCase()}>
                    {g.code} · {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="md:col-span-2 text-[11px] text-slate-600 space-y-1">
              <span>SELF 가중</span>
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={rule.selfWeight}
                onChange={(e) => updateRule(idx, { selfWeight: e.target.value === '' ? '' : Number(e.target.value) })}
                className="w-full px-2 py-1.5 rounded border border-slate-200 text-xs"
              />
            </label>
            <label className="md:col-span-2 text-[11px] text-slate-600 space-y-1">
              <span>AVG 가중</span>
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={rule.avgWeight}
                onChange={(e) => updateRule(idx, { avgWeight: e.target.value === '' ? '' : Number(e.target.value) })}
                className="w-full px-2 py-1.5 rounded border border-slate-200 text-xs"
              />
            </label>
            <label className="md:col-span-5 text-[11px] text-slate-600 space-y-1">
              <span>AVG 대상 그룹 (Ctrl/Cmd 다중선택)</span>
              <select
                multiple
                value={rule.avgGroups}
                onChange={(e) => updateRule(idx, {
                  avgGroups: Array.from(e.target.selectedOptions).map((o) => o.value),
                })}
                className="w-full min-h-[72px] px-2 py-1.5 rounded border border-slate-200 text-xs bg-white"
              >
                {ownerGroups.map((g) => (
                  <option key={g.code} value={String(g.code).toUpperCase()}>
                    {g.code} · {g.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="md:col-span-1 flex md:justify-end pt-5">
              <button type="button" onClick={() => removeRule(idx)} className="text-xs text-rose-600 hover:underline">삭제</button>
            </div>
          </div>
        ))}
      </div>

      {history.length > 0 && (
        <p className="text-[10px] text-slate-400">
          이력: {history.map((h) => `${h.year}-${String(h.effective_from_month).padStart(2, '0')}(${(h.rules || []).length}규칙)`).join(' · ')}
        </p>
      )}
    </section>
  )
}

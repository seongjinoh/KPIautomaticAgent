import { useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { Search, BookMarked, Layers, ClipboardList, Zap, Plus, Pencil, Trash2, Upload, RotateCcw, X } from 'lucide-react'

const MEASURE_DESC = {
  TOT: { kr: '총량', desc: '기간 내 누적 잔액 또는 총합' },
  NEW: { kr: '연간신규', desc: '당해 연도 신규 발생분' },
  OUT: { kr: '연간이탈', desc: '당해 연도 이탈(감소)분' },
  NET: { kr: '연간순증', desc: '신규 - 이탈, 순증가분' },
  RAT: { kr: '비율', desc: '%/%p/점수 등 비율성 지표' },
  ETC: { kr: '기타', desc: '위 분류에 해당하지 않는 지표' },
}

const MASTER_EDITABLE_KEYS = [
  'kind', 'scopeCode', 'name', 'code21',
  'lv3', 'lv3Name',
  'calcBasis', 'measureCode', 'linkKpiCode', 'unit',
]

const MASTER_FIELD_LABELS = {
  kind: '구분', scopeCode: '그룹코드', name: '지표명',
  code21: '지표코드(21자)', lv1: 'Lv1', lv1Name: 'Lv1명',
  lv2: 'Lv2', lv2Name: 'Lv2명', lv3: 'Lv3(4자)', lv3Name: 'Lv3명',
  calcBasis: '실적구분', measureCode: '실적코드',
  linkKpiCode: '연결 KPI 코드', unit: '단위',
}

const EVAL_FIELD_LABELS = {
  mgmtTool: 'Tool', weight: '비중(%)', category: '카테고리',
  categoryL2: 'L2', categoryL3: 'L3', group: '그룹명',
  label: '평가 표시명', unit: '단위', annualTarget: '연간목표',
  collectType: '수집방식', dept: '담당부서',
}

const HEADER_TO_KEY = {
  no: 'no', 번호: 'no', id: 'id',
  kind: 'kind', 구분: 'kind',
  그룹코드: 'scopeCode', scopecode: 'scopeCode',
  지표명: 'name', name: 'name',
  지표코드21자: 'code21', 지표코드: 'code21', code21: 'code21',
  lv1: 'lv1', lv1명: 'lv1Name', lv1name: 'lv1Name',
  lv2: 'lv2', lv2명: 'lv2Name', lv2name: 'lv2Name',
  lv3: 'lv3', lv3명: 'lv3Name', lv3name: 'lv3Name',
  실적구분: 'calcBasis', calcbasis: 'calcBasis',
  실적코드: 'measureCode', measurecode: 'measureCode',
  linkkpicode: 'linkKpiCode', 연결kpi코드: 'linkKpiCode',
  단위: 'unit', unit: 'unit',
}

const emptyMasterDraft = {
  kind: '재무', scopeCode: '', name: '', code21: '',
  lv1: '', lv1Name: '', lv2: '', lv2Name: '', lv3: '', lv3Name: '',
  calcBasis: '연간신규', measureCode: 'NEW', linkKpiCode: '', unit: '',
}

const emptyEvalDraft = {
  indicatorId: null, code: '', mgmtTool: 'KPI', weight: 0,
  category: '', categoryL2: '', categoryL3: '', group: '',
  label: '', unit: '', annualTarget: 0, collectType: '', dept: '',
}

const emptyStructureDraft = { lv1: '', lv1Name: '', lv2: '', lv2Name: '' }

function normalizeHeader(value) {
  return String(value || '').replace(/\s/g, '').replace(/[()\-_/]/g, '').toLowerCase()
}

function normalizeMasterRow(raw, nextId) {
  const row = { ...raw }
  const id = Number(row.id ?? row.no)
  row.id = Number.isFinite(id) && id > 0 ? id : nextId
  delete row.no
  row.kind = row.kind || '재무'
  row.name = row.name || row.lv3Name || ''
  row.lv3Name = row.lv3Name || row.name || ''
  row.measureCode = row.measureCode || 'NEW'
  row.calcBasis = row.calcBasis || (MEASURE_DESC[row.measureCode]?.kr ?? '기타')
  row.code21 = String(row.code21 || '').trim()
  row.linkKpiCode = String(row.linkKpiCode || '').trim()
  row.financial21 = row.kind === '재무' ? row.code21 : ''
  row.nonFinancial21 = row.kind === '비재무' ? row.code21 : ''
  row.financial13 = row.financial21 ? row.financial21.slice(0, 13) : ''
  row.unit = row.unit || ''
  return row
}

export default function CodebookAdminView({
  indicatorMaster,
  meta,
  structure,
  evalConfigs,
  onMasterChange,
  onStructureChange,
  onEvalConfigChange,
  defaultMaster = [],
  defaultEvalConfigs = {},
  defaultStructure = [],
}) {
  const [tab, setTab] = useState('legend')
  const [feedback, setFeedback] = useState('')
  const fileInputRef = useRef(null)

  const [masterQ, setMasterQ] = useState('')
  const [masterKind, setMasterKind] = useState('전체')
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [draft, setDraft] = useState(emptyMasterDraft)

  const [isStructureEditorOpen, setIsStructureEditorOpen] = useState(false)
  const [editingStructureIdx, setEditingStructureIdx] = useState(null)
  const [structureDraft, setStructureDraft] = useState(emptyStructureDraft)

  const [evalYear, setEvalYear] = useState(2026)
  const [evalQ, setEvalQ] = useState('')
  const [evalTool, setEvalTool] = useState('전체')
  const [isEvalEditorOpen, setIsEvalEditorOpen] = useState(false)
  const [editingEvalIdx, setEditingEvalIdx] = useState(null)
  const [evalDraft, setEvalDraft] = useState(emptyEvalDraft)
  const [indicatorSearch, setIndicatorSearch] = useState('')

  /* ── master tab memos ── */
  const masterRows = useMemo(() => {
    let list = indicatorMaster || []
    if (masterKind !== '전체') list = list.filter(r => (r.kind || '') === masterKind)
    if (!masterQ.trim()) return list
    const s = masterQ.trim().toLowerCase()
    return list.filter(r =>
      [r.name, r.linkKpiCode, r.code21, r.lv1, r.lv1Name, r.lv2, r.lv2Name, r.lv3, r.lv3Name, r.measureCode, r.calcBasis, r.scopeCode, r.kind, r.unit]
        .filter(Boolean).join(' ').toLowerCase().includes(s)
    )
  }, [indicatorMaster, masterQ, masterKind])

  const nextId = useMemo(() => (indicatorMaster || []).reduce((m, r) => Math.max(m, Number(r.id) || 0), 0) + 1, [indicatorMaster])

  const lv1Options = useMemo(() => {
    const map = new Map()
    ;(structure || []).forEach(row => {
      const key = row[0] ?? ''
      if (!key) return
      if (!map.has(key)) map.set(key, row[1] ?? '')
    })
    if (draft.lv1 && !map.has(draft.lv1)) map.set(draft.lv1, draft.lv1Name ?? '')
    return [...map.entries()].map(([lv1, lv1Name]) => ({ lv1, lv1Name }))
  }, [structure, draft.lv1, draft.lv1Name])

  const lv2Options = useMemo(() => {
    const list = (structure || [])
      .filter(row => (row[0] ?? '') === (draft.lv1 ?? ''))
      .map(row => ({ lv2: row[2] ?? '', lv2Name: row[3] ?? '' }))
      .filter(row => row.lv2)
    if (list.length === 0 && draft.lv2) return [{ lv2: draft.lv2, lv2Name: draft.lv2Name ?? '' }]
    return list
  }, [structure, draft.lv1, draft.lv2, draft.lv2Name])

  /* ── eval config tab memos ── */
  const evalYearConfig = useMemo(() => evalConfigs?.[evalYear] || [], [evalConfigs, evalYear])

  const masterById = useMemo(() => {
    const map = new Map()
    ;(indicatorMaster || []).forEach(m => map.set(m.id, m))
    return map
  }, [indicatorMaster])

  const evalRows = useMemo(() => {
    let list = evalYearConfig.map((cfg, idx) => ({ ...cfg, _idx: idx }))
    if (evalTool !== '전체') list = list.filter(r => r.mgmtTool === evalTool)
    if (!evalQ.trim()) return list
    const s = evalQ.trim().toLowerCase()
    return list.filter(r => {
      const m = masterById.get(r.indicatorId)
      return [r.code, r.mgmtTool, r.category, r.categoryL2, r.categoryL3, r.group, r.label, r.dept, m?.name, m?.code21]
        .filter(Boolean).join(' ').toLowerCase().includes(s)
    })
  }, [evalYearConfig, evalQ, evalTool, masterById])

  const filteredMasterForPicker = useMemo(() => {
    if (!indicatorSearch.trim()) return indicatorMaster || []
    const s = indicatorSearch.trim().toLowerCase()
    return (indicatorMaster || []).filter(m =>
      [m.name, m.linkKpiCode, m.code21].filter(Boolean).join(' ').toLowerCase().includes(s)
    )
  }, [indicatorMaster, indicatorSearch])

  /* ── master handlers ── */
  const handleLv1Change = (value) => {
    const picked = lv1Options.find(opt => opt.lv1 === value)
    const firstLv2 = (structure || []).find(row => (row[0] ?? '') === value)
    setDraft(prev => ({ ...prev, lv1: value, lv1Name: picked?.lv1Name ?? '', lv2: firstLv2?.[2] ?? '', lv2Name: firstLv2?.[3] ?? '' }))
  }

  const handleLv2Change = (value) => {
    const picked = lv2Options.find(opt => opt.lv2 === value)
    setDraft(prev => ({ ...prev, lv2: value, lv2Name: picked?.lv2Name ?? '' }))
  }

  const openMasterCreate = () => {
    const firstLv1 = lv1Options[0]
    const firstLv2 = (structure || []).find(row => (row[0] ?? '') === (firstLv1?.lv1 ?? ''))
    setEditingId(null)
    setDraft({ ...emptyMasterDraft, lv1: firstLv1?.lv1 ?? '', lv1Name: firstLv1?.lv1Name ?? '', lv2: firstLv2?.[2] ?? '', lv2Name: firstLv2?.[3] ?? '' })
    setIsEditorOpen(true)
  }

  const openMasterEdit = (row) => {
    setEditingId(row.id)
    const d = { ...emptyMasterDraft }
    ;[...MASTER_EDITABLE_KEYS, 'lv1', 'lv1Name', 'lv2', 'lv2Name'].forEach(k => { d[k] = row[k] ?? '' })
    setDraft(d)
    setIsEditorOpen(true)
  }

  const saveMasterDraft = () => {
    if (!draft.code21.trim() || !draft.name.trim()) { setFeedback('지표코드(21자)와 지표명은 필수입니다.'); return }
    if (!draft.lv1 || !draft.lv2) { setFeedback('코드체계를 먼저 등록하고 선택해 주세요.'); return }
    const normalized = normalizeMasterRow({ ...draft }, editingId ?? nextId)
    const next = editingId == null
      ? [...(indicatorMaster || []), normalized]
      : (indicatorMaster || []).map(r => (r.id === editingId ? { ...r, ...normalized } : r))
    onMasterChange(next)
    setIsEditorOpen(false)
    setFeedback(editingId == null ? '지표를 추가했습니다.' : '지표를 수정했습니다.')
  }

  const removeMasterRow = (row) => {
    if (!window.confirm(`[${row.code21}] 지표를 삭제할까요?`)) return
    onMasterChange((indicatorMaster || []).filter(r => r.id !== row.id))
    setFeedback('지표를 삭제했습니다.')
  }

  /* ── structure handlers ── */
  const saveStructureDraft = () => {
    if (!structureDraft.lv1.trim() || !structureDraft.lv2.trim()) { setFeedback('코드체계의 Lv1/Lv2 코드는 필수입니다.'); return }
    const nextEntry = [structureDraft.lv1.trim(), structureDraft.lv1Name.trim(), structureDraft.lv2.trim(), structureDraft.lv2Name.trim()]
    const nextStructure = [...(structure || [])]
    if (editingStructureIdx == null) nextStructure.push(nextEntry)
    else nextStructure.splice(editingStructureIdx, 1, nextEntry)
    onStructureChange(nextStructure)
    setIsStructureEditorOpen(false)
    setEditingStructureIdx(null)
    setFeedback(editingStructureIdx == null ? '코드체계를 추가했습니다.' : '코드체계를 수정했습니다.')
  }

  const openEditStructure = (row, idx) => {
    setEditingStructureIdx(idx)
    setStructureDraft({ lv1: row[0] ?? '', lv1Name: row[1] ?? '', lv2: row[2] ?? '', lv2Name: row[3] ?? '' })
    setIsStructureEditorOpen(true)
  }

  const removeStructure = (idx) => {
    if (!window.confirm('선택한 코드체계를 삭제할까요?')) return
    onStructureChange((structure || []).filter((_, i) => i !== idx))
    setFeedback('코드체계를 삭제했습니다.')
  }

  /* ── eval config handlers ── */
  const openEvalCreate = () => {
    setEditingEvalIdx(null)
    setEvalDraft({ ...emptyEvalDraft })
    setIndicatorSearch('')
    setIsEvalEditorOpen(true)
  }

  const openEvalEdit = (cfg) => {
    setEditingEvalIdx(cfg._idx)
    const d = { ...emptyEvalDraft }
    Object.keys(emptyEvalDraft).forEach(k => { d[k] = cfg[k] ?? emptyEvalDraft[k] })
    setEvalDraft(d)
    setIndicatorSearch('')
    setIsEvalEditorOpen(true)
  }

  const saveEvalDraft = () => {
    if (!evalDraft.indicatorId && !evalDraft.code) { setFeedback('마스터 지표를 선택하거나 코드를 입력해 주세요.'); return }
    const entry = { ...evalDraft, year: evalYear }
    if (!entry.code && entry.indicatorId) {
      const m = masterById.get(entry.indicatorId)
      entry.code = m?.linkKpiCode || ''
    }
    delete entry._idx
    const nextConfig = [...evalYearConfig]
    if (editingEvalIdx == null) nextConfig.push(entry)
    else nextConfig[editingEvalIdx] = entry
    onEvalConfigChange({ ...evalConfigs, [evalYear]: nextConfig })
    setIsEvalEditorOpen(false)
    setFeedback(editingEvalIdx == null ? '평가배치를 추가했습니다.' : '평가배치를 수정했습니다.')
  }

  const removeEvalRow = (originalIdx) => {
    if (!window.confirm('선택한 평가배치를 삭제할까요?')) return
    const nextConfig = evalYearConfig.filter((_, i) => i !== originalIdx)
    onEvalConfigChange({ ...evalConfigs, [evalYear]: nextConfig })
    setFeedback('평가배치를 삭제했습니다.')
  }

  const selectMasterForEval = (m) => {
    setEvalDraft(prev => ({
      ...prev,
      indicatorId: m.id,
      code: m.linkKpiCode || '',
      label: prev.label || m.name || '',
      unit: prev.unit || m.unit || '',
    }))
    setIndicatorSearch('')
  }

  /* ── Excel import (master) ── */
  const importExcel = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]]
      const source = XLSX.utils.sheet_to_json(firstSheet, { defval: '' })
      const parsedRows = source.map((row, idx) => {
        const out = {}
        Object.entries(row).forEach(([key, value]) => {
          out[HEADER_TO_KEY[normalizeHeader(key)] || key] = value
        })
        return normalizeMasterRow(out, nextId + idx)
      }).filter(r => r.code21)
      const merged = [...(indicatorMaster || [])]
      let inserted = 0, updated = 0
      parsedRows.forEach(row => {
        const idx = merged.findIndex(x => x.code21 === row.code21 || (row.linkKpiCode && x.linkKpiCode === row.linkKpiCode))
        if (idx >= 0) { merged[idx] = { ...merged[idx], ...row }; updated++ }
        else { merged.push(row); inserted++ }
      })
      onMasterChange(merged)
      setFeedback(`엑셀 업로드 완료: 신규 ${inserted}건, 수정 ${updated}건`)
    } catch {
      setFeedback('엑셀 업로드 중 오류가 발생했습니다. 컬럼명을 확인해 주세요.')
    } finally {
      if (event.target) event.target.value = ''
    }
  }

  const TABS = [
    { id: 'legend', icon: <BookMarked className="w-4 h-4" />, label: '0. 코드북 (범례)' },
    { id: 'structure', icon: <Layers className="w-4 h-4" />, label: '0. 코드체계 (Lv1~2)' },
    { id: 'master', icon: <ClipboardList className="w-4 h-4" />, label: '지표 마스터' },
    { id: 'evalConfig', icon: <Zap className="w-4 h-4" />, label: '연도별 평가배치' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex gap-2 border-b border-slate-200">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 ${tab === t.id ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* ━━ 범례 탭 ━━ */}
      {tab === 'legend' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="px-4 py-2.5 bg-violet-700 text-white text-xs font-semibold">실적구분 코드</div>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-slate-50">
                {Object.entries(MEASURE_DESC).map(([code, { kr, desc }]) => (
                  <tr key={code}><td className="px-3 py-1.5 font-mono font-bold text-violet-700">{code}</td><td className="px-3 py-1.5">{kr}</td><td className="px-3 py-1.5 text-slate-500">{desc}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="px-4 py-2.5 bg-violet-700 text-white text-xs font-semibold">그룹코드</div>
            <table className="w-full text-xs">
              <tbody className="divide-y divide-slate-50">
                {Object.entries(meta?.scopeCodes || {}).map(([k, v]) => (
                  <tr key={k}><td className="px-3 py-1.5 font-mono font-bold text-violet-700">{k}</td><td className="px-3 py-1.5">{v}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ━━ 코드체계 탭 ━━ */}
      {tab === 'structure' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <button onClick={() => { setEditingStructureIdx(null); setStructureDraft({ ...emptyStructureDraft }); setIsStructureEditorOpen(true) }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-700 text-white text-sm">
              <Plus className="w-4 h-4" /> 코드체계 추가
            </button>
            <button onClick={() => { if (!window.confirm('코드체계를 기본값으로 복원할까요?')) return; onStructureChange(defaultStructure); setFeedback('코드체계를 기본값으로 복원했습니다.') }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm">
              <RotateCcw className="w-4 h-4" /> 코드체계 초기화
            </button>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="px-4 py-2.5 bg-emerald-800 text-white text-xs font-semibold">Lv1~2 분류 마스터</div>
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600">
                  <th className="px-3 py-2">Lv1코드</th><th className="px-3 py-2">Lv1명</th><th className="px-3 py-2">Lv2코드</th><th className="px-3 py-2">Lv2명</th><th className="px-3 py-2 text-center">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(structure || []).map((row, idx) => (
                  <tr key={`${row[0]}-${row[2]}-${idx}`}>
                    <td className="px-3 py-1.5 font-mono text-violet-700">{row[0]}</td>
                    <td className="px-3 py-1.5">{row[1]}</td>
                    <td className="px-3 py-1.5 font-mono">{row[2]}</td>
                    <td className="px-3 py-1.5">{row[3]}</td>
                    <td className="px-3 py-1.5 text-center">
                      <button onClick={() => openEditStructure(row, idx)} className="p-1 rounded hover:bg-slate-100 text-slate-600"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => removeStructure(idx)} className="p-1 rounded hover:bg-rose-100 text-rose-600"><Trash2 className="w-3.5 h-3.5" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ━━ 지표 마스터 탭 ━━ */}
      {tab === 'master' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="search" placeholder="지표명, 코드, Lv명 검색" value={masterQ} onChange={e => setMasterQ(e.target.value)} className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm" />
            </div>
            <select value={masterKind} onChange={e => setMasterKind(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">{['전체', '재무', '비재무'].map(k => <option key={k} value={k}>구분: {k}</option>)}</select>
            <button onClick={openMasterCreate} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 text-white text-sm"><Plus className="w-4 h-4" /> 지표 추가</button>
            <button onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm"><Upload className="w-4 h-4" /> 엑셀 업로드</button>
            <button onClick={() => { if (window.confirm('마스터 전체를 초기값으로 되돌릴까요?')) onMasterChange(defaultMaster) }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm"><RotateCcw className="w-4 h-4" /> 초기화</button>
            <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={importExcel} />
          </div>
          {feedback && <p className="text-xs text-violet-700">{feedback}</p>}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="bg-red-800 text-white">{['ID', '구분', '지표명', '단위', '지표코드(21자)', 'Lv1', 'Lv2', 'Lv3', '실적코드', 'KPI코드', '관리'].map(h => <th key={h} className="px-2 py-2 whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {masterRows.map(r => (
                    <tr key={`${r.id}-${r.code21}`} className="hover:bg-slate-50/80">
                      <td className="px-2 py-1.5">{r.id}</td>
                      <td className="px-2 py-1.5">{r.kind}</td>
                      <td className="px-2 py-1.5">{r.name}</td>
                      <td className="px-2 py-1.5">{r.unit}</td>
                      <td className="px-2 py-1.5 font-mono text-xs">{r.code21}</td>
                      <td className="px-2 py-1.5">{r.lv1}</td>
                      <td className="px-2 py-1.5">{r.lv2}</td>
                      <td className="px-2 py-1.5">{r.lv3}</td>
                      <td className="px-2 py-1.5">{r.measureCode}</td>
                      <td className="px-2 py-1.5 font-mono">{r.linkKpiCode}</td>
                      <td className="px-2 py-1.5">
                        <button onClick={() => openMasterEdit(r)} className="p-1 rounded hover:bg-slate-100 text-slate-600"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => removeMasterRow(r)} className="p-1 rounded hover:bg-rose-100 text-rose-600"><Trash2 className="w-3.5 h-3.5" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ━━ 연도별 평가배치 탭 ━━ */}
      {tab === 'evalConfig' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex rounded-lg border border-slate-200 overflow-hidden">
              {[2026, 2025].map(y => (
                <button key={y} onClick={() => setEvalYear(y)} className={`px-4 py-2 text-sm font-semibold ${evalYear === y ? 'bg-slate-800 text-white' : 'bg-white text-slate-500 hover:bg-slate-50'}`}>
                  {y}년
                </button>
              ))}
            </div>
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="search" placeholder="지표, 코드, 그룹, 카테고리 검색" value={evalQ} onChange={e => setEvalQ(e.target.value)} className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm" />
            </div>
            <select value={evalTool} onChange={e => setEvalTool(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">{['전체', 'KPI', '전략과제', '모니터링'].map(t => <option key={t} value={t}>Tool: {t}</option>)}</select>
            <button onClick={openEvalCreate} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-700 text-white text-sm"><Plus className="w-4 h-4" /> 배치 추가</button>
            <button onClick={() => {
              if (!window.confirm(`${evalYear}년 평가배치를 초기값으로 되돌릴까요?`)) return
              onEvalConfigChange({ ...evalConfigs, [evalYear]: defaultEvalConfigs[evalYear] || [] })
              setFeedback(`${evalYear}년 평가배치를 초기화했습니다.`)
            }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm">
              <RotateCcw className="w-4 h-4" /> 초기화
            </button>
          </div>
          <p className="text-xs text-slate-500">
            {evalYear}년 배치 현황: 총 {evalYearConfig.length}건
            (KPI {evalYearConfig.filter(c => c.mgmtTool === 'KPI').length} /
            전략과제 {evalYearConfig.filter(c => c.mgmtTool === '전략과제').length} /
            모니터링 {evalYearConfig.filter(c => c.mgmtTool === '모니터링').length})
          </p>
          {feedback && <p className="text-xs text-violet-700">{feedback}</p>}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead><tr className="bg-emerald-800 text-white">{['#', '마스터지표', '코드', 'Tool', '비중', '카테고리', 'L2', 'L3', '그룹', '표시명', '연간목표', '관리'].map(h => <th key={h} className="px-2 py-2 whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {evalRows.map((cfg, idx) => {
                    const m = masterById.get(cfg.indicatorId)
                    return (
                      <tr key={`${cfg.code}-${idx}`} className="hover:bg-slate-50/80">
                        <td className="px-2 py-1.5 text-slate-400">{idx + 1}</td>
                        <td className="px-2 py-1.5 text-violet-700 font-medium">{m?.name || <span className="text-slate-400 italic">미연결</span>}</td>
                        <td className="px-2 py-1.5 font-mono">{cfg.code}</td>
                        <td className="px-2 py-1.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${cfg.mgmtTool === 'KPI' ? 'bg-indigo-100 text-indigo-700' : cfg.mgmtTool === '전략과제' ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-600'}`}>
                            {cfg.mgmtTool}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">{cfg.weight}%</td>
                        <td className="px-2 py-1.5">{cfg.category}</td>
                        <td className="px-2 py-1.5">{cfg.categoryL2}</td>
                        <td className="px-2 py-1.5">{cfg.categoryL3}</td>
                        <td className="px-2 py-1.5">{cfg.group}</td>
                        <td className="px-2 py-1.5">{cfg.label}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{(cfg.annualTarget || 0).toLocaleString()}</td>
                        <td className="px-2 py-1.5">
                          <button onClick={() => openEvalEdit(cfg)} className="p-1 rounded hover:bg-slate-100 text-slate-600"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => removeEvalRow(cfg._idx)} className="p-1 rounded hover:bg-rose-100 text-rose-600"><Trash2 className="w-3.5 h-3.5" /></button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ━━ 지표 마스터 편집 모달 ━━ */}
      {isEditorOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/30 flex items-center justify-center p-6">
          <div className="w-full max-w-5xl max-h-[90vh] overflow-auto rounded-xl bg-white border border-slate-200 shadow-xl">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">{editingId == null ? '지표 추가' : `지표 수정 #${editingId}`}</h3>
              <button onClick={() => setIsEditorOpen(false)} className="p-1 rounded hover:bg-slate-100 text-slate-500"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
              <label className="text-xs text-slate-600 space-y-1">
                <span>Lv1명</span>
                <select value={draft.lv1 ?? ''} onChange={e => handleLv1Change(e.target.value)} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
                  {lv1Options.length === 0 && <option value="">선택 가능한 Lv1 없음</option>}
                  {lv1Options.map(opt => <option key={opt.lv1} value={opt.lv1}>{opt.lv1Name || opt.lv1}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-600 space-y-1">
                <span>Lv1코드</span>
                <input value={draft.lv1 ?? ''} readOnly className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-slate-50" />
              </label>
              <label className="text-xs text-slate-600 space-y-1">
                <span>Lv2명</span>
                <select value={draft.lv2 ?? ''} onChange={e => handleLv2Change(e.target.value)} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
                  {lv2Options.length === 0 && <option value="">선택 가능한 Lv2 없음</option>}
                  {lv2Options.map(opt => <option key={opt.lv2} value={opt.lv2}>{opt.lv2Name || opt.lv2}</option>)}
                </select>
              </label>
              <label className="text-xs text-slate-600 space-y-1">
                <span>Lv2코드</span>
                <input value={draft.lv2 ?? ''} readOnly className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-slate-50" />
              </label>
              {MASTER_EDITABLE_KEYS.map(key => (
                <label key={key} className="text-xs text-slate-600 space-y-1">
                  <span>{MASTER_FIELD_LABELS[key]}</span>
                  <input value={draft[key] ?? ''} onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.value }))} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-sm" />
                </label>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setIsEditorOpen(false)} className="px-3 py-2 rounded-lg border border-slate-200 text-sm">취소</button>
              <button onClick={saveMasterDraft} className="px-3 py-2 rounded-lg bg-violet-600 text-white text-sm">저장</button>
            </div>
          </div>
        </div>
      )}

      {/* ━━ 평가배치 편집 모달 ━━ */}
      {isEvalEditorOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/30 flex items-center justify-center p-6">
          <div className="w-full max-w-4xl max-h-[90vh] overflow-auto rounded-xl bg-white border border-slate-200 shadow-xl">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">{editingEvalIdx == null ? `${evalYear}년 평가배치 추가` : `${evalYear}년 평가배치 수정`}</h3>
              <button onClick={() => setIsEvalEditorOpen(false)} className="p-1 rounded hover:bg-slate-100 text-slate-500"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-4">
              <div className="space-y-1">
                <span className="text-xs font-semibold text-slate-700">마스터 지표 선택</span>
                {evalDraft.indicatorId ? (
                  <div className="flex items-center gap-2 p-2 rounded-lg border border-violet-200 bg-violet-50">
                    <span className="text-sm font-medium text-violet-800">{masterById.get(evalDraft.indicatorId)?.name || '알 수 없는 지표'}</span>
                    <span className="text-xs text-violet-500 font-mono">{evalDraft.code}</span>
                    <button onClick={() => setEvalDraft(prev => ({ ...prev, indicatorId: null, code: '' }))} className="ml-auto text-xs text-violet-600 hover:underline">변경</button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <input type="search" placeholder="지표명 또는 코드로 검색..." value={indicatorSearch} onChange={e => setIndicatorSearch(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm" />
                    <div className="max-h-40 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100">
                      {filteredMasterForPicker.slice(0, 20).map(m => (
                        <button key={m.id} onClick={() => selectMasterForEval(m)} className="w-full text-left px-3 py-1.5 hover:bg-slate-50 text-sm flex items-center gap-2">
                          <span className="font-medium text-slate-700 truncate">{m.name}</span>
                          <span className="text-xs text-slate-400 font-mono flex-shrink-0">{m.linkKpiCode}</span>
                          <span className="text-xs text-slate-400 flex-shrink-0">{m.unit}</span>
                        </button>
                      ))}
                      {filteredMasterForPicker.length === 0 && <p className="px-3 py-2 text-xs text-slate-400">일치하는 지표가 없습니다.</p>}
                    </div>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {Object.entries(EVAL_FIELD_LABELS).map(([key, label]) => (
                  <label key={key} className="text-xs text-slate-600 space-y-1">
                    <span>{label}</span>
                    {key === 'mgmtTool' ? (
                      <select value={evalDraft[key] ?? ''} onChange={e => setEvalDraft(prev => ({ ...prev, [key]: e.target.value }))} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-sm bg-white">
                        {['KPI', '전략과제', '모니터링'].map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    ) : (
                      <input
                        value={evalDraft[key] ?? ''}
                        onChange={e => setEvalDraft(prev => ({ ...prev, [key]: (key === 'weight' || key === 'annualTarget') ? (Number(e.target.value) || 0) : e.target.value }))}
                        className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-sm"
                        type={(key === 'weight' || key === 'annualTarget') ? 'number' : 'text'}
                      />
                    )}
                  </label>
                ))}
              </div>
            </div>
            <div className="px-4 py-3 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setIsEvalEditorOpen(false)} className="px-3 py-2 rounded-lg border border-slate-200 text-sm">취소</button>
              <button onClick={saveEvalDraft} className="px-3 py-2 rounded-lg bg-emerald-700 text-white text-sm">저장</button>
            </div>
          </div>
        </div>
      )}

      {/* ━━ 코드체계 편집 모달 ━━ */}
      {isStructureEditorOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/30 flex items-center justify-center p-6">
          <div className="w-full max-w-xl rounded-xl bg-white border border-slate-200 shadow-xl">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-800">{editingStructureIdx == null ? '코드체계 추가' : '코드체계 수정'}</h3>
              <button onClick={() => setIsStructureEditorOpen(false)} className="p-1 rounded hover:bg-slate-100 text-slate-500"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3">
              <label className="text-xs text-slate-600 space-y-1">
                <span>Lv1코드</span>
                <input value={structureDraft.lv1} onChange={e => setStructureDraft(p => ({ ...p, lv1: e.target.value }))} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-sm" />
              </label>
              <label className="text-xs text-slate-600 space-y-1">
                <span>Lv1명</span>
                <input value={structureDraft.lv1Name} onChange={e => setStructureDraft(p => ({ ...p, lv1Name: e.target.value }))} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-sm" />
              </label>
              <label className="text-xs text-slate-600 space-y-1">
                <span>Lv2코드</span>
                <input value={structureDraft.lv2} onChange={e => setStructureDraft(p => ({ ...p, lv2: e.target.value }))} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-sm" />
              </label>
              <label className="text-xs text-slate-600 space-y-1">
                <span>Lv2명</span>
                <input value={structureDraft.lv2Name} onChange={e => setStructureDraft(p => ({ ...p, lv2Name: e.target.value }))} className="w-full px-2.5 py-2 rounded-lg border border-slate-200 text-sm" />
              </label>
            </div>
            <div className="px-4 py-3 border-t border-slate-100 flex justify-end gap-2">
              <button onClick={() => setIsStructureEditorOpen(false)} className="px-3 py-2 rounded-lg border border-slate-200 text-sm">취소</button>
              <button onClick={saveStructureDraft} className="px-3 py-2 rounded-lg bg-emerald-700 text-white text-sm">저장</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, Layers, ClipboardList, Plus, Pencil, Trash2, Upload, Download, X, Users, Link2, Calculator, Sparkles } from 'lucide-react'
import { api } from '../lib/apiClient'
import { findSimilarCommons, recommendLv3Classification } from '../lib/lv3Recommend'
import { composeIndicatorCode, PERF_OPTIONS } from '../lib/codeSystem'
import {
  isValidOperandKey,
  nextOperandKey,
  parseOperandsSafe,
  replaceOperandIdent,
} from '../lib/formulaDisplay'
import {
  DATA_SOURCE_KINDS,
  LV3_DEFINITION_FIELDS,
  LV3_FIELD_META,
  emptyLv3Definition,
  emptyMasterDefinition,
  mergeIndicatorDefinition,
  pickLv3DefinitionFromRow,
  pickMasterDefinitionFromRow,
  sourceLabel,
} from '../lib/indicatorDefinition'
import {
  ORG_LEVEL_OPTIONS,
  buildGroupTree,
  filterCodeGroups,
  filterEvalGroups,
  flattenGroupTree,
  orgLevelLabel,
  parentGroupOptions,
} from '../lib/orgGroup'

function summarizeOperands(ops) {
  const entries = Object.entries(ops || {})
  if (!entries.length) return '—'
  return entries.map(([k, v]) => `${k}=${v}`).join(', ')
}

export default function CodebookAdminView() {
  const [tab, setTab] = useState('groups')
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [apiOk, setApiOk] = useState(false)
  const [wakeHint, setWakeHint] = useState('')

  const [groups, setGroups] = useState([])
  const [lv1List, setLv1List] = useState([])
  const [lv2List, setLv2List] = useState([])
  const [commons, setCommons] = useState([])
  const [codes, setCodes] = useState([])
  const [formulas, setFormulas] = useState([])

  const fileInputRef = useRef(null)
  const [showInactive, setShowInactive] = useState(false)

  const codeGroups = useMemo(() => filterCodeGroups(groups), [groups])
  const evalGroups = useMemo(() => filterEvalGroups(groups), [groups])
  const groupTreeRows = useMemo(() => {
    const tree = buildGroupTree(groups, { includeInactive: showInactive })
    return flattenGroupTree(tree)
  }, [groups, showInactive])
  const groupNameByCode = useMemo(() => {
    const m = {}
    ;(groups || []).forEach((g) => { m[g.code] = g.name })
    return m
  }, [groups])

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    setWakeHint(/onrender\.com/i.test(api.base) ? 'Render 서버 깨우는 중… (최대 1~2분)' : '')
    try {
      await api.health()
      setApiOk(true)
      setWakeHint('')
      const [g, l1, l2, c, ic, ff] = await Promise.all([
        api.listGroups(),
        api.listLv1(),
        api.listLv2(),
        api.listCommon(),
        api.listCodes(),
        api.listFactFormulas(),
      ])
      setGroups(g.items || [])
      setLv1List(l1.items || [])
      setLv2List(l2.items || [])
      setCommons(c.items || [])
      setCodes(ic.items || [])
      setFormulas(ff.items || [])
    } catch (e) {
      setApiOk(false)
      const viaProxy = !api.apiBase
      const cold = /onrender\.com/i.test(api.apiBase || '')
      const msg = e?.data?.message || e?.message || ''
      setError(
        cold
          ? `API 연결 실패 (${api.base}). Render 무료 서버가 잠들었거나 재배포 중일 수 있습니다. 1~2분 후 「다시 시도」를 눌러 주세요.`
          : viaProxy
            ? `API 연결 실패 (${api.base}). 이 PC에서 API+ngrok이 꺼져 있으면 Vercel도 실패합니다. Cursor 터미널: .\\scripts\\start-kpi-stack.ps1 실행 후 「다시 시도」${msg ? ` — ${msg}` : ''}`
            : `API 연결 실패 (${api.base}). 서버를 실행하세요: python server/kpi_api.py${msg ? ` — ${msg}` : ''}`,
      )
    } finally {
      setLoading(false)
      setWakeHint('')
    }
  }, [])

  useEffect(() => { reload() }, [reload])

  const note = (msg) => { setFeedback(msg); setError('') }
  const fail = (e) => {
    const msg = e?.data?.message || e?.data?.error || e?.message || '요청 실패'
    const code = e?.data?.code ? ` (${e.data.code})` : ''
    setError(`${msg}${code}`)
    setFeedback('')
  }

  /* ── group editor ── */
  const [groupEditor, setGroupEditor] = useState(null)
  const saveGroup = async () => {
    try {
      const payload = {
        name: groupEditor.name,
        sort_order: Number(groupEditor.sort_order) || 0,
        use_yn: groupEditor.use_yn || 'Y',
        org_level: groupEditor.org_level || 'GROUP',
        parent_code: groupEditor.parent_code || '',
      }
      if (groupEditor._new) {
        await api.createGroup({ code: groupEditor.code, ...payload })
        note('그룹·본부를 추가했습니다.')
      } else {
        await api.updateGroup(groupEditor.code, payload)
        note('그룹·본부를 수정했습니다.')
      }
      setGroupEditor(null)
      await reload()
    } catch (e) { fail(e) }
  }

  const deactivateGroup = async (g) => {
    if (!window.confirm(`[${g.code}] 미사용 처리할까요?\n기존 평가·실적 이력은 유지됩니다.`)) return
    try {
      await api.updateGroup(g.code, { use_yn: 'N' })
      note(`${g.code} 미사용 처리됨`)
      await reload()
    } catch (e) { fail(e) }
  }

  const deactivateCode = async (r) => {
    if (!window.confirm(`[${r.indicator_code}] 미사용 처리할까요?`)) return
    try {
      await api.updateCode(r.indicator_code, {
        display_name: r.display_name,
        use_yn: 'N',
        detailed_definition_text: r.detailed_definition_text || '',
        owner_group_code: r.master_definition?.owner_group_code || r.owner_group_code || '',
        dept: r.master_definition?.dept || r.dept || '',
      })
      note('미사용 처리됨')
      await reload()
    } catch (e) { fail(e) }
  }

  const deactivateCommon = async (r) => {
    if (!window.confirm(`[${r.common_code}] 미사용 처리할까요?`)) return
    try {
      await api.updateCommon(r.common_code, {
        name: r.name,
        unit: r.unit,
        use_yn: 'N',
        ...pickLv3DefinitionFromRow(r),
      })
      note('미사용 처리됨')
      await reload()
    } catch (e) { fail(e) }
  }

  /* ── lv1/lv2 editor ── */
  const [lvEditor, setLvEditor] = useState(null)
  const openLv1Create = (selectInCommon = false) => {
    setLvEditor({
      kind: 'lv1',
      _new: true,
      code: '',
      name: '',
      sort_order: lv1List.length,
      selectInCommon: !!selectInCommon,
    })
  }
  const openLv2Create = async (selectInCommon = false) => {
    let code = ''
    try {
      const data = await api.nextLv2()
      code = data?.lv2_code || ''
    } catch (e) { fail(e); return }
    setLvEditor({
      kind: 'lv2',
      _new: true,
      code,
      name: '',
      sort_order: Number(code) || lv2List.length,
      selectInCommon: !!selectInCommon,
    })
  }
  const saveLv = async () => {
    try {
      let createdCode = String(lvEditor.code || '').trim()
      if (lvEditor.kind === 'lv1') {
        if (lvEditor._new) {
          const res = await api.createLv1({ code: lvEditor.code, name: lvEditor.name, sort_order: Number(lvEditor.sort_order) || 0 })
          createdCode = res?.code || createdCode
        } else {
          await api.updateLv1(lvEditor.code, { name: lvEditor.name, sort_order: Number(lvEditor.sort_order) || 0, use_yn: lvEditor.use_yn || 'Y' })
        }
      } else if (lvEditor._new) {
        const res = await api.createLv2({ code: lvEditor.code, name: lvEditor.name, sort_order: Number(lvEditor.sort_order) || 0 })
        createdCode = res?.code || createdCode
      } else {
        await api.updateLv2(lvEditor.code, { name: lvEditor.name, sort_order: Number(lvEditor.sort_order) || 0, use_yn: lvEditor.use_yn || 'Y' })
      }
      if (lvEditor.selectInCommon && lvEditor._new && createdCode) {
        setCommonEditor((p) => (p ? {
          ...p,
          ...(lvEditor.kind === 'lv1' ? { lv1_code: createdCode } : { lv2_code: createdCode }),
        } : p))
      }
      note('코드체계를 저장했습니다.')
      setLvEditor(null)
      await reload()
    } catch (e) { fail(e) }
  }

  /* ── common editor ── */
  const [commonEditor, setCommonEditor] = useState(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [dupCheck, setDupCheck] = useState(null)
  const commonPreview = useMemo(() => {
    if (!commonEditor) return ''
    const { lv1_code, lv2_code, lv3_code } = commonEditor
    if (!lv1_code || !lv2_code || !lv3_code) return ''
    return `${lv1_code}-${lv2_code}-${lv3_code}`
  }, [commonEditor])

  /** Lv2는 Lv1과 독립 — 전체 목록을 그대로 사용 */
  const lv2Options = useMemo(() => {
    return [...(lv2List || [])].sort((a, b) =>
      Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0)
      || String(a.code).localeCompare(String(b.code), 'ko'),
    )
  }, [lv2List])

  const similarLive = useMemo(() => {
    if (!commonEditor?._new) return []
    return findSimilarCommons(commons, commonEditor.name)
  }, [commonEditor, commons])

  const persistCommon = async () => {
    const defs = pickLv3DefinitionFromRow(commonEditor)
    if (commonEditor._new) {
      await api.createCommon({
        lv1_code: commonEditor.lv1_code,
        lv2_code: commonEditor.lv2_code,
        lv3_code: commonEditor.lv3_code,
        name: commonEditor.name,
        unit: commonEditor.unit || '',
        ...defs,
      })
    } else {
      await api.updateCommon(commonEditor.common_code, {
        name: commonEditor.name,
        unit: commonEditor.unit || '',
        use_yn: commonEditor.use_yn || 'Y',
        ...defs,
      })
    }
    note('Lv3를 저장했습니다.')
    setDupCheck(null)
    setCommonEditor(null)
    await reload()
  }

  const saveCommon = async () => {
    try {
      if (commonEditor._new) {
        const hits = findSimilarCommons(commons, commonEditor.name)
        if (hits.length) {
          setDupCheck({ hits })
          return
        }
      }
      await persistCommon()
    } catch (e) { fail(e) }
  }

  const confirmDupAndSave = async () => {
    try {
      await persistCommon()
    } catch (e) { fail(e) }
  }

  const runAiWizard = async () => {
    const name = String(commonEditor?.name || '').trim()
    if (!name) {
      fail(new Error('지표명을 먼저 입력하세요.'))
      return
    }
    setAiBusy(true)
    try {
      const rec = await recommendLv3Classification({ name, lv1List, lv2List })
      setCommonEditor((p) => {
        if (!p) return p
        const patch = {
          unit: rec.unit || p.unit,
          definition_text: rec.definition_text || p.definition_text,
          calc_logic_text: rec.calc_logic_text || p.calc_logic_text,
        }
        if (p._new) {
          if (rec.lv1_code) patch.lv1_code = rec.lv1_code
          if (rec.lv2_code) patch.lv2_code = rec.lv2_code
        }
        return { ...p, ...patch }
      })
      const missed = []
      if (commonEditor?._new && rec.lv1_unmatched) missed.push('Lv1')
      if (commonEditor?._new && rec.lv2_unmatched) missed.push('Lv2')
      const similar = findSimilarCommons(commons, name)
      const similarNote = similar.length
        ? ` 비슷한 지표 ${similar.length}건이 이미 있습니다. 저장 시 확인합니다.`
        : ''
      note(missed.length
        ? `AI 초안을 채웠습니다. ${missed.join('/')}는 기존 코드와 맞지 않아 비워 두었습니다. 옆에서 추가하세요.${similarNote}`
        : `${rec.reason ? `AI 초안 반영. ${rec.reason}` : 'AI 초안을 반영했습니다. 확인하고 저장하세요.'}${similarNote}`)
    } catch (e) { fail(e) }
    finally { setAiBusy(false) }
  }

  /* ── code (지표마스터) editor ── */
  const [codeEditor, setCodeEditor] = useState(null)
  const [codeQ, setCodeQ] = useState('')
  const [codeGroupFilter, setCodeGroupFilter] = useState('전체')
  const codePreview = useMemo(() => {
    if (!codeEditor?._new) return codeEditor?.indicator_code || ''
    const common = commons.find(c => c.common_code === codeEditor.common_code)
    if (!common || !codeEditor.perf_code || !codeEditor.group_code) return ''
    return composeIndicatorCode(common.lv1_code, common.lv2_code, common.lv3_code, codeEditor.perf_code, codeEditor.group_code)
  }, [codeEditor, commons])
  const codeLv3Base = useMemo(
    () => commons.find(c => c.common_code === codeEditor?.common_code) || null,
    [commons, codeEditor?.common_code],
  )
  const codeMergePreview = useMemo(() => {
    if (!codeEditor) return null
    return mergeIndicatorDefinition(codeLv3Base || {}, codeEditor)
  }, [codeEditor, codeLv3Base])
  const filteredCodes = useMemo(() => {
    let list = codes
    if (!showInactive) list = list.filter((r) => (r.use_yn || 'Y') !== 'N')
    if (codeGroupFilter !== '전체') list = list.filter(r => r.group_code === codeGroupFilter)
    if (!codeQ.trim()) return list
    const s = codeQ.trim().toLowerCase()
    return list.filter(r =>
      [r.indicator_code, r.common_code, r.display_name, r.group_code, r.perf_code,
        r.detailed_definition_text]
        .filter(Boolean).join(' ').toLowerCase().includes(s)
    )
  }, [codes, codeQ, codeGroupFilter, showInactive])

  const saveCode = async () => {
    try {
      const defs = pickMasterDefinitionFromRow(codeEditor)
      if (codeEditor._new) {
        await api.createCode({
          common_code: codeEditor.common_code,
          group_code: codeEditor.group_code,
          perf_code: codeEditor.perf_code,
          display_name: codeEditor.display_name,
          ...defs,
        })
        note('지표마스터를 추가했습니다.')
      } else {
        await api.updateCode(codeEditor.indicator_code, {
          display_name: codeEditor.display_name,
          use_yn: codeEditor.use_yn || 'Y',
          ...defs,
        })
        note('지표마스터를 수정했습니다.')
      }
      setCodeEditor(null)
      await reload()
    } catch (e) { fail(e) }
  }

  const importExcel = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const result = await api.importCodes(file)
      note(`엑셀 임포트 완료: 그룹 ${result.counts?.owner_group}, Lv1 ${result.counts?.code_lv1}, Lv2 ${result.counts?.code_lv2}, Lv3 ${result.counts?.indicator_common}, 지표마스터 ${result.counts?.indicator_code}`)
      await reload()
    } catch (e) { fail(e) }
    finally { if (event.target) event.target.value = '' }
  }

  /* ── formula editor ── */
  const [formulaEditor, setFormulaEditor] = useState(null)
  const [formulaPreviewYm, setFormulaPreviewYm] = useState(() => {
    const d = new Date()
    const prev = new Date(d.getFullYear(), d.getMonth() - 1, 1)
    return { year: prev.getFullYear(), month: prev.getMonth() + 1 }
  })
  const [formulaPreview, setFormulaPreview] = useState(null)
  const [formulaCodeQ, setFormulaCodeQ] = useState('')
  const formulaCodeOptions = useMemo(() => {
    const q = formulaCodeQ.trim().toLowerCase()
    let list = codes.filter((c) => (c.use_yn || 'Y') !== 'N')
    if (q) {
      list = list.filter((c) =>
        [c.indicator_code, c.display_name, c.group_code]
          .filter(Boolean).join(' ').toLowerCase().includes(q),
      )
    }
    return list.slice(0, 80)
  }, [codes, formulaCodeQ])

  const openFormulaEditor = (row = null) => {
    if (row) {
      setFormulaEditor({
        _new: false,
        id: row.id,
        name: row.name || '',
        output_indicator_code: row.output_indicator_code || '',
        expr: row.expr || '',
        operands: parseOperandsSafe(row.operands_json),
        use_yn: row.use_yn || 'Y',
      })
    } else {
      setFormulaEditor({
        _new: true,
        name: '',
        output_indicator_code: '',
        expr: '항목1/(항목1+항목2)*100',
        operands: { 항목1: '', 항목2: '' },
        use_yn: 'Y',
      })
    }
    setFormulaPreview(null)
    setFormulaCodeQ('')
  }

  const saveFormula = async () => {
    try {
      const ops = formulaEditor.operands || {}
      for (const key of Object.keys(ops)) {
        if (!isValidOperandKey(key)) {
          fail(new Error(`피연산자 이름 "${key}"이(가) 올바르지 않습니다. 한글·영문으로 시작하고 공백 없이 입력하세요.`))
          return
        }
      }
      const body = {
        name: formulaEditor.name,
        output_indicator_code: formulaEditor.output_indicator_code,
        expr: formulaEditor.expr,
        operands: ops,
        use_yn: formulaEditor.use_yn || 'Y',
      }
      if (formulaEditor._new) {
        await api.createFactFormula(body)
        note('가공식을 등록했습니다.')
      } else {
        await api.updateFactFormula(formulaEditor.id, body)
        note('가공식을 수정했습니다.')
      }
      setFormulaEditor(null)
      setFormulaPreview(null)
      await reload()
    } catch (e) { fail(e) }
  }

  const renameOperandKey = (oldKey, rawNewKey) => {
    const newKey = String(rawNewKey || '').trim()
    setFormulaEditor((p) => {
      if (!p) return p
      if (!newKey || newKey === oldKey) return p
      if (Object.prototype.hasOwnProperty.call(p.operands || {}, newKey)) {
        return p
      }
      const nextOps = { ...(p.operands || {}) }
      nextOps[newKey] = nextOps[oldKey]
      delete nextOps[oldKey]
      return {
        ...p,
        operands: nextOps,
        expr: replaceOperandIdent(p.expr || '', oldKey, newKey),
      }
    })
  }

  const runFormulaPreview = async () => {
    if (!formulaEditor) return
    try {
      const res = await api.previewFactFormula({
        year: formulaPreviewYm.year,
        month: formulaPreviewYm.month,
        expr: formulaEditor.expr,
        operands: formulaEditor.operands,
      })
      setFormulaPreview(res)
    } catch (e) { fail(e) }
  }

  const TABS = [
    { id: 'groups', icon: <Users className="w-4 h-4" />, label: '그룹·본부' },
    { id: 'structure', icon: <Layers className="w-4 h-4" />, label: 'Lv1·Lv2' },
    { id: 'common', icon: <ClipboardList className="w-4 h-4" />, label: 'Lv3' },
    { id: 'codes', icon: <Link2 className="w-4 h-4" />, label: '지표마스터' },
    { id: 'formulas', icon: <Calculator className="w-4 h-4" />, label: '가공식' },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div className="flex gap-2 border-b border-slate-200 flex-1">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 ${tab === t.id ? 'border-violet-600 text-violet-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs ${apiOk ? 'text-emerald-700' : 'text-rose-600'}`}>
            {loading ? (wakeHint || '로딩…') : apiOk ? 'API 연결' : 'API 끊김'}
          </span>
          {!apiOk && !loading && (
            <button type="button" onClick={reload} className="text-xs font-semibold text-blue-700 hover:text-blue-800">
              다시 시도
            </button>
          )}
          <a
            href={api.getCodesExportUrl()}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm"
          >
            <Download className="w-4 h-4" /> 엑셀 다운로드
          </a>
          <button onClick={() => fileInputRef.current?.click()} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-sm">
            <Upload className="w-4 h-4" /> 엑셀 업로드
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={importExcel} />
        </div>
      </div>

      {(error || feedback) && (
        <div className="fixed top-4 left-1/2 z-[80] w-[min(92vw,32rem)] -translate-x-1/2">
          <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg ${
            error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-violet-200 bg-violet-50 text-violet-800'
          }`}>
            <p className="flex-1 leading-5">{error || feedback}</p>
            {error && (
              <button type="button" onClick={reload} className="shrink-0 text-xs font-semibold underline">
                다시 시도
              </button>
            )}
            <button
              type="button"
              onClick={() => { setError(''); setFeedback('') }}
              className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
              aria-label="닫기"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {tab === 'groups' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setGroupEditor({
                _new: true,
                code: '',
                name: '',
                sort_order: groups.length,
                use_yn: 'Y',
                org_level: 'GROUP',
                parent_code: 'SHB',
              })}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-700 text-white text-sm"
            >
              <Plus className="w-4 h-4" /> 그룹·본부 추가
            </button>
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(e) => setShowInactive(e.target.checked)}
                className="rounded border-slate-300"
              />
              미사용 포함
            </label>
            <p className="text-[11px] text-slate-500">
              본부(HQ)는 지표코드 생성용 · 피평가는 그룹/전행만
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600">
                  <th className="px-3 py-2">코드</th>
                  <th className="px-3 py-2">이름</th>
                  <th className="px-3 py-2">레벨</th>
                  <th className="px-3 py-2">상위</th>
                  <th className="px-3 py-2">정렬</th>
                  <th className="px-3 py-2">사용</th>
                  <th className="px-3 py-2 text-center">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {groupTreeRows.map(g => (
                  <tr key={g.code} className={`${(g.use_yn || 'Y') === 'N' ? 'bg-slate-50/80 opacity-60' : ''}`}>
                    <td className="px-3 py-1.5 font-mono text-violet-700">
                      <span style={{ paddingLeft: `${(g.depth || 0) * 1.25}rem` }} className="inline-flex items-center gap-1">
                        {(g.depth || 0) > 0 && <span className="text-slate-300">└</span>}
                        {g.code}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">{g.name}</td>
                    <td className="px-3 py-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        (g.org_level || 'GROUP') === 'HQ' ? 'bg-amber-50 text-amber-800'
                          : (g.org_level || 'GROUP') === 'BANK' ? 'bg-slate-200 text-slate-700'
                            : 'bg-violet-50 text-violet-700'
                      }`}>
                        {orgLevelLabel(g.org_level)}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-slate-500">
                      {g.parent_code
                        ? `${g.parent_code}${groupNameByCode[g.parent_code] ? ` · ${groupNameByCode[g.parent_code]}` : ''}`
                        : '—'}
                    </td>
                    <td className="px-3 py-1.5">{g.sort_order}</td>
                    <td className="px-3 py-1.5">{(g.use_yn || 'Y') === 'Y' ? 'Y' : 'N'}</td>
                    <td className="px-3 py-1.5 text-center">
                      <button onClick={() => setGroupEditor({ ...g })} className="p-1 rounded hover:bg-slate-100 text-slate-600"><Pencil className="w-3.5 h-3.5" /></button>
                      {(g.use_yn || 'Y') === 'Y' && (
                        <button onClick={() => deactivateGroup(g)} className="p-1 rounded hover:bg-amber-50 text-amber-700" title="미사용"><Trash2 className="w-3.5 h-3.5" /></button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'structure' && (
        <div className="space-y-3">
          <p className="text-[11px] text-slate-500">
            Lv1(대분류)과 Lv2(중분류)는 <span className="font-semibold text-slate-700">독립 마스터</span>입니다.
            같은 Lv2 코드는 전역에서 동일한 의미이며, Lv3에서 임의의 Lv1×Lv2 조합이 가능합니다.
            예: 슈퍼SOL(Lv2) + 신규가입(Lv3)을 전행·좌수 / 영업점·Point로 나눠 배정.
          </p>
          <div className="flex gap-2">
            <button onClick={() => openLv1Create(false)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-700 text-white text-sm"><Plus className="w-4 h-4" /> Lv1 추가</button>
            <button onClick={() => openLv2Create(false)} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 text-white text-sm"><Plus className="w-4 h-4" /> Lv2 추가</button>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
              <div className="px-4 py-2.5 bg-emerald-800 text-white text-xs font-semibold">Lv1 대분류 ({lv1List.length})</div>
              <div className="overflow-x-auto max-h-[60vh]">
                <table className="w-full text-left text-xs">
                  <thead><tr className="bg-slate-50 sticky top-0"><th className="px-3 py-2">코드</th><th className="px-3 py-2">이름</th><th className="px-3 py-2 text-center">관리</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {lv1List.map(r => (
                      <tr key={r.code}>
                        <td className="px-3 py-1.5 font-mono text-violet-700">{r.code}</td>
                        <td className="px-3 py-1.5">{r.name}</td>
                        <td className="px-3 py-1.5 text-center">
                          <button onClick={() => setLvEditor({ kind: 'lv1', ...r })} className="p-1 rounded hover:bg-slate-100"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={async () => { if (!window.confirm(`[${r.code}] 미사용 처리?`)) return; try { await api.updateLv1(r.code, { name: r.name, sort_order: r.sort_order, use_yn: 'N' }); note('미사용 처리됨'); await reload() } catch (e) { fail(e) } }} className="p-1 rounded hover:bg-amber-50 text-amber-700" title="미사용"><Trash2 className="w-3.5 h-3.5" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
              <div className="px-4 py-2.5 bg-violet-800 text-white text-xs font-semibold">Lv2 중분류 ({lv2List.length})</div>
              <div className="overflow-x-auto max-h-[60vh]">
                <table className="w-full text-left text-xs">
                  <thead><tr className="bg-slate-50 sticky top-0"><th className="px-3 py-2">코드</th><th className="px-3 py-2">이름</th><th className="px-3 py-2 text-center">관리</th></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {lv2Options.map(r => (
                      <tr key={r.code}>
                        <td className="px-3 py-1.5 font-mono text-violet-700">{r.code}</td>
                        <td className="px-3 py-1.5">{r.name}</td>
                        <td className="px-3 py-1.5 text-center">
                          <button onClick={() => setLvEditor({ kind: 'lv2', ...r })} className="p-1 rounded hover:bg-slate-100"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={async () => { if (!window.confirm(`[${r.code}] 미사용 처리?`)) return; try { await api.updateLv2(r.code, { name: r.name, sort_order: r.sort_order, use_yn: 'N' }); note('미사용 처리됨'); await reload() } catch (e) { fail(e) } }} className="p-1 rounded hover:bg-amber-50 text-amber-700" title="미사용"><Trash2 className="w-3.5 h-3.5" /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'common' && (
        <div className="space-y-3">
          <button onClick={async () => {
            let lv3 = ''
            try {
              const data = await api.nextLv3()
              lv3 = data?.lv3_code || ''
            } catch (e) { fail(e); return }
            setCommonEditor({
              _new: true,
              lv1_code: lv1List[0]?.code || '',
              lv2_code: '',
              lv3_code: lv3,
              name: '',
              unit: '',
              ...emptyLv3Definition(),
            })
          }} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 text-white text-sm">
            <Plus className="w-4 h-4" /> Lv3 추가
          </button>
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="overflow-x-auto max-h-[60vh]">
              <table className="w-full text-left text-xs">
                <thead><tr className="bg-red-800 text-white sticky top-0">{['Lv3코드', 'Lv1', 'Lv2', 'Lv3', '지표명', '단위', '정의', '관리'].map(h => <th key={h} className="px-2 py-2 whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {commons.map(r => {
                    const filled = LV3_DEFINITION_FIELDS.filter(f => String(r[f] || '').trim()).length
                    return (
                      <tr key={r.common_code} className="hover:bg-slate-50/80">
                        <td className="px-2 py-1.5 font-mono">{r.common_code}</td>
                        <td className="px-2 py-1.5">{r.lv1_code}</td>
                        <td className="px-2 py-1.5">{r.lv2_code}</td>
                        <td className="px-2 py-1.5">{r.lv3_code}</td>
                        <td className="px-2 py-1.5">{r.name}</td>
                        <td className="px-2 py-1.5">{r.unit || '—'}</td>
                        <td className="px-2 py-1.5">
                          <DefinitionBadge filled={filled} total={LV3_DEFINITION_FIELDS.length} />
                        </td>
                        <td className="px-2 py-1.5">
                          <button onClick={() => setCommonEditor({ ...emptyLv3Definition(), ...r })} className="p-1 rounded hover:bg-slate-100"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => deactivateCommon(r)} className="p-1 rounded hover:bg-amber-50 text-amber-700" title="미사용"><Trash2 className="w-3.5 h-3.5" /></button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'codes' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[220px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="search" placeholder="지표코드, Lv3코드, 이름 검색" value={codeQ} onChange={e => setCodeQ(e.target.value)} className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm" />
            </div>
            <select value={codeGroupFilter} onChange={e => setCodeGroupFilter(e.target.value)} className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white">
              <option value="전체">그룹: 전체</option>
              {codeGroups.map(g => <option key={g.code} value={g.code}>{g.code} · {g.name}{g.org_level === 'HQ' ? ' (본부)' : ''}</option>)}
            </select>
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-600">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="rounded border-slate-300" />
              미사용 포함
            </label>
            <button onClick={() => setCodeEditor({
              _new: true,
              common_code: commons[0]?.common_code || '',
              group_code: codeGroups[0]?.code || '',
              perf_code: 'ETC',
              display_name: '',
              ...emptyMasterDefinition(),
            })} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-violet-600 text-white text-sm">
              <Plus className="w-4 h-4" /> 지표마스터 추가
            </button>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="overflow-x-auto max-h-[60vh]">
              <table className="w-full text-left text-xs">
                <thead><tr className="bg-red-800 text-white sticky top-0">{['지표코드', 'Lv3', '그룹', '실적', '표시명', '상세정의', '관리'].map(h => <th key={h} className="px-2 py-2 whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredCodes.map(r => (
                    <tr key={r.indicator_code} className="hover:bg-slate-50/80">
                      <td className="px-2 py-1.5 font-mono text-[11px]">{r.indicator_code}</td>
                      <td className="px-2 py-1.5 font-mono text-[10px]">{r.common_code}</td>
                      <td className="px-2 py-1.5">{r.group_code}</td>
                      <td className="px-2 py-1.5">{r.perf_code}</td>
                      <td className="px-2 py-1.5">{r.display_name}</td>
                      <td className="px-2 py-1.5">
                        {String(r.detailed_definition_text || '').trim()
                          ? <span className="inline-flex rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-medium text-violet-700">있음</span>
                          : <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-400">없음</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        <button onClick={() => setCodeEditor({
                          ...r,
                          detailed_definition_text: r.detailed_definition_text || '',
                          owner_group_code: r.master_definition?.owner_group_code || '',
                          dept: r.master_definition?.dept || '',
                        })} className="p-1 rounded hover:bg-slate-100"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => deactivateCode(r)} className="p-1 rounded hover:bg-amber-50 text-amber-700" title="미사용"><Trash2 className="w-3.5 h-3.5" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2 text-[11px] text-slate-500 border-t">표시 {filteredCodes.length} / 전체 {codes.length}</div>
          </div>
        </>
      )}

      {tab === 'formulas' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              코드마스터에 등록된 지표만 출력으로 선택합니다. 실적 새로고침 시 직접실적 다음에 가공식으로 산출됩니다.
            </p>
            <button
              type="button"
              onClick={() => openFormulaEditor()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-700 text-white text-sm"
            >
              <Plus className="w-4 h-4" /> 가공식 추가
            </button>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm">
            <div className="overflow-x-auto max-h-[60vh]">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-indigo-900 text-white sticky top-0">
                    {['ID', '이름', '출력지표', '식', '피연산자', '사용', '관리'].map((h) => (
                      <th key={h} className="px-2 py-2 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {formulas.map((r) => {
                    const ops = parseOperandsSafe(r.operands_json)
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/80">
                        <td className="px-2 py-1.5 tabular-nums text-slate-500">{r.id}</td>
                        <td className="px-2 py-1.5 font-medium text-slate-800">{r.name}</td>
                        <td className="px-2 py-1.5 font-mono text-[10px] text-violet-700">{r.output_indicator_code}</td>
                        <td className="px-2 py-1.5 font-mono text-[11px]">{r.expr}</td>
                        <td className="px-2 py-1.5 max-w-[280px] truncate text-slate-600" title={summarizeOperands(ops)}>
                          {summarizeOperands(ops)}
                        </td>
                        <td className="px-2 py-1.5">{(r.use_yn || 'Y') === 'Y' ? '사용' : '미사용'}</td>
                        <td className="px-2 py-1.5 whitespace-nowrap">
                          <button type="button" onClick={() => openFormulaEditor(r)} className="p-1 rounded hover:bg-slate-100"><Pencil className="w-3.5 h-3.5" /></button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!window.confirm(`[${r.name}] 미사용 처리?`)) return
                              try {
                                await api.updateFactFormula(r.id, {
                                  name: r.name,
                                  output_indicator_code: r.output_indicator_code,
                                  expr: r.expr,
                                  operands: ops,
                                  use_yn: 'N',
                                })
                                note('미사용 처리됨')
                                await reload()
                              } catch (e) { fail(e) }
                            }}
                            className="p-1 rounded hover:bg-amber-50 text-amber-700"
                            title="미사용"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                  {!loading && formulas.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">등록된 가공식이 없습니다.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* modals */}
      {groupEditor && (
        <Modal title={groupEditor._new ? '그룹·본부 추가' : `그룹·본부 ${groupEditor.code}`} onClose={() => setGroupEditor(null)} onSave={saveGroup}>
          {groupEditor._new && <Field label="코드"><input value={groupEditor.code} onChange={e => setGroupEditor(p => ({ ...p, code: e.target.value.toUpperCase() }))} className="input" /></Field>}
          <Field label="이름"><input value={groupEditor.name} onChange={e => setGroupEditor(p => ({ ...p, name: e.target.value }))} className="input" /></Field>
          <Field label="조직 레벨">
            <select
              value={groupEditor.org_level || 'GROUP'}
              onChange={(e) => {
                const org_level = e.target.value
                const parents = parentGroupOptions(groups, org_level, groupEditor.code)
                setGroupEditor((p) => ({
                  ...p,
                  org_level,
                  parent_code: org_level === 'BANK' ? '' : (parents[0]?.code || p.parent_code || ''),
                }))
              }}
              className="input"
            >
              {ORG_LEVEL_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          {(groupEditor.org_level || 'GROUP') !== 'BANK' && (
            <Field label="상위 조직">
              <select
                value={groupEditor.parent_code || ''}
                onChange={(e) => setGroupEditor((p) => ({ ...p, parent_code: e.target.value }))}
                className="input"
              >
                <option value="">(선택)</option>
                {parentGroupOptions(groups, groupEditor.org_level, groupEditor.code).map((g) => (
                  <option key={g.code} value={g.code}>{g.code} · {g.name}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="정렬"><input type="number" value={groupEditor.sort_order} onChange={e => setGroupEditor(p => ({ ...p, sort_order: e.target.value }))} className="input" /></Field>
          <Field label="사용">
            <select value={groupEditor.use_yn || 'Y'} onChange={e => setGroupEditor(p => ({ ...p, use_yn: e.target.value }))} className="input">
              <option value="Y">사용</option>
              <option value="N">미사용</option>
            </select>
          </Field>
        </Modal>
      )}

      {lvEditor && (
        <Modal
          title={lvEditor._new ? `${lvEditor.kind.toUpperCase()} 추가` : `${lvEditor.kind.toUpperCase()} 수정`}
          onClose={() => setLvEditor(null)}
          onSave={saveLv}
          stacked={!!commonEditor}
        >
          <Field label={lvEditor.kind === 'lv2' && lvEditor._new ? '코드(4자리, 전역 자동배정)' : '코드'}>
            <input
              value={lvEditor.code}
              readOnly={lvEditor.kind === 'lv2' && lvEditor._new}
              disabled={!lvEditor._new}
              onChange={e => setLvEditor(p => ({ ...p, code: lvEditor.kind === 'lv1' ? e.target.value.toUpperCase() : e.target.value }))}
              className={`input ${lvEditor.kind === 'lv2' && lvEditor._new ? 'bg-slate-50 font-mono' : ''}`}
              title={lvEditor.kind === 'lv2' && lvEditor._new ? '기존 최대값+1로 전역 유일 배정' : undefined}
            />
          </Field>
          <Field label="이름"><input value={lvEditor.name} onChange={e => setLvEditor(p => ({ ...p, name: e.target.value }))} className="input" /></Field>
          <Field label="정렬"><input type="number" value={lvEditor.sort_order ?? 0} onChange={e => setLvEditor(p => ({ ...p, sort_order: e.target.value }))} className="input" /></Field>
        </Modal>
      )}

      {dupCheck && (
        <Modal
          title="비슷한 지표가 이미 있습니다"
          onClose={() => setDupCheck(null)}
          onSave={confirmDupAndSave}
          stacked="top"
          saveLabel="그래도 추가"
          cancelLabel="돌아가기"
        >
          <p className="text-sm text-slate-700">
            아래 지표와 이름이 비슷합니다. 중복이 아니면 <span className="font-semibold">그래도 추가</span>를 누르세요.
          </p>
          <div className="max-h-64 overflow-auto rounded-lg border border-amber-200 bg-amber-50/70">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-amber-100 text-amber-900">
                  <th className="px-2 py-1.5">코드</th>
                  <th className="px-2 py-1.5">지표명</th>
                  <th className="px-2 py-1.5">단위</th>
                  <th className="px-2 py-1.5">유사</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-amber-100">
                {dupCheck.hits.map((r) => (
                  <tr key={r.common_code}>
                    <td className="px-2 py-1.5 font-mono whitespace-nowrap">{r.common_code}</td>
                    <td className="px-2 py-1.5">{r.name}</td>
                    <td className="px-2 py-1.5">{r.unit || '—'}</td>
                    <td className="px-2 py-1.5">{Math.round((r.similarScore || 0) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {commonEditor && (
        <Modal title={commonEditor._new ? 'Lv3 추가' : `Lv3 ${commonEditor.common_code}`} onClose={() => { setDupCheck(null); setCommonEditor(null) }} onSave={saveCommon} wide>
          {commonEditor._new ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="text-xs text-slate-600 space-y-1">
                  <span className="block">Lv1 대분류</span>
                  <div className="flex gap-2">
                    <select
                      value={commonEditor.lv1_code}
                      onChange={e => setCommonEditor(p => ({ ...p, lv1_code: e.target.value }))}
                      className="input"
                    >
                      <option value="">선택</option>
                      {lv1List.map(r => <option key={r.code} value={r.code}>{r.code} · {r.name}</option>)}
                    </select>
                    <button
                      type="button"
                      onClick={() => openLv1Create(true)}
                      className="shrink-0 inline-flex items-center gap-1 px-2.5 rounded-lg bg-emerald-700 text-white text-xs font-semibold whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" /> Lv1 추가
                    </button>
                  </div>
                </div>
                <div className="text-xs text-slate-600 space-y-1">
                  <span className="block">Lv2 중분류 (독립)</span>
                  <div className="flex gap-2">
                    <select
                      value={commonEditor.lv2_code}
                      onChange={(e) => setCommonEditor((p) => ({ ...p, lv2_code: e.target.value }))}
                      className="input"
                    >
                      <option value="">선택</option>
                      {lv2Options.map((r) => (
                        <option key={r.code} value={r.code}>{r.code} · {r.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => openLv2Create(true)}
                      className="shrink-0 inline-flex items-center gap-1 px-2.5 rounded-lg bg-violet-600 text-white text-xs font-semibold whitespace-nowrap"
                    >
                      <Plus className="w-3.5 h-3.5" /> Lv2 추가
                    </button>
                  </div>
                </div>
              </div>
              <Field label="Lv3(4자리, 전역 자동배정)">
                <input value={commonEditor.lv3_code} readOnly className="input bg-slate-50 font-mono" title="기존 최대값+1로 전역 유일 배정" />
              </Field>
              <Field label="Lv3코드(미리보기)"><input value={commonPreview} readOnly className="input bg-slate-50 font-mono" /></Field>
            </>
          ) : null}
          <div className="text-xs text-slate-600 space-y-1">
            <span className="block">지표명</span>
            <div className="flex gap-2">
              <input
                value={commonEditor.name}
                onChange={e => setCommonEditor(p => ({ ...p, name: e.target.value }))}
                className="input"
                placeholder="예: 슈퍼SOL 신규가입"
              />
              <button
                type="button"
                onClick={runAiWizard}
                disabled={aiBusy}
                className="shrink-0 inline-flex items-center gap-1 px-3 rounded-lg bg-violet-600 text-white text-xs font-semibold whitespace-nowrap disabled:opacity-50"
                title="지표명으로 Lv1·Lv2·단위·정의 초안 추천"
              >
                <Sparkles className="w-3.5 h-3.5" />
                {aiBusy ? '추천 중…' : 'AI마법사'}
              </button>
            </div>
            {similarLive.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-900">
                <p className="font-semibold">비슷한 지표 {similarLive.length}건이 이미 있습니다.</p>
                <ul className="mt-1 space-y-0.5">
                  {similarLive.slice(0, 4).map((r) => (
                    <li key={r.common_code}>
                      <span className="font-mono">{r.common_code}</span>
                      {' · '}{r.name}
                      {r.unit ? ` (${r.unit})` : ''}
                    </li>
                  ))}
                </ul>
                {similarLive.length > 4 ? <p className="mt-0.5 text-amber-700">외 {similarLive.length - 4}건. 저장 시 전체 확인.</p> : <p className="mt-0.5 text-amber-700">저장하면 계속 추가할지 한 번 더 묻습니다.</p>}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="단위"><input value={commonEditor.unit || ''} onChange={e => setCommonEditor(p => ({ ...p, unit: e.target.value }))} className="input" placeholder="원, %, 명, 건 …" /></Field>
          </div>
          <DefinitionFieldsEditor
            title="지표정의 (Lv3 공통)"
            hint="지표정의 · 산출로직 · Ownership(주관그룹/부서) · 산출주기 · 산출시점 · 데이터원천. 하위 지표마스터에서 Ownership만 덮어쓸 수 있습니다."
            value={commonEditor}
            groups={evalGroups}
            onChange={(patch) => setCommonEditor(p => ({ ...p, ...patch }))}
          />
        </Modal>
      )}

      {codeEditor && (
        <Modal title={codeEditor._new ? '지표마스터 추가' : `지표마스터 ${codeEditor.indicator_code}`} onClose={() => setCodeEditor(null)} onSave={saveCode} wide>
          {codeEditor._new ? (
            <>
              <Field label="Lv3">
                <select value={codeEditor.common_code} onChange={e => setCodeEditor(p => ({ ...p, common_code: e.target.value }))} className="input">
                  {commons.map(r => <option key={r.common_code} value={r.common_code}>{r.common_code} · {r.name}</option>)}
                </select>
              </Field>
              <Field label="코드 그룹 (지표코드 suffix)">
                <select value={codeEditor.group_code} onChange={e => setCodeEditor(p => ({ ...p, group_code: e.target.value }))} className="input">
                  {codeGroups.map(g => <option key={g.code} value={g.code}>{g.code} · {g.name}{g.org_level === 'HQ' ? ' (본부)' : ''}</option>)}
                </select>
              </Field>
              <Field label="실적구분">
                <select value={codeEditor.perf_code} onChange={e => setCodeEditor(p => ({ ...p, perf_code: e.target.value }))} className="input">
                  {PERF_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </Field>
            </>
          ) : null}
          <Field label="지표코드(미리보기)"><input value={codePreview} readOnly className="input bg-slate-50 font-mono" /></Field>
          <Field label="표시명"><input value={codeEditor.display_name || ''} onChange={e => setCodeEditor(p => ({ ...p, display_name: e.target.value }))} className="input" placeholder="비우면 Lv3 지표명 사용" /></Field>
          <p className="text-[11px] text-slate-500 -mt-1">
            단위: <span className="font-semibold text-slate-700">{codeLv3Base?.unit || '—'} </span>
            <span className="text-slate-400">(Lv3에서만 수정)</span>
            {!codeEditor._new && (
              <span className="ml-2 text-slate-400">· 피평가그룹 <span className="font-semibold text-slate-700">{codeEditor.group_code}</span></span>
            )}
          </p>
          {codeLv3Base && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-[11px] text-slate-600 space-y-1">
              <p className="font-bold text-slate-700">Lv3 공통 Ownership · 정의 요약</p>
              <p><span className="text-slate-400">Ownership</span> · {[
                codeLv3Base.owner_group_code
                  ? (groups.find(g => g.code === codeLv3Base.owner_group_code)?.name || codeLv3Base.owner_group_code)
                  : null,
                codeLv3Base.dept,
              ].filter(Boolean).join(' / ') || '—'}</p>
              <p><span className="text-slate-400">지표정의</span> · {(codeLv3Base.definition_text || '—').slice(0, 120)}{(codeLv3Base.definition_text || '').length > 120 ? '…' : ''}</p>
              <p><span className="text-slate-400">주기/시점</span> · {[codeLv3Base.calc_cycle, codeLv3Base.calc_timing].filter(Boolean).join(' / ') || '—'}</p>
            </div>
          )}
          <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-3 space-y-3 col-span-full">
            <p className="text-xs font-bold text-amber-900">Ownership 덮어쓰기 (비우면 Lv3 상속)</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Ownership 그룹">
                <select
                  value={codeEditor.owner_group_code || ''}
                  onChange={(e) => setCodeEditor((p) => ({ ...p, owner_group_code: e.target.value }))}
                  className="input"
                >
                  <option value="">(Lv3 상속)</option>
                  {evalGroups.map((g) => (
                    <option key={g.code} value={g.code}>{g.code} · {g.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Ownership 부서">
                <input
                  value={codeEditor.dept || ''}
                  onChange={(e) => setCodeEditor((p) => ({ ...p, dept: e.target.value }))}
                  className="input"
                  placeholder={codeLv3Base?.dept ? `Lv3: ${codeLv3Base.dept}` : '비우면 Lv3 상속'}
                />
              </Field>
            </div>
          </div>
          <Field label="상세지표정의">
            <textarea
              value={codeEditor.detailed_definition_text || ''}
              onChange={(e) => setCodeEditor((p) => ({ ...p, detailed_definition_text: e.target.value }))}
              className="input min-h-[120px]"
              rows={5}
              placeholder="그룹·실적구분별 예외·세부 산식·필터 조건 등. 비우면 Lv3 공통 정의만 사용합니다."
            />
          </Field>
          <Field label="사용">
            <select value={codeEditor.use_yn || 'Y'} onChange={(e) => setCodeEditor((p) => ({ ...p, use_yn: e.target.value }))} className="input">
              <option value="Y">사용</option>
              <option value="N">미사용</option>
            </select>
          </Field>
          {codeMergePreview && (
            <MergePreview merged={codeMergePreview} groups={groups} />
          )}
        </Modal>
      )}

      {formulaEditor && (
        <Modal
          title={formulaEditor._new ? '가공식 추가' : `가공식 수정 #${formulaEditor.id}`}
          onClose={() => { setFormulaEditor(null); setFormulaPreview(null) }}
          onSave={saveFormula}
          wide
        >
          <Field label="이름">
            <input
              value={formulaEditor.name}
              onChange={(e) => setFormulaEditor((p) => ({ ...p, name: e.target.value }))}
              className="input"
              placeholder="예: 신규비중"
            />
          </Field>
          <Field label="출력지표 (코드마스터)">
            <input
              list="formula-output-codes"
              value={formulaEditor.output_indicator_code}
              onChange={(e) => setFormulaEditor((p) => ({ ...p, output_indicator_code: e.target.value.toUpperCase() }))}
              onFocus={() => setFormulaCodeQ('')}
              className="input font-mono"
              placeholder="지표코드 검색·선택"
            />
            <datalist id="formula-output-codes">
              {formulaCodeOptions.map((c) => (
                <option key={c.indicator_code} value={c.indicator_code}>
                  {c.display_name || c.indicator_code}
                </option>
              ))}
            </datalist>
            <input
              value={formulaCodeQ}
              onChange={(e) => setFormulaCodeQ(e.target.value)}
              className="input mt-1"
              placeholder="지표 검색 필터"
            />
          </Field>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-600">피연산자 (이름은 한글·영문 가능)</span>
              <button
                type="button"
                className="text-xs text-violet-700 hover:underline"
                onClick={() => setFormulaEditor((p) => {
                  const key = nextOperandKey(p.operands)
                  return { ...p, operands: { ...p.operands, [key]: '' } }
                })}
              >
                + 추가
              </button>
            </div>
            {Object.entries(formulaEditor.operands || {}).map(([key, val]) => (
              <div key={key} className="flex gap-2 items-center">
                <input
                  defaultValue={key}
                  onBlur={(e) => {
                    const v = String(e.target.value || '').trim()
                    if (!v) {
                      e.target.value = key
                      fail(new Error('피연산자 이름은 비울 수 없습니다.'))
                      return
                    }
                    if (!isValidOperandKey(v)) {
                      e.target.value = key
                      fail(new Error(`피연산자 이름 "${v}"이(가) 올바르지 않습니다. 한글·영문으로 시작, 공백 불가.`))
                      return
                    }
                    if (v !== key && Object.prototype.hasOwnProperty.call(formulaEditor.operands || {}, v)) {
                      e.target.value = key
                      fail(new Error(`피연산자 이름 "${v}"이(가) 이미 있습니다.`))
                      return
                    }
                    renameOperandKey(key, v)
                  }}
                  className="input !w-24 font-semibold text-sm"
                  title="식에서 쓰는 변수명 (한글 가능)"
                  placeholder="항목1"
                />
                <input
                  list={`formula-op-${key}`}
                  value={val}
                  onChange={(e) => setFormulaEditor((p) => ({
                    ...p,
                    operands: { ...p.operands, [key]: e.target.value },
                  }))}
                  className="input font-mono flex-1"
                  placeholder="지표코드 또는 상수"
                />
                <datalist id={`formula-op-${key}`}>
                  {formulaCodeOptions.map((c) => (
                    <option key={c.indicator_code} value={c.indicator_code}>{c.display_name}</option>
                  ))}
                </datalist>
                <button
                  type="button"
                  className="p-1 text-rose-600 hover:bg-rose-50 rounded"
                  onClick={() => setFormulaEditor((p) => {
                    const next = { ...p.operands }
                    delete next[key]
                    return { ...p, operands: next }
                  })}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
          <Field label="식 (예: 항목1/(항목1+항목2)*100)">
            <input
              value={formulaEditor.expr}
              onChange={(e) => setFormulaEditor((p) => ({ ...p, expr: e.target.value }))}
              className="input font-mono"
              placeholder="피연산자 이름을 그대로 사용"
            />
          </Field>
          <Field label="사용여부">
            <select
              value={formulaEditor.use_yn || 'Y'}
              onChange={(e) => setFormulaEditor((p) => ({ ...p, use_yn: e.target.value }))}
              className="input"
            >
              <option value="Y">사용</option>
              <option value="N">미사용</option>
            </select>
          </Field>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-600">미리보기 연월</span>
              <select
                value={formulaPreviewYm.year}
                onChange={(e) => setFormulaPreviewYm((p) => ({ ...p, year: Number(e.target.value) }))}
                className="input !w-auto"
              >
                {[2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
              <select
                value={formulaPreviewYm.month}
                onChange={(e) => setFormulaPreviewYm((p) => ({ ...p, month: Number(e.target.value) }))}
                className="input !w-auto"
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>{m}월</option>
                ))}
              </select>
              <button
                type="button"
                onClick={runFormulaPreview}
                className="px-3 py-1.5 rounded-lg border border-violet-200 bg-violet-50 text-violet-700 text-xs font-medium"
              >
                미리보기 실행
              </button>
            </div>
            {formulaPreview && (
              <div className="text-xs text-slate-700 space-y-1">
                <p>
                  결과:{' '}
                  <span className="font-mono font-semibold">
                    {formulaPreview.ok ? formulaPreview.result : '—'}
                  </span>
                  {!formulaPreview.ok && formulaPreview.message ? ` (${formulaPreview.message})` : ''}
                </p>
                <p className="text-slate-500">
                  그룹 {formulaPreview.group_code || '—'} · {formulaPreview.eval_ym || '—'}
                </p>
              </div>
            )}
          </div>
        </Modal>
      )}

      <style>{`.input{width:100%;padding:0.5rem 0.625rem;border-radius:0.5rem;border:1px solid #e2e8f0;font-size:0.875rem;background:#fff}`}</style>
    </div>
  )
}

function Field({ label, children }) {
  return (
    <label className="text-xs text-slate-600 space-y-1 block">
      <span>{label}</span>
      {children}
    </label>
  )
}

function DefinitionBadge({ filled = 0, total = 7 }) {
  if (!filled) {
    return <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-400">미작성</span>
  }
  if (filled >= 4) {
    return <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">{filled}/{total}</span>
  }
  return <span className="inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">{filled}/{total}</span>
}

function DefinitionFieldsEditor({ title, hint, value, onChange, groups = [] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 space-y-3 col-span-full">
      <div>
        <p className="text-xs font-bold text-slate-700">{title}</p>
        {hint ? <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{hint}</p> : null}
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {['definition_text', 'calc_logic_text'].map((field) => {
          const meta = LV3_FIELD_META[field]
          return (
            <Field key={field} label={meta.label}>
              <textarea
                value={value?.[field] || ''}
                onChange={(e) => onChange({ [field]: e.target.value })}
                className="input"
                rows={meta.rows}
                placeholder={meta.placeholder}
              />
            </Field>
          )
        })}
        <Field label={LV3_FIELD_META.owner_group_code.label}>
          <select
            value={value?.owner_group_code || ''}
            onChange={(e) => onChange({ owner_group_code: e.target.value })}
            className="input"
          >
            <option value="">선택</option>
            {groups.map((g) => (
              <option key={g.code} value={g.code}>{g.code} · {g.name}</option>
            ))}
          </select>
        </Field>
        <Field label={LV3_FIELD_META.dept.label}>
          <input
            value={value?.dept || ''}
            onChange={(e) => onChange({ dept: e.target.value })}
            className="input"
            placeholder={LV3_FIELD_META.dept.placeholder}
          />
        </Field>
        {['calc_cycle', 'calc_timing'].map((field) => {
          const meta = LV3_FIELD_META[field]
          return (
            <Field key={field} label={meta.label}>
              <input
                value={value?.[field] || ''}
                onChange={(e) => onChange({ [field]: e.target.value })}
                className="input"
                placeholder={meta.placeholder}
              />
            </Field>
          )
        })}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-slate-600">데이터원천</p>
        <div className="flex flex-wrap items-center gap-2">
          {DATA_SOURCE_KINDS.map((kind) => {
            const active = (value?.data_source_kind || '') === kind
            return (
              <button
                key={kind}
                type="button"
                onClick={() => onChange({ data_source_kind: kind })}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold border transition ${
                  active
                    ? 'bg-violet-600 text-white border-violet-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {kind}
              </button>
            )
          })}
          {(value?.data_source_kind || '') && (
            <button
              type="button"
              onClick={() => onChange({ data_source_kind: '' })}
              className="text-[11px] text-slate-400 hover:text-slate-600"
            >
              선택 해제
            </button>
          )}
        </div>
        <Field label={value?.data_source_kind === 'Data Warehouse' ? '테이블 / View' : '원천 상세'}>
          <input
            value={value?.data_source || ''}
            onChange={(e) => onChange({ data_source: e.target.value })}
            className="input font-mono"
            placeholder={
              value?.data_source_kind === 'Data Warehouse'
                ? '예: DW.KPI_FACT_MONTH / schema.table'
                : '예: 수기 엑셀, 원장 화면명, 외부 API'
            }
          />
        </Field>
      </div>
    </div>
  )
}

function MergePreview({ merged, groups = [] }) {
  const groupLabel = (code) => {
    if (!code) return '—'
    const g = groups.find((x) => x.code === code)
    return g ? `${g.code} · ${g.name}` : code
  }
  const rows = [
    ...LV3_DEFINITION_FIELDS.map((field) => ({
      field,
      label: field === 'data_source_kind' ? '원천종류'
        : field === 'data_source' ? '원천상세'
          : field === 'owner_group_code' ? 'Ownership 그룹'
            : field === 'dept' ? 'Ownership 부서'
              : (LV3_FIELD_META[field]?.label || field),
    })),
    { field: 'detailed_definition_text', label: '상세지표정의' },
    { field: 'unit', label: '단위' },
  ]
  return (
    <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-3 space-y-2 col-span-full">
      <p className="text-xs font-bold text-violet-900">최종 정의 미리보기 (Lv3 + 상세·Ownership)</p>
      <div className="space-y-1.5">
        {rows.map(({ field, label }) => {
          let text = merged[field] || ''
          if (field === 'owner_group_code') text = groupLabel(text)
          const src = merged.sources?.[field] || ''
          return (
            <div key={field} className="grid grid-cols-[110px_52px_1fr] gap-2 text-[11px]">
              <span className="font-medium text-slate-600">{label}</span>
              <span className={`rounded px-1.5 py-0.5 text-center font-medium ${
                src === 'master' ? 'bg-violet-200/80 text-violet-900'
                  : src === 'lv3' ? 'bg-white text-slate-600 border border-slate-200'
                    : 'bg-slate-100 text-slate-400'
              }`}>{sourceLabel(src)}</span>
              <span className="text-slate-700 whitespace-pre-wrap break-words">{text || '—'}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Modal({ title, onClose, onSave, children, wide = false, stacked = false, saveLabel = '저장', cancelLabel = '취소' }) {
  const z = stacked === 'top' ? 'z-[70]' : stacked ? 'z-[60]' : 'z-50'
  return (
    <div className={`fixed inset-0 ${z} bg-slate-900/30 flex items-center justify-center p-6`}>
      <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-xl'} max-h-[90vh] overflow-auto rounded-xl bg-white border border-slate-200 shadow-xl`}>
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800">{title}</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-500"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 grid grid-cols-1 gap-3">{children}</div>
        <div className="px-4 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-2 rounded-lg border border-slate-200 text-sm">{cancelLabel}</button>
          <button onClick={onSave} className="px-3 py-2 rounded-lg bg-violet-600 text-white text-sm">{saveLabel}</button>
        </div>
      </div>
    </div>
  )
}

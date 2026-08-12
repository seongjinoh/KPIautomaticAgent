import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { FileText, Settings, Play, Loader2, Copy, Check, RotateCcw, ChevronDown, ChevronUp, Save } from 'lucide-react'
import { loadSettings, saveSettings, callLLM, PROVIDER_OPTIONS } from '../lib/llmService'
import { buildReportPrompt } from '../lib/reportPrompt'
import MarkdownRenderer from './MarkdownRenderer'

const PROMPT_STORAGE_KEY = 'kpi_report_prompt_override'

function loadPromptOverride() {
  try {
    const raw = localStorage.getItem(PROMPT_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return {
      systemPrompt: typeof parsed.systemPrompt === 'string' ? parsed.systemPrompt : null,
      userPrompt: typeof parsed.userPrompt === 'string' ? parsed.userPrompt : null,
      saveUserAlso: Boolean(parsed.saveUserAlso),
    }
  } catch {
    return null
  }
}

function savePromptOverride(payload) {
  localStorage.setItem(PROMPT_STORAGE_KEY, JSON.stringify(payload))
}

function clearPromptOverride() {
  localStorage.removeItem(PROMPT_STORAGE_KEY)
}

export default function ReportView({ group, categories, definitions, results, selectedMonth, selectedYear }) {
  const [report, setReport] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showPrompt, setShowPrompt] = useState(true)
  const [settings, setSettings] = useState(loadSettings)
  const [systemEdit, setSystemEdit] = useState('')
  const [userEdit, setUserEdit] = useState('')
  const [promptDirty, setPromptDirty] = useState(false)
  const [promptSavedMsg, setPromptSavedMsg] = useState('')
  const lastBuiltKey = useRef('')

  const kpiDefs = useMemo(() => definitions.filter(d => d.mgmtTool === 'KPI'), [definitions])
  const refDefs = useMemo(() => definitions.filter(d => d.mgmtTool !== 'KPI'), [definitions])

  const builtPrompt = useMemo(() => buildReportPrompt({
    group,
    categories,
    kpiDefs,
    refDefs,
    results,
    selectedMonth,
    selectedYear,
  }), [group, categories, kpiDefs, refDefs, results, selectedMonth, selectedYear])

  const builtKey = `${group}|${selectedYear}|${selectedMonth}|${builtPrompt.systemPrompt.length}|${builtPrompt.userPrompt.length}`

  useEffect(() => {
    const override = loadPromptOverride()
    const dataChanged = Boolean(lastBuiltKey.current) && lastBuiltKey.current !== builtKey
    lastBuiltKey.current = builtKey

    // 연월·그룹 등 데이터가 바뀌었거나, 아직 사용자가 손대기 전일 때만 에디터 갱신
    if (dataChanged || !promptDirty) {
      setSystemEdit(override?.systemPrompt || builtPrompt.systemPrompt)
      if (override?.saveUserAlso && override.userPrompt && !dataChanged) {
        setUserEdit(override.userPrompt)
      } else {
        setUserEdit(builtPrompt.userPrompt)
      }
      if (dataChanged) setPromptDirty(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- promptDirty는 의도적으로 제외(수정 중 덮어쓰기 방지)
  }, [builtKey, builtPrompt.systemPrompt, builtPrompt.userPrompt])

  const coreCount = kpiDefs.filter((d) => d.isCore).length

  const activePrompt = useMemo(() => ({
    systemPrompt: systemEdit || builtPrompt.systemPrompt,
    userPrompt: userEdit || builtPrompt.userPrompt,
  }), [systemEdit, userEdit, builtPrompt])

  const handleGenerate = useCallback(async () => {
    if (!settings.apiKey) {
      setShowSettings(true)
      setError('API Key를 먼저 설정해 주세요.')
      return
    }
    setLoading(true)
    setError('')
    setReport('')
    try {
      await callLLM(activePrompt, (chunk) => setReport(chunk))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [activePrompt, settings.apiKey])

  const handleCopy = () => {
    navigator.clipboard.writeText(report)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleCopyPrompt = async () => {
    await navigator.clipboard.writeText(
      `【시스템】\n${activePrompt.systemPrompt}\n\n【사용자】\n${activePrompt.userPrompt}`,
    )
    setPromptSavedMsg('프롬프트를 복사했습니다.')
    setTimeout(() => setPromptSavedMsg(''), 2000)
  }

  const handleResetPrompt = () => {
    clearPromptOverride()
    setSystemEdit(builtPrompt.systemPrompt)
    setUserEdit(builtPrompt.userPrompt)
    setPromptDirty(false)
    setPromptSavedMsg('기본 프롬프트로 되돌렸습니다.')
    setTimeout(() => setPromptSavedMsg(''), 2000)
  }

  const handleSavePrompt = (saveUserAlso = false) => {
    savePromptOverride({
      systemPrompt: systemEdit,
      userPrompt: saveUserAlso ? userEdit : null,
      saveUserAlso,
    })
    setPromptDirty(false)
    setPromptSavedMsg(saveUserAlso ? '시스템·사용자 프롬프트를 저장했습니다.' : '시스템 프롬프트를 저장했습니다. (데이터 본문은 연월 바뀔 때 자동 갱신)')
    setTimeout(() => setPromptSavedMsg(''), 3500)
  }

  const handleSaveSettings = (newSettings) => {
    setSettings(newSettings)
    saveSettings(newSettings)
    setShowSettings(false)
    setError('')
  }

  const selectedProvider = PROVIDER_OPTIONS.find(p => p.id === settings.provider) || PROVIDER_OPTIONS[0]

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center">
              <FileText className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">AI 실적 진단 보고서</h3>
              <p className="text-xs text-slate-400">
                {group} · {selectedYear ? `${selectedYear}년 ` : ''}{selectedMonth}월 · Core {coreCount}개 포함 · 부진·특이 중심 현업형 문안
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
            >
              <Settings className="w-4 h-4" />
              {selectedProvider.label}
            </button>
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {loading ? '생성 중...' : report ? '다시 생성' : '보고서 생성'}
            </button>
          </div>
        </div>
      </div>

      {showSettings && (
        <SettingsPanel settings={settings} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} />
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          <strong>오류:</strong> {error}
          {(error.includes('할당량') || error.includes('quota')) && (
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => setShowSettings(true)}
                className="px-3 py-1.5 rounded-lg bg-white border border-red-200 text-red-700 text-xs font-medium hover:bg-red-50"
              >
                설정에서 OpenAI로 전환
              </button>
              <button
                onClick={() => { setError(''); handleGenerate() }}
                className="px-3 py-1.5 rounded-lg bg-red-100 text-red-700 text-xs font-medium hover:bg-red-200"
              >
                다시 시도
              </button>
            </div>
          )}
        </div>
      )}

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowPrompt(!showPrompt)}
          className="w-full px-5 py-3 flex items-center justify-between text-sm text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <span className="flex items-center gap-2">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">편집 가능</span>
            프롬프트 (생성 전 직접 수정)
            {promptDirty && <span className="text-[10px] text-amber-600">수정됨</span>}
          </span>
          {showPrompt ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {showPrompt && (
          <div className="px-5 pb-4 border-t border-slate-100 space-y-3">
            <p className="text-[11px] text-slate-500 mt-3">
              아래 내용이 LLM에 그대로 전달됩니다. 연·월·그룹이 바뀌면 데이터 본문(사용자 프롬프트)은 다시 채워집니다.
              시스템 안내는 「시스템만 저장」으로 브라우저에 남길 수 있습니다.
            </p>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-600">시스템 프롬프트 (역할·문체 규칙)</label>
              </div>
              <textarea
                value={systemEdit}
                onChange={(e) => { setSystemEdit(e.target.value); setPromptDirty(true) }}
                rows={8}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-700 outline-none focus:border-violet-400 focus:bg-white"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-semibold text-slate-600">사용자 프롬프트 (데이터 + 출력 지시)</label>
              </div>
              <textarea
                value={userEdit}
                onChange={(e) => { setUserEdit(e.target.value); setPromptDirty(true) }}
                rows={18}
                className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-700 outline-none focus:border-violet-400 focus:bg-white"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => handleSavePrompt(false)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700"
              >
                <Save className="w-3.5 h-3.5" /> 시스템만 저장
              </button>
              <button
                type="button"
                onClick={() => handleSavePrompt(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100"
              >
                <Save className="w-3.5 h-3.5" /> 시스템+사용자 저장
              </button>
              <button
                type="button"
                onClick={handleResetPrompt}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                <RotateCcw className="w-3.5 h-3.5" /> 기본값 복원
              </button>
              <button
                type="button"
                onClick={handleCopyPrompt}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                <Copy className="w-3.5 h-3.5" /> 복사
              </button>
              {promptSavedMsg && <span className="text-[11px] text-emerald-700">{promptSavedMsg}</span>}
            </div>
          </div>
        )}
      </div>

      {(report || loading) && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <FileText className="w-4 h-4 text-violet-500" />
              생성된 보고서
              {loading && <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-500" />}
            </h3>
            {report && !loading && (
              <div className="flex items-center gap-2">
                <button onClick={handleCopy} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-500 hover:bg-slate-100 transition-colors">
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? '복사됨' : '복사'}
                </button>
                <button onClick={handleGenerate} className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-500 hover:bg-slate-100 transition-colors">
                  <RotateCcw className="w-3.5 h-3.5" />
                  재생성
                </button>
              </div>
            )}
          </div>
          <div className="px-8 py-6">
            <MarkdownRenderer content={report} />
            {loading && !report && (
              <div className="flex items-center gap-3 justify-center py-12 text-slate-400">
                <Loader2 className="w-6 h-6 animate-spin" />
                <span className="text-sm">AI가 데이터를 분석하고 보고서를 작성하고 있습니다...</span>
              </div>
            )}
          </div>
        </div>
      )}

      {!report && !loading && !error && (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-violet-50 flex items-center justify-center mx-auto mb-4">
            <FileText className="w-8 h-8 text-violet-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-700 mb-2">보고서를 생성해 보세요</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto mb-6">
            위 프롬프트를 수정한 뒤 생성하면, 편집한 내용 그대로 LLM에 전달됩니다.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => { if (!settings.apiKey) setShowSettings(true); else handleGenerate() }}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-colors"
            >
              <Play className="w-4 h-4" />
              보고서 생성하기
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function SettingsPanel({ settings, onSave, onClose }) {
  const [local, setLocal] = useState({ ...settings })
  const provider = PROVIDER_OPTIONS.find(p => p.id === local.provider) || PROVIDER_OPTIONS[0]

  return (
    <div className="bg-white rounded-xl border border-violet-200 p-5">
      <h4 className="text-sm font-bold text-slate-700 mb-4">LLM API 설정</h4>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Provider</label>
          <select
            value={local.provider}
            onChange={e => setLocal(s => ({ ...s, provider: e.target.value, model: PROVIDER_OPTIONS.find(p => p.id === e.target.value)?.models[0] || '' }))}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-violet-400"
          >
            {PROVIDER_OPTIONS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Model</label>
          {provider.models.length > 0 ? (
            <select
              value={local.model}
              onChange={e => setLocal(s => ({ ...s, model: e.target.value }))}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-violet-400"
            >
              {provider.models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          ) : (
            <input
              value={local.model}
              onChange={e => setLocal(s => ({ ...s, model: e.target.value }))}
              placeholder="모델명 입력"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-violet-400"
            />
          )}
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-slate-500 mb-1">API Key</label>
          <input
            type="password"
            value={local.apiKey}
            onChange={e => setLocal(s => ({ ...s, apiKey: e.target.value }))}
            placeholder={local.provider === 'gemini' ? 'Google AI Studio API Key' : 'sk-...'}
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-violet-400"
          />
        </div>
        {local.provider === 'custom' && (
          <div className="col-span-2">
            <label className="block text-xs font-medium text-slate-500 mb-1">Base URL</label>
            <input
              value={local.baseUrl}
              onChange={e => setLocal(s => ({ ...s, baseUrl: e.target.value }))}
              placeholder="https://your-api.com/v1"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm outline-none focus:border-violet-400"
            />
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-slate-500 hover:bg-slate-100">취소</button>
        <button onClick={() => onSave(local)} className="px-4 py-1.5 rounded-lg text-sm bg-violet-600 text-white hover:bg-violet-700">저장</button>
      </div>
    </div>
  )
}

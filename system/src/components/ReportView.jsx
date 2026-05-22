import { useState, useCallback, useRef } from 'react'
import { FileText, Settings, Play, Loader2, Copy, Check, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react'
import { loadSettings, saveSettings, callLLM, PROVIDER_OPTIONS } from '../lib/llmService'
import { buildReportPrompt } from '../lib/reportPrompt'
import MarkdownRenderer from './MarkdownRenderer'

export default function ReportView({ group, categories, definitions, results, selectedMonth }) {
  const [report, setReport] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showPrompt, setShowPrompt] = useState(false)
  const [settings, setSettings] = useState(loadSettings)
  const abortRef = useRef(null)

  const kpiDefs = definitions.filter(d => d.mgmtTool === 'KPI')
  const refDefs = definitions.filter(d => d.mgmtTool !== 'KPI')

  const prompt = buildReportPrompt({ group, categories, kpiDefs, refDefs, results, selectedMonth })

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
      await callLLM(prompt, (chunk) => setReport(chunk))
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [prompt, settings.apiKey])

  const handleCopy = () => {
    navigator.clipboard.writeText(report)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
      {/* Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center">
              <FileText className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-800">AI 실적 진단 보고서</h3>
              <p className="text-xs text-slate-400">{group} · {selectedMonth}월 기준 · KPI {kpiDefs.length}개 + 참고 {refDefs.length}개 데이터 분석</p>
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

      {/* Settings Panel */}
      {showSettings && (
        <SettingsPanel settings={settings} onSave={handleSaveSettings} onClose={() => setShowSettings(false)} />
      )}

      {/* Error */}
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

      {/* Prompt Preview */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <button
          onClick={() => setShowPrompt(!showPrompt)}
          className="w-full px-5 py-3 flex items-center justify-between text-sm text-slate-600 hover:bg-slate-50 transition-colors"
        >
          <span className="flex items-center gap-2">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">PROMPT</span>
            프롬프트 미리보기 (LLM에 전달되는 데이터)
          </span>
          {showPrompt ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {showPrompt && (
          <div className="px-5 pb-4 border-t border-slate-100">
            <pre className="text-xs text-slate-600 bg-slate-50 rounded-lg p-4 mt-3 max-h-80 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed">
              {prompt.userPrompt}
            </pre>
          </div>
        )}
      </div>

      {/* Report Output */}
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

      {/* Empty State */}
      {!report && !loading && !error && (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="w-16 h-16 rounded-2xl bg-violet-50 flex items-center justify-center mx-auto mb-4">
            <FileText className="w-8 h-8 text-violet-400" />
          </div>
          <h3 className="text-lg font-semibold text-slate-700 mb-2">보고서를 생성해 보세요</h3>
          <p className="text-sm text-slate-400 max-w-md mx-auto mb-6">
            {group}의 KPI {kpiDefs.length}개, 전략과제·모니터링 {refDefs.length}개 데이터를 AI가 분석하여
            실적 진단, 추진현황, 개선과제를 포함한 경영진 보고서를 자동 생성합니다.
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

import { useMemo, useState } from 'react'
import { Bot, Database, FileText, Search, Send, ShieldCheck } from 'lucide-react'
import { buildAgentAnswer, buildAgentLLMPrompt } from '../lib/agentAnswerBuilder'
import { callLLM, loadSettings } from '../lib/llmService'
import { appendAuthAudit } from '../lib/authService'
import MarkdownRenderer from './MarkdownRenderer'

const SAMPLE_QUESTIONS = [
  '이번 달 부진 지표 알려줘',
  '전월 대비 급등락 이상치 찾아줘',
  '본원적 수익력 부진 원인 후보 설명해줘',
  '임원 보고용 월간 실적 리뷰 초안 작성해줘',
]

export default function AgentQueryView({
  definitions,
  results,
  groups,
  categories,
  selectedMonth,
  selectedYear,
  currentUser,
}) {
  const [question, setQuestion] = useState(SAMPLE_QUESTIONS[0])
  const [lastQuestion, setLastQuestion] = useState('')
  const [agentResult, setAgentResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const availableScope = useMemo(() => {
    const groupCount = new Set((definitions || []).map(def => def.group)).size
    return {
      groupCount,
      kpiCount: (definitions || []).filter(def => def.mgmtTool === 'KPI').length,
    }
  }, [definitions])

  const ask = async (text = question) => {
    const q = text.trim()
    if (!q) return
    const result = buildAgentAnswer({
      question: q,
      definitions,
      results,
      groups,
      categories,
      selectedMonth,
      selectedYear,
      currentUser,
    })
    const settings = loadSettings()
    appendAuthAudit({
      eventType: 'AI_QUERY_REQUESTED',
      employeeNo: currentUser?.employeeNo,
      userId: currentUser?.id,
      sessionId: currentUser?.sessionId,
      result: 'SUCCESS',
      reason: `${result.intentLabel}: ${q.slice(0, 80)}`,
    })
    setLastQuestion(q)
    setError('')
    setAgentResult({
      ...result,
      answer: settings.apiKey
        ? '## Gemini 응답 생성 중\n- 규칙 기반 분석 결과와 근거 데이터를 Gemini에 전달해 답변을 생성하고 있습니다.'
        : result.answer,
      llmUsed: false,
    })
    setQuestion(q)

    if (!settings.apiKey) {
      setError('.env의 VITE_GEMINI_API_KEY 또는 화면 설정의 API Key가 없어 규칙 기반 답변만 표시합니다.')
      return
    }

    setLoading(true)
    try {
      const prompt = buildAgentLLMPrompt({
        question: q,
        agentResult: result,
        selectedMonth,
        selectedYear,
        currentUser,
      })
      await callLLM(prompt, (chunk) => {
        setAgentResult(prev => prev ? { ...prev, answer: chunk, llmUsed: true } : prev)
      })
      appendAuthAudit({
        eventType: 'AI_ANSWER_GENERATED',
        employeeNo: currentUser?.employeeNo,
        userId: currentUser?.id,
        sessionId: currentUser?.sessionId,
        result: 'SUCCESS',
        reason: `${result.intentLabel}: Gemini answer generated`,
      })
    } catch (e) {
      setAgentResult({ ...result, llmUsed: false })
      setError(`Gemini 호출 실패: ${e.message}. 규칙 기반 답변으로 대체했습니다.`)
      appendAuthAudit({
        eventType: 'AI_ANSWER_BLOCKED',
        employeeNo: currentUser?.employeeNo,
        userId: currentUser?.id,
        sessionId: currentUser?.sessionId,
        result: 'FAIL',
        reason: e.message,
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50">
              <Bot className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <h3 className="text-lg font-black text-slate-800">성과평가 AI Agent</h3>
              <p className="mt-1 text-sm text-slate-500">
                권한 범위 내 KPI 데이터를 기준으로 조회, 이상치 센싱, 관계해석, 보고서 초안을 생성합니다.
              </p>
            </div>
          </div>
          <div className="hidden rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-right text-xs text-slate-500 md:block">
            <p>조회 가능 그룹 {availableScope.groupCount}개</p>
            <p>KPI {availableScope.kpiCount}개 · {selectedYear}년 {selectedMonth}월</p>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
          <label className="mb-2 block text-xs font-bold uppercase tracking-widest text-slate-400">Question</label>
          <div className="flex gap-2">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="min-h-24 flex-1 resize-none rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 outline-none focus:border-blue-400"
              placeholder="예: 이번 달 고객솔루션그룹 부진 원인 후보 알려줘"
            />
            <button
              onClick={() => ask()}
              disabled={loading}
              className="flex w-24 flex-col items-center justify-center gap-1 rounded-xl bg-blue-600 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {loading ? '생성중' : '질의'}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {SAMPLE_QUESTIONS.map(sample => (
              <button
                key={sample}
                onClick={() => ask(sample)}
                className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
              >
                {sample}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-5">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-blue-600" />
            <h4 className="text-sm font-bold text-blue-900">통제 기준</h4>
          </div>
          <ul className="space-y-2 text-xs leading-5 text-blue-900/80">
            <li>사용자 권한 범위로 필터링된 KPI만 사용합니다.</li>
            <li>LLM SQL 생성 없이 승인된 데이터 구조만 조회하는 전제를 따릅니다.</li>
            <li>답변에는 기준월, 근거 데이터, 한계 및 유의사항을 포함합니다.</li>
            <li>현재는 POC 규칙 기반이며 운영 시 DW/MCP/행내 LLM으로 교체해야 합니다.</li>
          </ul>
        </div>
      </section>

      {agentResult ? (
        <section className="grid grid-cols-1 gap-5 xl:grid-cols-[1.15fr_0.85fr]">
          <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-widest text-blue-500">{agentResult.intentLabel}</p>
                <h4 className="mt-1 text-sm font-bold text-slate-700">{lastQuestion}</h4>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-500">
                {agentResult.llmUsed ? 'Gemini' : 'Rule'} · {selectedYear}.{String(selectedMonth).padStart(2, '0')}
              </span>
            </div>
            {error && (
              <div className="border-b border-amber-100 bg-amber-50 px-5 py-2 text-xs text-amber-700">
                {error}
              </div>
            )}
            <div className="px-7 py-5">
              <MarkdownRenderer content={agentResult.answer} />
            </div>
          </div>

          <div className="space-y-5">
            <EvidenceTable rows={agentResult.evidenceRows} />
            <RelationCard relation={agentResult.relation} />
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center">
          <Search className="mx-auto mb-3 h-8 w-8 text-slate-300" />
          <h4 className="text-base font-bold text-slate-700">질문을 입력하면 Agent가 분석합니다</h4>
          <p className="mt-2 text-sm text-slate-400">조회·부진·이상치·관계해석·보고서 초안을 우선 지원합니다.</p>
        </section>
      )}
    </div>
  )
}

function EvidenceTable({ rows }) {
  const keys = rows?.[0] ? Object.keys(rows[0]) : []
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-sm">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
        <Database className="h-4 w-4 text-slate-500" />
        <h4 className="text-sm font-bold text-slate-700">근거 데이터</h4>
      </div>
      {rows?.length ? (
        <div className="max-h-96 overflow-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>{keys.map(key => <th key={key} className="whitespace-nowrap px-3 py-2 text-left font-semibold">{key}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} className="border-t border-slate-100">
                  {keys.map(key => <td key={key} className="whitespace-nowrap px-3 py-2 text-slate-600">{row[key]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="px-4 py-6 text-sm text-slate-400">표시할 근거 데이터가 없습니다.</p>
      )}
    </div>
  )
}

function RelationCard({ relation }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <FileText className="h-4 w-4 text-slate-500" />
        <h4 className="text-sm font-bold text-slate-700">관계 해석 후보</h4>
      </div>
      <p className="text-xs leading-5 text-slate-500">{relation?.summary ?? '관계 해석 결과가 없습니다.'}</p>
      {relation?.drivers?.length > 0 && (
        <div className="mt-3 space-y-2">
          {relation.drivers.slice(0, 3).map(driver => (
            <div key={driver.code} className="rounded-xl bg-slate-50 px-3 py-2">
              <p className="text-xs font-bold text-slate-700">{driver.label}</p>
              <p className="text-[11px] text-slate-400">달성률 {driver.achievement?.toFixed?.(2)}% · 비중 {driver.weight}%</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

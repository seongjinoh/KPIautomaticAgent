import { ArrowLeft, Calendar, Filter, FileText } from 'lucide-react'

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1)
const TOOLS = ['전체', 'KPI', '전략과제', '모니터링']
const YEARS = [2026, 2025]

export default function Header({ view, selectedGroup, selectedMonth, selectedYear, toolFilter, onMonthChange, onYearChange, onToolFilterChange, onBack, onReportClick }) {
  return (
    <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-3">
        {view !== 'dashboard' && (
          <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
            <ArrowLeft className="w-5 h-5 text-slate-500" />
          </button>
        )}
        <div>
          <h2 className="text-lg font-semibold text-slate-800">
            {view === 'dashboard' ? `${selectedYear}년 전행 KPI 현황`
              : view === 'report' ? `${selectedGroup} AI 보고서`
              : view === 'codebook' ? '0. 코드북'
              : selectedGroup}
          </h2>
          <p className="text-xs text-slate-400">
            {view === 'dashboard'
              ? selectedYear === 2026
                ? 'KPI 20개/그룹 · 은행KPI 20개 · 4대 카테고리'
                : '25년 체계: 재무/고객/전략 · 기관제휴=영추4+기관솔루션'
              : view === 'report' ? 'LLM 기반 실적 진단 · 추진현황 · 개선과제'
              : view === 'codebook' ? '재무/비재무 상호 배타 · 엑셀 0.코드북 동기'
              : `${selectedYear}년 평가 기준`}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* 연도 선택 */}
        {view !== 'codebook' && (
          <div className="flex rounded-lg border border-slate-200 overflow-hidden">
            {YEARS.map(y => (
              <button
                key={y}
                onClick={() => onYearChange(y)}
                className={`px-3 py-1.5 text-sm font-semibold transition-colors ${
                  selectedYear === y
                    ? 'bg-slate-800 text-white'
                    : 'bg-white text-slate-500 hover:bg-slate-50'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
        )}

        {/* 월 선택 */}
        {view !== 'codebook' && (
          <div className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-1.5 border border-slate-200">
            <Calendar className="w-4 h-4 text-slate-400" />
            <select
              value={selectedMonth}
              onChange={e => onMonthChange(Number(e.target.value))}
              className="text-sm bg-transparent outline-none cursor-pointer text-slate-700"
            >
              {MONTHS.map(m => <option key={m} value={m}>{m}월</option>)}
            </select>
          </div>
        )}

        {view === 'detail' && (
          <>
            <div className="flex items-center gap-2 bg-slate-50 rounded-lg px-3 py-1.5 border border-slate-200">
              <Filter className="w-4 h-4 text-slate-400" />
              <select
                value={toolFilter}
                onChange={e => onToolFilterChange(e.target.value)}
                className="text-sm bg-transparent outline-none cursor-pointer text-slate-700"
              >
                {TOOLS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <button
              onClick={onReportClick}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-colors"
            >
              <FileText className="w-4 h-4" />
              AI 보고서
            </button>
          </>
        )}
      </div>
    </header>
  )
}

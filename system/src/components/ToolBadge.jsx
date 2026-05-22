const styles = {
  'KPI': 'bg-emerald-100 text-emerald-700',
  '전략과제': 'bg-amber-100 text-amber-700',
  '모니터링': 'bg-rose-100 text-rose-600',
}

export default function ToolBadge({ tool }) {
  return (
    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${styles[tool] || 'bg-slate-100 text-slate-600'}`}>
      {tool}
    </span>
  )
}

export default function StatusDot({ value, size = 'sm' }) {
  let color = 'bg-rose-500'
  if (value >= 100) color = 'bg-emerald-500'
  else if (value >= 80) color = 'bg-amber-400'

  const sizeClass = size === 'lg' ? 'w-3.5 h-3.5' : 'w-2.5 h-2.5'

  return <span className={`inline-block rounded-full ${sizeClass} ${color}`} />
}

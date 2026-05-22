/**
 * 마크다운 렌더링 (의존성 없이 순수 구현)
 * 지원: 헤딩, 볼드, 리스트, 테이블, 인라인코드, 수평선, 단락
 */
export default function MarkdownRenderer({ content }) {
  if (!content) return null
  const html = parseMarkdown(content)
  return (
    <div
      className="prose prose-slate prose-sm max-w-none
        [&_h1]:text-xl [&_h1]:font-bold [&_h1]:text-slate-800 [&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:pb-2 [&_h1]:border-b [&_h1]:border-slate-200
        [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-slate-800 [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:pb-1.5 [&_h2]:border-b [&_h2]:border-slate-100
        [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-slate-700 [&_h3]:mt-4 [&_h3]:mb-2
        [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-slate-600 [&_h4]:mt-3 [&_h4]:mb-1
        [&_p]:text-sm [&_p]:text-slate-600 [&_p]:leading-relaxed [&_p]:mb-2
        [&_ul]:text-sm [&_ul]:text-slate-600 [&_ul]:pl-5 [&_ul]:mb-2 [&_ul]:list-disc
        [&_ol]:text-sm [&_ol]:text-slate-600 [&_ol]:pl-5 [&_ol]:mb-2 [&_ol]:list-decimal
        [&_li]:mb-1 [&_li]:leading-relaxed
        [&_strong]:text-slate-800 [&_strong]:font-semibold
        [&_code]:text-xs [&_code]:bg-slate-100 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-violet-700
        [&_hr]:my-4 [&_hr]:border-slate-200
        [&_table]:w-full [&_table]:text-sm [&_table]:border-collapse [&_table]:mb-3
        [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-medium [&_th]:text-slate-600 [&_th]:border [&_th]:border-slate-200
        [&_td]:px-3 [&_td]:py-1.5 [&_td]:border [&_td]:border-slate-200 [&_td]:text-slate-600
        [&_blockquote]:border-l-3 [&_blockquote]:border-violet-300 [&_blockquote]:bg-violet-50 [&_blockquote]:pl-4 [&_blockquote]:py-2 [&_blockquote]:my-3 [&_blockquote]:text-sm [&_blockquote]:text-violet-800 [&_blockquote]:rounded-r-lg
      "
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}

function parseMarkdown(md) {
  let html = md
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // Tables
  html = html.replace(/^(\|.+\|)\n(\|[-:\s|]+\|)\n((?:\|.+\|\n?)*)/gm, (_, header, sep, body) => {
    const ths = header.split('|').filter(Boolean).map(c => `<th>${c.trim()}</th>`).join('')
    const rows = body.trim().split('\n').map(row => {
      const tds = row.split('|').filter(Boolean).map(c => `<td>${c.trim()}</td>`).join('')
      return `<tr>${tds}</tr>`
    }).join('')
    return `<table><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table>`
  })

  // Blockquotes
  html = html.replace(/^&gt;\s?(.+)$/gm, '<blockquote>$1</blockquote>')

  // Headings
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // Horizontal rules
  html = html.replace(/^---+$/gm, '<hr>')

  // Bold + italic
  html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Inline code
  html = html.replace(/`(.+?)`/g, '<code>$1</code>')

  // Unordered lists
  html = html.replace(/^(\s*)[-*]\s+(.+)$/gm, (_, indent, text) => {
    return `<li style="margin-left:${indent.length * 12}px">${text}</li>`
  })
  html = html.replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul>$1</ul>')

  // Ordered lists
  html = html.replace(/^\d+\.\s+(.+)$/gm, '<oli>$1</oli>')
  html = html.replace(/((?:<oli>.*<\/oli>\n?)+)/g, (match) => {
    return '<ol>' + match.replace(/<\/?oli>/g, (t) => t === '<oli>' ? '<li>' : '</li>') + '</ol>'
  })

  // Paragraphs
  html = html.replace(/^([^<\n].+)$/gm, (match) => {
    if (/^<(h[1-4]|ul|ol|li|table|thead|tbody|tr|th|td|hr|blockquote|div|p)/.test(match)) return match
    return `<p>${match}</p>`
  })

  // Clean up extra newlines
  html = html.replace(/\n{2,}/g, '\n')

  return html
}

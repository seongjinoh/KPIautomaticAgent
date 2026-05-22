/**
 * LLM API 호출 서비스
 * OpenAI, Google Gemini, OpenAI-호환 엔드포인트 지원
 */

const STORAGE_KEY = 'kpi_llm_settings'

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {}
  return { provider: 'openai', apiKey: '', model: 'gpt-4o', baseUrl: '' }
}

export function saveSettings(settings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export async function callLLM({ systemPrompt, userPrompt }, onChunk) {
  const settings = loadSettings()
  if (!settings.apiKey) throw new Error('API Key가 설정되지 않았습니다.')

  const call = () => settings.provider === 'gemini'
    ? callGemini(settings, systemPrompt, userPrompt, onChunk)
    : callOpenAI(settings, systemPrompt, userPrompt, onChunk)

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await call()
    } catch (e) {
      const is429 = e.message?.includes('429') || e.message?.toLowerCase().includes('quota') || e.message?.toLowerCase().includes('resource_exhausted')
      if (is429 && attempt < 2) {
        if (onChunk) onChunk(`\n\n⏳ 할당량 초과로 15초 후 재시도합니다...\n\n`)
        await new Promise(r => setTimeout(r, 15000))
        continue
      }
      if (is429) {
        throw new Error(
          'Gemini 무료 할당량을 초과했습니다. 일일 한도인 경우 내일 다시 시도하거나, 설정에서 OpenAI API로 전환해 주세요.'
        )
      }
      throw e
    }
  }
}

async function callOpenAI(settings, systemPrompt, userPrompt, onChunk) {
  const baseUrl = settings.baseUrl || 'https://api.openai.com/v1'
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model || 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: true,
      temperature: 0.4,
      max_tokens: 4096,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`API 오류 (${res.status}): ${err}`)
  }

  return streamSSE(res, onChunk)
}

async function callGemini(settings, systemPrompt, userPrompt, onChunk) {
  const model = settings.model || 'gemini-2.0-flash'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${settings.apiKey}`

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ parts: [{ text: userPrompt }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Gemini API 오류 (${res.status}): ${err}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data: ')) continue
      const jsonStr = trimmed.slice(6)
      if (jsonStr === '[DONE]') break
      try {
        const parsed = JSON.parse(jsonStr)
        const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || ''
        if (text) { full += text; onChunk?.(full) }
      } catch {}
    }
  }
  return full
}

async function streamSSE(res, onChunk) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let full = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data: ')) continue
      const jsonStr = trimmed.slice(6)
      if (jsonStr === '[DONE]') break
      try {
        const parsed = JSON.parse(jsonStr)
        const delta = parsed.choices?.[0]?.delta?.content || ''
        if (delta) { full += delta; onChunk?.(full) }
      } catch {}
    }
  }
  return full
}

export const PROVIDER_OPTIONS = [
  { id: 'openai', label: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o3-mini'] },
  { id: 'gemini', label: 'Google Gemini', models: ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.5-pro-exp-03-25'] },
  { id: 'custom', label: '커스텀 (OpenAI 호환)', models: [] },
]

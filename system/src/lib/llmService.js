/**
 * LLM API 호출 서비스
 * OpenAI, Google Gemini, OpenAI-호환 엔드포인트 지원
 *
 * API Key 우선순위: system/.env (VITE_GEMINI_API_KEY) > 화면/localStorage
 * .env 변경 후에는 dev 서버 재시작 필요 (npm run dev)
 */

const STORAGE_KEY = 'kpi_llm_settings'
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite'

function envSettings() {
  const env = import.meta.env || {}
  const apiKey = String(env.VITE_GEMINI_API_KEY || env.VITE_LLM_API_KEY || '').trim()
  const model = String(env.VITE_GEMINI_MODEL || env.VITE_LLM_MODEL || DEFAULT_GEMINI_MODEL).trim()
  return {
    provider: env.VITE_LLM_PROVIDER || 'gemini',
    apiKey,
    model,
    baseUrl: String(env.VITE_LLM_BASE_URL || '').trim(),
    source: apiKey ? 'env' : 'manual',
  }
}

export function hasEnvApiKey() {
  return Boolean(envSettings().apiKey)
}

export function hasEnvModel() {
  return Boolean(String(import.meta.env?.VITE_GEMINI_MODEL || import.meta.env?.VITE_LLM_MODEL || '').trim())
}

export function loadSettings() {
  const env = envSettings()
  let saved = null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) saved = JSON.parse(raw)
  } catch {
    saved = null
  }

  // .env에 키/모델이 있으면 항상 env 우선 (localStorage의 옛 gemini-2.0-flash 등 무시)
  if (env.apiKey) {
    return {
      provider: env.provider || saved?.provider || 'gemini',
      apiKey: env.apiKey,
      model: env.model,
      baseUrl: env.baseUrl || saved?.baseUrl || '',
      source: 'env',
    }
  }

  if (saved) {
    const deprecated = new Set(['gemini-2.0-flash', 'gemini-2.0-flash-lite'])
    const savedModel = String(saved.model || '').trim()
    const model = (savedModel && !deprecated.has(savedModel)) ? savedModel : env.model
    return {
      provider: saved.provider || env.provider,
      apiKey: String(saved.apiKey || '').trim(),
      model,
      baseUrl: saved.baseUrl || env.baseUrl,
      source: saved.apiKey ? 'manual' : 'manual',
    }
  }

  return env
}

export function saveSettings(settings) {
  const env = envSettings()
  const payload = env.apiKey
    ? {
        provider: settings.provider,
        model: env.model || settings.model,
        baseUrl: settings.baseUrl || '',
      }
    : {
        provider: settings.provider,
        model: settings.model,
        baseUrl: settings.baseUrl || '',
        apiKey: settings.apiKey || '',
      }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

export async function callLLM({ systemPrompt, userPrompt }, onChunk) {
  const settings = loadSettings()
  if (!settings.apiKey) {
    throw new Error('API Key가 설정되지 않았습니다. system/.env의 VITE_GEMINI_API_KEY를 넣고 dev 서버를 재시작하세요.')
  }

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
  const model = settings.model || DEFAULT_GEMINI_MODEL
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
  { id: 'gemini', label: 'Google Gemini', models: ['gemini-2.0-flash', 'gemini-2.0-flash-lite', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'] },
  { id: 'custom', label: '커스텀 (OpenAI 호환)', models: [] },
]

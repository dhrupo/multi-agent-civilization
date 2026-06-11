import { AI_RATE_LIMIT_BACKOFF_MS, AI_REQUEST_TIMEOUT_MS } from "../constants"
import { envKeyPresent, listMinds, loadAiSettings, type AiSettings } from "./settings"

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string }

// live request accounting — proof the pipeline is actually flowing
const callStats = { sent: 0, ok: 0, failed: 0, rateLimited: 0 }

export function getAiCallStats(): typeof callStats {
  return { ...callStats }
}

export class RateLimitError extends Error {
  retryAfterMs: number
  constructor(retryAfterMs: number) {
    super("AI provider rate limit reached")
    this.retryAfterMs = retryAfterMs
  }
}

// Node batch mode: experiments configure a provider directly (no proxy, no localStorage)
let nodeAi: AiSettings | null = null

export function configureNodeAi(settings: AiSettings): void {
  nodeAi = settings
}

export function aiAvailable(): boolean {
  return nodeAi !== null || loadAiSettings() !== null || listMinds().length > 0 || envKeyPresent()
}

// Models may wrap JSON in code fences, prepend prose, or get truncated by the
// token cap — extract the first object and repair a cut-off tail if needed.
function extractJson(text: string): unknown {
  const start = text.indexOf("{")
  if (start === -1) {
    throw new Error(`No JSON object in model output: ${text.slice(0, 200)}`)
  }
  const raw = text.slice(start)
  const end = raw.lastIndexOf("}")
  if (end !== -1) {
    try {
      return JSON.parse(raw.slice(0, end + 1))
    } catch {
      // fall through to repair
    }
  }
  // truncation repair: close an unterminated string, drop a dangling fragment
  // after the last comma, and balance the braces
  const candidates: string[] = []
  let body = raw.replace(/```/g, "").trimEnd()
  if ((body.match(/(?<!\\)"/g) ?? []).length % 2 === 1) candidates.push(body + '"')
  candidates.push(body)
  const lastComma = body.lastIndexOf(",")
  if (lastComma > 0) candidates.push(body.slice(0, lastComma))
  for (const candidate of candidates) {
    const open = (candidate.match(/{/g) ?? []).length
    const close = (candidate.match(/}/g) ?? []).length
    try {
      return JSON.parse(candidate + "}".repeat(Math.max(0, open - close)))
    } catch {
      // try the next candidate
    }
  }
  throw new Error(`Unparseable JSON in model output: ${text.slice(0, 200)}`)
}

async function post(body: Record<string, unknown>, override?: AiSettings | null): Promise<Response> {
  const settings = override ?? nodeAi ?? loadAiSettings()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS)
  try {
    if (nodeAi) {
      // Node: call the provider directly — there is no dev-server proxy
      const direct = settings ?? nodeAi
      return await fetch(`${direct.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${direct.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" }
    if (settings) {
      headers["x-ai-base-url"] = settings.baseUrl
      headers["x-ai-key"] = settings.apiKey
    }
    // no settings → the proxy falls back to the .env z.ai key and base URL
    return await fetch("/api/ai/chat", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

// One tiny real request to prove the provider, model, and key all work —
// used by the settings panel before persisting anything.
export async function testConnection(settings: AiSettings): Promise<void> {
  const messages: ChatMessage[] = [{ role: "user", content: "Reply with the single word: ok" }]
  // generous budget: reasoning models burn tokens before answering
  let res = await post(buildBody(messages, 1000, settings), settings)
  if (!res.ok && res.status >= 400 && res.status < 500 && ![401, 403, 429].includes(res.status)) {
    res = await post({ model: settings.model, messages }, settings)
  }
  if (!res.ok) {
    const text = (await res.text()).slice(0, 200)
    if (res.status === 401 || res.status === 403) throw new Error("key rejected (401/403)")
    if (res.status === 404) throw new Error(`model or URL not found (404): ${text}`)
    if (res.status === 429) throw new Error("key works but is rate-limited right now (429)")
    throw new Error(`provider error ${res.status}: ${text}`)
  }
  const data = await res.json()
  if (!data?.choices?.[0]?.message) {
    throw new Error("unexpected response shape — is the base URL OpenAI-compatible?")
  }
}

export function activeModel(): string {
  return nodeAi?.model ?? loadAiSettings()?.model ?? "glm-4.5-flash"
}

function isGlm(model: string): boolean {
  return model.startsWith("glm")
}

// Reasoning models (gemini-2.5, gpt-5/o-series, GLM with thinking) burn output
// budget on hidden thinking BEFORE the JSON — give them generous headroom.
function buildBody(
  messages: ChatMessage[],
  maxTokens: number,
  mind: AiSettings | null | undefined
): Record<string, unknown> {
  const model = mind?.model ?? activeModel()
  const provider = mind?.provider ?? nodeAi?.provider ?? loadAiSettings()?.provider ?? "zai"
  const body: Record<string, unknown> = { model, messages }
  // OpenAI's reasoning-era models require max_completion_tokens and a default temperature
  const reasoningOpenAI = provider === "openai" && /^(gpt-5|o\d)/.test(model)
  if (provider === "openai") body.max_completion_tokens = maxTokens
  else body.max_tokens = maxTokens
  if (!reasoningOpenAI) body.temperature = 0.8
  if (isGlm(model)) body.thinking = { type: "disabled" }
  return body
}

// `mind` routes the request to a specific provider; omitted = default settings
export async function chatJSON(
  messages: ChatMessage[],
  maxTokens = 1500,
  mind?: AiSettings | null
): Promise<unknown> {
  const model = mind?.model ?? activeModel()
  const body = buildBody(messages, maxTokens, mind)
  callStats.sent++

  try {
    // provider-tuned body first; on a 4xx (unknown param etc.), retry minimal
    let res = await post(body, mind)
    if (!res.ok && res.status >= 400 && res.status < 500 && ![401, 403, 429].includes(res.status)) {
      res = await post({ model, messages }, mind)
    }
    if (res.status === 429) {
      callStats.rateLimited++
      const retryAfter = Number(res.headers.get("retry-after"))
      throw new RateLimitError(
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : AI_RATE_LIMIT_BACKOFF_MS
      )
    }
    if (res.status >= 500) {
      // provider overload (Gemini 503 "high demand", 529, …) — transient, back off
      callStats.rateLimited++
      throw new RateLimitError(30_000)
    }
    if (!res.ok) {
      throw new Error(`AI API error ${res.status}: ${(await res.text()).slice(0, 300)}`)
    }

    const data = await res.json()
    const content: string | undefined = data?.choices?.[0]?.message?.content
    if (!content) {
      throw new Error(`Empty completion: ${JSON.stringify(data).slice(0, 300)}`)
    }
    const parsed = extractJson(content)
    callStats.ok++
    return parsed
  } catch (error) {
    if (!(error instanceof RateLimitError)) callStats.failed++
    throw error
  }
}

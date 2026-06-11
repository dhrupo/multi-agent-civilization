// User-configurable AI provider. Any OpenAI-compatible chat/completions API
// works; requests route through the local dev proxy so keys never face CORS
// and never appear in page scripts.

export type AiProviderId =
  | "zai"
  | "openai"
  | "anthropic"
  | "gemini"
  | "groq"
  | "openrouter"
  | "custom"

export type ProviderPreset = {
  id: AiProviderId
  label: string
  baseUrl: string // OpenAI-compatible root (…/chat/completions appended)
  models: string[] // curated options, first = default (cheap + fast preferred)
  keyHint: string
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: "zai",
    label: "z.ai (GLM)",
    baseUrl: "https://api.z.ai/api/paas/v4",
    models: ["glm-4.5-flash", "glm-4.5-air", "glm-4.5", "glm-4.6"],
    keyHint: "z.ai API key",
  },
  {
    id: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4.1-mini", "gpt-5-mini", "gpt-5-nano", "gpt-4o"],
    keyHint: "sk-…",
  },
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    baseUrl: "https://api.anthropic.com/v1",
    models: ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-8"],
    keyHint: "sk-ant-…",
  },
  {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-pro"],
    keyHint: "AIza…",
  },
  {
    id: "groq",
    label: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-20b"],
    keyHint: "gsk_…",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      "openai/gpt-4o-mini",
      "anthropic/claude-haiku-4.5",
      "google/gemini-2.5-flash",
      "meta-llama/llama-3.3-70b-instruct",
    ],
    keyHint: "sk-or-…",
  },
  {
    id: "custom",
    label: "Custom (OpenAI-compatible)",
    baseUrl: "",
    models: [],
    keyHint: "API key",
  },
]

export type AiSettings = {
  provider: AiProviderId
  baseUrl: string
  model: string
  apiKey: string
}

const STORAGE_KEY = "tiny-civ-ai-settings"

const hasLocalStorage = typeof localStorage !== "undefined"

export function loadAiSettings(): AiSettings | null {
  if (!hasLocalStorage) return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AiSettings
    if (parsed.baseUrl && parsed.model && parsed.apiKey) {
      // The default mind is always z.ai GLM. A non-GLM default saved by an
      // older build gets demoted to a per-agent mind, and GLM takes over.
      if (parsed.provider !== "zai") {
        const exists = listMinds().some(
          (m) => m.provider === parsed.provider && m.model === parsed.model && m.apiKey === parsed.apiKey
        )
        if (!exists) addMind(parsed)
        localStorage.removeItem(STORAGE_KEY)
        return null
      }
      return parsed
    }
  } catch (error) {
    console.error("[ai] failed to read settings:", error)
  }
  return null
}

export function saveAiSettings(settings: AiSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export function clearAiSettings(): void {
  localStorage.removeItem(STORAGE_KEY)
}

// The env-provided z.ai key (via .env, injected by the dev proxy) is the
// fallback when the user hasn't configured their own provider.
export function envKeyPresent(): boolean {
  return typeof __AI_KEY_PRESENT__ !== "undefined" && __AI_KEY_PRESENT__
}

export function defaultModelFor(id: AiProviderId): string {
  return PROVIDER_PRESETS.find((p) => p.id === id)?.models[0] ?? ""
}

// --- Mind profiles: multiple saved providers, assignable per agent ---

export type MindProfile = AiSettings & { id: string }

const MINDS_KEY = "tiny-civ-ai-minds"

export function listMinds(): MindProfile[] {
  if (!hasLocalStorage) return []
  try {
    const raw = localStorage.getItem(MINDS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as MindProfile[]
      if (Array.isArray(parsed)) return parsed.filter((m) => m.id && m.baseUrl && m.model && m.apiKey)
    }
  } catch (error) {
    console.error("[ai] failed to read minds:", error)
  }
  return []
}

export function addMind(settings: AiSettings): MindProfile {
  const minds = listMinds()
  const mind: MindProfile = { ...settings, id: `mind${Date.now().toString(36)}` }
  localStorage.setItem(MINDS_KEY, JSON.stringify([...minds, mind]))
  return mind
}

export function deleteMind(id: string): void {
  localStorage.setItem(MINDS_KEY, JSON.stringify(listMinds().filter((m) => m.id !== id)))
}

export function mindById(id: string | null | undefined): MindProfile | null {
  if (!id) return null
  return listMinds().find((m) => m.id === id) ?? null
}

export function mindLabel(mind: AiSettings): string {
  const preset = PROVIDER_PRESETS.find((p) => p.id === mind.provider)
  return `${preset?.label ?? mind.provider} · ${mind.model}`
}

export function activeAiDescription(): string | null {
  const user = loadAiSettings()
  if (user) {
    const preset = PROVIDER_PRESETS.find((p) => p.id === user.provider)
    return `${preset?.label ?? user.provider}: ${user.model}`
  }
  if (envKeyPresent()) return "z.ai (GLM): glm-4.5-flash"
  return null
}

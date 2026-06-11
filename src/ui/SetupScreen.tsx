import { useState } from "react"
import type { Personality } from "../types"
import {
  AGENT_COLORS,
  DEFAULT_SIM_END_DAY,
  MAX_AGENTS,
  MAX_SIM_DAYS,
  MIN_AGENTS,
  MIN_SIM_DAYS,
} from "../constants"
import { matchPreset, PRESETS, RANDOM_NAMES, randomPersonality } from "../simulation/agent"
import { clearMemories, listRuns, pastRunCount } from "../ai/memory"
import {
  addMind,
  clearAiSettings,
  deleteMind,
  envKeyPresent,
  listMinds,
  loadAiSettings,
  mindLabel,
  PROVIDER_PRESETS,
  saveAiSettings,
  type AiProviderId,
  type MindProfile,
} from "../ai/settings"
import { testConnection } from "../ai/client"
import { useSimStore } from "../store/useSimStore"

type CardState = {
  name: string
  color: string
  personality: Personality
  mindId: string | null
}

const TRAITS: (keyof Personality)[] = ["aggression", "greed", "cooperation", "curiosity"]
const DEFAULT_NAMES = ["Kai", "Maya", "Rex", "Luna", "Vex", "Ana", "Oba", "Zia"]
const DEFAULT_PRESETS = ["Warrior", "Merchant", "Explorer", "Hermit", "Tyrant", "Diplomat", "Explorer", "Merchant"]

// Method 3: pre-fill from URL params like ?a1=Warrior,Kai&a2=Merchant,Maya
function initialCards(): CardState[] {
  const params = new URLSearchParams(window.location.search)
  return DEFAULT_NAMES.slice(0, 4).map((name, i) => {
    const raw = params.get(`a${i + 1}`)
    if (raw) {
      const [presetName, agentName] = raw.split(",")
      const preset = PRESETS[presetName]
      if (preset) {
        return {
          name: (agentName || presetName).slice(0, 12),
          color: AGENT_COLORS[i],
          personality: { ...preset },
          mindId: null,
        }
      }
    }
    return {
      name,
      color: AGENT_COLORS[i],
      personality: { ...PRESETS[DEFAULT_PRESETS[i]] },
      mindId: null,
    }
  })
}

function pickName(taken: string[], index: number): string {
  const available = RANDOM_NAMES.filter((n) => !taken.includes(n))
  return available[Math.floor(Math.random() * available.length)] ?? `Agent${index + 1}`
}

function randomCard(existing: CardState[], index: number): CardState {
  const name = pickName(existing.map((c) => c.name), index)
  return {
    name,
    color: existing[index].color,
    personality: randomPersonality(),
    mindId: existing[index].mindId,
  }
}

// Names must be threaded through sequentially — randomizing each card against
// the pre-randomize list lets two cards roll the same name.
function randomizeAll(prev: CardState[]): CardState[] {
  const taken: string[] = []
  return prev.map((card, i) => {
    const name = pickName(taken, i)
    taken.push(name)
    return { name, color: card.color, personality: randomPersonality(), mindId: card.mindId }
  })
}

function initialDays(): number {
  const raw = Number(new URLSearchParams(window.location.search).get("days"))
  if (Number.isFinite(raw) && raw >= MIN_SIM_DAYS && raw <= MAX_SIM_DAYS) return Math.floor(raw)
  return DEFAULT_SIM_END_DAY
}

const CUSTOM_MODEL = "__custom__"

function AiMindPanel({ minds, onMindsChange }: { minds: MindProfile[]; onMindsChange: () => void }) {
  const saved = loadAiSettings()
  const [provider, setProvider] = useState<AiProviderId>(saved?.provider ?? "zai")
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? PROVIDER_PRESETS[0].baseUrl)
  const [model, setModel] = useState(saved?.model ?? PROVIDER_PRESETS[0].models[0])
  const [apiKey, setApiKey] = useState(saved?.apiKey ?? "")
  const [status, setStatus] = useState<string>(
    saved ? "✓ using your key" : envKeyPresent() ? "using the .env z.ai key" : "no key — instinct mode"
  )

  const preset = PROVIDER_PRESETS.find((p) => p.id === provider)!
  // saved/edited models outside the curated list render as "Custom…"
  const useModelDropdown = preset.models.length > 0
  const modelInList = preset.models.includes(model)
  const [customModelMode, setCustomModelMode] = useState(useModelDropdown && !modelInList && model !== "")

  const pickProvider = (id: AiProviderId) => {
    const next = PROVIDER_PRESETS.find((p) => p.id === id)!
    setProvider(id)
    setBaseUrl(next.baseUrl)
    setModel(next.models[0] ?? "")
    setCustomModelMode(false)
  }

  const pickModel = (value: string) => {
    if (value === CUSTOM_MODEL) {
      setCustomModelMode(true)
      setModel("")
    } else {
      setCustomModelMode(false)
      setModel(value)
    }
  }

  const [testing, setTesting] = useState(false)

  const currentSettings = () => ({
    provider,
    baseUrl: baseUrl.trim(),
    model: model.trim(),
    apiKey: apiKey.trim(),
  })

  const formIncomplete = !apiKey.trim() || !baseUrl.trim() || !model.trim()

  const save = async () => {
    if (formIncomplete || testing) return
    const settings = currentSettings()
    setTesting(true)
    setStatus("⏳ testing the key with a real request…")
    try {
      await testConnection(settings)
      saveAiSettings(settings)
      setStatus("✓ key verified — saved as the default mind")
    } catch (error) {
      setStatus(`✗ not saved — ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setTesting(false)
    }
  }

  const addAsMind = async () => {
    if (formIncomplete || testing) return
    const settings = currentSettings()
    setTesting(true)
    setStatus("⏳ testing the key with a real request…")
    try {
      await testConnection(settings)
      addMind(settings)
      onMindsChange()
      setStatus(`✓ verified — added "${mindLabel(settings)}" to the minds list`)
    } catch (error) {
      setStatus(`✗ not added — ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setTesting(false)
    }
  }

  const reset = () => {
    clearAiSettings()
    setApiKey("")
    setStatus(envKeyPresent() ? "cleared — using the .env z.ai key" : "cleared — instinct mode")
  }

  return (
    <details className="ai-mind-panel panel">
      <summary>🧠 AI Mind — bring your own API key ({status})</summary>
      <div className="ai-mind-grid">
        <label>
          Provider
          <select value={provider} onChange={(e) => pickProvider(e.target.value as AiProviderId)}>
            {PROVIDER_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Model
          {useModelDropdown ? (
            <select value={customModelMode ? CUSTOM_MODEL : model} onChange={(e) => pickModel(e.target.value)}>
              {preset.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value={CUSTOM_MODEL}>Custom…</option>
            </select>
          ) : (
            <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="model id" />
          )}
        </label>
        {useModelDropdown && customModelMode && (
          <label className="ai-mind-wide">
            Custom model id
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="exact model id"
            />
          </label>
        )}
        {provider === "custom" && (
          <label className="ai-mind-wide">
            Base URL (OpenAI-compatible)
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
            />
          </label>
        )}
        <label className="ai-mind-wide">
          API key
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={preset.keyHint}
            autoComplete="off"
          />
        </label>
        <div className="ai-mind-actions">
          {provider === "zai" && (
            <button className="btn btn-small" onClick={save} disabled={formIncomplete || testing}>
              {testing ? "Testing…" : "Test & Save default"}
            </button>
          )}
          <button className="btn btn-small" onClick={addAsMind} disabled={formIncomplete || testing}>
            {testing ? "Testing…" : "＋ Add as agent mind"}
          </button>
          <button className="btn btn-small" onClick={reset}>
            Use .env default
          </button>
        </div>
        <div className="panel-hint ai-mind-wide">
          The default mind is always z.ai GLM. Other providers can be added as per-agent minds and
          assigned on the agent cards.
        </div>
        {minds.length > 0 && (
          <div className="minds-list ai-mind-wide">
            {minds.map((mind) => (
              <span key={mind.id} className="mind-chip">
                {mindLabel(mind)}
                <button
                  onClick={() => {
                    deleteMind(mind.id)
                    onMindsChange()
                  }}
                  aria-label={`Delete mind ${mindLabel(mind)}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="ai-mind-hint">
          Keys live only in this browser (localStorage) and travel through the local dev proxy. "Add as agent
          mind" lets each agent run on a different provider — pick minds per agent on the cards above. A run
          makes ~100–300 small calls per agent mind.
        </div>
      </div>
    </details>
  )
}

export default function SetupScreen() {
  const initSim = useSimStore((s) => s.initSim)
  const [cards, setCards] = useState<CardState[]>(initialCards)
  const [days, setDays] = useState<number>(initialDays)
  const [pastRuns, setPastRuns] = useState<number>(pastRunCount)
  const [minds, setMinds] = useState<MindProfile[]>(() => {
    loadAiSettings() // runs the demote-non-GLM-default migration before minds are read
    return listMinds()
  })

  const updateCard = (index: number, patch: Partial<CardState>) => {
    setCards((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)))
  }

  const addAgent = () => {
    setCards((prev) => {
      if (prev.length >= MAX_AGENTS) return prev
      const i = prev.length
      const name = pickName(prev.map((c) => c.name), i)
      return [
        ...prev,
        {
          name: DEFAULT_NAMES[i] && !prev.some((c) => c.name === DEFAULT_NAMES[i]) ? DEFAULT_NAMES[i] : name,
          color: AGENT_COLORS[i % AGENT_COLORS.length],
          personality: { ...PRESETS[DEFAULT_PRESETS[i % DEFAULT_PRESETS.length]] },
          mindId: null,
        },
      ]
    })
  }

  const removeAgent = (index: number) => {
    setCards((prev) => (prev.length <= MIN_AGENTS ? prev : prev.filter((_, i) => i !== index)))
  }

  const names = cards.map((c) => c.name.trim())
  const allNamed = names.every((n) => n.length >= 1 && n.length <= 12)
  const allUnique = new Set(names.map((n) => n.toLowerCase())).size === names.length
  const daysValid = days >= MIN_SIM_DAYS && days <= MAX_SIM_DAYS
  const valid = allNamed && allUnique && daysValid
  const error = !allNamed
    ? "Every agent needs a name (1–12 characters)."
    : !allUnique
      ? "Agent names must be unique."
      : !daysValid
        ? `Run length must be ${MIN_SIM_DAYS}–${MAX_SIM_DAYS} days.`
        : ""

  const start = () => {
    if (!valid) return
    initSim(
      cards.map((c) => ({
        name: c.name.trim(),
        color: c.color,
        personality: c.personality,
        mindId: c.mindId,
      })),
      days
    )
  }

  return (
    <div className="setup-screen">
      <h1 className="setup-title">TINY CIVILIZATION</h1>
      <p className="setup-subtitle">
        Four AI minds, one island, as many days as you choose. Configure their personalities and watch a society emerge.
      </p>
      {pastRuns > 0 && (
        <div className="memory-row">
          🔮 Agents remember {pastRuns} past {pastRuns === 1 ? "life" : "lives"} (matched by name)
          <button
            className="btn btn-small"
            onClick={() => {
              clearMemories()
              setPastRuns(0)
            }}
          >
            🗑 Forget past lives
          </button>
        </div>
      )}

      <div className="agent-cards">
        {cards.map((card, i) => {
          const presetName = matchPreset(card.personality) ?? "Custom"
          return (
            <div
              key={i}
              className="agent-card panel"
              style={{ "--card-color": card.color } as React.CSSProperties}
            >
              <div>
                <label>Name</label>
                <input
                  type="text"
                  maxLength={12}
                  value={card.name}
                  onChange={(e) => updateCard(i, { name: e.target.value })}
                />
              </div>

              <div>
                <label>Preset</label>
                <select
                  value={presetName}
                  onChange={(e) => {
                    const preset = PRESETS[e.target.value]
                    if (preset) updateCard(i, { personality: { ...preset } })
                  }}
                >
                  {Object.keys(PRESETS).map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                  <option value="Custom" disabled>
                    Custom
                  </option>
                </select>
              </div>

              <div>
                {TRAITS.map((trait) => (
                  <div className="slider-row" key={trait}>
                    <span style={{ textTransform: "capitalize" }}>{trait}</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={card.personality[trait]}
                      onChange={(e) =>
                        updateCard(i, {
                          personality: { ...card.personality, [trait]: Number(e.target.value) },
                        })
                      }
                    />
                    <span className="slider-value">{card.personality[trait]}</span>
                  </div>
                ))}
              </div>

              <div>
                <label>Mind</label>
                <select
                  value={card.mindId ?? ""}
                  onChange={(e) => updateCard(i, { mindId: e.target.value || null })}
                >
                  <option value="">Default mind</option>
                  {minds.map((mind) => (
                    <option key={mind.id} value={mind.id}>
                      {mindLabel(mind)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label>Color</label>
                <div className="color-swatches">
                  {AGENT_COLORS.map((color) => (
                    <button
                      key={color}
                      className={`color-swatch ${card.color === color ? "selected" : ""}`}
                      style={{ background: color }}
                      onClick={() => updateCard(i, { color })}
                      aria-label={`Set color ${color}`}
                    />
                  ))}
                </div>
              </div>

              <button className="btn btn-small" onClick={() => setCards((prev) => prev.map((c, j) => (j === i ? randomCard(prev, i) : c)))}>
                🎲 Randomize Agent
              </button>
              {cards.length > MIN_AGENTS && (
                <button
                  className="btn btn-small card-remove"
                  onClick={() => removeAgent(i)}
                  aria-label={`Remove agent ${card.name}`}
                >
                  ✕ Remove
                </button>
              )}
            </div>
          )
        })}
        {cards.length < MAX_AGENTS && (
          <button className="add-agent-card panel" onClick={addAgent} aria-label="Add agent">
            ＋<br />
            Add agent
          </button>
        )}
      </div>

      {pastRuns > 0 && (
        <details className="chronicle-panel panel">
          <summary>📜 Chronicle — the island's past lives</summary>
          {listRuns()
            .slice()
            .reverse()
            .map((run) => (
              <div key={run.runNumber} className="chronicle-run">
                <h4>
                  Life #{run.runNumber} — {run.endedDay} days
                </h4>
                {Object.entries(run.perAgent).map(([name, lines]) => (
                  <div key={name}>
                    <b>{name[0].toUpperCase() + name.slice(1)}:</b> {lines.join("; ")}
                  </div>
                ))}
              </div>
            ))}
        </details>
      )}

      <AiMindPanel minds={minds} onMindsChange={() => setMinds(listMinds())} />

      <div className="setup-actions">
        <div className="days-row">
          <label htmlFor="sim-days">Run length</label>
          <input
            id="sim-days"
            type="number"
            min={MIN_SIM_DAYS}
            max={MAX_SIM_DAYS}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
          <span>days</span>
          <span className="days-hint">
            ≈ {days / 2 >= 90 ? `${Math.round(days / 120)} min` : `${Math.round(days / 2)}s`} at 1× speed
          </span>
        </div>
        <button className="btn" onClick={() => setCards(randomizeAll)}>
          🎲 Randomize All
        </button>
        <button className="btn-primary btn" disabled={!valid} onClick={start}>
          ▶ Start Simulation
        </button>
        <div className="setup-error">{error}</div>
      </div>
    </div>
  )
}

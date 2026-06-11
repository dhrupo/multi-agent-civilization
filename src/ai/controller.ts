import type { Agent, AiPlan, AiStance, AiStrategy, SimState } from "../types"
import {
  AI_CONVO_CHANCE,
  AI_CONVO_COOLDOWN_DAYS,
  AI_MAX_CONCURRENT,
  AI_BREAKER_COOLDOWN_MS,
  AI_MAX_FAILURES,
  AI_MIN_REQUEST_INTERVAL_MS,
  AI_PLAN_INTERVAL_DAYS,
  INTERACTION_RANGE,
  NEGOTIATED_TRADE_MAX_PER_RESOURCE,
  STORAGE_PROTECTED_FOOD,
} from "../constants"
import { distance } from "../simulation/world"
import { attackJustification } from "../simulation/actions"
import { getAgentBase } from "../simulation/buildings"
import { getSeason, seasonDay } from "../simulation/seasons"
import { aiAvailable, chatJSON, RateLimitError, type ChatMessage } from "./client"
import { memoriesForAgent } from "./memory"
import { mindById } from "./settings"

export type ConversationLine = { speakerId: string; text: string }

export type NegotiatedTrade = {
  aGives: { food: number; wood: number; stone: number }
  bGives: { food: number; wood: number; stone: number }
}

// The store implements this bridge; every apply re-checks runId so responses
// that arrive after a restart or game end are discarded.
export type AiBridge = {
  getState: () => SimState
  runId: () => number
  applyPlan: (runId: number, agentId: string, plan: AiPlan) => void
  applyConversation: (
    runId: number,
    aId: string,
    bId: string,
    lines: ConversationLine[],
    deltaA: number,
    deltaB: number,
    trade: NegotiatedTrade | null
  ) => void
  notifyAiDisabled: (reason: string) => void
}

const STRATEGIES: AiStrategy[] = [
  "gather",
  "build",
  "trade",
  "aggress",
  "avoid",
  "socialize",
  "survive",
  "help",
  "reconcile",
]
const STANCES: AiStance[] = ["ally", "neutral", "enemy"]

let currentRunId = -1
let pendingPlans = new Set<string>()
let pendingConvos = new Set<string>()
let lastConvoDay = new Map<string, number>()
let inFlight = 0
// Backoff and failure tracking are PER MIND: one provider's outage or rate
// limit must never silence agents running on a different provider.
let failuresByMind = new Map<string, number>()
let backoffByMind = new Map<string, number>() // mind key → resume timestamp (ms)
let lastRequestByMind = new Map<string, number>() // proactive pacing per mind
// Adaptive pacing: each 429 widens the interval, each success narrows it —
// the controller learns whatever ceiling the user's key actually has.
let paceByMind = new Map<string, number>()
const PACE_MAX_MS = 10_000

function currentPace(key: string): number {
  return paceByMind.get(key) ?? AI_MIN_REQUEST_INTERVAL_MS
}

function paceUp(key: string): void {
  paceByMind.set(key, Math.min(PACE_MAX_MS, currentPace(key) * 1.7))
}

function paceDown(key: string): void {
  paceByMind.set(key, Math.max(AI_MIN_REQUEST_INTERVAL_MS, currentPace(key) * 0.95))
}

function mindKey(agent: Agent): string {
  return agent.mindId ?? "default"
}

function mindResting(key: string): boolean {
  return Date.now() < (backoffByMind.get(key) ?? 0)
}

// Pacing: don't fire faster than the provider's comfort — prevention over recovery
function mindPaced(key: string): boolean {
  return Date.now() - (lastRequestByMind.get(key) ?? 0) < currentPace(key)
}

function markRequest(key: string): void {
  lastRequestByMind.set(key, Date.now())
}

export function resetAi(runId: number): void {
  currentRunId = runId
  pendingPlans = new Set()
  pendingConvos = new Set()
  lastConvoDay = new Map()
  inFlight = 0
  failuresByMind = new Map()
  backoffByMind = new Map()
  lastRequestByMind = new Map()
  paceByMind = new Map()
}

export type AiStatus = "off" | "live" | "resting"

// "resting" only when every mind currently in backoff covers the board —
// if at least one mind can think, the AI is live.
export function getAiStatus(): AiStatus {
  if (!aiAvailable()) return "off"
  const restingKeys = [...backoffByMind.entries()].filter(([, until]) => Date.now() < until)
  if (restingKeys.length === 0) return "live"
  // any mind not currently resting → live
  const allKeys = new Set(["default", ...restingKeys.map(([k]) => k)])
  for (const key of allKeys) {
    if (!mindResting(key)) return "live"
  }
  return "resting"
}

// --- Prompts ---

function personaSystem(agent: Agent): string {
  const p = agent.personality
  return (
    `You are ${agent.name}, a person living on a small island with 3 others — a tiny civilization. ` +
    `Your personality (0-100): aggression ${p.aggression}, greed ${p.greed}, cooperation ${p.cooperation}, curiosity ${p.curiosity}. ` +
    `Behave like a real human in a society. You have a home base and a territory you feel protective of. ` +
    `Violence is a LAST RESORT: you may only turn aggressive with a genuine reason — revenge for a listed grievance, ` +
    `defense of your home, or true desperation. Unprovoked violence makes the whole island despise you, ` +
    `defenders fight back, and fighting exhausts you. Even very aggressive people need a cause. ` +
    `You may form alliances and honor them, share food with the needy, trade fairly or drive hard bargains, ` +
    `conspire with one neighbor against a common threat, hold grudges, forgive, or seek revenge — ` +
    `including for what happened in your past lives. Endless fruitless wars EXHAUST you — after enough swings ` +
    `without victory you lose the stomach to keep fighting that person. Trade is PROFITABLE: both sides come out ahead, ` +
    `so trading partners grow rich together while loners stay poor. Feuds can be ENDED: offer reparations ` +
    `("reconcile") to settle a grudge someone holds against you — endless war exhausts and impoverishes everyone. ` +
    `In a catastrophe, humans usually help even rivals; sheltering NEAR another person protects you both in a storm; ` +
    `survival together beats dying alone. There is one winner at the end, but the dead win nothing. ` +
    `Respond ONLY with minified JSON, no prose.`
  )
}

function grievanceBrief(agent: Agent, state: SimState): string {
  const held = state.agents
    .filter((a) => a.id !== agent.id)
    .map((a) => {
      const score = attackJustification(agent, a)
      const reasons = agent.grievances[a.id]?.reasons.join(", ")
      return score > 0 ? `- vs ${a.name}: ${score}/100${reasons ? ` (${reasons})` : " (desperation)"}` : null
    })
    .filter(Boolean)
  const against = state.agents
    .filter((a) => a.id !== agent.id && (a.grievances[agent.id]?.score ?? 0) > 10)
    .map((a) => `- ${a.name} resents you: ${a.grievances[agent.id]!.reasons.join(", ")}`)
  let out = `Your grievances (you may only choose "aggress" against someone listed at 25+):\n${held.length ? held.join("\n") : "- none — you have NO justification for violence right now"}`
  if (against.length) out += `\nGrudges held against you:\n${against.join("\n")}`
  const weary = state.agents
    .filter((a) => a.id !== agent.id && (agent.warWeariness[a.id] ?? 0) > 10)
    .map((a) => `- ${a.name}${(agent.warWeariness[a.id] ?? 0) > 20 ? " (utterly exhausted — you cannot keep fighting them)" : ""}`)
  if (weary.length) out += `\nWar-weariness — you are tired of fighting:\n${weary.join("\n")}`
  return out
}

function pastLives(agent: Agent): string {
  const memories = memoriesForAgent(agent.name)
  if (memories.length === 0) return ""
  return `\nYou remember your PAST LIVES on this island (earlier runs):\n${memories
    .map((m) => `- ${m}`)
    .join("\n")}\nOld trust, grudges and debts may carry over — your choice.\n`
}

function describeOthers(agent: Agent, state: SimState): string {
  return state.agents
    .filter((a) => a.id !== agent.id)
    .map((a) => {
      if (!a.isAlive) return `- ${a.name}: DEAD (died day ${a.deathDay})`
      const rel = agent.relationships[a.id] ?? 0
      return `- ${a.name}: ${distance(agent, a)} tiles away, health ${Math.round(a.health)}, your relationship with them ${rel} (-100 hostile..+100 close)`
    })
    .join("\n")
}

function recentEventsFor(agent: Agent, state: SimState, limit: number): string {
  const mine = state.events.filter((e) => e.involvedIds.includes(agent.id)).slice(-limit)
  if (mine.length === 0) return "- nothing notable yet"
  return mine.map((e) => `- Day ${e.day}: ${e.text}`).join("\n")
}

function buildPlanMessages(agent: Agent, state: SimState): ChatMessage[] {
  const owned = state.buildings.filter((b) => b.ownerId === agent.id).map((b) => b.type)
  const base = getAgentBase(agent, state.buildings)
  const baseLine = base
    ? `Your base: ${base.hp}/100 hp at (${base.x},${base.y}); your territory surrounds it.`
    : `Your base was DESTROYED — rebuild one (6 wood, 2 stone) to reclaim a home.`
  const cat = state.catastrophe
    ? `\n⚠️ ONGOING CATASTROPHE: a ${state.catastrophe.type} (until day ${state.catastrophe.endDay}). Everyone is suffering — people can DIE in this. ${state.catastrophe.type === "storm" ? "Sheltering near another person halves the storm's toll on you both. " : ""}Helping others now forges lasting bonds; violence now is despised.\n`
    : ""
  const prev = agent.aiPlan
    ? `Your previous strategy: ${agent.aiPlan.strategy}${agent.aiPlan.targetId ? ` targeting ${state.agents.find((a) => a.id === agent.aiPlan!.targetId)?.name}` : ""} ("${agent.aiPlan.thought}")`
    : "You have no strategy yet."
  const names = state.agents.filter((a) => a.id !== agent.id && a.isAlive).map((a) => a.name)

  const season = getSeason(state.day)
  const seasonNote =
    season === "winter"
      ? "It is WINTER (day " + seasonDay(state.day) + "/30): food barely regrows and hunger bites harder — live off your stores."
      : season === "autumn"
        ? "It is AUTUMN: winter is coming — stockpile food now."
        : `It is ${season.toUpperCase()}: food regrows ${season === "summer" ? "fast" : "well"}.`

  const user = `Day ${state.day} of ${state.endDay}. ${seasonNote}
Your status: health ${Math.round(agent.health)}/100, hunger ${Math.round(agent.hunger)}/100 (100 = starving to death), energy ${Math.round(agent.energy)}/100.
Inventory: food ${agent.inventory.food}, wood ${agent.inventory.wood}, stone ${agent.inventory.stone}. Buildings you own: ${owned.length ? owned.join(", ") : "none"}.
${baseLine}
Score = resources + buildings(20pts each) + health. Highest score on day ${state.endDay} wins.
${cat}
Other agents:
${describeOthers(agent, state)}

${grievanceBrief(agent, state)}

Events you remember from this life:
${recentEventsFor(agent, state, 8)}
${pastLives(agent)}
${prev}

Choose your strategy for the next ~${planHorizonDays(state)} days.
- "gather": stockpile resources. "build": gather wood/stone and construct — a STORAGE locks ${STORAGE_PROTECTED_FOOD} food away from thieves. "trade": exchanges where BOTH sides profit — compounding wealth.
- "aggress": march on a target's base to raid/fight — ONLY with a listed grievance of 25+. "avoid": keep distance from a threat.
- "socialize": befriend someone. "survive": recover health/food. "help": share food with whoever is struggling (builds deep trust).
- "reconcile": bring reparations (costs food — and MORE each time you re-offend against the same person; serial apologies also get refused) to someone who deeply resents you (30+).
Reply with JSON only:
{"strategy":"gather|build|trade|aggress|avoid|socialize|survive|help|reconcile","target":${names.length ? `"${names.join('"|"')}"` : "null"} or null,"stances":{${names.map((n) => `"${n}":"ally|neutral|enemy"`).join(",")}},"thought":"first-person, in character, max 25 words"}`

  return [
    { role: "system", content: personaSystem(agent) },
    { role: "user", content: user },
  ]
}

// Cross-mind dialogue, turn 1: the initiator's OWN mind writes only its lines
function buildConvoOpenMessages(a: Agent, b: Agent, state: SimState): ChatMessage[] {
  const rel = a.relationships[b.id] ?? 0
  const memories = memoriesForAgent(a.name)
  const cat = state.catastrophe ? `A ${state.catastrophe.type} is ravaging the island. ` : ""
  const user = `Day ${state.day}. ${cat}You run into ${b.name} (your relationship with them: ${rel}, -100 hostile..+100 close).
Recent events you remember:
${recentEventsFor(a, state, 6)}
${memories.length ? `Your past lives: ${memories.join(" ")}` : ""}

Say 1-2 lines to ${b.name}, each max 18 words, fully in character. You may propose a deal,
warn them about someone who wronged you, or vouch for a friend.
Reply with JSON only: {"lines":[{"speaker":"${a.name}","text":"..."}]}`
  return [
    { role: "system", content: personaSystem(a) },
    { role: "user", content: user },
  ]
}

// Cross-mind dialogue, turn 2: the responder's mind replies and judges the exchange
function buildConvoReplyMessages(
  a: Agent,
  b: Agent,
  state: SimState,
  opening: ConversationLine[]
): ChatMessage[] {
  const rel = b.relationships[a.id] ?? 0
  const memories = memoriesForAgent(b.name)
  const said = opening.map((l) => `"${l.text}"`).join(" ")
  const user = `Day ${state.day}. ${a.name} (your relationship with them: ${rel}) approaches you and says: ${said}
Recent events you remember:
${recentEventsFor(b, state, 6)}
${memories.length ? `Your past lives: ${memories.join(" ")}` : ""}

Reply with 1-2 lines, each max 18 words, fully in character. Then judge how the whole exchange shifts feelings (-15..15).
If a deal was struck, include it — fair or shrewd as your character dictates (max ${NEGOTIATED_TRADE_MAX_PER_RESOURCE} per resource); omit "trade" if none.
Your inventory: food ${b.inventory.food}, wood ${b.inventory.wood}, stone ${b.inventory.stone}. Theirs: food ${a.inventory.food}, wood ${a.inventory.wood}, stone ${a.inventory.stone}.
Reply with JSON only: {"lines":[{"speaker":"${b.name}","text":"..."}],"deltaA":0,"deltaB":0,"trade":{"aGives":{"food":0,"wood":0,"stone":0},"bGives":{"food":0,"wood":0,"stone":0}}}
deltaA = change in how ${a.name} feels toward ${b.name}; deltaB = change in how YOU feel toward ${a.name}; aGives = what ${a.name} hands over.`
  return [
    { role: "system", content: personaSystem(b) },
    { role: "user", content: user },
  ]
}

function buildConvoMessages(a: Agent, b: Agent, state: SimState): ChatMessage[] {
  const relAB = a.relationships[b.id] ?? 0
  const relBA = b.relationships[a.id] ?? 0
  const pa = a.personality
  const pb = b.personality

  const system =
    `You write short in-character dialogue for a survival simulation. ` +
    `${a.name} (aggression ${pa.aggression}, greed ${pa.greed}, cooperation ${pa.cooperation}) feels ${relAB} toward ${b.name} (-100 hostile..+100 close). ` +
    `${b.name} (aggression ${pb.aggression}, greed ${pb.greed}, cooperation ${pb.cooperation}) feels ${relBA} toward ${a.name}. ` +
    `Dialogue can be friendly, transactional, tense, conspiratorial, or openly threatening — follow the personalities and history. ` +
    `They lived past lives together on this island and may bring up old alliances, betrayals, and deaths. Respond ONLY with minified JSON.`

  const aMemories = memoriesForAgent(a.name)
  const bMemories = memoriesForAgent(b.name)
  const past =
    aMemories.length || bMemories.length
      ? `\nPast lives — ${a.name}: ${aMemories.join(" ") || "none"}\nPast lives — ${b.name}: ${bMemories.join(" ") || "none"}`
      : ""

  const cat = state.catastrophe
    ? `A ${state.catastrophe.type} is ravaging the island — both are suffering through it.\n`
    : ""
  const user = `Day ${state.day}. They meet on the island.
${cat}${a.name}: health ${Math.round(a.health)}, food ${a.inventory.food}. ${b.name}: health ${Math.round(b.health)}, food ${b.inventory.food}.
Recent history between them (this life):
${recentEventsFor(a, state, 6)}${past}

Write a 2-4 line exchange, each line max 18 words — they may deal, warn each other about others, or vouch for friends.
Then decide how the exchange shifts each one's feelings (-15..15). If they strike a deal, include it (max ${NEGOTIATED_TRADE_MAX_PER_RESOURCE} per resource); omit "trade" if none.
${a.name}'s inventory: food ${a.inventory.food}, wood ${a.inventory.wood}, stone ${a.inventory.stone}. ${b.name}'s: food ${b.inventory.food}, wood ${b.inventory.wood}, stone ${b.inventory.stone}.
Reply with JSON only:
{"lines":[{"speaker":"${a.name}","text":"..."},{"speaker":"${b.name}","text":"..."}],"deltaA":0,"deltaB":0,"trade":{"aGives":{"food":0,"wood":0,"stone":0},"bGives":{"food":0,"wood":0,"stone":0}}}
deltaA = change in how ${a.name} feels toward ${b.name}; deltaB = the reverse; aGives = what ${a.name} hands over.`

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ]
}

// --- Parsing (defensive: the model output is untrusted) ---

// Plan cadence scales with population: one shared mind serving 8 agents would
// flood the provider at the 4-agent cadence
function planHorizonDays(state: SimState): number {
  const living = state.agents.filter((a) => a.isAlive).length
  return Math.round(AI_PLAN_INTERVAL_DAYS * Math.max(1, living / 4))
}

function agentIdByName(state: SimState, name: unknown): string | null {
  if (typeof name !== "string") return null
  return state.agents.find((a) => a.name.toLowerCase() === name.trim().toLowerCase())?.id ?? null
}

function parsePlan(raw: unknown, agent: Agent, state: SimState): AiPlan {
  const obj = (raw ?? {}) as Record<string, unknown>
  let strategy = STRATEGIES.includes(obj.strategy as AiStrategy) ? (obj.strategy as AiStrategy) : "gather"
  const targetId = agentIdByName(state, obj.target)

  // No casus belli, no war: an aggress plan without real justification is wishful
  // thinking — the model is downgraded to defensive posture instead.
  if (strategy === "aggress") {
    const target = state.agents.find((a) => a.id === targetId)
    if (!target || attackJustification(agent, target) < 15) {
      strategy = "gather"
    }
  }

  const stances: Record<string, AiStance> = {}
  const rawStances = (obj.stances ?? {}) as Record<string, unknown>
  for (const [name, stance] of Object.entries(rawStances)) {
    const id = agentIdByName(state, name)
    if (id && id !== agent.id && STANCES.includes(stance as AiStance)) {
      stances[id] = stance as AiStance
    }
  }

  return {
    strategy,
    targetId: targetId !== agent.id ? targetId : null,
    stances,
    thought: typeof obj.thought === "string" ? obj.thought.slice(0, 140) : "...",
    decidedOnDay: state.day,
    validUntilDay: state.day + planHorizonDays(state),
  }
}

function clampDelta(value: unknown): number {
  const n = typeof value === "number" ? value : 0
  return Math.max(-15, Math.min(15, Math.round(n)))
}

function clampGives(raw: unknown): { food: number; wood: number; stone: number } {
  const obj = (raw ?? {}) as Record<string, unknown>
  const take = (v: unknown) =>
    Math.max(0, Math.min(NEGOTIATED_TRADE_MAX_PER_RESOURCE, Math.round(typeof v === "number" ? v : 0)))
  return { food: take(obj.food), wood: take(obj.wood), stone: take(obj.stone) }
}

function parseTrade(raw: unknown): NegotiatedTrade | null {
  const obj = (raw ?? {}) as Record<string, unknown>
  if (!obj.trade || typeof obj.trade !== "object") return null
  const t = obj.trade as Record<string, unknown>
  const trade = { aGives: clampGives(t.aGives), bGives: clampGives(t.bGives) }
  const total =
    trade.aGives.food + trade.aGives.wood + trade.aGives.stone +
    trade.bGives.food + trade.bGives.wood + trade.bGives.stone
  return total > 0 ? trade : null
}

// --- Orchestration ---

function recordFailure(bridge: AiBridge, error: unknown, key: string): void {
  if (error instanceof RateLimitError) {
    // back off this mind only and resume automatically — throttling, not a fault.
    // Also widen this mind's pacing so the post-rest resume doesn't re-trip the limit.
    paceUp(key)
    backoffByMind.set(key, Math.max(backoffByMind.get(key) ?? 0, Date.now() + error.retryAfterMs))
    console.warn(
      `[ai] ${key} throttled; resting ${Math.round(error.retryAfterMs / 1000)}s, pace now ${(currentPace(key) / 1000).toFixed(1)}s`
    )
    return
  }
  const failures = (failuresByMind.get(key) ?? 0) + 1
  failuresByMind.set(key, failures)
  console.error(`[ai] ${key} request failed:`, error)
  if (failures >= AI_MAX_FAILURES) {
    failuresByMind.set(key, 0)
    backoffByMind.set(key, Date.now() + AI_BREAKER_COOLDOWN_MS)
    bridge.notifyAiDisabled(error instanceof Error ? error.message : String(error))
  }
}

function firePlanRequest(bridge: AiBridge, runId: number, agent: Agent, state: SimState): void {
  const key = mindKey(agent)
  pendingPlans.add(agent.id)
  markRequest(key)
  inFlight++
  chatJSON(buildPlanMessages(agent, state), 1500, mindById(agent.mindId))
    .then((raw) => {
      failuresByMind.set(key, 0)
      paceDown(key)
      if (bridge.runId() !== runId) return
      const plan = parsePlan(raw, agent, bridge.getState())
      bridge.applyPlan(runId, agent.id, plan)
    })
    .catch((error) => recordFailure(bridge, error, key))
    .finally(() => {
      inFlight--
      pendingPlans.delete(agent.id)
    })
}

function pairKey(aId: string, bId: string): string {
  return [aId, bId].sort().join(":")
}

function parseLines(raw: unknown, state: SimState, fallbackSpeakerId: string): ConversationLine[] {
  const obj = (raw ?? {}) as Record<string, unknown>
  const rawLines = Array.isArray(obj.lines) ? obj.lines : []
  return rawLines
    .map((l) => {
      const line = (l ?? {}) as Record<string, unknown>
      const speakerId = agentIdByName(state, line.speaker) ?? fallbackSpeakerId
      return typeof line.text === "string" ? { speakerId, text: line.text.slice(0, 160) } : null
    })
    .filter((l): l is ConversationLine => l !== null)
    .slice(0, 4)
}

function fireConvoRequest(bridge: AiBridge, runId: number, a: Agent, b: Agent, state: SimState): void {
  const key = pairKey(a.id, b.id)
  const mindA = mindKey(a)
  const mindB = mindKey(b)
  pendingConvos.add(key)
  lastConvoDay.set(key, state.day)
  markRequest(mindA)
  inFlight++

  const sameMind = mindA === mindB

  const exchange = async () => {
    if (sameMind) {
      // one mind writes the whole scene
      const raw = await chatJSON(buildConvoMessages(a, b, state), 1200, mindById(a.mindId))
      failuresByMind.set(mindA, 0)
      paceDown(mindA)
      if (bridge.runId() !== runId) return
      const obj = (raw ?? {}) as Record<string, unknown>
      const lines = parseLines(raw, bridge.getState(), a.id)
      if (lines.length === 0) return
      bridge.applyConversation(
        runId, a.id, b.id, lines,
        clampDelta(obj.deltaA), clampDelta(obj.deltaB), parseTrade(raw)
      )
      return
    }

    // true model-vs-model dialogue: each agent's own mind writes its lines
    const openRaw = await chatJSON(buildConvoOpenMessages(a, b, state), 800, mindById(a.mindId))
    failuresByMind.set(mindA, 0)
    paceDown(mindA)
    if (bridge.runId() !== runId) return
    const opening = parseLines(openRaw, bridge.getState(), a.id).map((l) => ({ ...l, speakerId: a.id }))
    if (opening.length === 0) return

    markRequest(mindB)
    const replyRaw = await chatJSON(buildConvoReplyMessages(a, b, bridge.getState(), opening), 1000, mindById(b.mindId))
    failuresByMind.set(mindB, 0)
    paceDown(mindB)
    if (bridge.runId() !== runId) return
    const replyObj = (replyRaw ?? {}) as Record<string, unknown>
    const reply = parseLines(replyRaw, bridge.getState(), b.id).map((l) => ({ ...l, speakerId: b.id }))
    bridge.applyConversation(
      runId,
      a.id,
      b.id,
      [...opening, ...reply],
      clampDelta(replyObj.deltaA),
      clampDelta(replyObj.deltaB),
      parseTrade(replyRaw)
    )
  }

  exchange()
    .catch((error) => recordFailure(bridge, error, mindA))
    .finally(() => {
      inFlight--
      pendingConvos.delete(key)
    })
}

// Called by the store after every tick. Cheap when nothing is due.
export function aiTick(bridge: AiBridge): void {
  if (!aiAvailable()) return
  const runId = bridge.runId()
  if (runId !== currentRunId) resetAi(runId)
  const state = bridge.getState()
  if (state.phase !== "running") return

  const runPlans = () => {
    // strategic plans (skip agents whose mind is resting or paced — others continue)
    for (const agent of state.agents) {
      if (inFlight >= AI_MAX_CONCURRENT) return
      const key = mindKey(agent)
      if (!agent.isAlive || pendingPlans.has(agent.id) || mindResting(key) || mindPaced(key)) continue
      const due = !agent.aiPlan || state.day >= agent.aiPlan.validUntilDay || agent.needsReplan
      if (due) firePlanRequest(bridge, runId, agent, state)
    }
  }

  const runConvos = () => {
    // conversations between nearby agents
    const living = state.agents.filter((a) => a.isAlive)
    for (let i = 0; i < living.length; i++) {
      for (let j = i + 1; j < living.length; j++) {
        if (inFlight >= AI_MAX_CONCURRENT) return
        const a = living[i]
        const b = living[j]
        if (mindResting(mindKey(a)) || mindPaced(mindKey(a))) continue
        if (distance(a, b) > INTERACTION_RANGE) continue
        const key = pairKey(a.id, b.id)
        if (pendingConvos.has(key)) continue
        const last = lastConvoDay.get(key)
        if (last !== undefined && state.day - last < AI_CONVO_COOLDOWN_DAYS) continue
        if (Math.random() > AI_CONVO_CHANCE) {
          // missed the moment: brief per-day cooldown so this pair isn't re-rolled every tick
          lastConvoDay.set(key, state.day - AI_CONVO_COOLDOWN_DAYS + 2)
          continue
        }
        fireConvoRequest(bridge, runId, a, b, state)
      }
    }
  }

  // alternate priority so plan demand can't starve conversations of pacing slots
  if (state.tick % 2 === 0) {
    runPlans()
    runConvos()
  } else {
    runConvos()
    runPlans()
  }
}

import { create } from "zustand"
import type { AgentConfig, AiPlan, EventLogEntry, SimState } from "../types"
import { AGENT_COLORS, DEFAULT_SIM_END_DAY, MAX_STORED_EVENTS, TICK_MS_BASE } from "../constants"
import { createAgent } from "../simulation/agent"
import { generateWorld, getSpawnPositions } from "../simulation/world"
import { placeStartingBase } from "../simulation/buildings"
import { runTick } from "../simulation/tick"
import { addGrievance, updateRelationship } from "../simulation/relationships"
import { aiTick, type AiBridge, type ConversationLine, type NegotiatedTrade } from "../ai/controller"
import { saveRunMemory } from "../ai/memory"
import {
  GOSSIP_GRIEVANCE_MIN,
  GOSSIP_REL_PENALTY,
  GOSSIP_TRANSFER,
  GOSSIP_TRANSFER_CAP,
  GOSSIP_VOUCH_GAIN,
  GOSSIP_VOUCH_MIN,
  TRADE_BONUS,
} from "../constants"

const DEFAULT_SPEED = 1

function freshSimState(configs: AgentConfig[], endDay: number): SimState {
  const tiles = generateWorld()
  const spawns = getSpawnPositions(tiles, configs.length)
  const agents = configs.map((cfg, i) => {
    const agent = createAgent(`a${i + 1}`, cfg.name, cfg.color || AGENT_COLORS[i], cfg.personality, spawns[i])
    agent.mindId = cfg.mindId ?? null
    return agent
  })
  for (const a of agents) {
    for (const b of agents) {
      if (a.id !== b.id) a.relationships[b.id] = 0
    }
  }
  const buildings: SimState["buildings"] = []
  for (const agent of agents) {
    placeStartingBase(agent, tiles, buildings)
  }
  return {
    phase: "running",
    day: 0,
    endDay,
    tick: 0,
    speed: DEFAULT_SPEED,
    isPaused: false,
    agents,
    tiles,
    buildings,
    events: [],
    selectedAgentId: null,
    winner: null,
    catastrophe: null,
    lastCatastropheEnd: 0,
    catastropheCount: 0,
    scoreHistory: {},
    societyHistory: [],
  }
}

type SimStore = {
  state: SimState
  agentConfigs: AgentConfig[]
  simDays: number

  initSim: (configs: AgentConfig[], days: number) => void
  startSim: () => void
  stopSim: () => void
  pauseSim: () => void
  resumeSim: () => void
  setSpeed: (speed: 1 | 2) => void
  restartSim: () => void
  backToSetup: () => void
  selectAgent: (id: string | null) => void
  tick: () => void
}

let intervalRef: ReturnType<typeof setInterval> | null = null
let aiRunId = 0
let aiEventCounter = 0

function aiEvent(day: number, text: string, weight: number, involvedIds: string[]): EventLogEntry {
  return { id: `ai${++aiEventCounter}`, day, text, weight, involvedIds }
}

function appendEvents(state: SimState, events: EventLogEntry[]): EventLogEntry[] {
  const all = [...state.events, ...events]
  const overflow = all.length - MAX_STORED_EVENTS
  return overflow > 0
    ? [...all.slice(0, overflow).filter((e) => e.weight === 3), ...all.slice(overflow)]
    : all
}

export const useSimStore = create<SimStore>((set, get) => ({
  state: {
    phase: "setup",
    day: 0,
    endDay: DEFAULT_SIM_END_DAY,
    tick: 0,
    speed: DEFAULT_SPEED,
    isPaused: false,
    agents: [],
    tiles: [],
    buildings: [],
    events: [],
    selectedAgentId: null,
    winner: null,
    catastrophe: null,
    lastCatastropheEnd: 0,
    catastropheCount: 0,
    scoreHistory: {},
    societyHistory: [],
  },
  agentConfigs: [],
  simDays: DEFAULT_SIM_END_DAY,

  initSim: (configs, days) => {
    aiRunId++
    set({ state: freshSimState(configs, days), agentConfigs: configs, simDays: days })
    get().startSim()
  },

  startSim: () => {
    get().stopSim()
    intervalRef = setInterval(() => get().tick(), TICK_MS_BASE / get().state.speed)
  },

  stopSim: () => {
    if (intervalRef) {
      clearInterval(intervalRef)
      intervalRef = null
    }
  },

  pauseSim: () => {
    get().stopSim()
    set((s) => ({ state: { ...s.state, isPaused: true } }))
  },

  resumeSim: () => {
    set((s) => ({ state: { ...s.state, isPaused: false } }))
    get().startSim()
  },

  setSpeed: (speed) => {
    set((s) => ({ state: { ...s.state, speed } }))
    if (!get().state.isPaused && get().state.phase === "running") {
      get().startSim()
    }
  },

  restartSim: () => {
    const configs = get().agentConfigs
    if (configs.length === 0) return
    aiRunId++
    set({ state: freshSimState(configs, get().simDays) })
    get().startSim()
  },

  backToSetup: () => {
    get().stopSim()
    set((s) => ({ state: { ...s.state, phase: "setup", agents: [], winner: null } }))
  },

  selectAgent: (id) => {
    set((s) => ({ state: { ...s.state, selectedAgentId: id } }))
  },

  tick: () => {
    const next = runTick(get().state)
    set({ state: next })
    if (next.phase === "ended") {
      get().stopSim()
      saveRunMemory(next) // agents will remember this life next run
      return
    }
    aiTick(aiBridge)
  },
}))

// --- AI bridge: lets async LLM responses mutate the running sim safely ---

const aiBridge: AiBridge = {
  getState: () => useSimStore.getState().state,
  runId: () => aiRunId,

  applyPlan: (runId: number, agentId: string, plan: AiPlan) => {
    if (runId !== aiRunId) return
    useSimStore.setState((s) => {
      if (s.state.phase !== "running") return s
      const agent = s.state.agents.find((a) => a.id === agentId)
      if (!agent || !agent.isAlive) return s

      const events: EventLogEntry[] = []
      const targetName = plan.targetId
        ? s.state.agents.find((a) => a.id === plan.targetId)?.name
        : null
      if (plan.strategy === "aggress" && targetName) {
        events.push(
          aiEvent(s.state.day, `🧠 ${agent.name} is plotting against ${targetName}: "${plan.thought}"`, 3, [
            agentId,
            plan.targetId!,
          ])
        )
      } else if (plan.strategy !== agent.aiPlan?.strategy) {
        events.push(
          aiEvent(s.state.day, `🧠 ${agent.name} (${plan.strategy}): "${plan.thought}"`, 2, [agentId])
        )
      }

      return {
        state: {
          ...s.state,
          agents: s.state.agents.map((a) =>
            a.id === agentId ? { ...a, aiPlan: plan, needsReplan: false } : a
          ),
          events: appendEvents(s.state, events),
        },
      }
    })
  },

  applyConversation: (
    runId: number,
    aId: string,
    bId: string,
    lines: ConversationLine[],
    deltaA: number,
    deltaB: number,
    trade: NegotiatedTrade | null
  ) => {
    if (runId !== aiRunId) return
    useSimStore.setState((s) => {
      if (s.state.phase !== "running") return s
      const agents = s.state.agents.map((x) => ({
        ...x,
        relationships: { ...x.relationships },
        inventory: { ...x.inventory },
        grievances: Object.fromEntries(
          Object.entries(x.grievances).map(([id, g]) => [id, { ...g, reasons: [...g.reasons] }])
        ),
        lastTrades: { ...x.lastTrades },
        stats: { ...x.stats },
      }))
      const a = agents.find((x) => x.id === aId)
      const b = agents.find((x) => x.id === bId)
      if (!a || !b || !a.isAlive || !b.isAlive) return s

      const events: EventLogEntry[] = lines.map((line) => {
        const speaker = agents.find((x) => x.id === line.speakerId)
        return aiEvent(s.state.day, `💬 ${speaker?.name}: “${line.text}”`, 2, [aId, bId])
      })

      const m1 = updateRelationship(a, bId, deltaA)
      const m2 = updateRelationship(b, aId, deltaB)
      if (m1 === "enemies" || m2 === "enemies") {
        events.push(aiEvent(s.state.day, `${a.name} and ${b.name} are now enemies`, 3, [aId, bId]))
      } else if (m1 === "best_friends" || m2 === "best_friends") {
        events.push(aiEvent(s.state.day, `${a.name} and ${b.name} are now best friends`, 3, [aId, bId]))
      }

      // gossip: the teller's strongest grudge (and warmest friendship) rubs off
      for (const [teller, listener] of [
        [a, b],
        [b, a],
      ] as const) {
        const worst = agents
          .filter((x) => x.id !== teller.id && x.id !== listener.id && x.isAlive)
          .map((x) => ({ x, g: teller.grievances[x.id]?.score ?? 0 }))
          .sort((p, q) => q.g - p.g)[0]
        if (worst && worst.g >= GOSSIP_GRIEVANCE_MIN) {
          const transfer = Math.min(GOSSIP_TRANSFER_CAP, Math.round(worst.g * GOSSIP_TRANSFER))
          const reason = teller.grievances[worst.x.id]?.reasons.slice(-1)[0] ?? "wronged them"
          addGrievance(listener, worst.x.id, transfer, `heard from ${teller.name}: ${reason}`)
          updateRelationship(listener, worst.x.id, -GOSSIP_REL_PENALTY)
          if (transfer >= 10) {
            events.push(
              aiEvent(s.state.day, `🗣️ ${teller.name} warned ${listener.name} about ${worst.x.name}`, 2, [
                teller.id,
                listener.id,
                worst.x.id,
              ])
            )
          }
        }
        const friend = agents
          .filter((x) => x.id !== teller.id && x.id !== listener.id && x.isAlive)
          .map((x) => ({ x, r: teller.relationships[x.id] ?? 0 }))
          .sort((p, q) => q.r - p.r)[0]
        if (friend && friend.r >= GOSSIP_VOUCH_MIN) {
          updateRelationship(listener, friend.x.id, GOSSIP_VOUCH_GAIN)
        }
      }

      // a deal struck in conversation executes immediately (if both can pay)
      if (trade) {
        const canA =
          a.inventory.food >= trade.aGives.food &&
          a.inventory.wood >= trade.aGives.wood &&
          a.inventory.stone >= trade.aGives.stone
        const canB =
          b.inventory.food >= trade.bGives.food &&
          b.inventory.wood >= trade.bGives.wood &&
          b.inventory.stone >= trade.bGives.stone
        const aTotal = trade.aGives.food + trade.aGives.wood + trade.aGives.stone
        const bTotal = trade.bGives.food + trade.bGives.wood + trade.bGives.stone
        if (canA && canB && aTotal > 0 && bTotal > 0) {
          for (const res of ["food", "wood", "stone"] as const) {
            a.inventory[res] += trade.bGives[res] - trade.aGives[res]
            b.inventory[res] += trade.aGives[res] - trade.bGives[res]
          }
          // gains from trade apply to negotiated deals too
          a.inventory.food += TRADE_BONUS
          b.inventory.food += TRADE_BONUS
          a.stats.trades++
          b.stats.trades++
          a.lastTrades[bId] = s.state.day
          b.lastTrades[aId] = s.state.day
          const fmt = (g: NegotiatedTrade["aGives"]) =>
            (["food", "wood", "stone"] as const)
              .filter((r) => g[r] > 0)
              .map((r) => `${g[r]} ${r}`)
              .join("+") || "nothing"
          events.push(
            aiEvent(
              s.state.day,
              `🤝 Deal: ${a.name} gave ${fmt(trade.aGives)} for ${b.name}'s ${fmt(trade.bGives)}`,
              2,
              [aId, bId]
            )
          )
        }
      }

      return { state: { ...s.state, agents, events: appendEvents(s.state, events) } }
    })
  },

  notifyAiDisabled: (reason: string) => {
    useSimStore.setState((s) => ({
      state: {
        ...s.state,
        events: appendEvents(s.state, [
          aiEvent(
            s.state.day,
            `🧠 The AI minds rest after repeated errors (${reason.slice(0, 80)}) — instinct takes over, retrying in ~5 min`,
            3,
            []
          ),
        ]),
      },
    }))
  },
}

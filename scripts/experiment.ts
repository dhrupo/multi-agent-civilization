// Headless batch experiment runner — seeded, reproducible, CSV output.
//
//   npm run experiment -- --runs 50 --days 1500 --seed 1            # instinct-only, deterministic
//   npm run experiment -- --runs 5 --days 500 --seed 1 --ai        # AI minds (needs ZAI_API_KEY in env/.env)
//   npm run experiment -- ... --ai --memory                         # memories carry across the batch's runs
//
// Instinct mode is deterministic given a seed; AI mode is not (model outputs vary)
// but lets you measure how MINDS change outcomes. CSV → stdout, summary → stderr.
import { readFileSync } from "node:fs"
import type { Agent, AiPlan, SimState } from "../src/types"
import { AGENT_COLORS } from "../src/constants"
import { createAgent, DEV_CONFIG } from "../src/simulation/agent"
import { placeStartingBase } from "../src/simulation/buildings"
import { generateWorld, getSpawnPositions } from "../src/simulation/world"
import { setSeed } from "../src/simulation/rng"
import { runTick } from "../src/simulation/tick"
import { configureNodeAi } from "../src/ai/client"
import { aiTick, resetAi, type AiBridge, type ConversationLine, type NegotiatedTrade } from "../src/ai/controller"
import { saveRunMemory, clearMemories } from "../src/ai/memory"
import { updateRelationship } from "../src/simulation/relationships"

function arg(name: string, fallback: number): number {
  const idx = process.argv.indexOf(`--${name}`)
  const value = idx !== -1 ? Number(process.argv[idx + 1]) : NaN
  return Number.isFinite(value) ? value : fallback
}

const RUNS = arg("runs", 20)
const DAYS = arg("days", 1500)
const BASE_SEED = arg("seed", 1)
const AI_MODE = process.argv.includes("--ai")
const MEMORY_MODE = process.argv.includes("--memory")
const TICK_MS = arg("tick-ms", AI_MODE ? 150 : 0)

if (AI_MODE) {
  // read ZAI_API_KEY from env or .env (same convention as the dev server)
  let key = process.env.ZAI_API_KEY ?? ""
  if (!key) {
    try {
      const env = readFileSync(".env", "utf8")
      key = env.match(/^ZAI_API_KEY=(.*)$/m)?.[1]?.trim() ?? ""
    } catch {
      // no .env
    }
  }
  if (!key) {
    console.error("--ai requires ZAI_API_KEY in the environment or .env")
    process.exit(1)
  }
  configureNodeAi({
    provider: "zai",
    baseUrl: process.env.ZAI_BASE_URL || "https://api.z.ai/api/paas/v4",
    model: "glm-4.5-flash",
    apiKey: key,
  })
}
if (!MEMORY_MODE) clearMemories()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function runOnce(seed: number, runIndex: number): Promise<SimState> {
  setSeed(seed)
  const tiles = generateWorld()
  const spawns = getSpawnPositions(tiles, DEV_CONFIG.length)
  const agents = DEV_CONFIG.map((cfg, i) =>
    createAgent(`a${i + 1}`, cfg.name, AGENT_COLORS[i], cfg.personality, spawns[i])
  )
  for (const a of agents) for (const b of agents) if (a.id !== b.id) a.relationships[b.id] = 0
  const buildings: SimState["buildings"] = []
  for (const a of agents) placeStartingBase(a, tiles, buildings)

  let state: SimState = {
    phase: "running",
    day: 0,
    endDay: DAYS,
    tick: 0,
    speed: 1,
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

  // minimal AI bridge: async plan/convo responses mutate the live state in place
  const bridge: AiBridge = {
    getState: () => state,
    runId: () => runIndex,
    applyPlan: (rid: number, agentId: string, plan: AiPlan) => {
      if (rid !== runIndex || state.phase !== "running") return
      const agent = state.agents.find((x) => x.id === agentId)
      if (agent?.isAlive) {
        agent.aiPlan = plan
        agent.needsReplan = false
      }
    },
    applyConversation: (
      rid: number,
      aId: string,
      bId: string,
      _lines: ConversationLine[],
      deltaA: number,
      deltaB: number,
      _trade: NegotiatedTrade | null
    ) => {
      if (rid !== runIndex || state.phase !== "running") return
      const a = state.agents.find((x) => x.id === aId)
      const b = state.agents.find((x) => x.id === bId)
      if (a?.isAlive && b?.isAlive) {
        updateRelationship(a, bId, deltaA)
        updateRelationship(b, aId, deltaB)
      }
    },
    notifyAiDisabled: (reason: string) => console.error(`[ai] resting: ${reason.slice(0, 80)}`),
  }
  if (AI_MODE) resetAi(runIndex)

  let guard = DAYS + 10
  while (state.phase === "running" && guard-- > 0) {
    state = runTick(state)
    if (AI_MODE && state.phase === "running") {
      aiTick(bridge)
      await sleep(TICK_MS)
    }
  }
  if (MEMORY_MODE) saveRunMemory(state)
  return state
}

const header = [
  "seed",
  "winner",
  "deaths",
  "catastrophes",
  ...DEV_CONFIG.flatMap((c) => {
    const n = c.name.toLowerCase()
    return [
      `${n}_score`,
      `${n}_alive`,
      `${n}_trades`,
      `${n}_gifts`,
      `${n}_peace`,
      `${n}_steals`,
      `${n}_raids`,
      `${n}_attacks`,
      `${n}_kills`,
    ]
  }),
]
console.log(header.join(","))

async function main() {
  const wins = new Map<string, number>()
  const scoreSums = new Map<string, number>()
  let totalDeaths = 0

  for (let i = 0; i < RUNS; i++) {
    const seed = BASE_SEED + i
    const state = await runOnce(seed, i)
    const deaths = state.agents.filter((a) => !a.isAlive).length
    totalDeaths += deaths
    wins.set(state.winner!.name, (wins.get(state.winner!.name) ?? 0) + 1)
    const row: (string | number)[] = [seed, state.winner!.name, deaths, state.catastropheCount]
    for (const agent of state.agents) {
      scoreSums.set(agent.name, (scoreSums.get(agent.name) ?? 0) + agent.score)
      const s = agent.stats
      row.push(agent.score, agent.isAlive ? 1 : 0, s.trades, s.gifts, s.peaceOffers, s.steals, s.raids, s.attacks, s.kills)
    }
    console.log(row.join(","))
    console.error(`run ${i + 1}/${RUNS} (seed ${seed}): winner=${state.winner!.name} deaths=${deaths}`)
  }

  console.error("\n=== summary ===")
  console.error(`mode=${AI_MODE ? "AI minds" : "instinct"}${MEMORY_MODE ? " + memories" : ""}`)
  for (const cfg of DEV_CONFIG) {
    console.error(
      `${cfg.name.padEnd(6)} wins=${(wins.get(cfg.name) ?? 0).toString().padStart(3)}  mean score=${((scoreSums.get(cfg.name) ?? 0) / RUNS).toFixed(1)}`
    )
  }
  console.error(`mean deaths/run=${(totalDeaths / RUNS).toFixed(2)}`)
}

main()

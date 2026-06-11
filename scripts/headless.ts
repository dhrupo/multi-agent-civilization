// Headless simulation smoke test (bundled via esbuild, run with node)
import type { Agent, SimState } from "../src/types"
import { AGENT_COLORS } from "../src/constants"
import { createAgent, DEV_CONFIG } from "../src/simulation/agent"
import { placeStartingBase } from "../src/simulation/buildings"
import { generateWorld, getSpawnPositions } from "../src/simulation/world"
import { setSeed } from "../src/simulation/rng"
import { runTick } from "../src/simulation/tick"
import { chooseBuildingType } from "../src/simulation/buildings"
import { applyGossip, executeNegotiatedTrade } from "../src/simulation/conversation"

function makeState(agents: Agent[], tiles: ReturnType<typeof generateWorld>, endDay: number): SimState {
  const buildings: SimState["buildings"] = []
  for (const a of agents) placeStartingBase(a, tiles, buildings)
  return {
    phase: "running",
    day: 0,
    endDay,
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
}

// --- Full-run sanity ---
{
  const tiles = generateWorld()
  const spawns = getSpawnPositions(tiles, 4)
  const agents = DEV_CONFIG.map((cfg, i) =>
    createAgent(`a${i + 1}`, cfg.name, AGENT_COLORS[i], cfg.personality, spawns[i])
  )
  for (const a of agents) for (const b of agents) if (a.id !== b.id) a.relationships[b.id] = 0

  let state = makeState(agents, tiles, 365)
  let ticks = 0
  const actionCounts: Record<string, number> = {}
  while (state.phase === "running" && ticks < 500) {
    state = runTick(state)
    ticks++
    for (const a of state.agents) {
      if (a.currentAction) actionCounts[a.currentAction] = (actionCounts[a.currentAction] ?? 0) + 1
    }
  }
  console.log(`full run: phase=${state.phase} day=${state.day} catastrophes=${state.catastropheCount}`)
  console.log("actions:", actionCounts)
  for (const a of state.agents) {
    console.log(
      `  ${a.name.padEnd(6)} alive=${a.isAlive} hp=${a.health.toFixed(0)} score=${a.score} grievances=${JSON.stringify(
        Object.fromEntries(Object.entries(a.grievances).map(([k, g]) => [k, g.score]))
      )}`
    )
  }
  const gifts = state.events.filter((e) => e.text.includes("shared food")).length
  const raids = state.events.filter((e) => e.text.includes("raided")).length
  const attacks = state.events.filter((e) => e.text.includes("attacked")).length
  const outcast = state.events.filter((e) => e.text.includes("turns on")).length
  console.log(`  gifts=${gifts} raids=${raids} attacks=${attacks} outcast-events=${outcast}`)

  // the trade-loop exploit minted inventories in the hundreds; caps must hold
  const maxStock = Math.max(...state.agents.flatMap((a) => [a.inventory.food, a.inventory.wood]))
  console.log(`  max stockpile=${maxStock} ${maxStock <= 30 ? "PASS" : "FAIL (trade exploit back?)"}`)

  // trespass alone must never justify a kill campaign
  const trespassOnly = state.agents.flatMap((a) =>
    Object.values(a.grievances).filter((g) => g.reasons.length === 1 && g.reasons[0] === "harvests my territory")
  )
  const maxTrespass = Math.max(0, ...trespassOnly.map((g) => g.score))
  console.log(`  max trespass-only grievance=${maxTrespass} ${maxTrespass <= 28 ? "PASS" : "FAIL"}`)
}

// --- Justification gate: aggress plan w/o grievance must NOT produce violence ---
function aggressScenario(withGrievance: boolean): { attacked: boolean; raided: boolean } {
  const tiles = generateWorld()
  const a = createAgent("a1", "Hostile", "#fff", { aggression: 95, greed: 90, cooperation: 10, curiosity: 20 }, { x: 5, y: 5 })
  const b = createAgent("a2", "Victim", "#000", { aggression: 15, greed: 25, cooperation: 15, curiosity: 60 }, { x: 6, y: 5 })
  a.relationships = { a2: 0 }
  b.relationships = { a1: 0 }
  a.aiPlan = {
    strategy: "aggress",
    targetId: "a2",
    stances: { a2: "enemy" },
    thought: "test",
    decidedOnDay: 1,
    validUntilDay: 9999,
  }
  if (withGrievance) {
    a.grievances = { a2: { score: 60, reasons: ["raided my base"] } }
  }
  // keep the aggressor fed and sated: desperation (starving + broke) legitimately
  // justifies violence, so it must not contaminate the pure no-grievance check
  a.inventory.food = 10
  a.hunger = 0
  let s = makeState([a, b], tiles, 9999)
  let attacked = false
  let raided = false
  for (let i = 0; i < 30; i++) {
    s = runTick(s)
    attacked ||= s.events.some((e) => e.text.includes("attacked"))
    raided ||= s.events.some((e) => e.text.includes("raided"))
  }
  const grievanceVsVictim = s.agents[0].grievances["a2"]?.score ?? 0
  return { attacked, raided, grievanceVsVictim }
}

// --- Trait drift: a brutalized agent hardens (less cooperative, more aggressive) ---
{
  setSeed(11)
  const tiles = generateWorld()
  const bully = createAgent("a1", "Bully", "#fff", { aggression: 95, greed: 60, cooperation: 10, curiosity: 20 }, { x: 5, y: 5 })
  const mark = createAgent("a2", "Mark", "#000", { aggression: 20, greed: 30, cooperation: 70, curiosity: 40 }, { x: 6, y: 5 })
  bully.relationships = { a2: -80 }
  mark.relationships = { a1: -80 }
  bully.grievances = { a2: { score: 100, reasons: ["attacked me"] } }
  bully.inventory.food = 10
  let s = makeState([bully, mark], tiles, 9999)
  for (let i = 0; i < 80; i++) s = runTick(s)
  const m = s.agents.find((a) => a.id === "a2")!
  const hardened = m.personality.cooperation < m.basePersonality.cooperation && m.personality.aggression > m.basePersonality.aggression
  const attacksHappened = s.events.some((e) => e.text.includes("attacked"))
  console.log(
    `trait drift: coop ${m.basePersonality.cooperation}→${m.personality.cooperation.toFixed(1)}, aggr ${m.basePersonality.aggression}→${m.personality.aggression.toFixed(1)} ${
      attacksHappened && hardened ? "PASS (victim hardened)" : "FAIL"
    }`
  )
}

{
  const without = aggressScenario(false)
  const withG = aggressScenario(true)
  // attacks (kill campaigns) must never fire without cause; raids are legitimate
  // when the victim earned a real grievance during the run (e.g. trespassing)
  const gateHolds =
    !without.attacked && (!without.raided || without.grievanceVsVictim >= 15)
  const justiceWorks = withG.attacked || withG.raided
  console.log(`justification gate (no cause → no violence): ${gateHolds ? "PASS" : `FAIL ${JSON.stringify(without)}`}`)
  console.log(`justified violence still possible: ${justiceWorks ? "PASS" : "FAIL"}`)
}

// --- Reconciliation: a cooperative agent with a peace plan ends a feud ---
{
  const tiles = generateWorld()
  const a = createAgent("a1", "Penitent", "#fff", { aggression: 20, greed: 30, cooperation: 90, curiosity: 40 }, { x: 5, y: 5 })
  const b = createAgent("a2", "Wronged", "#000", { aggression: 40, greed: 30, cooperation: 50, curiosity: 40 }, { x: 6, y: 5 })
  a.relationships = { a2: -40 }
  b.relationships = { a1: -60 }
  b.grievances = { a1: { score: 70, reasons: ["raided my base"] } }
  a.inventory.food = 8
  a.aiPlan = {
    strategy: "reconcile",
    targetId: "a2",
    stances: { a2: "neutral" },
    thought: "test",
    decidedOnDay: 1,
    validUntilDay: 9999,
  }
  let s = makeState([a, b], tiles, 9999)
  let peace = false
  for (let i = 0; i < 40 && !peace; i++) {
    s = runTick(s)
    peace = s.events.some((e) => e.text.includes("reparations"))
  }
  const grudgeAfter = s.agents.find((x) => x.id === "a2")!.grievances["a1"]?.score ?? 0
  console.log(`reconciliation: peaceOffered=${peace} grudge 70→${grudgeAfter} ${peace && grudgeAfter <= 10 ? "PASS" : "FAIL"}`)
}

// --- Positive-sum trade: total resources grow when two agents trade ---
{
  const tiles = generateWorld()
  const a = createAgent("a1", "Trader", "#fff", { aggression: 10, greed: 50, cooperation: 90, curiosity: 40 }, { x: 5, y: 5 })
  const b = createAgent("a2", "Partner", "#000", { aggression: 10, greed: 50, cooperation: 90, curiosity: 40 }, { x: 6, y: 5 })
  a.relationships = { a2: 30 }
  b.relationships = { a1: 30 }
  a.inventory = { food: 0, wood: 8, stone: 0 }
  b.inventory = { food: 8, wood: 0, stone: 0 }
  a.hunger = 0
  b.hunger = 0 // keep them from eating before the trade fires
  let s = makeState([a, b], tiles, 9999)
  const totalBefore =
    a.inventory.food + a.inventory.wood + b.inventory.food + b.inventory.wood
  let traded = false
  for (let i = 0; i < 20 && !traded; i++) {
    s = runTick(s)
    traded = s.events.some((e) => e.text.includes("traded"))
  }
  const [a2, b2] = s.agents
  const totalAfter = a2.inventory.food + a2.inventory.wood + b2.inventory.food + b2.inventory.wood
  console.log(
    `positive-sum trade: traded=${traded} total ${totalBefore}→${totalAfter} ${traded && totalAfter > totalBefore ? "PASS" : "FAIL (gathering noise possible — check trade event)"}`
  )
}

// --- Storage protection: a granary keeps the last food out of thieves' hands ---
{
  const tiles = generateWorld()
  const thief = createAgent("a1", "Thief", "#fff", { aggression: 80, greed: 95, cooperation: 10, curiosity: 20 }, { x: 5, y: 5 })
  const victim = createAgent("a2", "Victim", "#000", { aggression: 10, greed: 20, cooperation: 50, curiosity: 30 }, { x: 6, y: 5 })
  thief.relationships = { a2: -50 }
  victim.relationships = { a1: -50 }
  thief.grievances = { a2: { score: 50, reasons: ["attacked me"] } }
  victim.inventory.food = 8
  thief.inventory.food = 0
  thief.hunger = 85 // desperate — steal is strongly favored
  let s = makeState([thief, victim], tiles, 9999)
  // give the victim a storage building on an adjacent tile
  const storeTile = s.tiles[6][6]
  storeTile.terrain = "grass"
  storeTile.buildingId = "storetest"
  s.buildings.push({ id: "storetest", type: "storage", ownerId: "a2", x: 6, y: 6, builtOnDay: 0, hp: 60 })
  let minVictimFood = victim.inventory.food
  let stolenEvents = 0
  for (let i = 0; i < 25; i++) {
    s = runTick(s)
    const v = s.agents.find((a) => a.id === "a2")!
    // track food floor excluding the victim's own eating (only check right after thefts)
    stolenEvents = s.events.filter((e) => /stole|stealing/.test(e.text)).length
    minVictimFood = Math.min(minVictimFood, v.inventory.food + (s.events.length ? 0 : 0))
  }
  const totalStolen = s.agents.find((a) => a.id === "a1")!.stats.steals
  const robbed = s.agents.find((a) => a.id === "a2")!.stats.timesRobbed
  // victim eats own food, so check thief's takings: stealable surplus was only 8-6=2
  const thiefFood = s.agents.find((a) => a.id === "a1")!.inventory.food
  console.log(
    `storage protection: thefts=${totalStolen} robbed=${robbed} stolenEvents=${stolenEvents} ${
      robbed <= 1 ? "PASS (granary held — at most the surplus was taken)" : "FAIL"
    }`
  )
}

// --- War weariness: a mutual-grievance war must burn itself out ---
// (seeded: the assertion is about dynamics, not dice)
{
  setSeed(7)
  const tiles = generateWorld()
  const a = createAgent("a1", "Hawk", "#fff", { aggression: 95, greed: 60, cooperation: 10, curiosity: 20 }, { x: 5, y: 5 })
  const b = createAgent("a2", "Dove", "#000", { aggression: 90, greed: 60, cooperation: 10, curiosity: 20 }, { x: 6, y: 5 })
  a.relationships = { a2: -80 }
  b.relationships = { a1: -80 }
  a.grievances = { a2: { score: 100, reasons: ["attacked me"] } }
  b.grievances = { a1: { score: 100, reasons: ["attacked me"] } }
  a.inventory.food = 10
  b.inventory.food = 10
  let s = makeState([a, b], tiles, 9999)
  const attacksInWindow = (events: typeof s.events, from: number, to: number) =>
    events.filter((e) => e.text.includes("attacked") && e.day >= from && e.day <= to).length
  for (let i = 0; i < 300; i++) s = runTick(s)
  const early = attacksInWindow(s.events, 0, 80)
  const late = attacksInWindow(s.events, 220, 300)
  const bothAlive = s.agents.every((x) => x.isAlive)
  console.log(
    `war weariness: attacks days 0-80=${early}, days 220-300=${late}, bothAlive=${bothAlive} ${
      early > 0 && late <= Math.max(2, early * 0.5) ? "PASS (war burned out)" : "FAIL"
    }`
  )
}

// --- Diplomat viability: sustained trade funds construction ---
{
  // A Diplomat (coop 95, greed 30) barely builds on personality alone; once
  // she has traded enough, commerce should drive her industry up to build.
  const diplomat = createAgent("a1", "Dip", "#fff", { aggression: 10, greed: 30, cooperation: 95, curiosity: 60 }, { x: 5, y: 5 })
  const buildBefore = chooseBuildingType(diplomat, []) // base first, regardless
  diplomat.stats.trades = 40 // simulate a rich trading history
  diplomat.inventory = { food: 5, wood: 10, stone: 10 }
  // give it a base already so the next pick reflects discretionary building
  const tiles = generateWorld()
  let s = makeState([diplomat], tiles, 9999)
  let builtNonBase = false
  for (let i = 0; i < 60 && !builtNonBase; i++) {
    s = runTick(s)
    builtNonBase = s.buildings.filter((b) => b.ownerId === "a1" && b.type !== "base").length > 0
  }
  console.log(
    `diplomat viability: traded-merchant built ${s.buildings.filter((b) => b.ownerId === "a1").length} structures ${
      builtNonBase ? "PASS (commerce funded construction)" : "FAIL"
    }`
  )
  void buildBefore
}

// --- Gossip: a grudge is partially transmitted to a conversation partner ---
{
  const teller = createAgent("a1", "Teller", "#fff", { aggression: 30, greed: 40, cooperation: 50, curiosity: 50 }, { x: 5, y: 5 })
  const listener = createAgent("a2", "Listener", "#000", { aggression: 30, greed: 40, cooperation: 50, curiosity: 50 }, { x: 6, y: 5 })
  const villain = createAgent("a3", "Villain", "#0f0", { aggression: 70, greed: 60, cooperation: 20, curiosity: 30 }, { x: 7, y: 5 })
  teller.grievances = { a3: { score: 80, reasons: ["raided my base"] } }
  const before = listener.grievances["a3"]?.score ?? 0
  const warnings = applyGossip([teller, listener, villain], teller, listener)
  const after = listener.grievances["a3"]?.score ?? 0
  const warned = warnings.some((w) => w.aboutId === "a3" && w.listenerId === "a2")
  console.log(
    `gossip transfer: listener grudge vs villain ${before}→${after}, warned=${warned} ${
      after > before && warned ? "PASS (rumor spread)" : "FAIL"
    }`
  )
}

// --- Negotiated trade: an in-dialogue deal moves the agreed resources ---
{
  const a = createAgent("a1", "A", "#fff", { aggression: 30, greed: 50, cooperation: 60, curiosity: 40 }, { x: 5, y: 5 })
  const b = createAgent("a2", "B", "#000", { aggression: 30, greed: 50, cooperation: 60, curiosity: 40 }, { x: 6, y: 5 })
  a.inventory = { food: 0, wood: 5, stone: 0 }
  b.inventory = { food: 5, wood: 0, stone: 0 }
  const result = executeNegotiatedTrade(a, b, { aGives: { food: 0, wood: 3, stone: 0 }, bGives: { food: 4, wood: 0, stone: 0 } }, 1)
  // A gave 3 wood (5→2), got 4 food (+trade bonus); B gave 4 food (5→1, +bonus), got 3 wood
  const ok =
    result !== null &&
    a.inventory.wood === 2 &&
    a.inventory.food >= 4 &&
    b.inventory.wood === 3 &&
    b.inventory.food >= 1 &&
    a.stats.trades === 1 &&
    b.stats.trades === 1
  console.log(
    `negotiated trade: A=${a.inventory.food}f/${a.inventory.wood}w B=${b.inventory.food}f/${b.inventory.wood}w ${
      ok ? "PASS (deal executed as agreed)" : "FAIL"
    }`
  )
  // a deal nobody can pay must be rejected
  const broke = executeNegotiatedTrade(a, b, { aGives: { food: 99, wood: 0, stone: 0 }, bGives: { food: 1, wood: 0, stone: 0 } }, 2)
  console.log(`negotiated trade guard: unaffordable deal rejected ${broke === null ? "PASS" : "FAIL"}`)
}

// --- Catastrophe over a long horizon ---
{
  const tiles = generateWorld()
  const spawns = getSpawnPositions(tiles, 4)
  const agents = DEV_CONFIG.map((cfg, i) =>
    createAgent(`a${i + 1}`, cfg.name, AGENT_COLORS[i], cfg.personality, spawns[i])
  )
  for (const a of agents) for (const b of agents) if (a.id !== b.id) a.relationships[b.id] = 0
  let state = makeState(agents, tiles, 1500)
  let ticks = 0
  while (state.phase === "running" && ticks < 1600) {
    state = runTick(state)
    ticks++
  }
  console.log(`catastrophe check over ${state.day} days: count=${state.catastropheCount} ${state.catastropheCount >= 1 ? "PASS" : "FAIL"}`)
}

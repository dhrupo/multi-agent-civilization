import type { Agent, Building, Catastrophe, CatastropheType, EventLogEntry, SimState, Tile } from "../types"
import {
  BLIGHT_FOOD_SPOIL,
  BLIGHT_HUNGER_MULT,
  HUDDLE_PROTECTION,
  INTERACTION_RANGE,
  CATASTROPHE_DAILY_CHANCE,
  CATASTROPHE_MAX_DURATION,
  CATASTROPHE_MIN_DURATION,
  CATASTROPHE_MIN_GAP_DAYS,
  EARTHQUAKE_BUILDING_DAMAGE,
  EARTHQUAKE_HEALTH_HIT,
  ENERGY_DECAY,
  HEALTH_REGEN,
  HUNGER_PER_TICK,
  MAX_STORED_EVENTS,
  PLAN_GRACE_DAYS,
  STARVATION_DAMAGE,
  STORM_ENERGY_DRAIN,
  STORM_HEALTH_DRAIN,
  STORM_WOOD_LOSS,
  TICKS_PER_DAY,
  TILE_MAX_RESOURCE,
  TILE_REGEN_CHANCE,
} from "../constants"
import { buildWorldContext, executeAction, getBestAction, getHardOverride } from "./actions"
import { clamp, decayGrievances, decayRelationships } from "./relationships"
import { destroyBuilding, getBuildingAt } from "./buildings"
import { computeScore, computeWinner } from "./scoring"
import { distance } from "./world"
import { random } from "./rng"
import { seasonHungerMult, seasonRegenMult } from "./seasons"

let tickEventCounter = 0

function tickEvent(day: number, text: string, weight: number, involvedIds: string[] = []): EventLogEntry {
  return { id: `t${++tickEventCounter}`, day, text, weight, involvedIds }
}

function regenTiles(tiles: Tile[][], blightActive: boolean, seasonMult: number): void {
  if (blightActive) return // nothing grows during a blight
  for (const row of tiles) {
    for (const tile of row) {
      if (random() >= TILE_REGEN_CHANCE * seasonMult) continue
      if (tile.terrain === "grass" || tile.terrain === "water") {
        tile.food = Math.min(TILE_MAX_RESOURCE, tile.food + 1)
      } else if (tile.terrain === "forest") {
        tile.wood = Math.min(TILE_MAX_RESOURCE, tile.wood + 1)
        if (tile.food < 2) tile.food += 1
      } else if (tile.terrain === "mountain") {
        tile.stone = Math.min(TILE_MAX_RESOURCE, tile.stone + 1)
      }
    }
  }
}

const CATASTROPHE_LABEL: Record<CatastropheType, string> = {
  storm: "🌪️ A violent storm batters the island",
  blight: "🌾 Blight! The island's crops are rotting",
  earthquake: "🌋 An earthquake shakes the island",
}

function maybeStartCatastrophe(
  state: SimState,
  day: number,
  agents: Agent[],
  tiles: Tile[][],
  buildings: Building[],
  events: EventLogEntry[]
): Catastrophe | null {
  if (state.catastrophe) return state.catastrophe
  if (day - state.lastCatastropheEnd < CATASTROPHE_MIN_GAP_DAYS) return null
  if (random() >= CATASTROPHE_DAILY_CHANCE) return null

  const types: CatastropheType[] = ["storm", "blight", "earthquake"]
  const type = types[Math.floor(random() * types.length)]
  const duration =
    CATASTROPHE_MIN_DURATION +
    Math.floor(random() * (CATASTROPHE_MAX_DURATION - CATASTROPHE_MIN_DURATION + 1))
  const catastrophe: Catastrophe = { type, startDay: day, endDay: day + duration }

  events.push(tickEvent(day, `${CATASTROPHE_LABEL[type]} (${duration} days)`, 3))

  if (type === "earthquake") {
    // immediate shock: everyone hurt, structures cracked
    for (const agent of agents) {
      if (!agent.isAlive) continue
      agent.health = clamp(agent.health - EARTHQUAKE_HEALTH_HIT, 0, 100)
    }
    for (const building of [...buildings]) {
      building.hp -= EARTHQUAKE_BUILDING_DAMAGE
      if (building.hp <= 0) {
        const owner = agents.find((a) => a.id === building.ownerId)
        destroyBuilding(building, tiles, buildings)
        events.push(
          tickEvent(day, `💔 The earthquake destroyed ${owner?.name ?? "someone"}'s ${building.type}!`, 3, [building.ownerId])
        )
      }
    }
  }
  if (type === "blight") {
    for (const row of tiles) {
      for (const tile of row) tile.food = Math.floor(tile.food / 2)
    }
    // stored food rots too — wealth is no shield against a blight
    for (const agent of agents) {
      if (!agent.isAlive) continue
      agent.inventory.food = Math.floor(agent.inventory.food * (1 - BLIGHT_FOOD_SPOIL))
    }
  }
  if (type === "storm") {
    // the wind scatters woodpiles
    for (const agent of agents) {
      if (!agent.isAlive) continue
      agent.inventory.wood = Math.floor(agent.inventory.wood * (1 - STORM_WOOD_LOSS))
    }
  }

  // a crisis makes everyone rethink their plans immediately
  for (const agent of agents) {
    if (agent.isAlive) agent.needsReplan = true
  }

  return catastrophe
}

export function runTick(state: SimState): SimState {
  // 1. Advance day counter
  const newDay = state.tick % TICKS_PER_DAY === 0 ? state.day + 1 : state.day

  // 2. Check end condition
  if (newDay > state.endDay || state.agents.every((a) => !a.isAlive)) {
    return { ...state, phase: "ended", winner: computeWinner(state.agents) }
  }

  // Clone mutable simulation data; actions mutate the clones in place.
  const agents: Agent[] = state.agents.map((a) => ({
    ...a,
    inventory: { ...a.inventory },
    relationships: { ...a.relationships },
    personality: { ...a.personality }, // trait drift mutates this
    homeTile: { ...a.homeTile },
    grievances: Object.fromEntries(
      Object.entries(a.grievances).map(([id, g]) => [id, { ...g, reasons: [...g.reasons] }])
    ),
    lastTrades: { ...a.lastTrades },
    stats: { ...a.stats },
    peaceHistory: { ...a.peaceHistory },
    warWeariness: { ...a.warWeariness },
  }))

  // a plan whose mind has gone unreachable eventually expires — clean instinct
  // beats stale orders from a silent god
  for (const agent of agents) {
    if (agent.aiPlan && newDay > agent.aiPlan.validUntilDay + PLAN_GRACE_DAYS) {
      agent.aiPlan = null
    }
  }
  const tiles: Tile[][] = state.tiles.map((row) => row.map((t) => ({ ...t })))
  const buildings = state.buildings.map((b) => ({ ...b }))
  const newEvents: EventLogEntry[] = []

  // 3. Catastrophe lifecycle
  let catastrophe = maybeStartCatastrophe(state, newDay, agents, tiles, buildings, newEvents)
  let lastCatastropheEnd = state.lastCatastropheEnd
  let catastropheCount = state.catastropheCount + (catastrophe && !state.catastrophe ? 1 : 0)
  if (catastrophe && newDay >= catastrophe.endDay) {
    newEvents.push(tickEvent(newDay, `☀️ The ${catastrophe.type} has passed. The island breathes again.`, 2))
    lastCatastropheEnd = newDay
    catastrophe = null
    for (const agent of agents) {
      if (agent.isAlive) agent.needsReplan = true
    }
  }
  const stormActive = catastrophe?.type === "storm"
  const blightActive = catastrophe?.type === "blight"
  const quakeAfter = catastrophe?.type === "earthquake"

  // 4. Decay needs for each living agent (winter bites harder)
  for (const agent of agents) {
    if (!agent.isAlive) continue
    const hungerRate =
      HUNGER_PER_TICK * (blightActive ? BLIGHT_HUNGER_MULT : 1) * seasonHungerMult(newDay)
    agent.hunger = clamp(agent.hunger + hungerRate, 0, 100)
    agent.energy = clamp(agent.energy - ENERGY_DECAY - (stormActive ? STORM_ENERGY_DRAIN : 0), 0, 100)
    agent.health =
      agent.hunger >= 100
        ? clamp(agent.health - STARVATION_DAMAGE, 0, 100)
        : clamp(agent.health + HEALTH_REGEN, 0, 100)
    if (stormActive) {
      // huddling together blunts the storm — surviving alone is far harder
      const hasCompany = agents.some(
        (other) => other.id !== agent.id && other.isAlive && distance(agent, other) <= INTERACTION_RANGE
      )
      const drain = hasCompany ? Math.max(1, STORM_HEALTH_DRAIN - HUDDLE_PROTECTION) : STORM_HEALTH_DRAIN
      agent.health = clamp(agent.health - drain, 0, 100)
    }
    if (quakeAfter) agent.health = clamp(agent.health - 1, 0, 100)

    // home comforts: a small passive bonus on your own base
    const here = getBuildingAt(buildings, agent.x, agent.y)
    if (here?.type === "base" && here.ownerId === agent.id) {
      agent.health = clamp(agent.health + 1, 0, 100)
      agent.energy = clamp(agent.energy + 1, 0, 100)
    }
  }

  // 5. Regen tile resources (season-scaled)
  regenTiles(tiles, blightActive, seasonRegenMult(newDay))

  // 6. Each living agent decides and executes one action
  for (const agent of agents) {
    if (!agent.isAlive) continue
    const ctx = buildWorldContext(agent, agents, tiles, buildings, newDay, catastrophe !== null)
    const action = getHardOverride(agent, ctx) ?? getBestAction(agent, ctx)
    newEvents.push(...executeAction(action, agent, ctx))
  }

  // 7. Check deaths (starvation/catastrophe; combat deaths are recorded by executeAction)
  for (const agent of agents) {
    if (agent.isAlive && agent.health <= 0) {
      agent.isAlive = false
      agent.deathDay = newDay
      agent.currentGoal = "Dead"
      newEvents.push(
        tickEvent(
          newDay,
          catastrophe
            ? `${agent.name} perished in the ${catastrophe.type} on Day ${newDay}`
            : `${agent.name} died from starvation on Day ${newDay}`,
          3,
          [agent.id]
        )
      )
    }
  }

  // 8. Relationship + grievance passive decay every 10 ticks
  if (state.tick % 10 === 0 && state.tick > 0) {
    for (const agent of agents) {
      decayRelationships(agent)
      decayGrievances(agent)
    }
  }

  // 9. Recalculate scores; sample history every 10 days for the sparklines
  for (const agent of agents) {
    agent.score = computeScore(agent, buildings)
  }
  let scoreHistory = state.scoreHistory
  let societyHistory = state.societyHistory
  if (newDay % 10 === 0 && newDay !== state.day) {
    scoreHistory = { ...state.scoreHistory }
    for (const agent of agents) {
      scoreHistory[agent.id] = [...(scoreHistory[agent.id] ?? []), agent.score].slice(-200)
    }
    // island health: mean trust, total wealth, cumulative conflict and commerce
    const living = agents.filter((a) => a.isAlive)
    let relSum = 0
    let relCount = 0
    for (const a of living) {
      for (const b of living) {
        if (a.id === b.id) continue
        relSum += a.relationships[b.id] ?? 0
        relCount++
      }
    }
    societyHistory = [
      ...state.societyHistory,
      {
        day: newDay,
        trust: relCount ? Math.round(relSum / relCount) : 0,
        wealth: agents.reduce((s, a) => s + a.score, 0),
        violence: agents.reduce((s, a) => s + a.stats.attacks + a.stats.raids, 0),
        trades: agents.reduce((s, a) => s + a.stats.trades, 0) / 2,
      },
    ].slice(-200)
  }

  // Trim to the rolling window, but never evict dramatic (weight-3) events —
  // the end screen needs them even when they happened early in the run.
  const allEvents = [...state.events, ...newEvents]
  const overflow = allEvents.length - MAX_STORED_EVENTS
  const events =
    overflow > 0
      ? [...allEvents.slice(0, overflow).filter((e) => e.weight === 3), ...allEvents.slice(overflow)]
      : allEvents

  return {
    ...state,
    day: newDay,
    tick: state.tick + 1,
    agents,
    tiles,
    buildings,
    events,
    catastrophe,
    lastCatastropheEnd,
    catastropheCount,
    scoreHistory,
    societyHistory,
  }
}

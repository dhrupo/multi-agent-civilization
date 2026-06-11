import type { ActionType, Agent, Building, EventLogEntry, Tile } from "../types"
import {
  ATTACK_BASE_DAMAGE,
  ATTACK_ENERGY_COST,
  ATTACK_MIN_JUSTIFICATION,
  BUILDING_BONUS,
  CATASTROPHE_GIFT_REL_FLOOR,
  CATASTROPHE_VIOLENCE_DAMPING,
  DESPERATION_JUSTIFICATION,
  EAT_FOOD_COST,
  EAT_HUNGER_REDUCE,
  GATHER_FOOD_AMOUNT,
  GATHER_STONE_AMOUNT,
  GATHER_WOOD_AMOUNT,
  GIFT_AMOUNT,
  GIFT_REL_GAIN,
  GIFT_WITNESS_GAIN,
  GRIEVANCE,
  HEAL_AMOUNT,
  HEAL_ENERGY_COST,
  INTERACTION_RANGE,
  MAP_SIZE,
  PEACE_COST_FOOD,
  PEACE_GRIEVANCE_RELIEF,
  PEACE_MAX_COST,
  PEACE_MIN_TARGET_GRIEVANCE,
  PEACE_OWN_RELIEF,
  PEACE_REL_GAIN,
  PEACE_REPEAT_REFUSAL,
  PEACE_REPEAT_SURCHARGE,
  RAID_BASE_DAMAGE,
  RAID_ENERGY_COST,
  RAID_LOOT,
  RAID_MIN_JUSTIFICATION,
  RETALIATION_DAMAGE,
  SLEEP_ENERGY_RESTORE,
  STEAL_AMOUNT,
  STEAL_CATCH_CHANCE,
  STEAL_MIN_JUSTIFICATION,
  STORAGE_PROTECTED_FOOD,
  TERRITORY_RADIUS,
  TRADE_AMOUNT,
  TRADE_BONUS,
  TRADE_COOLDOWN_DAYS,
  TRESPASS_GRIEVANCE_CAP,
  DRIFT_BETRAYED_AGGR,
  DRIFT_BETRAYED_COOP,
  DRIFT_KINDNESS_COOP,
  DRIFT_MAX,
  DRIFT_MIN,
  DRIFT_ROBBED_COOP,
  WEARINESS_BURNOUT,
  WEARINESS_DAMPING,
  WEARINESS_EXHAUSTED,
  WEARINESS_PER_ATTACK,
  WEARINESS_PER_RAID,
  WEARINESS_PROVOKED_RELIEF,
} from "../constants"
import { addGrievance, clamp, getMaxHatred, justification, updateRelationship } from "./relationships"
import type { RelationshipMilestone } from "./relationships"
import {
  chooseBuildingType,
  destroyBuilding,
  getAgentBase,
  getBuildingAt,
  isBuildableTile,
  placeBuilding,
} from "./buildings"
import { distance, findNearestTile, getNeighbors, getTile, isPassable, territoryOwner } from "./world"
import { random } from "./rng"

export type WorldContext = {
  agents: Agent[]
  tiles: Tile[][]
  buildings: Building[]
  nearbyAgents: Agent[] // living, within INTERACTION_RANGE, excluding self
  nearbyTiles: Tile[] // within INTERACTION_RANGE, including own tile
  day: number
  catastropheActive: boolean
}

export function buildWorldContext(
  agent: Agent,
  agents: Agent[],
  tiles: Tile[][],
  buildings: Building[],
  day: number,
  catastropheActive: boolean
): WorldContext {
  return {
    agents,
    tiles,
    buildings,
    nearbyAgents: agents.filter(
      (a) => a.id !== agent.id && a.isAlive && distance(a, agent) <= INTERACTION_RANGE
    ),
    nearbyTiles: getNeighbors(tiles, agent.x, agent.y, INTERACTION_RANGE),
    day,
    catastropheActive,
  }
}

// Relationship as the agent's AI plan perceives it: a declared stance can
// override history — an AI can warm to a stranger or stay cold to an old friend.
export function effectiveRel(agent: Agent, otherId: string): number {
  const rel = agent.relationships[otherId] ?? 0
  const stance = agent.aiPlan?.stances[otherId]
  if (stance === "enemy") return Math.min(rel, -40)
  if (stance === "ally") return Math.max(rel, 30)
  return rel
}

export function attackJustification(agent: Agent, target: Agent): number {
  return justification(agent, target, DESPERATION_JUSTIFICATION)
}

// Experience reshapes character: betrayal hardens, kindness softens (slowly, bounded)
export function driftTrait(agent: Agent, trait: keyof Agent["personality"], delta: number): void {
  agent.personality[trait] = Math.max(DRIFT_MIN, Math.min(DRIFT_MAX, agent.personality[trait] + delta))
}

// Endless fruitless fighting exhausts the will to continue — wars burn out
export function wearinessOf(agent: Agent, targetId: string): number {
  return agent.warWeariness[targetId] ?? 0
}

function wearinessFactor(agent: Agent, targetId: string): number {
  const w = wearinessOf(agent, targetId)
  if (w >= WEARINESS_EXHAUSTED) return 0
  return 1 / (1 + w * WEARINESS_DAMPING)
}

const STRATEGY_BIAS: Record<string, Partial<Record<ActionType, number>>> = {
  gather: { gather_food: 1.5, gather_wood: 1.5, gather_stone: 1.5 },
  build: { gather_wood: 1.5, gather_stone: 1.5, build: 2 },
  trade: { trade: 2 },
  aggress: { attack: 2.2, raid: 2.5, steal: 1.6 },
  avoid: { move: 2 },
  socialize: { trade: 2, gift: 1.5, move: 1.3 },
  survive: { eat: 1.5, sleep: 1.5, heal: 1.5, gather_food: 1.3 },
  help: { gift: 2.5, trade: 1.3, heal: 1.2 },
  reconcile: { make_peace: 3, gift: 1.3, trade: 1.2 },
}

let eventCounter = 0

function makeEvent(day: number, text: string, weight: number, involvedIds: string[]): EventLogEntry {
  return { id: `e${++eventCounter}`, day, text, weight, involvedIds }
}

const BASE_CAPACITY = 10

function getCapacity(agent: Agent, ctx: WorldContext): number {
  const nearStorage = ctx.buildings.some(
    (b) => b.type === "storage" && distance(b, agent) <= INTERACTION_RANGE
  )
  return nearStorage
    ? Math.floor(BASE_CAPACITY * BUILDING_BONUS.storage.storageMultiplier)
    : BASE_CAPACITY
}

// A storage building is a locked granary: part of the owner's food is theft-proof
function protectedFood(agent: Agent, buildings: Building[]): number {
  return buildings.some((b) => b.type === "storage" && b.ownerId === agent.id)
    ? STORAGE_PROTECTED_FOOD
    : 0
}

function stealableFood(victim: Agent, buildings: Building[]): number {
  return Math.max(0, victim.inventory.food - protectedFood(victim, buildings))
}

// Raidable: a base of someone the agent has real cause against, in range
function findRaidTarget(agent: Agent, ctx: WorldContext): { base: Building; owner: Agent } | null {
  for (const b of ctx.buildings) {
    if (b.type !== "base" || b.ownerId === agent.id) continue
    if (distance(b, agent) > INTERACTION_RANGE) continue
    const owner = ctx.agents.find((a) => a.id === b.ownerId && a.isAlive)
    if (!owner) continue
    if (wearinessOf(agent, owner.id) >= WEARINESS_EXHAUSTED) continue
    if (attackJustification(agent, owner) >= RAID_MIN_JUSTIFICATION) return { base: b, owner }
  }
  return null
}

function findGiftTarget(agent: Agent, ctx: WorldContext): Agent | null {
  // in a catastrophe, mercy extends even to near-enemies
  const relFloor = ctx.catastropheActive ? CATASTROPHE_GIFT_REL_FLOOR : -50
  const needy = ctx.nearbyAgents
    .filter((a) => (a.hunger > 60 || (ctx.catastropheActive && a.health < 70)) && effectiveRel(agent, a.id) > relFloor)
    .sort((a, b) => b.hunger - a.hunger)
  return needy[0] ?? null
}

// Apologizing again and again to the same person gets ever more expensive
export function peaceCost(agent: Agent, targetId: string): number {
  const prior = agent.peaceHistory[targetId] ?? 0
  return Math.min(PEACE_MAX_COST, PEACE_COST_FOOD + prior * PEACE_REPEAT_SURCHARGE)
}

// Someone nearby who holds a real grudge against this agent — peace candidate
function findPeaceTarget(agent: Agent, ctx: WorldContext): Agent | null {
  const aggrieved = ctx.nearbyAgents
    .filter(
      (a) =>
        (a.grievances[agent.id]?.score ?? 0) >= PEACE_MIN_TARGET_GRIEVANCE &&
        agent.inventory.food >= peaceCost(agent, a.id)
    )
    .sort((a, b) => (b.grievances[agent.id]?.score ?? 0) - (a.grievances[agent.id]?.score ?? 0))
  const planned = aggrieved.find((a) => a.id === agent.aiPlan?.targetId)
  return planned ?? aggrieved[0] ?? null
}

// --- Decision engine ---

export function computeUtilities(agent: Agent, ctx: WorldContext): Record<ActionType, number> {
  const { aggression, greed, cooperation, curiosity } = agent.personality
  const { hunger, energy, health, inventory } = agent
  const { nearbyAgents, nearbyTiles } = ctx

  const hatred = getMaxHatred(agent)
  const hasFoodNearby = nearbyTiles.some((t) => t.food > 0)
  const hasWoodNearby = nearbyTiles.some((t) => t.wood > 0)
  const hasStoneNearby = nearbyTiles.some((t) => t.stone > 0)
  const hasTradePartner = pickTradePartner(agent, ctx) !== null
  // Violence requires justification — and the will to keep fighting (weariness)
  const attackable = nearbyAgents.filter(
    (a) =>
      attackJustification(agent, a) >= ATTACK_MIN_JUSTIFICATION &&
      wearinessOf(agent, a.id) < WEARINESS_EXHAUSTED
  )
  const bestTarget = pickAttackTarget(agent, ctx)
  const attackWeariness = bestTarget ? wearinessFactor(agent, bestTarget.id) : 1
  const stealable =
    inventory.food >= 10
      ? [] // no room to carry loot — theft for hoarding's sake is pointless
      : nearbyAgents.filter(
          (a) =>
            stealableFood(a, ctx.buildings) > 0 &&
            (attackJustification(agent, a) >= STEAL_MIN_JUSTIFICATION || agent.hunger > 80) &&
            effectiveRel(agent, a.id) <= 40
        )
  const raidTarget = findRaidTarget(agent, ctx)
  const giftTarget = findGiftTarget(agent, ctx)
  const peaceTarget = findPeaceTarget(agent, ctx)
  const canBuild = chooseBuildingType(agent, ctx.buildings) !== null
  const cap = 10
  // a declared war plan hardens resolve, but never bypasses justification
  const effAggression = agent.aiPlan?.strategy === "aggress" ? Math.max(aggression, 70) : aggression
  const violenceDamp = ctx.catastropheActive ? CATASTROPHE_VIOLENCE_DAMPING : 1
  // Industry runs on greed OR self-reliance OR proven commerce. A loner who
  // can't lean on trade homesteads (Hermit); a merchant whose trades have made
  // them rich reinvests in buildings (Diplomat) — so all archetypes can build.
  const independence = (100 - cooperation) * 0.7
  const commerce = Math.min(60, agent.stats.trades * 1.5) // each completed trade earns build ambition
  const industry = Math.max(greed, independence, commerce)

  const utilities: Record<ActionType, number> = {
    eat: hunger > 20 && inventory.food > 0 ? hunger * 3 : 0,
    gather_food: hasFoodNearby && inventory.food < cap ? hunger * 2 + curiosity * 0.3 : 0,
    sleep: energy < 80 ? (100 - energy) * 1.5 : 0,
    heal: health < 70 ? (100 - health) * 2 : 0,
    gather_wood: hasWoodNearby && inventory.wood < cap ? industry * 0.8 + (10 - inventory.wood) * 1.5 : 0,
    gather_stone: hasStoneNearby && inventory.stone < cap ? industry * 0.6 + (10 - inventory.stone) * 1.2 : 0,
    build: canBuild ? industry * 1.2 : 0,
    trade: hasTradePartner ? cooperation * 1.1 : 0,
    gift:
      giftTarget && inventory.food >= 4 && hunger < 60
        ? cooperation * 1.2 + (ctx.catastropheActive ? 40 : 0) + (giftTarget.hunger > 80 ? 20 : 0)
        : 0,
    make_peace:
      peaceTarget && inventory.food >= peaceCost(agent, peaceTarget.id) + 1 && hunger < 70
        ? cooperation * 0.9 + (peaceTarget.grievances[agent.id]?.score ?? 0) * 0.5
        : 0,
    steal:
      stealable.length > 0 && energy > 30
        ? greed * (effAggression / 100) * (0.6 + hatred / 100) * 1.2 * violenceDamp
        : 0,
    attack:
      attackable.length > 0 && health > 40 && energy > ATTACK_ENERGY_COST
        ? Math.max(effAggression * (hatred / 100) * 1.5, effAggression * 0.5) * violenceDamp * attackWeariness
        : 0,
    raid:
      raidTarget && health > 35 && energy > RAID_ENERGY_COST
        ? (effAggression * 0.6 + greed * 0.4) * violenceDamp * wearinessFactor(agent, raidTarget.owner.id)
        : 0,
    move: curiosity * 0.5 + 5, // always available as fallback
  }

  const bias = agent.aiPlan ? STRATEGY_BIAS[agent.aiPlan.strategy] : undefined
  if (bias) {
    for (const [action, mult] of Object.entries(bias) as [ActionType, number][]) {
      utilities[action] *= mult
    }
  }

  return utilities
}

export function getHardOverride(agent: Agent, ctx: WorldContext): ActionType | null {
  if (agent.hunger >= 95) {
    if (agent.inventory.food > 0) return "eat"
    if (ctx.nearbyTiles.some((t) => t.food > 0)) return "gather_food"
    return "move" // go find food
  }
  if (agent.health <= 10) return "heal"
  if (agent.energy <= 5) return "sleep"
  return null
}

export function getBestAction(agent: Agent, ctx: WorldContext): ActionType {
  const utilities = computeUtilities(agent, ctx)
  const sorted = (Object.entries(utilities) as [ActionType, number][])
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])

  if (sorted.length === 0) return "move"

  // Tie-breaking: scores within 5 points of the leader → pick randomly among them
  const top = sorted[0][1]
  const contenders = sorted.filter(([, score]) => top - score <= 5)
  return contenders[Math.floor(random() * contenders.length)][0]
}

// --- Target helpers ---

function pickAttackTarget(agent: Agent, ctx: WorldContext): Agent | null {
  const targets = ctx.nearbyAgents
    .filter(
      (a) =>
        attackJustification(agent, a) >= ATTACK_MIN_JUSTIFICATION &&
        wearinessOf(agent, a.id) < WEARINESS_EXHAUSTED
    )
    .sort((a, b) => attackJustification(agent, b) - attackJustification(agent, a))
  const planned = targets.find((a) => a.id === agent.aiPlan?.targetId)
  return planned ?? targets[0] ?? null
}

function pickStealTarget(agent: Agent, ctx: WorldContext): Agent | null {
  const targets = ctx.nearbyAgents
    .filter(
      (a) =>
        stealableFood(a, ctx.buildings) > 0 &&
        (attackJustification(agent, a) >= STEAL_MIN_JUSTIFICATION || agent.hunger > 80) &&
        effectiveRel(agent, a.id) <= 40
    )
    .sort((a, b) => stealableFood(b, ctx.buildings) - stealableFood(a, ctx.buildings))
  const planned = targets.find((a) => a.id === agent.aiPlan?.targetId)
  return planned ?? targets[0] ?? null
}

function pickTradePartner(agent: Agent, ctx: WorldContext): Agent | null {
  const partners = ctx.nearbyAgents
    .filter(
      (a) =>
        effectiveRel(agent, a.id) > -40 &&
        (a.inventory.food > 2 || a.inventory.wood > 2) &&
        // each pair trades at most once per cooldown window — no wealth-minting loops
        ctx.day - (agent.lastTrades[a.id] ?? -Infinity) >= TRADE_COOLDOWN_DAYS
    )
    .sort((a, b) => effectiveRel(agent, b.id) - effectiveRel(agent, a.id))
  return partners[0] ?? null
}

// --- Movement ---

function moveTarget(agent: Agent, ctx: WorldContext): { x: number; y: number; goal: string } {
  const { tiles } = ctx
  if (agent.hunger > 50) {
    const t = findNearestTile(tiles, agent, (tile) => tile.food > 2)
    if (t) return { x: t.x, y: t.y, goal: "Searching for food" }
  }
  // the AI plan steers movement toward (or away from) its target
  const plan = agent.aiPlan
  if (plan?.targetId) {
    const target = ctx.agents.find((a) => a.id === plan.targetId && a.isAlive)
    if (target) {
      if (plan.strategy === "aggress" && distance(agent, target) > INTERACTION_RANGE) {
        // march on their base, not wherever they wander
        const base = getAgentBase(target, ctx.buildings)
        const dest = base ?? target
        if (distance(agent, dest) > INTERACTION_RANGE) {
          return { x: dest.x, y: dest.y, goal: `Marching on ${target.name}'s ${base ? "base" : "position"}` }
        }
      }
      if (
        (plan.strategy === "socialize" || plan.strategy === "help" || plan.strategy === "reconcile") &&
        distance(agent, target) > INTERACTION_RANGE
      ) {
        const goal = plan.strategy === "reconcile" ? `Going to make peace with ${target.name}` : `Seeking out ${target.name}`
        return { x: target.x, y: target.y, goal }
      }
      if (plan.strategy === "avoid") {
        const fleeX = agent.x + Math.sign(agent.x - target.x) * 5
        const fleeY = agent.y + Math.sign(agent.y - target.y) * 5
        return {
          x: Math.max(0, Math.min(MAP_SIZE - 1, fleeX)),
          y: Math.max(0, Math.min(MAP_SIZE - 1, fleeY)),
          goal: `Avoiding ${target.name}`,
        }
      }
    }
  }
  // social pull: aggressive agents hunt, cooperative agents visit
  const { aggression, cooperation } = agent.personality
  if (aggression > 55 || cooperation > 60) {
    const others = ctx.agents
      .filter((a) => a.id !== agent.id && a.isAlive)
      .sort((a, b) => distance(agent, a) - distance(agent, b))
    const target = others[0]
    if (target && distance(agent, target) > INTERACTION_RANGE) {
      const goal = aggression > cooperation ? `Stalking ${target.name}` : `Visiting ${target.name}`
      return { x: target.x, y: target.y, goal }
    }
  }
  if (agent.inventory.wood < 5) {
    const t = findNearestTile(tiles, agent, (tile) => tile.terrain === "forest" && tile.wood > 0)
    if (t) return { x: t.x, y: t.y, goal: "Heading to the forest" }
  }
  if (agent.personality.curiosity > 50) {
    const t = findNearestTile(
      tiles,
      { x: agent.homeTile.x, y: agent.homeTile.y },
      (tile) => isPassable(tile) && distance(tile, agent.homeTile) > 6
    )
    if (t) return { x: t.x, y: t.y, goal: "Exploring" }
  }
  return { x: agent.x, y: agent.y, goal: "Wandering" }
}

function stepToward(agent: Agent, target: { x: number; y: number }, tiles: Tile[][]): void {
  const dx = Math.sign(target.x - agent.x)
  const dy = Math.sign(target.y - agent.y)

  const candidates: { x: number; y: number }[] = []
  if (dx !== 0 || dy !== 0) candidates.push({ x: agent.x + dx, y: agent.y + dy })
  if (dx !== 0) candidates.push({ x: agent.x + dx, y: agent.y })
  if (dy !== 0) candidates.push({ x: agent.x, y: agent.y + dy })
  // random fallback neighbors
  for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]].sort(() => random() - 0.5)) {
    candidates.push({ x: agent.x + ox, y: agent.y + oy })
  }

  for (const c of candidates) {
    const tile = getTile(tiles, c.x, c.y)
    if (tile && isPassable(tile)) {
      agent.x = c.x
      agent.y = c.y
      return
    }
  }
  // stuck in a corner: stay put
}

// --- Social consequences ---

function milestoneEvent(
  milestone: RelationshipMilestone,
  a: Agent,
  b: Agent,
  day: number
): EventLogEntry | null {
  if (milestone === "enemies") {
    return makeEvent(
      day,
      `${a.name} and ${b.name} are now enemies (relationship: ${a.relationships[b.id]})`,
      3,
      [a.id, b.id]
    )
  }
  if (milestone === "best_friends") {
    return makeEvent(
      day,
      `${a.name} and ${b.name} are now best friends (relationship: ${a.relationships[b.id]})`,
      3,
      [a.id, b.id]
    )
  }
  return null
}

// Society reacts to violence: justified force is tolerated, unprovoked
// aggression makes an outcast, and the victim's friends close ranks.
function applyWitnessReactions(
  attacker: Agent,
  victim: Agent,
  justified: boolean,
  ctx: WorldContext,
  events: EventLogEntry[]
): void {
  for (const witness of ctx.agents) {
    if (!witness.isAlive || witness.id === attacker.id || witness.id === victim.id) continue
    if (!justified) {
      updateRelationship(witness, attacker.id, -15)
      addGrievance(witness, attacker.id, GRIEVANCE.unjustifiedWitness, `attacked ${victim.name} without cause`)
    } else {
      updateRelationship(witness, attacker.id, -3)
    }
    if ((witness.relationships[victim.id] ?? 0) >= 40) {
      addGrievance(witness, attacker.id, GRIEVANCE.defensivePact, `harmed my friend ${victim.name}`)
      witness.needsReplan = true
    }
  }
  if (!justified) {
    events.push(
      makeEvent(ctx.day, `The island turns on ${attacker.name} for unprovoked violence against ${victim.name}`, 3, [
        attacker.id,
        victim.id,
      ])
    )
  }
}

function handleKill(killer: Agent, victim: Agent, ctx: WorldContext, events: EventLogEntry[]): void {
  victim.isAlive = false
  victim.deathDay = ctx.day
  victim.currentGoal = "Dead"
  events.push(makeEvent(ctx.day, `${killer.name} killed ${victim.name}!`, 3, [killer.id, victim.id]))
  for (const other of ctx.agents) {
    if (other.id === killer.id || other.id === victim.id) continue
    if ((other.relationships[victim.id] ?? 0) > 0) {
      updateRelationship(other, killer.id, -50)
      addGrievance(other, killer.id, GRIEVANCE.defensivePact, `killed ${victim.name}`)
    }
  }
}

// --- Execution ---

export function executeAction(action: ActionType, agent: Agent, ctx: WorldContext): EventLogEntry[] {
  const events: EventLogEntry[] = []
  const { tiles, day } = ctx
  agent.currentAction = action

  switch (action) {
    case "eat": {
      if (agent.inventory.food <= 0) break
      const cost = Math.min(EAT_FOOD_COST, agent.inventory.food)
      agent.inventory.food -= cost
      agent.hunger = clamp(agent.hunger - EAT_HUNGER_REDUCE, 0, 100)
      agent.currentGoal = "Eating"
      break
    }

    case "gather_food":
    case "gather_wood":
    case "gather_stone": {
      const resource = action === "gather_food" ? "food" : action === "gather_wood" ? "wood" : "stone"
      const amount =
        resource === "food" ? GATHER_FOOD_AMOUNT : resource === "wood" ? GATHER_WOOD_AMOUNT : GATHER_STONE_AMOUNT
      const source = ctx.nearbyTiles
        .filter((t) => t[resource] > 0)
        .sort((a, b) => distance(agent, a) - distance(agent, b))[0]
      if (!source) break
      const cap = getCapacity(agent, ctx)
      const taken = Math.min(amount, source[resource], cap - agent.inventory[resource])
      if (taken <= 0) break
      source[resource] -= taken
      agent.inventory[resource] += taken
      agent.currentGoal = `Gathering ${resource}`

      // harvesting inside someone else's territory breeds resentment
      const ownerId = territoryOwner(source.x, source.y, ctx.agents, TERRITORY_RADIUS)
      if (ownerId && ownerId !== agent.id) {
        const owner = ctx.agents.find((a) => a.id === ownerId)
        if (owner?.isAlive) {
          // trespass anger plateaus — it justifies confrontation, not a kill campaign
          const existing = owner.grievances[agent.id]?.score ?? 0
          const room = TRESPASS_GRIEVANCE_CAP - existing
          if (room > 0) {
            addGrievance(owner, agent.id, Math.min(GRIEVANCE.trespass, room), `harvests my territory`)
          }
          updateRelationship(owner, agent.id, -2)
          if (random() < 0.15) {
            events.push(
              makeEvent(day, `${agent.name} harvested ${resource} in ${owner.name}'s territory`, 1, [agent.id, ownerId])
            )
          }
        }
      } else {
        events.push(makeEvent(day, `${agent.name} gathered ${resource} near (${source.x},${source.y})`, 1, [agent.id]))
      }
      break
    }

    case "sleep": {
      const building = getBuildingAt(ctx.buildings, agent.x, agent.y)
      let restore = SLEEP_ENERGY_RESTORE
      if (building?.ownerId === agent.id) {
        if (building.type === "campfire") restore += BUILDING_BONUS.campfire.energyRegen
        if (building.type === "house") restore += BUILDING_BONUS.house.energyRegen
        if (building.type === "base") restore += BUILDING_BONUS.base.energyRegen
      }
      agent.energy = clamp(agent.energy + restore, 0, 100)
      agent.currentGoal = "Sleeping"
      events.push(makeEvent(day, `${agent.name} is sleeping`, 1, [agent.id]))
      break
    }

    case "heal": {
      const building = getBuildingAt(ctx.buildings, agent.x, agent.y)
      let amount = HEAL_AMOUNT
      if (building?.type === "house" && building.ownerId === agent.id) {
        amount += BUILDING_BONUS.house.healthRegen
      }
      agent.health = clamp(agent.health + amount, 0, 100)
      agent.energy = clamp(agent.energy - HEAL_ENERGY_COST, 0, 100)
      agent.currentGoal = "Resting and healing"
      events.push(makeEvent(day, `${agent.name} is recovering`, 1, [agent.id]))
      break
    }

    case "build": {
      const type = chooseBuildingType(agent, ctx.buildings)
      if (!type) break
      const here = getTile(tiles, agent.x, agent.y)
      if (here && isBuildableTile(here)) {
        const building = placeBuilding(agent, type, tiles, ctx.buildings, day)
        if (building) {
          agent.stats.buildingsBuilt++
          agent.currentGoal = `Built a ${type}`
          const weight = type === "campfire" ? 1 : 2
          events.push(
            makeEvent(day, `${agent.name} built a ${type} at (${building.x},${building.y})`, weight, [agent.id])
          )
        }
      } else {
        // current tile occupied or not grass: head to the nearest buildable tile
        const target = findNearestTile(tiles, agent, isBuildableTile)
        if (target) stepToward(agent, target, tiles)
        agent.currentGoal = "Looking for a build site"
      }
      break
    }

    case "trade": {
      const partner = pickTradePartner(agent, ctx)
      if (!partner) break
      // gains from trade: specialization means both sides come out ahead —
      // but received goods are capped by carrying capacity, so wealth can't
      // be minted endlessly by ping-pong trading
      const myCap = getCapacity(agent, ctx)
      const theirCap = getCapacity(partner, ctx)
      let gave: string | null = null
      if (
        agent.inventory.wood >= TRADE_AMOUNT &&
        partner.inventory.food >= TRADE_AMOUNT &&
        agent.inventory.food < myCap &&
        partner.inventory.wood < theirCap
      ) {
        agent.inventory.wood -= TRADE_AMOUNT
        partner.inventory.wood = Math.min(theirCap, partner.inventory.wood + TRADE_AMOUNT + TRADE_BONUS)
        partner.inventory.food -= TRADE_AMOUNT
        agent.inventory.food = Math.min(myCap, agent.inventory.food + TRADE_AMOUNT + TRADE_BONUS)
        gave = "wood for food"
      } else if (
        agent.inventory.food >= TRADE_AMOUNT &&
        partner.inventory.wood >= TRADE_AMOUNT &&
        agent.inventory.wood < myCap &&
        partner.inventory.food < theirCap
      ) {
        agent.inventory.food -= TRADE_AMOUNT
        partner.inventory.food = Math.min(theirCap, partner.inventory.food + TRADE_AMOUNT + TRADE_BONUS)
        partner.inventory.wood -= TRADE_AMOUNT
        agent.inventory.wood = Math.min(myCap, agent.inventory.wood + TRADE_AMOUNT + TRADE_BONUS)
        gave = "food for wood"
      }
      if (!gave) break
      agent.lastTrades[partner.id] = ctx.day
      partner.lastTrades[agent.id] = ctx.day
      agent.stats.trades++
      partner.stats.trades++
      const m1 = updateRelationship(agent, partner.id, 5)
      const m2 = updateRelationship(partner, agent.id, 5)
      agent.currentGoal = `Trading with ${partner.name}`
      events.push(makeEvent(day, `${agent.name} traded ${gave} with ${partner.name}`, 2, [agent.id, partner.id]))
      const me1 = milestoneEvent(m1, agent, partner, day)
      const me2 = milestoneEvent(m2, partner, agent, day)
      if (me1) events.push(me1)
      else if (me2) events.push(me2)
      break
    }

    case "gift": {
      const target = findGiftTarget(agent, ctx)
      if (!target || agent.inventory.food < GIFT_AMOUNT) break
      agent.inventory.food -= GIFT_AMOUNT
      target.inventory.food = Math.min(getCapacity(target, ctx), target.inventory.food + GIFT_AMOUNT)
      const m1 = updateRelationship(target, agent.id, GIFT_REL_GAIN)
      updateRelationship(agent, target.id, 5)
      // kindness is seen and remembered by everyone
      for (const witness of ctx.agents) {
        if (witness.isAlive && witness.id !== agent.id && witness.id !== target.id) {
          updateRelationship(witness, agent.id, GIFT_WITNESS_GAIN)
        }
      }
      agent.stats.gifts++
      target.stats.giftsReceived++
      driftTrait(target, "cooperation", DRIFT_KINDNESS_COOP)
      agent.currentGoal = `Helping ${target.name}`
      events.push(makeEvent(day, `❤️ ${agent.name} shared food with ${target.name}`, 2, [agent.id, target.id]))
      const me = milestoneEvent(m1, target, agent, day)
      if (me) events.push(me)
      break
    }

    case "make_peace": {
      const target = findPeaceTarget(agent, ctx)
      if (!target) break
      const cost = peaceCost(agent, target.id)
      if (agent.inventory.food < cost) break
      const grudge = target.grievances[agent.id]
      const priorOffers = agent.peaceHistory[target.id] ?? 0
      agent.peaceHistory[target.id] = priorOffers + 1

      // a proud or repeatedly-wronged target may refuse the olive branch —
      // serial offenders' apologies ring hollow
      const prideRefusal =
        target.personality.aggression > 75 && (grudge?.score ?? 0) > 60 ? 0.5 : 0
      const fatigueRefusal = Math.min(0.8, priorOffers * PEACE_REPEAT_REFUSAL)
      if (random() < Math.max(prideRefusal, fatigueRefusal)) {
        if (grudge) grudge.score = Math.max(0, grudge.score - 10)
        agent.currentGoal = `Rebuffed by ${target.name}`
        events.push(
          makeEvent(day, `🕊️ ${agent.name} offered peace to ${target.name} — and was rejected`, 3, [agent.id, target.id])
        )
        break
      }

      agent.inventory.food -= cost
      target.inventory.food = Math.min(getCapacity(target, ctx), target.inventory.food + cost)
      if (grudge) {
        grudge.score = Math.max(0, grudge.score - PEACE_GRIEVANCE_RELIEF)
        if (grudge.score === 0) delete target.grievances[agent.id]
      }
      const own = agent.grievances[target.id]
      if (own) {
        own.score = Math.max(0, own.score - PEACE_OWN_RELIEF)
        if (own.score === 0) delete agent.grievances[target.id]
      }
      const m1 = updateRelationship(target, agent.id, PEACE_REL_GAIN)
      updateRelationship(agent, target.id, PEACE_REL_GAIN / 2)
      driftTrait(target, "cooperation", DRIFT_KINDNESS_COOP)
      agent.stats.peaceOffers++
      target.needsReplan = true
      agent.currentGoal = `Making peace with ${target.name}`
      events.push(
        makeEvent(day, `🕊️ ${agent.name} offered reparations to ${target.name} — the feud cools`, 3, [agent.id, target.id])
      )
      const me = milestoneEvent(m1, target, agent, day)
      if (me) events.push(me)
      break
    }

    case "steal": {
      const victim = pickStealTarget(agent, ctx)
      if (!victim) break
      // the granary holds: only food outside the storage can be taken
      const taken = Math.min(
        STEAL_AMOUNT,
        stealableFood(victim, ctx.buildings),
        getCapacity(agent, ctx) - agent.inventory.food
      )
      if (taken <= 0) break
      victim.inventory.food -= taken
      agent.inventory.food += taken
      agent.stats.steals++
      victim.stats.timesRobbed++
      driftTrait(victim, "cooperation", DRIFT_ROBBED_COOP)
      agent.currentGoal = `Stealing from ${victim.name}`
      if (random() < STEAL_CATCH_CHANCE) {
        const m1 = updateRelationship(victim, agent.id, -20)
        updateRelationship(agent, victim.id, -5) // guilt
        addGrievance(victim, agent.id, GRIEVANCE.caughtStealing, `stole my food`)
        victim.needsReplan = true
        events.push(makeEvent(day, `${agent.name} was caught stealing from ${victim.name}!`, 3, [agent.id, victim.id]))
        const me = milestoneEvent(m1, victim, agent, day)
        if (me) events.push(me)
      } else {
        events.push(makeEvent(day, `${agent.name} stole food from ${victim.name}`, 2, [agent.id, victim.id]))
      }
      break
    }

    case "attack": {
      const target = pickAttackTarget(agent, ctx)
      if (!target) break
      const cause = attackJustification(agent, target)
      agent.energy = clamp(agent.energy - ATTACK_ENERGY_COST, 0, 100)
      target.health = clamp(target.health - ATTACK_BASE_DAMAGE, 0, 100)
      const m1 = updateRelationship(target, agent.id, -30)
      updateRelationship(agent, target.id, -10)
      addGrievance(target, agent.id, GRIEVANCE.attacked, `attacked me`)
      agent.stats.attacks++
      target.stats.timesAttacked++
      driftTrait(target, "cooperation", DRIFT_BETRAYED_COOP)
      driftTrait(target, "aggression", DRIFT_BETRAYED_AGGR)
      // every swing tires the attacker of this war; being struck re-provokes the victim
      const worn = wearinessOf(agent, target.id) + WEARINESS_PER_ATTACK
      if (worn >= WEARINESS_EXHAUSTED && wearinessOf(agent, target.id) < WEARINESS_EXHAUSTED) {
        // burnout latches: the will to fight this war is gone for a long time
        agent.warWeariness[target.id] = WEARINESS_BURNOUT
        events.push(
          makeEvent(day, `🏳️ ${agent.name} has lost the will to keep fighting ${target.name} — the war burns out`, 3, [
            agent.id,
            target.id,
          ])
        )
      } else {
        agent.warWeariness[target.id] = worn
      }
      // being struck re-provokes — but a burned-out will doesn't return under fire
      const targetWorn = wearinessOf(target, agent.id)
      if (targetWorn < WEARINESS_EXHAUSTED) {
        target.warWeariness[agent.id] = Math.max(0, targetWorn - WEARINESS_PROVOKED_RELIEF)
      }
      target.needsReplan = true
      agent.currentGoal = `Fighting ${target.name}`
      events.push(
        makeEvent(
          day,
          `${agent.name} attacked ${target.name}! (${target.name} now has ${Math.round(target.health)} health)`,
          3,
          [agent.id, target.id]
        )
      )
      const me = milestoneEvent(m1, target, agent, day)
      if (me) events.push(me)

      // the defender fights back
      if (target.health > 30 && target.isAlive) {
        agent.health = clamp(agent.health - RETALIATION_DAMAGE, 0, 100)
      }

      applyWitnessReactions(agent, target, cause >= 50, ctx, events)

      if (target.health <= 0 && target.isAlive) {
        agent.stats.kills++
        handleKill(agent, target, ctx, events)
      }
      if (agent.health <= 0 && agent.isAlive) {
        agent.isAlive = false
        agent.deathDay = day
        agent.currentGoal = "Dead"
        events.push(makeEvent(day, `${agent.name} died of wounds while attacking ${target.name}!`, 3, [agent.id, target.id]))
      }
      break
    }

    case "raid": {
      const found = findRaidTarget(agent, ctx)
      if (!found) break
      const { base, owner } = found
      const cause = attackJustification(agent, owner)
      agent.energy = clamp(agent.energy - RAID_ENERGY_COST, 0, 100)
      base.hp -= RAID_BASE_DAMAGE
      const loot = Math.max(
        0,
        Math.min(RAID_LOOT, owner.inventory.food, getCapacity(agent, ctx) - agent.inventory.food)
      )
      owner.inventory.food -= loot
      agent.inventory.food += loot
      updateRelationship(owner, agent.id, -25)
      addGrievance(owner, agent.id, GRIEVANCE.raided, `raided my base`)
      agent.stats.raids++
      driftTrait(owner, "cooperation", DRIFT_BETRAYED_COOP)
      driftTrait(owner, "aggression", DRIFT_BETRAYED_AGGR)
      const raidWorn = wearinessOf(agent, owner.id) + WEARINESS_PER_RAID
      agent.warWeariness[owner.id] = raidWorn >= WEARINESS_EXHAUSTED ? WEARINESS_BURNOUT : raidWorn
      const ownerWorn = wearinessOf(owner, agent.id)
      if (ownerWorn < WEARINESS_EXHAUSTED) {
        owner.warWeariness[agent.id] = Math.max(0, ownerWorn - WEARINESS_PROVOKED_RELIEF)
      }
      owner.needsReplan = true
      agent.currentGoal = `Raiding ${owner.name}'s base`
      events.push(
        makeEvent(day, `🏚️ ${agent.name} raided ${owner.name}'s base! (stole ${loot} food, base at ${Math.max(0, base.hp)} hp)`, 3, [
          agent.id,
          owner.id,
        ])
      )
      applyWitnessReactions(agent, owner, cause >= 50, ctx, events)

      if (base.hp <= 0) {
        destroyBuilding(base, tiles, ctx.buildings)
        events.push(makeEvent(day, `💔 ${agent.name} destroyed ${owner.name}'s base!`, 3, [agent.id, owner.id]))
      }
      break
    }

    case "move": {
      const target = moveTarget(agent, ctx)
      agent.currentGoal = target.goal
      stepToward(agent, target, tiles)
      break
    }
  }

  return events
}

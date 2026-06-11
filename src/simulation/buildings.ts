import type { Agent, Building, BuildingType, Inventory, Tile } from "../types"
import { BUILDING_COSTS, BUILDING_HP, STORAGE_ROBBERY_TRIGGER } from "../constants"
import { getTile } from "./world"

export function canAfford(inventory: Inventory, type: BuildingType): boolean {
  const cost = BUILDING_COSTS[type]
  return inventory.wood >= cost.wood && inventory.stone >= cost.stone
}

// True when the agent can afford any building it would actually want.
export function checkBuildCost(agent: Agent, buildings: Building[]): boolean {
  return chooseBuildingType(agent, buildings) !== null
}

// Build priority: base (rebuild if destroyed) → campfire → house → storage.
// One of each per agent keeps builds meaningful.
export function chooseBuildingType(agent: Agent, buildings: Building[]): BuildingType | null {
  const owned = buildings.filter((b) => b.ownerId === agent.id)
  const has = (type: BuildingType) => owned.some((b) => b.type === type)

  if (!has("base") && canAfford(agent.inventory, "base")) return "base"
  if (!has("campfire") && canAfford(agent.inventory, "campfire")) return "campfire"
  // a granary protects food from thieves — the greedy want one, and being
  // robbed makes a believer of anyone (loners convert after a single theft)
  const robberyTrigger = agent.personality.cooperation < 30 ? 1 : STORAGE_ROBBERY_TRIGGER
  const wantsStorage =
    agent.personality.greed > 60 || agent.stats.timesRobbed >= robberyTrigger
  if (!has("storage") && wantsStorage && canAfford(agent.inventory, "storage")) {
    return "storage"
  }
  if (!has("house") && canAfford(agent.inventory, "house")) return "house"
  return null
}

export function isBuildableTile(tile: Tile): boolean {
  return tile.terrain === "grass" && tile.buildingId === null
}

let buildingCounter = 0

export function placeBuilding(
  agent: Agent,
  type: BuildingType,
  tiles: Tile[][],
  buildings: Building[],
  day: number
): Building | null {
  const tile = getTile(tiles, agent.x, agent.y)
  if (!tile || !isBuildableTile(tile) || !canAfford(agent.inventory, type)) return null

  const cost = BUILDING_COSTS[type]
  agent.inventory.wood -= cost.wood
  agent.inventory.stone -= cost.stone

  const building: Building = {
    id: `b${++buildingCounter}`,
    type,
    ownerId: agent.id,
    x: agent.x,
    y: agent.y,
    builtOnDay: day,
    hp: BUILDING_HP[type],
  }
  buildings.push(building)
  tile.buildingId = building.id

  // a rebuilt base moves "home" — territory follows the hearth
  if (type === "base") {
    agent.homeTile = { x: agent.x, y: agent.y }
  }

  return building
}

// Free starting base on the agent's home tile (used at sim init)
export function placeStartingBase(agent: Agent, tiles: Tile[][], buildings: Building[]): Building {
  const tile = getTile(tiles, agent.homeTile.x, agent.homeTile.y)!
  const building: Building = {
    id: `b${++buildingCounter}`,
    type: "base",
    ownerId: agent.id,
    x: agent.homeTile.x,
    y: agent.homeTile.y,
    builtOnDay: 0,
    hp: BUILDING_HP.base,
  }
  buildings.push(building)
  tile.buildingId = building.id
  return building
}

export function destroyBuilding(building: Building, tiles: Tile[][], buildings: Building[]): void {
  const tile = getTile(tiles, building.x, building.y)
  if (tile && tile.buildingId === building.id) tile.buildingId = null
  const idx = buildings.findIndex((b) => b.id === building.id)
  if (idx !== -1) buildings.splice(idx, 1)
}

export function getAgentBase(agent: Agent, buildings: Building[]): Building | null {
  return buildings.find((b) => b.type === "base" && b.ownerId === agent.id) ?? null
}

export function getBuildingAt(buildings: Building[], x: number, y: number): Building | null {
  return buildings.find((b) => b.x === x && b.y === y) ?? null
}

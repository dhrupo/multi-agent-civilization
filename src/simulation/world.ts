import type { Terrain, Tile } from "../types"
import { MAP_SIZE } from "../constants"
import { random } from "./rng"

const TERRAIN_RESOURCES: Record<Terrain, { food: number; wood: number; stone: number }> = {
  grass: { food: 5, wood: 1, stone: 1 },
  forest: { food: 2, wood: 8, stone: 0 },
  water: { food: 6, wood: 0, stone: 0 },
  mountain: { food: 0, wood: 1, stone: 8 },
}

function randInt(max: number): number {
  return Math.floor(random() * max)
}

function scatterPatches(
  tiles: Tile[][],
  terrain: Terrain,
  patchCount: number,
  minSize: number,
  maxSize: number
): void {
  for (let p = 0; p < patchCount; p++) {
    const size = minSize + randInt(maxSize - minSize + 1)
    let x = randInt(MAP_SIZE)
    let y = randInt(MAP_SIZE)
    for (let i = 0; i < size; i++) {
      const tile = getTile(tiles, x, y)
      if (tile && tile.terrain === "grass") {
        tile.terrain = terrain
      }
      // grow the patch by stepping to a random adjacent tile
      x = Math.max(0, Math.min(MAP_SIZE - 1, x + randInt(3) - 1))
      y = Math.max(0, Math.min(MAP_SIZE - 1, y + randInt(3) - 1))
    }
  }
}

export function generateWorld(): Tile[][] {
  const tiles: Tile[][] = []
  for (let y = 0; y < MAP_SIZE; y++) {
    const row: Tile[] = []
    for (let x = 0; x < MAP_SIZE; x++) {
      row.push({ x, y, terrain: "grass", food: 0, wood: 0, stone: 0, buildingId: null })
    }
    tiles.push(row)
  }

  scatterPatches(tiles, "water", 4, 2, 4)
  scatterPatches(tiles, "forest", 6, 3, 6)
  scatterPatches(tiles, "mountain", 3, 2, 4)

  for (const row of tiles) {
    for (const tile of row) {
      const res = TERRAIN_RESOURCES[tile.terrain]
      tile.food = res.food
      tile.wood = res.wood
      tile.stone = res.stone
    }
  }

  return tiles
}

export function getTile(tiles: Tile[][], x: number, y: number): Tile | null {
  return tiles[y]?.[x] ?? null
}

export function getNeighbors(tiles: Tile[][], x: number, y: number, range: number): Tile[] {
  const result: Tile[] = []
  for (let dy = -range; dy <= range; dy++) {
    for (let dx = -range; dx <= range; dx++) {
      const tile = getTile(tiles, x + dx, y + dy)
      if (tile) result.push(tile)
    }
  }
  return result
}

export function isPassable(tile: Tile): boolean {
  return tile.terrain !== "water" && tile.terrain !== "mountain"
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y))
}

export function findNearestTile(
  tiles: Tile[][],
  from: { x: number; y: number },
  condition: (t: Tile) => boolean
): Tile | null {
  let best: Tile | null = null
  let bestDist = Infinity
  for (const row of tiles) {
    for (const tile of row) {
      if (!condition(tile)) continue
      const d = distance(from, tile)
      if (d < bestDist) {
        bestDist = d
        best = tile
      }
    }
  }
  return best
}

// Which agent's territory is this tile in? Nearest living agent's home wins,
// within TERRITORY_RADIUS; ties (equidistant) make the tile neutral ground.
export function territoryOwner(
  x: number,
  y: number,
  agents: { id: string; isAlive: boolean; homeTile: { x: number; y: number } }[],
  radius: number
): string | null {
  let bestId: string | null = null
  let bestDist = Infinity
  let tied = false
  for (const agent of agents) {
    if (!agent.isAlive) continue
    const d = distance({ x, y }, agent.homeTile)
    if (d > radius) continue
    if (d < bestDist) {
      bestDist = d
      bestId = agent.id
      tied = false
    } else if (d === bestDist) {
      tied = true
    }
  }
  return tied ? null : bestId
}

// One spawn point per map quadrant, on a random passable grass tile.
export function getSpawnPositions(tiles: Tile[][], count: number): { x: number; y: number }[] {
  const half = Math.floor(MAP_SIZE / 2)
  const quadrants = [
    { x0: 0, y0: 0 },
    { x0: half, y0: 0 },
    { x0: 0, y0: half },
    { x0: half, y0: half },
  ]
  const positions: { x: number; y: number }[] = []
  for (let i = 0; i < count; i++) {
    const q = quadrants[i % quadrants.length]
    let placed = false
    for (let attempt = 0; attempt < 100 && !placed; attempt++) {
      const x = q.x0 + randInt(half)
      const y = q.y0 + randInt(half)
      const tile = getTile(tiles, x, y)
      if (tile && tile.terrain === "grass" && !positions.some((p) => p.x === x && p.y === y)) {
        positions.push({ x, y })
        placed = true
      }
    }
    if (!placed) {
      // fallback: quadrant center forced to grass
      const x = q.x0 + Math.floor(half / 2)
      const y = q.y0 + Math.floor(half / 2)
      const tile = getTile(tiles, x, y)!
      tile.terrain = "grass"
      positions.push({ x, y })
    }
  }
  return positions
}

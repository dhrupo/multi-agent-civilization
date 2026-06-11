import type { Agent, AgentConfig, Personality } from "../types"

export const PRESETS: Record<string, Personality> = {
  Warrior: { aggression: 85, greed: 60, cooperation: 20, curiosity: 30 },
  Merchant: { aggression: 20, greed: 80, cooperation: 75, curiosity: 50 },
  Explorer: { aggression: 30, greed: 40, cooperation: 50, curiosity: 95 },
  Hermit: { aggression: 15, greed: 25, cooperation: 15, curiosity: 60 },
  Tyrant: { aggression: 95, greed: 90, cooperation: 10, curiosity: 20 },
  Diplomat: { aggression: 10, greed: 30, cooperation: 95, curiosity: 60 },
}

export const RANDOM_NAMES = [
  "Kai", "Maya", "Rex", "Luna", "Aria", "Finn", "Nova", "Orin",
  "Sage", "Vera", "Milo", "Zara", "Eko", "Iris", "Juno", "Thane",
]

export function randomPersonality(): Personality {
  return {
    aggression: Math.floor(Math.random() * 101),
    greed: Math.floor(Math.random() * 101),
    cooperation: Math.floor(Math.random() * 101),
    curiosity: Math.floor(Math.random() * 101),
  }
}

export function matchPreset(p: Personality): string | null {
  for (const [name, preset] of Object.entries(PRESETS)) {
    if (
      preset.aggression === p.aggression &&
      preset.greed === p.greed &&
      preset.cooperation === p.cooperation &&
      preset.curiosity === p.curiosity
    ) {
      return name
    }
  }
  return null
}

export function createAgent(
  id: string,
  name: string,
  color: string,
  personality: Personality,
  startTile: { x: number; y: number }
): Agent {
  return {
    id,
    name,
    color,
    x: startTile.x,
    y: startTile.y,
    homeTile: { ...startTile },
    health: 100,
    hunger: 20,
    energy: 80,
    inventory: { food: 3, wood: 0, stone: 0 },
    personality: { ...personality },
    relationships: {},
    currentAction: null,
    currentGoal: "Waking up...",
    isAlive: true,
    score: 0,
    deathDay: null,
    aiPlan: null,
    needsReplan: false,
    grievances: {},
    lastTrades: {},
    stats: {
      trades: 0,
      gifts: 0,
      giftsReceived: 0,
      steals: 0,
      raids: 0,
      attacks: 0,
      kills: 0,
      timesAttacked: 0,
      timesRobbed: 0,
      peaceOffers: 0,
      buildingsBuilt: 0,
    },
    mindId: null,
    peaceHistory: {},
    warWeariness: {},
    basePersonality: { ...personality },
  }
}

export const DEV_CONFIG: AgentConfig[] = [
  { name: "Kai", color: "#e63946", personality: PRESETS.Warrior },
  { name: "Maya", color: "#457b9d", personality: PRESETS.Merchant },
  { name: "Rex", color: "#52b788", personality: PRESETS.Tyrant },
  { name: "Luna", color: "#e9c46a", personality: PRESETS.Hermit },
]

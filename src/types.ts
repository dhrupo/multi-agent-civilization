export type Terrain = "grass" | "forest" | "water" | "mountain"

export type Tile = {
  x: number
  y: number
  terrain: Terrain
  food: number // 0–10, regenerates over time
  wood: number // 0–10
  stone: number // 0–10
  buildingId: string | null
}

export type Personality = {
  aggression: number // 0–100
  greed: number // 0–100
  cooperation: number // 0–100
  curiosity: number // 0–100
}

export type Inventory = {
  food: number
  wood: number
  stone: number
}

export type Agent = {
  id: string
  name: string
  color: string // hex color
  x: number // current tile x
  y: number // current tile y
  homeTile: { x: number; y: number }
  health: number // 0–100
  hunger: number // 0–100, higher = more hungry
  energy: number // 0–100
  inventory: Inventory
  personality: Personality
  relationships: Record<string, number> // agentId → -100 to +100
  currentAction: ActionType | null
  currentGoal: string // human-readable string for UI
  isAlive: boolean
  score: number
  deathDay: number | null
  aiPlan: AiPlan | null
  needsReplan: boolean // set when something dramatic happens to this agent
  grievances: Record<string, Grievance> // agentId → remembered wrongs
  lastTrades: Record<string, number> // agentId → day of last trade (per-pair cooldown)
  stats: AgentStats // lifetime action counters, for the end-screen analysis
  mindId: string | null // which AI mind profile drives this agent (null = default)
  peaceHistory: Record<string, number> // agentId → reparations already offered to them
  warWeariness: Record<string, number> // agentId → fatigue from fighting them (wars burn out)
  basePersonality: Personality // who they were at the start — drift is measured from here
}

export type Season = "spring" | "summer" | "autumn" | "winter"

export type SocietyMetric = {
  day: number
  trust: number // mean of all directed relationships
  wealth: number // sum of scores
  violence: number // cumulative attacks + raids
  trades: number // cumulative trades
}

export type AgentStats = {
  trades: number
  gifts: number
  giftsReceived: number
  steals: number
  raids: number
  attacks: number
  kills: number
  timesAttacked: number
  timesRobbed: number
  peaceOffers: number
  buildingsBuilt: number
}

export type BuildingType = "base" | "campfire" | "house" | "storage"

export type Building = {
  id: string
  type: BuildingType
  ownerId: string
  x: number
  y: number
  builtOnDay: number
  hp: number // bases and houses can be damaged by raids and earthquakes
}

// A grievance is a remembered wrong — the only legitimate fuel for violence
export type Grievance = {
  score: number // 0–100, decays over time
  reasons: string[] // last few human-readable causes
}

export type CatastropheType = "storm" | "blight" | "earthquake"

export type Catastrophe = {
  type: CatastropheType
  startDay: number
  endDay: number
}

export type AiStrategy =
  | "gather"
  | "build"
  | "trade"
  | "aggress"
  | "avoid"
  | "socialize"
  | "survive"
  | "help"
  | "reconcile"

export type AiStance = "ally" | "neutral" | "enemy"

export type AiPlan = {
  strategy: AiStrategy
  targetId: string | null // agent the strategy is aimed at (aggress/avoid/socialize)
  stances: Record<string, AiStance> // agentId → declared stance
  thought: string // in-character inner monologue
  decidedOnDay: number
  validUntilDay: number
}

export type ActionType =
  | "gather_food"
  | "gather_wood"
  | "gather_stone"
  | "move"
  | "eat"
  | "sleep"
  | "build"
  | "trade"
  | "steal"
  | "attack"
  | "heal"
  | "raid"
  | "gift"
  | "make_peace"

export type EventLogEntry = {
  id: string
  day: number
  text: string
  weight: number // 1 = minor, 2 = notable, 3 = dramatic
  involvedIds: string[] // agent IDs
}

export type GamePhase = "setup" | "running" | "ended"

export type SimState = {
  phase: GamePhase
  day: number
  endDay: number // user-chosen run length in days
  tick: number
  speed: number // 1 | 2 — kept slow so the AI minds (and API budget) keep pace
  isPaused: boolean
  agents: Agent[]
  tiles: Tile[][]
  buildings: Building[]
  events: EventLogEntry[]
  selectedAgentId: string | null
  winner: Agent | null
  catastrophe: Catastrophe | null
  lastCatastropheEnd: number // day the last catastrophe ended (enforces a gap)
  catastropheCount: number
  scoreHistory: Record<string, number[]> // agentId → score samples (every 10 days)
  societyHistory: SocietyMetric[] // island-level health, sampled every 10 days
}

export type AgentConfig = {
  name: string
  color: string
  personality: Personality
  mindId?: string | null // saved AI mind profile; null/undefined = default provider
}

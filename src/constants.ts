// --- Map ---
export const MAP_SIZE = 20

// --- Simulation time ---
export const DEFAULT_SIM_END_DAY = 365
export const MIN_SIM_DAYS = 30
export const MAX_SIM_DAYS = 9999
export const TICK_MS_BASE = 500 // at 1×: 2 days per second — slow enough for AI minds to keep up
export const TICKS_PER_DAY = 1 // 1 tick = 1 day (simplest model)

// --- Needs decay per tick ---
export const HUNGER_PER_TICK = 3 // hunger rises 3/tick
export const ENERGY_DECAY = 1 // energy falls 1/tick
export const HEALTH_REGEN = 0.5 // health recovers 0.5/tick when not starving

// --- Damage ---
export const STARVATION_DAMAGE = 5 // health lost/tick at hunger >= 100
export const ATTACK_BASE_DAMAGE = 15 // base damage per attack action

// --- Resource regen ---
export const TILE_REGEN_CHANCE = 0.05 // 5% chance per tick a tile regains 1 resource
export const TILE_MAX_RESOURCE = 10

// --- Gather amounts ---
export const GATHER_FOOD_AMOUNT = 3
export const GATHER_WOOD_AMOUNT = 2
export const GATHER_STONE_AMOUNT = 2

// --- Eat amount ---
export const EAT_FOOD_COST = 2 // food consumed when eating
export const EAT_HUNGER_REDUCE = 20 // hunger reduced when eating

// --- Sleep ---
export const SLEEP_ENERGY_RESTORE = 25

// --- Heal ---
export const HEAL_AMOUNT = 15
export const HEAL_ENERGY_COST = 10

// --- Trade ---
export const TRADE_AMOUNT = 2 // units exchanged per trade
export const TRADE_BONUS = 1 // gains from trade: both sides come out ahead
export const TRADE_COOLDOWN_DAYS = 4 // per-pair: prevents infinite trade loops minting wealth

// --- Steal ---
export const STEAL_AMOUNT = 3
export const STEAL_CATCH_CHANCE = 0.4 // 40% chance victim notices
// a storage building is a locked granary: this much of the owner's food is theft-proof
export const STORAGE_PROTECTED_FOOD = 6
export const STORAGE_ROBBERY_TRIGGER = 3 // being robbed this often makes anyone want a granary

// --- Buildings ---
export const BUILDING_COSTS = {
  base: { wood: 6, stone: 2 },
  campfire: { wood: 3, stone: 1 },
  house: { wood: 8, stone: 4 },
  storage: { wood: 5, stone: 5 },
} as const

export const BUILDING_BONUS = {
  base: { healthRegen: 1, energyRegen: 2 },
  campfire: { energyRegen: 5 },
  house: { healthRegen: 2, energyRegen: 3 },
  storage: { storageMultiplier: 1.5 },
} as const

export const BUILDING_HP = {
  base: 100,
  campfire: 40,
  house: 80,
  storage: 60,
} as const

// --- Territory ---
export const TERRITORY_RADIUS = 7 // tiles around an agent's base that belong to them

// --- Justified violence: humans need reasons to fight ---
export const ATTACK_MIN_JUSTIFICATION = 30
export const RAID_MIN_JUSTIFICATION = 25
export const STEAL_MIN_JUSTIFICATION = 15
export const DESPERATION_JUSTIFICATION = 40 // starving + target hoards food
export const ATTACK_ENERGY_COST = 12
export const RAID_ENERGY_COST = 15
export const RETALIATION_DAMAGE = 8 // defenders fight back
export const RAID_BASE_DAMAGE = 25
export const RAID_LOOT = 4

// --- War weariness: fruitless wars exhaust the aggressor and burn out ---
export const WEARINESS_PER_ATTACK = 4 // each swing tires you of this war
export const WEARINESS_PER_RAID = 4
export const WEARINESS_PROVOKED_RELIEF = 0.5 // being hit re-provokes a little
export const WEARINESS_DECAY = 0.25 // per 10 days — wars are forgotten slowly
export const WEARINESS_DAMPING = 0.08 // attack utility ÷ (1 + weariness × this)
export const WEARINESS_EXHAUSTED = 24 // beyond this, you simply refuse to keep fighting them
export const WEARINESS_BURNOUT = 60 // crossing the line latches here — burned-out wars stay out for years

// --- Grievance scores per wrong (heavier = grudges form faster, friction rises) ---
export const GRIEVANCE = {
  attacked: 35,
  raided: 32,
  caughtStealing: 22,
  trespass: 10,
  unjustifiedWitness: 15, // everyone resents an unprovoked aggressor
  defensivePact: 25, // friends of a victim turn on the attacker
} as const

// Foraging in your land justifies confrontation (raids, ≥25), never a kill
// campaign (attacks need ≥30) — unless combined with worse wrongs
export const TRESPASS_GRIEVANCE_CAP = 28

// --- Mutual aid ---
export const GIFT_AMOUNT = 2
export const GIFT_REL_GAIN = 15
export const GIFT_WITNESS_GAIN = 4 // kindness improves standing with everyone

// --- Reconciliation: feuds can end, but peace is reserved for real feuds ---
export const PEACE_COST_FOOD = 4 // reparations offered — forgiveness isn't cheap
export const PEACE_GRIEVANCE_RELIEF = 60 // how much of the target's grudge is settled
export const PEACE_OWN_RELIEF = 30 // offering peace also means letting go
export const PEACE_REL_GAIN = 20
export const PEACE_MIN_TARGET_GRIEVANCE = 30 // petty slights don't warrant reparations
// serial offenders find forgiveness ever more expensive and ever less likely —
// closes the steal-apologize-steal exploit
export const PEACE_REPEAT_SURCHARGE = 3 // extra food per prior offer to the same person
export const PEACE_MAX_COST = 13
export const PEACE_REPEAT_REFUSAL = 0.2 // added refusal chance per prior offer (cap 0.8)

// --- Catastrophes ---
export const CATASTROPHE_DAILY_CHANCE = 0.02
export const CATASTROPHE_MIN_GAP_DAYS = 60
export const CATASTROPHE_MIN_DURATION = 6
export const CATASTROPHE_MAX_DURATION = 12
export const STORM_HEALTH_DRAIN = 5
export const STORM_ENERGY_DRAIN = 2
export const HUDDLE_PROTECTION = 3 // storm drain reduced when sheltering near another person
export const BLIGHT_HUNGER_MULT = 2.2
export const EARTHQUAKE_BUILDING_DAMAGE = 50
export const EARTHQUAKE_HEALTH_HIT = 25
export const CATASTROPHE_VIOLENCE_DAMPING = 0.25 // violence feels wrong in a crisis
export const CATASTROPHE_GIFT_REL_FLOOR = -80 // in a crisis, mercy extends even to near-enemies
export const BLIGHT_FOOD_SPOIL = 0.3 // stored food rots — disasters touch the rich too
export const STORM_WOOD_LOSS = 0.2 // the wind scatters stockpiled wood

// --- Scoring weights ---
export const SCORE_WEIGHTS = {
  food: 1,
  wood: 0.5,
  stone: 0.5,
  building: 20,
  health: 1,
}

// --- Relationship deltas ---
export const REL_DELTA = {
  trade: +5,
  help: +10,
  gift: +15,
  steal: -20,
  attack: -30,
  kill: -100,
}

// --- Proximity (tiles) ---
export const INTERACTION_RANGE = 2 // must be within 2 tiles to interact

// --- Agent colors ---
export const AGENT_COLORS = [
  "#e63946",
  "#457b9d",
  "#52b788",
  "#e9c46a",
  "#9b5de5",
  "#f15bb5",
  "#00bbf9",
  "#fee440",
]
export const MIN_AGENTS = 2
export const MAX_AGENTS = 8
export const DEFAULT_AGENTS = 4

// --- Seasons: a 120-day year forces planning ---
export const SEASON_LENGTH = 30 // days per season; year = 4 seasons
export const SEASON_REGEN_MULT = { spring: 1.15, summer: 1.3, autumn: 1.0, winter: 0.45 } as const
export const WINTER_HUNGER_MULT = 1.25

// --- Trait drift: experience reshapes personality (slow, bounded) ---
export const DRIFT_MIN = 5
export const DRIFT_MAX = 95
export const DRIFT_BETRAYED_COOP = -1 // attacked/raided → trust erodes
export const DRIFT_BETRAYED_AGGR = 1 // …and hardens
export const DRIFT_ROBBED_COOP = -0.5
export const DRIFT_KINDNESS_COOP = 1 // gifts and accepted reparations soften
export const DRIFT_MEMORY_THRESHOLD = 8 // a shift this large becomes a remembered arc

// --- Gossip: conversations spread reputations ---
export const GOSSIP_GRIEVANCE_MIN = 30 // only real grudges are worth retelling
export const GOSSIP_TRANSFER = 0.3 // fraction of the teller's grievance the listener absorbs
export const GOSSIP_TRANSFER_CAP = 20
export const GOSSIP_REL_PENALTY = 5 // hearing ill of someone cools you toward them
export const GOSSIP_VOUCH_MIN = 60 // strong friendships get vouched for
export const GOSSIP_VOUCH_GAIN = 4

// --- Negotiated trades (struck inside conversations) ---
export const NEGOTIATED_TRADE_MAX_PER_RESOURCE = 4

// --- Events ---
export const MAX_STORED_EVENTS = 200

// --- AI (z.ai GLM) ---
export const AI_MODEL = "glm-4.5-flash"
export const AI_PLAN_INTERVAL_DAYS = 15 // each agent re-plans this often
export const PLAN_GRACE_DAYS = 10 // expired plans drop to instinct if the mind is unreachable
export const AI_CONVO_COOLDOWN_DAYS = 25 // min days between chats for a given pair
export const AI_MIN_REQUEST_INTERVAL_MS = 1500 // per-mind pacing — prevent 429s, don't just absorb them
export const AI_CONVO_CHANCE = 0.5 // chance a ready pair actually talks
export const AI_MAX_CONCURRENT = 2 // in-flight request cap
export const AI_MAX_FAILURES = 3 // consecutive failures before the breaker rests the AI
export const AI_REQUEST_TIMEOUT_MS = 30000
export const AI_RATE_LIMIT_BACKOFF_MS = 60_000 // default pause after a 429
export const AI_BREAKER_COOLDOWN_MS = 300_000 // breaker auto-retries instead of dying
export const MEMORY_MAX_RUNS = 5 // past runs each agent can remember

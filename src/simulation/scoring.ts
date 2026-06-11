import type { Agent, Building } from "../types"
import { SCORE_WEIGHTS } from "../constants"

export function computeScore(agent: Agent, buildings: Building[]): number {
  if (!agent.isAlive) return agent.score // frozen at death

  const { food, wood, stone } = agent.inventory
  const agentBuildings = buildings.filter((b) => b.ownerId === agent.id)

  return Math.floor(
    food * SCORE_WEIGHTS.food +
      wood * SCORE_WEIGHTS.wood +
      stone * SCORE_WEIGHTS.stone +
      agentBuildings.length * SCORE_WEIGHTS.building +
      agent.health * SCORE_WEIGHTS.health
  )
}

export function computeWinner(agents: Agent[]): Agent {
  return [...agents].sort((a, b) => b.score - a.score)[0]
}

export type ScoreBreakdown = {
  resources: number
  buildings: number
  health: number
  total: number
}

export function scoreBreakdown(agent: Agent, buildings: Building[]): ScoreBreakdown {
  const { food, wood, stone } = agent.inventory
  const owned = buildings.filter((b) => b.ownerId === agent.id).length
  const resources = Math.floor(
    food * SCORE_WEIGHTS.food + wood * SCORE_WEIGHTS.wood + stone * SCORE_WEIGHTS.stone
  )
  return {
    resources,
    buildings: owned * SCORE_WEIGHTS.building,
    health: Math.floor((agent.isAlive ? agent.health : 0) * SCORE_WEIGHTS.health),
    total: agent.score,
  }
}

// Rule-based reading of how the winner actually played — what made the difference
export function explainWinner(winner: Agent, agents: Agent[], buildings: Building[]): string[] {
  const reasons: string[] = []
  const others = agents.filter((a) => a.id !== winner.id)
  const breakdown = scoreBreakdown(winner, buildings)
  const s = winner.stats

  // dominant score source
  const parts: [string, number][] = [
    [`resource wealth (${breakdown.resources} pts)`, breakdown.resources],
    [`construction — ${buildings.filter((b) => b.ownerId === winner.id).length} buildings (${breakdown.buildings} pts)`, breakdown.buildings],
    [`staying healthy (${breakdown.health} pts)`, breakdown.health],
  ]
  parts.sort((a, b) => b[1] - a[1])
  reasons.push(`Biggest score source: ${parts[0][0]}, ahead of ${parts[1][0]}.`)

  // strategy reading from the life stats
  const maxTrades = Math.max(0, ...others.map((a) => a.stats.trades))
  if (s.trades > 10 && s.trades >= maxTrades) {
    reasons.push(
      `Commerce paid: ${s.trades} profitable trades — the most on the island — compounded wealth no loner could match.`
    )
  }
  if (s.kills > 0) {
    reasons.push(`Took ${s.kills} ${s.kills === 1 ? "life" : "lives"} — conquest removed competition, at the cost of every survivor's trust.`)
  } else if (others.some((a) => a.stats.kills > 0)) {
    reasons.push(`Kept hands clean while others killed — avoided the island-wide backlash that violence brings.`)
  }
  if (s.gifts >= 2) {
    reasons.push(`Generosity (${s.gifts} food gifts) bought goodwill that paid back as protection and trade partners.`)
  }
  if (s.peaceOffers >= 2) {
    reasons.push(`Diplomacy: ${s.peaceOffers} reparations offers kept feuds short instead of draining decades.`)
  }
  if (s.steals + s.raids > 5) {
    reasons.push(`Not a saint: ${s.steals} thefts and ${s.raids} raids supplemented the ledger.`)
  }
  if (s.timesAttacked > 10 && winner.isAlive) {
    reasons.push(`Survived ${s.timesAttacked} attacks — resilience under siege.`)
  }
  const survivors = agents.filter((a) => a.isAlive).length
  if (!winner.isAlive) {
    reasons.push(`Won posthumously — the score was frozen at death and nobody alive overtook it.`)
  } else if (survivors === 1) {
    reasons.push(`Last one standing: every rival died.`)
  }

  return reasons.slice(0, 4)
}

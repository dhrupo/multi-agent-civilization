import type { Agent } from "../types"
import { WEARINESS_DECAY } from "../constants"

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export type RelationshipMilestone = "enemies" | "best_friends" | null

// Applies a delta and reports whether a dramatic threshold was crossed.
export function updateRelationship(agent: Agent, targetId: string, delta: number): RelationshipMilestone {
  const before = agent.relationships[targetId] ?? 0
  const after = clamp(before + delta, -100, 100)
  agent.relationships[targetId] = after
  if (before > -70 && after <= -70) return "enemies"
  if (before < 70 && after >= 70) return "best_friends"
  return null
}

// Every 10 ticks, relationships drift 1 point toward 0.
export function decayRelationships(agent: Agent): void {
  for (const id of Object.keys(agent.relationships)) {
    const val = agent.relationships[id]
    if (val > 0) agent.relationships[id] = val - 1
    else if (val < 0) agent.relationships[id] = val + 1
  }
}

// --- Grievances: the moral ledger that justifies (or forbids) violence ---

export function addGrievance(agent: Agent, targetId: string, score: number, reason: string): void {
  const g = agent.grievances[targetId] ?? { score: 0, reasons: [] }
  g.score = clamp(g.score + score, 0, 100)
  if (!g.reasons.includes(reason)) g.reasons = [...g.reasons, reason].slice(-3)
  agent.grievances[targetId] = g
}

export function decayGrievances(agent: Agent): void {
  for (const id of Object.keys(agent.grievances)) {
    const g = agent.grievances[id]
    g.score = Math.max(0, g.score - 1)
    if (g.score === 0) delete agent.grievances[id]
  }
  // war fatigue also fades — slowly enough that burned-out wars stay out
  for (const id of Object.keys(agent.warWeariness)) {
    agent.warWeariness[id] = Math.max(0, agent.warWeariness[id] - WEARINESS_DECAY)
    if (agent.warWeariness[id] === 0) delete agent.warWeariness[id]
  }
}

// How justified would this agent be in moving against the target right now?
// Sources: remembered wrongs, and desperation (starving while the target hoards).
export function justification(agent: Agent, target: Agent, desperationScore: number): number {
  const grievance = agent.grievances[target.id]?.score ?? 0
  const desperation =
    agent.hunger > 70 && target.inventory.food > 3 && agent.inventory.food === 0
      ? desperationScore
      : 0
  return Math.min(100, grievance + desperation)
}

export function getMaxHatred(agent: Agent): number {
  let max = 0
  for (const val of Object.values(agent.relationships)) {
    if (val < 0) max = Math.max(max, Math.abs(val))
  }
  return max
}

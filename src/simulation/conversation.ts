import type { Agent } from "../types"
import { addGrievance, updateRelationship } from "./relationships"
import {
  GOSSIP_GRIEVANCE_MIN,
  GOSSIP_REL_PENALTY,
  GOSSIP_TRANSFER,
  GOSSIP_TRANSFER_CAP,
  GOSSIP_VOUCH_GAIN,
  GOSSIP_VOUCH_MIN,
  TRADE_BONUS,
} from "../constants"

// Pure conversation side-effects, extracted from the store so they can be unit-tested.
// Both functions mutate the agents in place and return descriptions of anything
// worth surfacing as an event — the caller owns event creation and React state.

export type ResourceGift = { food: number; wood: number; stone: number }
export type NegotiatedTrade = { aGives: ResourceGift; bGives: ResourceGift }

export type GossipWarning = {
  tellerId: string
  tellerName: string
  listenerId: string
  listenerName: string
  aboutId: string
  aboutName: string
}

// Gossip: each speaker's strongest grudge partially rubs off on the listener,
// and a strong friendship is vouched for. Returns warnings loud enough to log.
export function applyGossip(living: Agent[], a: Agent, b: Agent): GossipWarning[] {
  const warnings: GossipWarning[] = []
  for (const [teller, listener] of [
    [a, b],
    [b, a],
  ] as const) {
    const others = living.filter((x) => x.id !== teller.id && x.id !== listener.id && x.isAlive)

    const worst = others
      .map((x) => ({ x, g: teller.grievances[x.id]?.score ?? 0 }))
      .sort((p, q) => q.g - p.g)[0]
    if (worst && worst.g >= GOSSIP_GRIEVANCE_MIN) {
      const transfer = Math.min(GOSSIP_TRANSFER_CAP, Math.round(worst.g * GOSSIP_TRANSFER))
      const reason = teller.grievances[worst.x.id]?.reasons.slice(-1)[0] ?? "wronged them"
      addGrievance(listener, worst.x.id, transfer, `heard from ${teller.name}: ${reason}`)
      updateRelationship(listener, worst.x.id, -GOSSIP_REL_PENALTY)
      if (transfer >= 10) {
        warnings.push({
          tellerId: teller.id,
          tellerName: teller.name,
          listenerId: listener.id,
          listenerName: listener.name,
          aboutId: worst.x.id,
          aboutName: worst.x.name,
        })
      }
    }

    const friend = others
      .map((x) => ({ x, r: teller.relationships[x.id] ?? 0 }))
      .sort((p, q) => q.r - p.r)[0]
    if (friend && friend.r >= GOSSIP_VOUCH_MIN) {
      updateRelationship(listener, friend.x.id, GOSSIP_VOUCH_GAIN)
    }
  }
  return warnings
}

const RESOURCES = ["food", "wood", "stone"] as const

function giftTotal(g: ResourceGift): number {
  return g.food + g.wood + g.stone
}

// A deal struck in conversation executes immediately if both sides can pay.
// Returns a human-readable summary, or null if the deal couldn't go through.
export function executeNegotiatedTrade(
  a: Agent,
  b: Agent,
  trade: NegotiatedTrade,
  day: number
): { aGave: string; bGave: string } | null {
  const canPay = (agent: Agent, gift: ResourceGift) =>
    RESOURCES.every((r) => agent.inventory[r] >= gift[r])
  if (!canPay(a, trade.aGives) || !canPay(b, trade.bGives)) return null
  if (giftTotal(trade.aGives) === 0 || giftTotal(trade.bGives) === 0) return null

  for (const r of RESOURCES) {
    a.inventory[r] += trade.bGives[r] - trade.aGives[r]
    b.inventory[r] += trade.aGives[r] - trade.bGives[r]
  }
  // gains from trade apply to negotiated deals too — both sides come out ahead
  a.inventory.food += TRADE_BONUS
  b.inventory.food += TRADE_BONUS
  a.stats.trades++
  b.stats.trades++
  a.lastTrades[b.id] = day
  b.lastTrades[a.id] = day

  const fmt = (g: ResourceGift) =>
    RESOURCES.filter((r) => g[r] > 0)
      .map((r) => `${g[r]} ${r}`)
      .join("+") || "nothing"
  return { aGave: fmt(trade.aGives), bGave: fmt(trade.bGives) }
}

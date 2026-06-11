import type { Agent } from "../types"
import { mindById, mindLabel } from "../ai/settings"

type Props = {
  agent: Agent
  x: number
  y: number
}

export default function AgentTooltip({ agent, x, y }: Props) {
  const mind = mindById(agent.mindId)
  return (
    <div className="agent-tooltip" style={{ left: x + 14, top: y + 14 }}>
      <div className="tooltip-name" style={{ color: agent.color }}>
        {agent.name} {!agent.isAlive && "✝"}
      </div>
      <div style={{ color: "var(--text-muted)" }}>🧠 {mind ? mindLabel(mind) : "Default mind"}</div>
      {agent.isAlive ? (
        <>
          <div>❤ {Math.round(agent.health)} 🍖 {Math.round(agent.hunger)} ⚡ {Math.round(agent.energy)}</div>
          <div style={{ color: "var(--text-muted)" }}>{agent.currentGoal}</div>
        </>
      ) : (
        <div style={{ color: "var(--text-muted)" }}>Died on Day {agent.deathDay}</div>
      )}
    </div>
  )
}

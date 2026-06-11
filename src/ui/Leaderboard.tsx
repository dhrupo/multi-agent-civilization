import { useSimStore } from "../store/useSimStore"

// score-over-time mini chart — the story of who pulled ahead, and when
function Sparkline({ points, color }: { points: number[]; color: string }) {
  if (points.length < 2) return <span className="score-bar-track" />
  const w = 56
  const h = 14
  const max = Math.max(...points, 1)
  const min = Math.min(...points, 0)
  const span = Math.max(1, max - min)
  const path = points
    .map((p, i) => `${((i / (points.length - 1)) * w).toFixed(1)},${(h - ((p - min) / span) * (h - 2) - 1).toFixed(1)}`)
    .join(" ")
  return (
    <svg width={w} height={h} className="sparkline">
      <polyline points={path} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  )
}

export default function Leaderboard() {
  const agents = useSimStore((s) => s.state.agents)
  const scoreHistory = useSimStore((s) => s.state.scoreHistory)
  const selectedAgentId = useSimStore((s) => s.state.selectedAgentId)
  const selectAgent = useSimStore((s) => s.selectAgent)

  const sorted = [...agents].sort((a, b) => {
    if (a.isAlive !== b.isAlive) return a.isAlive ? -1 : 1
    return b.score - a.score
  })

  return (
    <div className="leaderboard panel">
      <div className="panel-title">🏆 Leaderboard</div>
      {sorted.map((agent, i) => (
        <div
          key={agent.id}
          className={`leaderboard-row ${agent.id === selectedAgentId ? "selected" : ""} ${
            agent.isAlive ? "" : "dead"
          }`}
          onClick={() => selectAgent(agent.id)}
        >
          <span className="leaderboard-rank">{i + 1}.</span>
          <span className="agent-dot" style={{ background: agent.isAlive ? agent.color : "#555566" }} />
          <span>{agent.name}</span>
          <Sparkline
            points={scoreHistory[agent.id] ?? []}
            color={agent.isAlive ? agent.color : "#555566"}
          />
          <span className="leaderboard-score">{agent.score}</span>
        </div>
      ))}
    </div>
  )
}

import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from "recharts"
import { activeAiDescription, mindById, mindLabel } from "../ai/settings"
import { useSimStore } from "../store/useSimStore"

const STAT_COLORS = {
  health: "#e63946",
  hunger: "#f4a261",
  energy: "#e9c46a",
}

export default function AgentPanel() {
  const agents = useSimStore((s) => s.state.agents)
  const selectedAgentId = useSimStore((s) => s.state.selectedAgentId)

  const agent = agents.find((a) => a.id === selectedAgentId)

  if (!agent) {
    return (
      <div className="agent-panel panel">
        <div className="panel-title">Selected Agent</div>
        <div className="panel-hint">Click an agent on the map or leaderboard to inspect them.</div>
      </div>
    )
  }

  const relData = agents
    .filter((a) => a.id !== agent.id)
    .map((a) => ({ name: a.name, value: agent.relationships[a.id] ?? 0 }))

  const friends = relData.filter((r) => r.value > 20)
  const enemies = relData.filter((r) => r.value < -20)

  return (
    <div className="agent-panel panel">
      <div className="panel-title">Selected Agent</div>
      <div className="agent-panel-header">
        <span className="agent-dot" style={{ background: agent.color }} />
        <span>{agent.name}</span>
        {!agent.isAlive && <span style={{ color: "var(--text-muted)" }}>✝ Day {agent.deathDay}</span>}
      </div>
      <div className="agent-panel-goal">{agent.currentGoal}</div>
      <div className="agent-mind-line">
        🧠{" "}
        {agent.mindId && mindById(agent.mindId)
          ? mindLabel(mindById(agent.mindId)!)
          : `Default — ${activeAiDescription() ?? "instinct only"}`}
      </div>
      {agent.aiPlan && (
        <div className="ai-plan-box">
          <span className="ai-strategy-badge">🧠 {agent.aiPlan.strategy}</span>
          <span className="ai-thought">“{agent.aiPlan.thought}”</span>
        </div>
      )}

      {(() => {
        // trait drift: how experience has reshaped this agent from who they began as
        const labels: Record<string, string> = {
          aggression: "aggression",
          greed: "greed",
          cooperation: "cooperation",
          curiosity: "curiosity",
        }
        const shifts = (Object.keys(labels) as (keyof typeof agent.personality)[])
          .map((t) => ({ t, delta: agent.personality[t] - agent.basePersonality[t] }))
          .filter((s) => Math.abs(s.delta) >= 2)
          .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        if (shifts.length === 0) return null
        const coopShift = agent.personality.cooperation - agent.basePersonality.cooperation
        const mood = coopShift <= -5 ? "Hardened by this life" : coopShift >= 5 ? "Softened by kindness" : "Changed by experience"
        return (
          <div className="drift-box" title="How this agent's personality has shifted from who they started as">
            <span className="drift-mood">⚖ {mood}</span>
            {shifts.map((s) => (
              <span key={s.t} className={`drift-trait ${s.delta > 0 ? "up" : "down"}`}>
                {labels[s.t]} {s.delta > 0 ? "▲" : "▼"}
                {Math.abs(Math.round(s.delta))}
              </span>
            ))}
          </div>
        )
      })()}

      {(
        [
          ["❤ Health", agent.health, STAT_COLORS.health],
          ["🍖 Hunger", agent.hunger, STAT_COLORS.hunger],
          ["⚡ Energy", agent.energy, STAT_COLORS.energy],
        ] as const
      ).map(([label, value, color]) => (
        <div className="stat-row" key={label}>
          <span>{label}</span>
          <span className="stat-bar-track">
            <span
              className="stat-bar-fill"
              style={{ display: "block", width: `${value}%`, background: color }}
            />
          </span>
          <span className="stat-value">{Math.round(value)}</span>
        </div>
      ))}

      <div className="inventory-row">
        <span>🌾 Food: {agent.inventory.food}</span>
        <span>🪵 Wood: {agent.inventory.wood}</span>
        <span>🪨 Stone: {agent.inventory.stone}</span>
      </div>

      <div className="relationship-list">
        {friends.length > 0 && (
          <div style={{ color: "#52b788" }}>
            Friends: {friends.map((f) => `${f.name} (+${f.value})`).join(", ")}
          </div>
        )}
        {enemies.length > 0 && (
          <div style={{ color: "var(--danger)" }}>
            Enemies: {enemies.map((f) => `${f.name} (${f.value})`).join(", ")}
          </div>
        )}
        {Object.entries(agent.grievances).filter(([, g]) => g.score > 5).length > 0 && (
          <div style={{ color: "var(--amber)", marginTop: 2 }}>
            Grudges:{" "}
            {Object.entries(agent.grievances)
              .filter(([, g]) => g.score > 5)
              .map(([id, g]) => {
                const other = agents.find((a) => a.id === id)
                return `${other?.name} (${g.score}: ${g.reasons[g.reasons.length - 1] ?? ""})`
              })
              .join(", ")}
          </div>
        )}
      </div>

      <div style={{ height: 110, padding: "6px 8px 0" }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={relData} margin={{ top: 4, right: 8, bottom: 0, left: -28 }}>
            <XAxis dataKey="name" tick={{ fill: "#8888aa", fontSize: 11 }} stroke="#8888aa" />
            <YAxis domain={[-100, 100]} tick={{ fill: "#8888aa", fontSize: 10 }} stroke="#8888aa" />
            <ReferenceLine y={0} stroke="#8888aa" />
            <Bar dataKey="value" isAnimationActive={false}>
              {relData.map((entry) => (
                <Cell key={entry.name} fill={entry.value >= 0 ? "#52b788" : "#e63946"} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

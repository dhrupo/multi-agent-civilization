import { buildRunMemory, currentRunNumber } from "../ai/memory"
import { explainWinner, scoreBreakdown } from "../simulation/scoring"
import { useSimStore } from "../store/useSimStore"

function timelineIcon(text: string): string {
  if (text.includes("🏳️")) return "🏳️"
  if (text.includes("killed")) return "💀"
  if (text.includes("died") || text.includes("perished")) return "🪦"
  if (text.includes("🕊️")) return "🕊️"
  if (text.includes("destroyed")) return "💔"
  if (text.includes("raided")) return "🏹"
  if (text.includes("attacked")) return "⚔️"
  if (text.includes("stealing")) return "🥷"
  if (text.includes("🌪️")) return "🌪️"
  if (text.includes("🌾")) return "🌾"
  if (text.includes("🌋")) return "🌋"
  if (text.includes("best friends")) return "💛"
  if (text.includes("enemies")) return "💢"
  if (text.includes("plotting")) return "🧠"
  return "•"
}

// importance of a dramatic event — drives both timeline selection and the top-10 list
function dramaScore(text: string): number {
  if (text.includes("killed")) return 10
  if (text.includes("died") || text.includes("perished")) return 9
  if (text.includes("destroyed")) return 8
  if (text.includes("🏳️")) return 8
  if (text.includes("🌋") || text.includes("🌪️") || text.includes("🌾")) return 7
  if (text.includes("rejected")) return 6
  if (text.includes("best friends") || text.includes("enemies")) return 5
  if (text.includes("reparations")) return 4
  if (text.includes("raided")) return 4
  if (text.includes("plotting")) return 3
  if (text.includes("attacked")) return 2
  if (text.includes("stealing")) return 1
  return 1
}

// conflict above the axis, diplomacy below, the world itself on the line
type TimelineLane = "conflict" | "world" | "social"

function timelineLane(text: string): TimelineLane {
  if (/🌋|🌪️|🌾|died|perished/.test(text)) return "world"
  if (/🕊️|best friends|reparations|rejected/.test(text)) return "social"
  return "conflict"
}

const LANE_TOP: Record<TimelineLane, number> = { conflict: 2, world: 26, social: 50 }

function relColor(value: number): string {
  if (value > 15) return "rgba(82, 183, 119, 0.35)"
  if (value < -15) return "rgba(230, 57, 70, 0.35)"
  return "rgba(136, 136, 170, 0.12)"
}

export default function EndScreen() {
  const state = useSimStore((s) => s.state)
  const restartSim = useSimStore((s) => s.restartSim)
  const backToSetup = useSimStore((s) => s.backToSetup)

  const { agents, events, winner, buildings } = state
  const allDead = agents.every((a) => !a.isAlive)
  const sorted = [...agents].sort((a, b) => b.score - a.score)
  // top 10 by importance, told in story order
  const drama = events
    .filter((e) => e.weight === 3)
    .map((e) => ({ e, score: dramaScore(e.text) }))
    .sort((a, b) => b.score - a.score || a.e.day - b.e.day)
    .slice(0, 10)
    .map(({ e }) => e)
    .sort((a, b) => a.day - b.day)
  const reasons = winner ? explainWinner(winner, agents, buildings) : []
  const breakdown = winner ? scoreBreakdown(winner, buildings) : null

  return (
    <div className="end-screen">
      <div className="winner-banner">
        <div className="winner-title">{allDead ? "Civilization Collapsed" : "Civilization Leader"}</div>
        <div className="winner-name" style={{ color: winner?.color }}>
          {winner?.name ?? "Nobody"}
        </div>
        <div className="winner-score">Final score: {winner?.score ?? 0}</div>
      </div>

      {winner && breakdown && (
        <div className="end-section panel">
          <h3>Why {winner.name} {allDead ? "outlasted the rest" : "won"}</h3>
          <div className="breakdown-bar" title="Score composition">
            {(
              [
                ["resources", breakdown.resources, "#e9c46a"],
                ["buildings", breakdown.buildings, "#52b788"],
                ["health", breakdown.health, "#e63946"],
              ] as const
            ).map(([label, value, color]) =>
              value > 0 ? (
                <span
                  key={label}
                  style={{ flexGrow: value, background: color }}
                  className="breakdown-seg"
                >
                  {value >= breakdown.total * 0.15 ? `${label} ${value}` : ""}
                </span>
              ) : null
            )}
          </div>
          {reasons.map((reason, i) => (
            <div key={i} className="reason-line">
              {reason}
            </div>
          ))}
          <table className="stats-table">
            <thead>
              <tr>
                <th />
                <th>🤝 trades</th>
                <th>❤️ gifts</th>
                <th>🕊️ peace</th>
                <th>🥷 thefts</th>
                <th>🏹 raids</th>
                <th>⚔️ attacks</th>
                <th>💀 kills</th>
                <th>🏠 built</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => (
                <tr key={a.id} className={a.id === winner.id ? "stats-winner" : ""}>
                  <th style={{ color: a.color }}>{a.name}</th>
                  <td>{a.stats.trades}</td>
                  <td>{a.stats.gifts}</td>
                  <td>{a.stats.peaceOffers}</td>
                  <td>{a.stats.steals}</td>
                  <td>{a.stats.raids}</td>
                  <td>{a.stats.attacks}</td>
                  <td>{a.stats.kills}</td>
                  <td>{a.stats.buildingsBuilt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="end-section panel">
        <h3>Final Leaderboard</h3>
        {sorted.map((agent, i) => (
          <div key={agent.id} className={`final-row ${agent.isAlive ? "" : "dead"}`}>
            <span>{i + 1}.</span>
            <span className="agent-dot" style={{ background: agent.isAlive ? agent.color : "#555566" }} />
            <span>
              {agent.name}
              {!agent.isAlive && ` ✝ (died Day ${agent.deathDay})`}
            </span>
            <span>{agent.score}</span>
          </div>
        ))}
      </div>

      <div className="end-section panel">
        <h3>Story Timeline</h3>
        <div className="timeline">
          <span className="lane-label" style={{ top: LANE_TOP.conflict }}>⚔️</span>
          <span className="lane-label" style={{ top: LANE_TOP.world }}>🌍</span>
          <span className="lane-label" style={{ top: LANE_TOP.social }}>🕊️</span>
          <div className="timeline-axis" />
          {(() => {
            // per lane: bucket the run into time slots and keep each slot's most
            // important event — sieges compress, kills and peaces never vanish
            const dramatic = events.filter((e) => e.weight === 3)
            const BINS = 36
            const markers: typeof dramatic = []
            for (const lane of ["conflict", "world", "social"] as TimelineLane[]) {
              const inLane = dramatic.filter((e) => timelineLane(e.text) === lane)
              const byBin = new Map<number, (typeof dramatic)[number]>()
              for (const e of inLane) {
                const bin = Math.floor((e.day / state.endDay) * BINS)
                const held = byBin.get(bin)
                if (!held || dramaScore(e.text) > dramaScore(held.text)) byBin.set(bin, e)
              }
              markers.push(...byBin.values())
            }
            return markers.map((e) => (
              <span
                key={e.id}
                className="timeline-dot"
                style={{
                  left: `${(e.day / state.endDay) * 100}%`,
                  top: `${LANE_TOP[timelineLane(e.text)]}px`,
                }}
                title={`Day ${e.day}: ${e.text}`}
              >
                {timelineIcon(e.text)}
              </span>
            ))
          })()}
          <span className="timeline-label" style={{ left: 14 }}>Day 0</span>
          <span className="timeline-label" style={{ right: 0 }}>Day {state.endDay}</span>
        </div>
        <div className="panel-hint">
          Rows: ⚔️ conflict · 🌍 world &amp; deaths · 🕊️ diplomacy. Hover any marker for the event.
        </div>
      </div>

      <div className="end-section panel">
        <h3>Most Dramatic Events</h3>
        {drama.length === 0 && <div className="panel-hint">A peaceful run. Nothing dramatic happened.</div>}
        {drama.map((event) => {
          const icon = timelineIcon(event.text)
          const prefix = icon !== "•" && !event.text.includes(icon) ? `${icon} ` : ""
          return (
            <div key={event.id} className="drama-entry">
              <span className="event-day">Day {event.day}</span>
              {prefix}
              {event.text}
            </div>
          )
        })}
      </div>

      <div className="end-section panel">
        <h3>What they'll remember</h3>
        {Object.entries(buildRunMemory(state, currentRunNumber() - 1).perAgent).map(([name, memLines]) => (
          <div key={name} className="chronicle-run">
            <h4>{name[0].toUpperCase() + name.slice(1)}</h4>
            <div>{memLines.join("; ")}</div>
          </div>
        ))}
        <div className="panel-hint">These memories carry into their next life on this island.</div>
      </div>

      <div className="end-section panel">
        <h3>Relationship Matrix</h3>
        <table className="matrix-table">
          <thead>
            <tr>
              <th />
              {agents.map((a) => (
                <th key={a.id} style={{ color: a.color }}>
                  {a.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map((row) => (
              <tr key={row.id}>
                <th style={{ color: row.color }}>{row.name}</th>
                {agents.map((col) =>
                  col.id === row.id ? (
                    <td key={col.id} style={{ background: "rgba(136,136,170,0.05)" }}>
                      —
                    </td>
                  ) : (
                    <td key={col.id} style={{ background: relColor(row.relationships[col.id] ?? 0) }}>
                      {row.relationships[col.id] ?? 0}
                    </td>
                  )
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="end-actions">
        <button className="btn" onClick={restartSim}>
          ↺ Play Again (same agents)
        </button>
        <button className="btn btn-primary" onClick={backToSetup}>
          ✦ New Game
        </button>
      </div>
    </div>
  )
}

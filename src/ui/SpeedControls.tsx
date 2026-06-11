import { useSimStore } from "../store/useSimStore"

// Single speed (1×): the AI minds keep pace with the sim — faster speeds
// outran the providers' rate limits and starved agents of plans.
export default function SpeedControls() {
  const isPaused = useSimStore((s) => s.state.isPaused)
  const pauseSim = useSimStore((s) => s.pauseSim)
  const resumeSim = useSimStore((s) => s.resumeSim)
  const restartSim = useSimStore((s) => s.restartSim)

  return (
    <div className="speed-controls">
      <button
        className="speed-btn"
        onClick={() => (isPaused ? resumeSim() : pauseSim())}
        aria-label={isPaused ? "Resume" : "Pause"}
      >
        {isPaused ? "▶ Resume" : "⏸ Pause"}
      </button>
      <button className="speed-btn" onClick={restartSim} aria-label="Restart">
        ↺ Restart
      </button>
    </div>
  )
}

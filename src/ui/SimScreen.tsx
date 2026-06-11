import { getAiStatus } from "../ai/controller"
import { getAiCallStats } from "../ai/client"
import { activeAiDescription } from "../ai/settings"
import { getSeason, SEASON_EMOJI } from "../simulation/seasons"
import { useSimStore } from "../store/useSimStore"
import SocietyPanel from "./SocietyPanel"
import AgentPanel from "./AgentPanel"
import EventLog from "./EventLog"
import Leaderboard from "./Leaderboard"
import MapCanvas from "./MapCanvas"
import SpeedControls from "./SpeedControls"

const CATASTROPHE_BANNER: Record<string, string> = {
  storm: "🌪️ STORM",
  blight: "🌾 BLIGHT",
  earthquake: "🌋 EARTHQUAKE",
}

function aiBadge(mixedMinds: boolean): { text: string; cls: string; title: string } {
  const status = getAiStatus()
  const desc = mixedMinds ? "mixed (per-agent)" : activeAiDescription()
  const s = getAiCallStats()
  const callInfo = s.sent > 0 ? ` · ${s.ok}✓${s.failed ? ` ${s.failed}✗` : ""}${s.rateLimited ? ` ${s.rateLimited}⏳` : ""}` : ""
  if (status === "live") {
    return {
      text: `🧠 ${desc}${callInfo}`,
      cls: "",
      title: `Agents are driven by ${desc}. Calls: ${s.sent} sent, ${s.ok} ok, ${s.failed} failed, ${s.rateLimited} throttled.`,
    }
  }
  if (status === "resting") {
    return {
      text: "🧠 AI resting (rate limit) — auto-resuming",
      cls: "ai-badge-warn",
      title: "The provider throttled requests; agents act on instinct until the backoff ends",
    }
  }
  return {
    text: "🧠 AI off — instinct mode",
    cls: "",
    title: "Configure an AI provider on the setup screen (or add ZAI_API_KEY to .env)",
  }
}

export default function SimScreen() {
  const day = useSimStore((s) => s.state.day)
  const endDay = useSimStore((s) => s.state.endDay)
  const catastrophe = useSimStore((s) => s.state.catastrophe)
  const mixedMinds = useSimStore((s) => s.state.agents.some((a) => a.mindId !== null))
  const badge = aiBadge(mixedMinds) // re-evaluated each day tick

  return (
    <div className="sim-screen">
      <div className="topbar panel">
        <div
          className="topbar-progress"
          style={{ transform: `scaleX(${Math.min(1, day / endDay)})` }}
        />
        <SpeedControls />
        <div className={`ai-badge ${badge.cls}`} title={badge.title}>
          {badge.text}
        </div>
        {catastrophe && (
          <div className="catastrophe-banner">
            {CATASTROPHE_BANNER[catastrophe.type]} — ends day {catastrophe.endDay}
          </div>
        )}
        <div className="day-display display-font">
          {SEASON_EMOJI[getSeason(day)]} {getSeason(day)} · 📅 Day {day} / {endDay}
        </div>
      </div>

      <div className="sim-main">
        <MapCanvas />
        <EventLog />
      </div>

      <div className="sim-side">
        <Leaderboard />
        <SocietyPanel />
        <AgentPanel />
      </div>
    </div>
  )
}

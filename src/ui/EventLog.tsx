import { useEffect, useRef, useState } from "react"
import type { EventLogEntry } from "../types"
import { useSimStore } from "../store/useSimStore"

type Filter = "all" | "drama" | "social" | "minds"

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "drama", label: "⚔️ Drama" },
  { key: "social", label: "🤝 Social" },
  { key: "minds", label: "🧠 Minds" },
]

const SOCIAL_RE = /💬|❤️|🕊️|traded|best friends/
const MINDS_RE = /🧠|💬/

function matches(event: EventLogEntry, filter: Filter): boolean {
  if (filter === "all") return true
  if (filter === "drama") return event.weight === 3 && !event.text.includes("🧠")
  if (filter === "social") return SOCIAL_RE.test(event.text)
  return MINDS_RE.test(event.text)
}

// Repeated near-identical events (daily attack spam during a war) collapse
// into one line: signature ignores numbers and parentheticals.
function signature(event: EventLogEntry): string {
  return event.text.replace(/\(.*?\)/g, "").replace(/\d+/g, "#") + "|" + event.involvedIds.join(",")
}

type Group = { first: EventLogEntry; last: EventLogEntry; count: number }

function collapse(events: EventLogEntry[]): Group[] {
  const groups: Group[] = []
  for (const event of events) {
    const prev = groups[groups.length - 1]
    if (prev && signature(prev.last) === signature(event)) {
      prev.last = event
      prev.count++
    } else {
      groups.push({ first: event, last: event, count: 1 })
    }
  }
  return groups
}

const LOG_WINDOW = 150 // old retained drama belongs to the end screen, not the live log

export default function EventLog() {
  const events = useSimStore((s) => s.state.events)
  const listRef = useRef<HTMLDivElement>(null)
  const pinnedToTop = useRef(true)
  const [filter, setFilter] = useState<Filter>("all")

  const visible = events.filter((e) => e.weight >= 2).slice(-LOG_WINDOW)
  // newest first: collapse chronologically, then flip for display
  const groups = collapse(visible.filter((e) => matches(e, filter))).reverse()

  useEffect(() => {
    const el = listRef.current
    if (el && pinnedToTop.current) {
      el.scrollTop = 0
    }
  }, [groups.length, filter])

  return (
    <div className="event-log panel">
      <div className="event-log-header">
        <div className="panel-title">📜 Event Log</div>
        <div className="event-tabs">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              className={`event-tab ${filter === f.key ? "active" : ""}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div
        className="event-log-list"
        ref={listRef}
        onScroll={(e) => {
          // reading older events further down suspends the auto-pin to top
          pinnedToTop.current = e.currentTarget.scrollTop < 30
        }}
      >
        {groups.length === 0 && <div className="panel-hint">Nothing here yet…</div>}
        {groups.map((group) => (
          <div key={group.first.id} className={`event-entry w${group.last.weight}`}>
            <span className="event-day">
              {group.count > 1 ? `Days ${group.first.day}–${group.last.day}` : `Day ${group.last.day}`}
            </span>
            {group.last.text}
            {group.count > 1 && <span className="event-repeat"> ×{group.count}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

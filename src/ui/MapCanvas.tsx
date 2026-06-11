import { useEffect, useRef, useState } from "react"
import type { Agent, Tile } from "../types"
import { MAP_SIZE, TERRITORY_RADIUS } from "../constants"
import { territoryOwner } from "../simulation/world"
import { getSeason } from "../simulation/seasons"
// (tile inspection reads live store state on render — refreshed by tick re-renders)
import { useSimStore } from "../store/useSimStore"
import AgentTooltip from "./AgentTooltip"

// Action effects: recent events become visible beams and pulses between agents,
// so you can SEE who is trading, robbing, fighting, or talking with whom.
type Fx = {
  id: string
  icon: string
  color: string
  aId: string
  bId: string | null
  start: number
}

const FX_DURATION = 2600

function classifyFx(text: string): { icon: string; color: string } | null {
  if (text.includes("attacked")) return { icon: "⚔️", color: "#e63946" }
  if (text.includes("raided")) return { icon: "🏹", color: "#e63946" }
  if (text.includes("killed")) return { icon: "💀", color: "#e63946" }
  if (text.includes("stole") || text.includes("stealing")) return { icon: "🥷", color: "#9b5de5" }
  if (text.includes("traded") || text.includes("Deal:")) return { icon: "🤝", color: "#e9c46a" }
  if (text.includes("shared food")) return { icon: "❤️", color: "#52b788" }
  if (text.includes("reparations") || text.includes("offered peace")) return { icon: "🕊️", color: "#ffffff" }
  if (text.includes("🗣️")) return { icon: "🗣️", color: "#f4a261" }
  if (text.includes("💬")) return { icon: "💬", color: "#aaaacc" }
  if (text.includes("built a")) return { icon: "🔨", color: "#e9c46a" }
  return null
}

const SEASON_TINT: Record<string, string | null> = {
  spring: null,
  summer: "rgba(255, 220, 130, 0.05)",
  autumn: "rgba(210, 140, 60, 0.07)",
  winter: "rgba(180, 210, 255, 0.13)",
}

const TILE_PX = 32
const CANVAS_PX = MAP_SIZE * TILE_PX

// Two shades per terrain; deterministic per-tile variation breaks up the flat grid
const TERRAIN_SHADES: Record<string, [string, string]> = {
  grass: ["#56885f", "#4d7d56"],
  forest: ["#2f5e2a", "#28521f"],
  water: ["#2a6598", "#235a8c"],
  mountain: ["#73716e", "#676562"],
}

const BUILDING_ICONS: Record<string, string> = {
  base: "⛺",
  campfire: "🔥",
  house: "🏠",
  storage: "📦",
}

const CATASTROPHE_TINT: Record<string, string> = {
  storm: "rgba(40, 60, 120, 0.22)",
  blight: "rgba(120, 90, 20, 0.22)",
  earthquake: "rgba(120, 40, 30, 0.22)",
}

const ACTION_ICONS: Record<string, string> = {
  gather_food: "🌾",
  gather_wood: "🪓",
  gather_stone: "⛏️",
  move: "👣",
  eat: "🍖",
  sleep: "💤",
  build: "🔨",
  trade: "🤝",
  steal: "🥷",
  attack: "⚔️",
  heal: "💚",
  raid: "🏹",
  gift: "❤️",
  make_peace: "🕊️",
}

type Hover = { agent: Agent; px: number; py: number }

function tileVariant(x: number, y: number): number {
  return (x * 7 + y * 13) % 3 === 0 ? 1 : 0
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function drawTile(ctx: CanvasRenderingContext2D, tile: Tile, now: number) {
  const px = tile.x * TILE_PX
  const py = tile.y * TILE_PX
  const shades = TERRAIN_SHADES[tile.terrain]
  ctx.fillStyle = shades[tileVariant(tile.x, tile.y)]
  ctx.fillRect(px, py, TILE_PX, TILE_PX)

  if (tile.terrain === "water") {
    // gentle shimmer
    const phase = Math.sin(now / 900 + tile.x * 1.7 + tile.y * 2.3)
    ctx.fillStyle = `rgba(255, 255, 255, ${0.04 + 0.04 * phase})`
    ctx.fillRect(px, py, TILE_PX, TILE_PX)
  }

  // resource pips along the bottom edge: food, wood, stone
  const pips: [number, string][] = [
    [tile.food, "#bfe8a3"],
    [tile.wood, "#a8784a"],
    [tile.stone, "#c9c9c9"],
  ]
  let drawn = 0
  for (const [amount, color] of pips) {
    const count = Math.min(3, Math.ceil(amount / 4))
    ctx.fillStyle = color
    for (let i = 0; i < count; i++) {
      ctx.globalAlpha = 0.75
      ctx.beginPath()
      ctx.arc(px + 6 + drawn * 6, py + TILE_PX - 5, 1.8, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
      drawn++
    }
  }

  // soft inner grid line
  ctx.strokeStyle = "rgba(15, 15, 26, 0.12)"
  ctx.strokeRect(px + 0.5, py + 0.5, TILE_PX - 1, TILE_PX - 1)
}

export default function MapCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const selectAgent = useSimStore((s) => s.selectAgent)
  const [hover, setHover] = useState<Hover | null>(null)
  // smoothed (display) positions, in pixels, keyed by agent id
  const displayPos = useRef(new Map<string, { x: number; y: number }>())
  const fxList = useRef<Fx[]>([])
  const seenFx = useRef(new Set<string>())

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext("2d")
    if (!canvas || !ctx) return

    let raf = 0
    let last = performance.now()

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw)
      const dt = Math.min(100, now - last)
      last = now

      const { tiles, agents, buildings, selectedAgentId, catastrophe, events, day, isPaused } =
        useSimStore.getState().state
      if (tiles.length === 0) return

      // pausing freezes the action beams — pause to inspect a scene
      if (isPaused) {
        for (const fx of fxList.current) fx.start += dt
      }

      // ingest fresh events into the FX layer
      for (const e of events.slice(-25)) {
        if (seenFx.current.has(e.id)) continue
        seenFx.current.add(e.id)
        const kind = classifyFx(e.text)
        if (!kind || e.involvedIds.length === 0) continue
        fxList.current.push({
          id: e.id,
          icon: kind.icon,
          color: kind.color,
          aId: e.involvedIds[0],
          bId: e.involvedIds[1] ?? null,
          start: now,
        })
      }
      fxList.current = fxList.current.filter((f) => now - f.start < FX_DURATION).slice(-12)
      if (seenFx.current.size > 600) seenFx.current = new Set([...seenFx.current].slice(-300))

      ctx.clearRect(0, 0, CANVAS_PX, CANVAS_PX)

      for (const row of tiles) for (const tile of row) drawTile(ctx, tile, now)

      // territory tint: each tile near a base carries its owner's color
      for (const row of tiles) {
        for (const tile of row) {
          const ownerId = territoryOwner(tile.x, tile.y, agents, TERRITORY_RADIUS)
          if (!ownerId) continue
          const owner = agents.find((a) => a.id === ownerId)
          if (!owner?.isAlive) continue
          ctx.fillStyle = owner.color
          ctx.globalAlpha = 0.09
          ctx.fillRect(tile.x * TILE_PX, tile.y * TILE_PX, TILE_PX, TILE_PX)
          ctx.globalAlpha = 1
        }
      }

      // buildings: owner-colored base + icon, hp bar when damaged
      for (const b of buildings) {
        const owner = agents.find((a) => a.id === b.ownerId)
        const px = b.x * TILE_PX
        const py = b.y * TILE_PX
        roundRect(ctx, px + 4, py + 4, TILE_PX - 8, TILE_PX - 8, 5)
        ctx.fillStyle = "rgba(15, 15, 26, 0.35)"
        ctx.fill()
        ctx.strokeStyle = owner?.color ?? "#888"
        ctx.lineWidth = b.type === "base" ? 2 : 1.5
        ctx.stroke()
        ctx.lineWidth = 1
        ctx.font = "15px serif"
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText(BUILDING_ICONS[b.type], px + TILE_PX / 2, py + TILE_PX / 2 + 1)

        const maxHp = b.type === "base" ? 100 : b.type === "house" ? 80 : 60
        if (b.hp < maxHp) {
          const frac = Math.max(0, b.hp / maxHp)
          ctx.fillStyle = "rgba(15, 15, 26, 0.7)"
          ctx.fillRect(px + 5, py + TILE_PX - 7, TILE_PX - 10, 3)
          ctx.fillStyle = frac > 0.5 ? "#52b788" : frac > 0.25 ? "#e9c46a" : "#e63946"
          ctx.fillRect(px + 5, py + TILE_PX - 7, (TILE_PX - 10) * frac, 3)
        }
      }

      // the selected agent's social web: green bonds, red feuds
      const selected = agents.find((a) => a.id === selectedAgentId && a.isAlive)
      if (selected) {
        const sp = displayPos.current.get(selected.id)
        if (sp) {
          for (const other of agents) {
            if (other.id === selected.id || !other.isAlive) continue
            const rel = selected.relationships[other.id] ?? 0
            if (Math.abs(rel) < 15) continue
            const op = displayPos.current.get(other.id)
            if (!op) continue
            ctx.beginPath()
            ctx.moveTo(sp.x, sp.y)
            ctx.lineTo(op.x, op.y)
            ctx.strokeStyle = rel > 0 ? "rgba(82, 183, 136, 0.55)" : "rgba(230, 57, 70, 0.55)"
            ctx.lineWidth = Math.min(4, 1 + Math.abs(rel) / 40)
            ctx.setLineDash(rel > 0 ? [] : [5, 4])
            ctx.stroke()
            ctx.setLineDash([])
            ctx.lineWidth = 1
          }
        }
      }

      // agents with smoothed movement
      const ease = 1 - Math.exp(-dt / 90)
      for (const agent of agents) {
        const tx = agent.x * TILE_PX + TILE_PX / 2
        const ty = agent.y * TILE_PX + TILE_PX / 2
        let pos = displayPos.current.get(agent.id)
        if (!pos) {
          pos = { x: tx, y: ty }
          displayPos.current.set(agent.id, pos)
        }
        pos.x += (tx - pos.x) * ease
        pos.y += (ty - pos.y) * ease
        const cx = pos.x
        const cy = pos.y

        if (!agent.isAlive) {
          ctx.font = "16px serif"
          ctx.textAlign = "center"
          ctx.textBaseline = "middle"
          ctx.globalAlpha = 0.8
          ctx.fillText("🪦", cx, cy)
          ctx.globalAlpha = 1
          ctx.font = "600 10px Inter, sans-serif"
          ctx.fillStyle = "#777788"
          ctx.fillText(agent.name, cx, cy + 18)
          continue
        }

        // shadow
        ctx.beginPath()
        ctx.ellipse(cx, cy + 9, 8, 3, 0, 0, Math.PI * 2)
        ctx.fillStyle = "rgba(0, 0, 0, 0.3)"
        ctx.fill()

        // selection pulse
        if (agent.id === selectedAgentId) {
          const pulse = 13 + Math.sin(now / 250) * 1.5
          ctx.beginPath()
          ctx.arc(cx, cy, pulse, 0, Math.PI * 2)
          ctx.strokeStyle = "#f4a261"
          ctx.lineWidth = 2
          ctx.stroke()
        }

        // health ring (green → red as health drops)
        const healthFrac = agent.health / 100
        ctx.beginPath()
        ctx.arc(cx, cy, 11, -Math.PI / 2, -Math.PI / 2 + healthFrac * Math.PI * 2)
        ctx.strokeStyle = healthFrac > 0.5 ? "#52b788" : healthFrac > 0.25 ? "#e9c46a" : "#e63946"
        ctx.lineWidth = 2
        ctx.stroke()
        ctx.lineWidth = 1

        // body
        ctx.beginPath()
        ctx.arc(cx, cy, 8.5, 0, Math.PI * 2)
        ctx.fillStyle = agent.color
        ctx.fill()
        ctx.strokeStyle = "rgba(255, 255, 255, 0.85)"
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.lineWidth = 1

        // name on a dark chip — readable on any terrain
        ctx.font = "600 10.5px Inter, sans-serif"
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        const nameW = ctx.measureText(agent.name).width
        roundRect(ctx, cx - nameW / 2 - 4, cy + 14, nameW + 8, 13, 4)
        ctx.fillStyle = "rgba(15, 15, 26, 0.75)"
        ctx.fill()
        ctx.fillStyle = agent.color
        ctx.fillText(agent.name, cx, cy + 21)

        // action emoji, bobbing
        if (agent.currentAction) {
          const bob = Math.sin(now / 300 + cx) * 1.5
          ctx.font = "12px serif"
          ctx.fillText(ACTION_ICONS[agent.currentAction] ?? "", cx, cy - 18 + bob)
        }

        // distress flag: starving or badly wounded
        if (agent.hunger > 85 || agent.health < 35) {
          if (Math.sin(now / 180) > -0.3) {
            ctx.font = "700 12px Inter, sans-serif"
            ctx.fillStyle = "#ff5566"
            ctx.fillText("❗", cx + 12, cy - 12)
          }
        }
      }

      // action FX: beams and icons between the agents involved in recent events
      for (const fx of fxList.current) {
        const age = (now - fx.start) / FX_DURATION
        const alpha = age < 0.15 ? age / 0.15 : 1 - (age - 0.15) / 0.85
        const pa = displayPos.current.get(fx.aId)
        if (!pa) continue
        const pb = fx.bId ? displayPos.current.get(fx.bId) : null
        ctx.globalAlpha = Math.max(0, alpha)
        if (pb) {
          // arc bulging upward with a glow — visible even between adjacent agents
          const mx = (pa.x + pb.x) / 2
          const my = (pa.y + pb.y) / 2 - 16 - Math.hypot(pb.x - pa.x, pb.y - pa.y) * 0.15
          ctx.beginPath()
          ctx.moveTo(pa.x, pa.y)
          ctx.quadraticCurveTo(mx, my, pb.x, pb.y)
          ctx.strokeStyle = fx.color
          ctx.lineWidth = 2.5
          ctx.shadowColor = fx.color
          ctx.shadowBlur = 6
          ctx.stroke()
          ctx.shadowBlur = 0
          ctx.lineWidth = 1
          ctx.font = "16px serif"
          ctx.textAlign = "center"
          ctx.fillText(fx.icon, mx, my - 4 - age * 6)
        } else {
          ctx.beginPath()
          ctx.arc(pa.x, pa.y, 12 + age * 14, 0, Math.PI * 2)
          ctx.strokeStyle = fx.color
          ctx.lineWidth = 2
          ctx.stroke()
          ctx.lineWidth = 1
          ctx.font = "14px serif"
          ctx.textAlign = "center"
          ctx.fillText(fx.icon, pa.x, pa.y - 20 - age * 8)
        }
        ctx.globalAlpha = 1
      }

      // seasonal atmosphere
      const seasonTint = SEASON_TINT[getSeason(day)]
      if (seasonTint) {
        ctx.fillStyle = seasonTint
        ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX)
      }

      // catastrophe: the whole island darkens under an ominous pulse
      if (catastrophe) {
        const pulse = 0.8 + 0.2 * Math.sin(now / 500)
        ctx.globalAlpha = pulse
        ctx.fillStyle = CATASTROPHE_TINT[catastrophe.type]
        ctx.fillRect(0, 0, CANVAS_PX, CANVAS_PX)
        ctx.globalAlpha = 1
      }
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const agentAt = (e: React.MouseEvent<HTMLCanvasElement>): { agent: Agent | null; px: number; py: number } => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const scaleX = CANVAS_PX / rect.width
    const scaleY = CANVAS_PX / rect.height
    const mx = (e.clientX - rect.left) * scaleX
    const my = (e.clientY - rect.top) * scaleY
    const { agents } = useSimStore.getState().state
    const agent =
      agents.find((a) => {
        const pos = displayPos.current.get(a.id)
        const cx = pos?.x ?? a.x * TILE_PX + TILE_PX / 2
        const cy = pos?.y ?? a.y * TILE_PX + TILE_PX / 2
        return Math.hypot(mx - cx, my - cy) <= 13
      }) ?? null
    return { agent, px: e.clientX - rect.left, py: e.clientY - rect.top }
  }

  const isPaused = useSimStore((s) => s.state.isPaused)
  const [inspectedTile, setInspectedTile] = useState<{ x: number; y: number } | null>(null)
  // keep the tile chip live while inspecting (no re-renders otherwise)
  useSimStore((s) => (inspectedTile ? s.state.tick : 0))

  const tileAt = (e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } | null => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = Math.floor(((e.clientX - rect.left) * (CANVAS_PX / rect.width)) / TILE_PX)
    const y = Math.floor(((e.clientY - rect.top) * (CANVAS_PX / rect.height)) / TILE_PX)
    return x >= 0 && x < MAP_SIZE && y >= 0 && y < MAP_SIZE ? { x, y } : null
  }

  const { tiles, agents, buildings } = useSimStore.getState().state
  const inspected = inspectedTile ? tiles[inspectedTile.y]?.[inspectedTile.x] : null
  const inspectedOwner = inspected
    ? agents.find((a) => a.id === territoryOwner(inspected.x, inspected.y, agents, TERRITORY_RADIUS))
    : null
  const inspectedBuilding = inspected?.buildingId
    ? buildings.find((b) => b.id === inspected.buildingId)
    : null

  return (
    <div className="map-wrap panel">
      <canvas
        ref={canvasRef}
        width={CANVAS_PX}
        height={CANVAS_PX}
        role="img"
        aria-label="Island map: agents, territories, and buildings. Click an agent to inspect them, or a tile for its details."
        onMouseMove={(e) => {
          const { agent, px, py } = agentAt(e)
          setHover(agent ? { agent, px, py } : null)
        }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => {
          const { agent } = agentAt(e)
          if (agent) {
            selectAgent(agent.id)
            setInspectedTile(null)
          } else {
            selectAgent(null)
            setInspectedTile(tileAt(e))
          }
        }}
      />
      {inspected && (
        <div className="tile-chip">
          <strong>
            ({inspected.x},{inspected.y}) {inspected.terrain}
          </strong>
          <span>
            🌾{inspected.food} 🪵{inspected.wood} 🪨{inspected.stone}
          </span>
          {inspectedOwner && <span style={{ color: inspectedOwner.color }}>{inspectedOwner.name}'s territory</span>}
          {inspectedBuilding && (
            <span>
              {BUILDING_ICONS[inspectedBuilding.type]} {inspectedBuilding.type} ({inspectedBuilding.hp} hp)
            </span>
          )}
          <button onClick={() => setInspectedTile(null)}>×</button>
        </div>
      )}
      {hover && <AgentTooltip agent={hover.agent} x={hover.px} y={hover.py} />}
      {isPaused && <div className="paused-overlay">⏸ PAUSED</div>}
      <details className="map-legend">
        <summary>Legend</summary>
        <div className="legend-grid">
          <span><i style={{ background: "#56885f" }} /> grass · <i style={{ background: "#2f5e2a" }} /> forest · <i style={{ background: "#2a6598" }} /> water · <i style={{ background: "#73716e" }} /> mountain</span>
          <span><i style={{ background: "rgba(230,57,70,0.35)" }} /> territory tint = owner · ⛺ base (bar = hp)</span>
          <span>◯ ring = health · ❗ = starving/wounded · 🪦 dead</span>
          <span>beams: ⚔️ attack · 🥷 theft · 🤝 trade · ❤️ gift · 🕊️ peace · 💬 talk</span>
          <span>click an agent → green/red lines show its friends &amp; enemies</span>
        </div>
      </details>
    </div>
  )
}

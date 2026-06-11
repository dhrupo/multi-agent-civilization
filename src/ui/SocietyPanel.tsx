import { useSimStore } from "../store/useSimStore"

// island-health mini chart: one metric over time
function MetricChart({
  label,
  values,
  color,
  domain,
}: {
  label: string
  values: number[]
  color: string
  domain?: [number, number]
}) {
  const w = 270
  const h = 34
  if (values.length < 2) {
    return (
      <div className="metric-chart">
        <span className="metric-label">{label}</span>
        <span className="panel-hint" style={{ padding: 0 }}>collecting…</span>
      </div>
    )
  }
  const min = domain ? domain[0] : Math.min(...values)
  const max = domain ? domain[1] : Math.max(...values)
  const span = Math.max(1, max - min)
  const path = values
    .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * (h - 4) - 2).toFixed(1)}`)
    .join(" ")
  const last = values[values.length - 1]
  return (
    <div className="metric-chart">
      <span className="metric-label">
        {label} <strong style={{ color }}>{Math.round(last)}</strong>
      </span>
      <svg width={w} height={h} role="img" aria-label={`${label} over time, currently ${Math.round(last)}`}>
        {domain && (
          <line x1={0} x2={w} y1={h - ((0 - min) / span) * (h - 4) - 2} y2={h - ((0 - min) / span) * (h - 4) - 2} stroke="#44445c" strokeDasharray="3 3" />
        )}
        <polyline points={path} fill="none" stroke={color} strokeWidth="1.5" />
      </svg>
    </div>
  )
}

export default function SocietyPanel() {
  const history = useSimStore((s) => s.state.societyHistory)
  const trust = history.map((m) => m.trust)
  const wealth = history.map((m) => m.wealth)
  // violence/trades are cumulative — chart the per-interval rate instead
  const rate = (xs: number[]) => xs.map((v, i) => (i === 0 ? 0 : Math.max(0, v - xs[i - 1])))
  const violence = rate(history.map((m) => m.violence))
  const trades = rate(history.map((m) => m.trades))

  return (
    <details className="society-panel panel">
      <summary>📈 Society</summary>
      <div className="society-charts">
        <MetricChart label="Trust (mean relationship)" values={trust} color="#52b788" domain={[-100, 100]} />
        <MetricChart label="Total wealth" values={wealth} color="#e9c46a" />
        <MetricChart label="Violence /10d" values={violence} color="#e63946" domain={[0, Math.max(5, ...violence)]} />
        <MetricChart label="Trades /10d" values={trades} color="#457b9d" domain={[0, Math.max(5, ...trades)]} />
      </div>
    </details>
  )
}

// Minimal z.ai-shaped mock for verifying the AI pipeline without a real key.
// Usage: node scripts/mock-zai.mjs  (listens on :5300)
import http from "node:http"

const STRATEGIES = ["gather", "build", "trade", "aggress", "socialize"]
let planCount = 0

function planResponse(userContent) {
  const names = [...userContent.matchAll(/^- (\w+):/gm)].map((m) => m[1])
  const strategy = STRATEGIES[planCount++ % STRATEGIES.length]
  const target = names[0] ?? null
  const stances = Object.fromEntries(
    names.map((n, i) => [n, strategy === "aggress" && i === 0 ? "enemy" : "neutral"])
  )
  return {
    strategy,
    target: strategy === "aggress" || strategy === "socialize" ? target : null,
    stances,
    thought: `Mock mind says: time to ${strategy}${target ? ` (eyes on ${target})` : ""}.`,
  }
}

function convoResponse(userContent) {
  const speakers = [...userContent.matchAll(/"speaker":"(\w+)"/g)].map((m) => m[1])
  const [a = "A", b = "B"] = speakers
  return {
    lines: [
      { speaker: a, text: "The island is small. Stay out of my forest." },
      { speaker: b, text: "Then keep your hands off my food stores." },
    ],
    deltaA: -8,
    deltaB: -8,
  }
}

http
  .createServer((req, res) => {
    let body = ""
    req.on("data", (c) => (body += c))
    req.on("end", () => {
      const payload = JSON.parse(body || "{}")
      const user = payload.messages?.find((m) => m.role === "user")?.content ?? ""
      const isConvo = user.includes('"lines"') && !user.includes('"stances"')
      const content = JSON.stringify(isConvo ? convoResponse(user) : planResponse(user))
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ choices: [{ message: { content } }] }))
      }, 300) // simulate latency
    })
  })
  .listen(5300, () => console.log("mock z.ai listening on :5300"))

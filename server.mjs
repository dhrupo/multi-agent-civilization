// Standalone production server: serves the built app (dist/) and proxies
// AI requests so the game works outside the Vite dev server.
//
//   npm run build && npm run serve     (PORT=8080 to override)
//
import http from "node:http"
import { readFileSync, existsSync } from "node:fs"
import { extname, join, normalize } from "node:path"

// minimal .env loader (no deps)
function loadEnv() {
  try {
    for (const line of readFileSync(".env", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2]
    }
  } catch {
    // no .env — env vars only
  }
}
loadEnv()

const PORT = Number(process.env.PORT) || 4173
const DIST = "./dist"
const FALLBACK_KEY = process.env.ZAI_API_KEY ?? ""
const FALLBACK_BASE = process.env.ZAI_BASE_URL || "https://api.z.ai/api/paas/v4"

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
}

http
  .createServer(async (req, res) => {
    if (req.method === "POST" && req.url === "/api/ai/chat") {
      const chunks = []
      req.on("data", (c) => chunks.push(c))
      req.on("end", async () => {
        const baseUrl = req.headers["x-ai-base-url"] || FALLBACK_BASE
        const auth = req.headers["x-ai-key"] || FALLBACK_KEY
        try {
          const upstream = await fetch(`${String(baseUrl).replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth}` },
            body: Buffer.concat(chunks),
          })
          res.statusCode = upstream.status
          const retryAfter = upstream.headers.get("retry-after")
          if (retryAfter) res.setHeader("retry-after", retryAfter)
          res.setHeader("Content-Type", "application/json")
          res.end(await upstream.text())
        } catch (error) {
          res.statusCode = 502
          res.end(JSON.stringify({ error: { message: String(error) } }))
        }
      })
      return
    }

    // static files with SPA fallback to index.html
    const path = normalize(decodeURIComponent((req.url ?? "/").split("?")[0])).replace(/^(\.\.[/\\])+/, "")
    let file = join(DIST, path === "/" ? "index.html" : path)
    if (!existsSync(file)) file = join(DIST, "index.html")
    try {
      res.setHeader("Content-Type", MIME[extname(file)] ?? "application/octet-stream")
      res.end(readFileSync(file))
    } catch {
      res.statusCode = 404
      res.end("not found")
    }
  })
  .listen(PORT, () => {
    console.log(`Tiny Civilization serving on http://localhost:${PORT}`)
    console.log(FALLBACK_KEY ? "AI fallback: .env z.ai key loaded" : "AI fallback: none (browser-entered keys only)")
  })

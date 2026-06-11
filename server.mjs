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

// The server key is bound to the default base URL only — never sent to a
// client-chosen host. Base URLs are validated (https, no private/loopback
// targets) to blunt SSRF.
function isBlockedHost(hostname) {
  const h = hostname.toLowerCase()
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal")) return true
  if (h === "::1" || h === "::" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 127 || a === 10 || a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
  }
  return false
}

function validateBase(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== "https:" || isBlockedHost(url.hostname)) return null
  return url
}

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
        const clientBase = req.headers["x-ai-base-url"]
        const clientKey = req.headers["x-ai-key"]
        // a custom base URL must bring its own key — don't pair it with FALLBACK_KEY
        if (clientBase && !clientKey) {
          res.statusCode = 400
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({ error: { message: "A custom base URL requires its own API key." } }))
          return
        }
        const baseUrl = clientBase || FALLBACK_BASE
        const auth = clientKey || (clientBase ? "" : FALLBACK_KEY)
        const base = validateBase(baseUrl)
        if (!base) {
          res.statusCode = 400
          res.setHeader("Content-Type", "application/json")
          res.end(JSON.stringify({ error: { message: "Invalid base URL (must be https and not a private host)." } }))
          return
        }
        try {
          const upstream = await fetch(`${base.toString().replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth}` },
            body: Buffer.concat(chunks),
            redirect: "manual",
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

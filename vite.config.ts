import { defineConfig, loadEnv, type Plugin } from "vite"
import react from "@vitejs/plugin-react"

// Forwards /api/ai/chat to any OpenAI-compatible provider. The browser sends
// the target base URL and (for user-configured providers) the key per request;
// with no key header, the server-side .env z.ai key is used as the fallback.
// Running through the dev server sidesteps CORS for every provider.
function isBlockedHost(rawHost: string): boolean {
  // URL.hostname wraps IPv6 literals in [brackets] — strip them before checks
  const h = rawHost.toLowerCase().replace(/^\[|\]$/g, "")
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal")) return true
  // IPv4-mapped/-compatible IPv6 with a dotted tail → check the embedded IPv4
  const embedded = h.match(/^::(?:ffff:)?(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
  const host = embedded ? embedded[1] : h
  if (host.includes(":")) {
    if (host === "::1" || host === "::") return true // loopback / unspecified
    if (host.startsWith("::")) return true // IPv4-mapped/-compatible (incl. ::ffff:7f00:1)
    const seg = host.split(":")[0]
    if (/^fe[89ab]/.test(seg)) return true // link-local fe80::/10
    if (/^f[cd]/.test(seg)) return true // unique-local fc00::/7
    if (/^ff/.test(seg)) return true // multicast ff00::/8
    return false
  }
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 127 || a === 10 || a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 192 && b === 168) return true
    if (a === 172 && b >= 16 && b <= 31) return true
  }
  return false
}

function validateBase(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== "https:" || isBlockedHost(url.hostname)) return null
  return url
}

function aiProxy(envKey: string, fallbackBase: string): Plugin {
  return {
    name: "tiny-civ-ai-proxy",
    configureServer(server) {
      server.middlewares.use("/api/ai/chat", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405
          res.end()
          return
        }
        const chunks: Buffer[] = []
        req.on("data", (c) => chunks.push(c))
        req.on("end", async () => {
          const clientBase = req.headers["x-ai-base-url"] as string | undefined
          const clientKey = req.headers["x-ai-key"] as string | undefined
          // a custom base URL must bring its own key — never paired with envKey
          if (clientBase && !clientKey) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: { message: "A custom base URL requires its own API key." } }))
            return
          }
          const base = validateBase(clientBase || fallbackBase)
          if (!base) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: { message: "Invalid base URL (must be https and not a private host)." } }))
            return
          }
          const auth = clientKey || (clientBase ? "" : envKey)
          try {
            const upstream = await fetch(`${base.toString().replace(/\/$/, "")}/chat/completions`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${auth}`,
              },
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
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const apiKey = env.ZAI_API_KEY ?? ""
  const baseUrl = env.ZAI_BASE_URL || "https://api.z.ai/api/paas/v4"

  return {
    plugins: [react(), aiProxy(apiKey, baseUrl)],
    // The env key stays in the dev server: the client only learns whether it exists.
    define: {
      __AI_KEY_PRESENT__: JSON.stringify(Boolean(apiKey)),
    },
  }
})

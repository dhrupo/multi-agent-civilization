// Netlify Function: the AI proxy for production deploys.
// Mirrors the dev-server middleware in vite.config.ts and server.mjs —
// forwards to any OpenAI-compatible provider, injecting the key server-side
// so it never appears in page scripts.
//
// Security: the server's own ZAI_API_KEY is ONLY ever sent to the default
// z.ai base URL. A request that supplies its own base URL MUST supply its own
// key too — otherwise the server key would be exfiltrated to an arbitrary host.
// Base URLs are validated (https only, no loopback/private/link-local targets)
// to blunt SSRF, and redirects are not followed.
const DEFAULT_BASE = process.env.ZAI_BASE_URL || "https://api.z.ai/api/paas/v4"

function isBlockedHost(hostname) {
  const h = hostname.toLowerCase()
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal")) return true
  // IPv6 loopback / unspecified / link-local / unique-local
  if (h === "::1" || h === "::" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true
  // IPv4 literal ranges: loopback, private, link-local, unspecified
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])]
    if (a === 127 || a === 10 || a === 0) return true
    if (a === 169 && b === 254) return true // link-local (incl. cloud metadata 169.254.169.254)
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
  if (url.protocol !== "https:") return null
  if (isBlockedHost(url.hostname)) return null
  return url
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  const clientBase = req.headers.get("x-ai-base-url")
  const clientKey = req.headers.get("x-ai-key")

  // The server key is bound to the default base URL. A custom base URL requires
  // its own key — never pair a client-chosen destination with the server key.
  let baseRaw
  let key
  if (clientBase) {
    if (!clientKey) {
      return new Response(
        JSON.stringify({ error: { message: "A custom base URL requires its own API key." } }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      )
    }
    baseRaw = clientBase
    key = clientKey
  } else {
    baseRaw = DEFAULT_BASE
    key = clientKey || process.env.ZAI_API_KEY || ""
  }

  const base = validateBase(baseRaw)
  if (!base) {
    return new Response(
      JSON.stringify({ error: { message: "Invalid base URL (must be https and not a private host)." } }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    )
  }

  try {
    const upstream = await fetch(`${base.toString().replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: await req.text(),
      redirect: "manual", // don't follow redirects to a re-validated-away host
    })
    const headers = { "Content-Type": "application/json" }
    const retryAfter = upstream.headers.get("retry-after")
    if (retryAfter) headers["retry-after"] = retryAfter
    return new Response(await upstream.text(), { status: upstream.status, headers })
  } catch (error) {
    return new Response(JSON.stringify({ error: { message: String(error) } }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    })
  }
}

export const config = { path: "/api/ai/chat" }

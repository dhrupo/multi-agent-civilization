// Netlify Function: the AI proxy for production deploys.
// Mirrors the dev-server middleware in vite.config.ts and server.mjs —
// forwards to any OpenAI-compatible provider, injecting the key server-side
// so it never appears in page scripts. Per-request x-ai-base-url/x-ai-key
// headers (user-configured minds) override the ZAI_* environment fallback.
export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }
  const baseUrl =
    req.headers.get("x-ai-base-url") || process.env.ZAI_BASE_URL || "https://api.z.ai/api/paas/v4"
  const key = req.headers.get("x-ai-key") || process.env.ZAI_API_KEY || ""
  try {
    const upstream = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: await req.text(),
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

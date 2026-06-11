import { defineConfig, loadEnv, type Plugin } from "vite"
import react from "@vitejs/plugin-react"

// Forwards /api/ai/chat to any OpenAI-compatible provider. The browser sends
// the target base URL and (for user-configured providers) the key per request;
// with no key header, the server-side .env z.ai key is used as the fallback.
// Running through the dev server sidesteps CORS for every provider.
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
          const baseUrl = (req.headers["x-ai-base-url"] as string) || fallbackBase
          const auth = (req.headers["x-ai-key"] as string) || envKey
          try {
            const upstream = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${auth}`,
              },
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

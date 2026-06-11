# Tiny Civilization 🏝️

A browser-based multi-agent civilization simulator where **AI agents live together on a small island** — gathering, building, trading, stealing, gossiping, holding grudges, making peace, and remembering it all across lives.

Give 2–8 agents distinct personalities, hand them an LLM mind, and watch a society emerge: wars that start for reasons and end from exhaustion, gossip that sparks conflicts, granaries invented to stop thieves, and personalities reshaped by trauma.

## What emerges (none of it scripted)

- 🗡️ **Justified violence only** — attacks require a real grievance or true desperation; unprovoked aggression is mechanically impossible
- 🏳️ **War weariness** — fruitless wars exhaust combatants until someone raises the white flag, followed by reparations and truces
- 🗣️ **Gossip** — conversations spread grievances and vouch for friends; a warning about a thief can start a war a week later
- 🤝 **Negotiated trade** — agents haggle terms in dialogue ("3 stone for 4 food?") and the deal executes as spoken
- 🏚️ **Fortification** — rampant theft drives victims to build granaries that lock food away from thieves
- 🧬 **Trait drift** — betrayal hardens agents, kindness softens them; big shifts become remembered character arcs
- 🔄 **Past lives** — agents remember previous runs: old allies, bitter enemies, catastrophes survived, lessons learned
- ❄️ **Seasons** — a 120-day year with harsh winters forces stockpiling and planning
- 🌋 **Catastrophes** — storms, blights, and earthquakes that test whether rivals help each other survive

## Architecture

Hybrid AI keeps it affordable: an **LLM decides strategy and dialogue** every ~2 weeks of sim time, while a **local utility engine executes daily actions** — a 1,000-day society costs ~150 API calls, not 15,000. Adaptive request pacing learns your API key's rate ceiling automatically.

- React 18 + TypeScript + Vite + Zustand, HTML5 canvas renderer
- Works with any OpenAI-compatible API — z.ai GLM is the default; OpenAI, Anthropic, Gemini, Groq, OpenRouter, or custom endpoints can be assigned as per-agent minds (mix models against each other!)
- Keys never reach the browser: a local proxy injects them server-side
- Seeded headless experiment runner for statistical claims (`npm run experiment`)
- 10-gate headless regression suite (`npm run test:headless`)

## Quick start

```bash
npm install
cp .env.example .env   # add your z.ai API key (or run keyless in instinct mode)
npm run dev            # http://localhost:5199
```

Set up agents (2–8), pick run length, press start. Click any agent on the map to see its social web — green lines to friends, red to enemies. Pause to freeze the action beams and inspect a scene.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with AI proxy at `localhost:5199` |
| `npm run build` | Production build to `dist/` |
| `npm run serve` | Standalone Node server for the built app (static + AI proxy) |
| `npm run test:headless` | 10-gate regression suite (justification, weariness, granaries, drift…) |
| `npm run experiment -- --runs 30 --days 1000 --seed 1` | Seeded batch runs, CSV to stdout |
| `npm run experiment -- --runs 5 --days 500 --ai --memory` | AI-minded batch with memories carried across runs |

## A finding worth sharing

The most peaceful run ever recorded (zero attacks, photo-finish scores) collapsed in the very next generation: agents *remembered* trusting each other, and that remembered trust became the attack surface for betrayal. Peace between strangers proved easier than peace between old friends with open tabs.

---

Built with [Claude Code](https://claude.com/claude-code).

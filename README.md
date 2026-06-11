# Tiny Civilization 🏝️

### ▶ [**Try the live demo →**](https://multiagentciv.netlify.app/)

A browser-based multi-agent civilization simulator where **AI agents live together on a small island** — gathering, building, trading, stealing, gossiping, holding grudges, making peace, and remembering it all across lives.

Give 2–8 agents distinct personalities, hand them an LLM mind, and watch a society emerge: wars that start for reasons and end from exhaustion, gossip that sparks conflicts, granaries invented to stop thieves, and personalities reshaped by trauma.

![A 6-agent run paused mid-earthquake: leaderboard with score sparklines, society health charts, and Vex's grudge ledger](docs/screenshot-sim.png)
*A 6-agent run paused mid-earthquake — leaderboard sparklines, society health charts, and the selected agent's grudge ledger.*

---

## Table of contents

- [How it works](#how-it-works)
- [Emergent mechanics](#emergent-mechanics)
- [The AI mind system](#the-ai-mind-system)
- [Quick start](#quick-start)
- [Playing a run](#playing-a-run)
- [Scripts & tooling](#scripts--tooling)
- [Project structure](#project-structure)
- [Tuning the society](#tuning-the-society)
- [Findings from 12+ simulated lifetimes](#findings-from-12-simulated-lifetimes)
- [Troubleshooting](#troubleshooting)

---

## How it works

### The hybrid architecture

Pure-LLM agents would cost a fortune (every step = a call) and pure-utility agents can't scheme or talk. Tiny Civilization splits the brain in two:

| Layer | Decides | Cadence | Cost |
|---|---|---|---|
| **LLM mind** | Strategy (`gather` / `build` / `trade` / `befriend` / `aggress` / `reconcile` / `defend`), per-neighbor stances, an inner thought, and all dialogue | Every ~15 sim-days (scales with population) | ~150 calls / 1,000 days |
| **Utility engine** | Each day's concrete action — eat, sleep, gather, build, steal, attack, gift, trade, make peace, shelter | Every tick (1 day) | Free, local |

The LLM's chosen strategy biases the utility scores (`STRATEGY_BIAS`), so a mind that declares *"aggress against Kai — he raided my base"* makes its body genuinely warlike for the next two weeks, while daily survival (hunger, energy, storms) still runs on instincts. No key? The sim runs in pure-instinct mode.

### A day in the loop

Every tick (1 sim-day, 500 ms wall time):

1. Catastrophes may strike (storm / blight / earthquake) or end
2. Needs decay — hunger and energy, scaled by season and blight
3. Each living agent scores ~18 possible actions and executes the best
4. Tiles regrow (season-scaled), grievances/weariness decay slowly
5. Every 10 days: society metrics sampled (trust, wealth, violence, trades)
6. Async: the AI controller fires due plan/conversation requests and applies the answers to the live state

### Memory across lives

When a run ends, each agent's life is distilled into memory lines — *"you won with score 200"*, *"Maya destroyed your home"*, *"you and Kai made peace after a feud"*, *"this life hardened you — you trust less now"* — stored in `localStorage` keyed by agent **name**. Next run, those memories are injected into the agent's prompts. Agents reference past lives in dialogue, pre-emptively pay reparations to remembered enemies, and trust remembered allies (sometimes to their cost — see [Findings](#findings-from-12-simulated-lifetimes)).

---

## Emergent mechanics

None of these behaviors are scripted — they emerge from the rules below plus the LLM's choices.

| Mechanic | The rule | What you'll see |
|---|---|---|
| 🗡️ **Justified violence** | Attacks/raids require a grievance above threshold (or true desperation). Grievances come from real wrongs: theft, attacks, raids, territory trespass. | An aggression-95 warrior with no grievance… peacefully gathers berries. Then someone steals from him. |
| 🏳️ **War weariness** | Each attack adds fatigue toward that opponent; fatigue dampens attack utility; crossing the threshold latches into burnout for ~years. | *"Kai has lost the will to keep fighting Maya — the war burns out"*, followed by reparations. |
| 🕊️ **Reconciliation** | Agents can pay food reparations to settle grudges held against them. The price escalates with each apology (4→7→10→13) and victims grow fatigued of serial apologizers. | Feuds actually end — but a thief can't cheaply apologize forever. |
| 🗣️ **Gossip** | Conversations transfer a fraction of the teller's strongest grievance to the listener, and vouch for close friends. | *"🗣️ Luna warned Rex about Vex"* — and a week later Rex attacks Vex. |
| 🤝 **Negotiated trade** | Conversation JSON may include a deal (`aGives`/`bGives`); validated and executed exactly as spoken. Trade is positive-sum (both sides gain a bonus). | *"3 stone for 4 food?"* in dialogue becomes a real inventory exchange. |
| 🏚️ **Granaries** | A storage building locks the owner's last 6 food away from thieves. Being robbed 3× (once for loners) makes anyone want one. | A theft wave triggers an island-wide fortification boom. |
| 🧬 **Trait drift** | Being attacked: −cooperation, +aggression. Receiving gifts/reparations: +cooperation. Bounded, slow. The agent panel shows how far each trait has moved from who they started as (*"⚖ Hardened — cooperation ▼9"*). | A trusting villager ground down by a bully measurably hardens — and remembers it next life. |
| ❄️ **Seasons** | 120-day year. Winter nearly halves food regrowth and sharpens hunger; minds are warned in prompts. | *"It is AUTUMN: winter is coming — stockpile now"* appears in agents' plans. |
| 🌋 **Catastrophes** | Storms, blights, earthquakes strike anytime, damage stockpiles and buildings; huddling together protects; violence is dampened. | Rivals sheltering side by side. Or an earthquake leveling four campfires at once. |
| 🏆 **Transparent scoring** | survival + health + buildings + exploration + social bonds. The end screen explains *why* the winner won. | *"Not a saint: 360 thefts and 1 raid supplemented the ledger."* |

---

## The AI mind system

- **Default mind: z.ai GLM (`glm-4.5-flash`)** via the key in `.env`. This is always the default — other providers can never silently take over.
- **Per-agent minds**: add any OpenAI-compatible provider (OpenAI, Anthropic, Gemini, Groq, OpenRouter, custom base URL) as a *mind profile* and assign it on an agent card — pit Claude against GLM against Gemini in the same village. Cross-mind conversations are true model-vs-model: each agent's own LLM writes its lines.
- **Keys never reach the browser.** The Vite dev server (and `server.mjs` in production) proxies `/api/ai/chat` and injects keys server-side. User-entered keys live in `localStorage` and travel only via proxy headers.
- **Keys are verified before saving** — a real test request must succeed.
- **Adaptive pacing**: every 429 widens that mind's request interval ×1.7 (up to 10s); every success narrows it 5%. The controller *learns* your key's actual rate ceiling, so one provider's outage or throttle never silences agents on another provider. Live call stats show in the top bar: `🧠 z.ai (GLM): glm-4.5-flash · 159✓ 2✗ 2⏳`.
- **Resilient parsing**: reasoning models that burn tokens on hidden thinking, truncated JSON, code fences — all repaired or retried; repeated failures rest that mind only, with auto-resume.

---

## Quick start

```bash
npm install
cp .env.example .env   # add your z.ai API key (or run keyless in instinct mode)
npm run dev            # http://localhost:5199
```

For a production deployment:

```bash
npm run build
npm run serve          # standalone Node server: static dist/ + AI proxy
```

**Deploying to Netlify**: `netlify.toml` and `netlify/functions/ai-chat.mjs` are included — the AI proxy runs as a serverless function at `/api/ai/chat`. Deploy via the connected repo (or `netlify deploy --prod`; drag-and-drop won't include functions), and set `ZAI_API_KEY` in **Site settings → Environment variables** so the default GLM mind works (it's also read at build time to enable the AI badge). Live demo: [multiagentciv.netlify.app](https://multiagentciv.netlify.app/)

---

## Playing a run

1. **Setup screen** — configure 2–8 agents: name, color, personality sliders (aggression / greed / cooperation / curiosity) or presets (Warrior, Merchant, Explorer, Hermit, Tyrant, Diplomat), and optionally a per-agent mind. Set run length (up to 9,999 days). The 📜 **Chronicle** shows every past life the island remembers.
2. **The canvas is the theater**:
   - **Action beams** — animated arcs between agents: ⚔️ attack (red), 🥷 theft (purple), 🤝 trade (gold), ❤️ gift (green), 🕊️ peace (white), 💬 talk
   - **Click an agent** → its social web: solid green lines to friends, dashed red to enemies, thickness = intensity
   - **Pause freezes the beams** so you can inspect a scene
   - ❗ flags mark agents starving or badly wounded; territory tint shows ownership; the map's color shifts with the seasons
3. **Side panels** — live leaderboard with score sparklines, 📈 Society dashboard (trust, wealth, violence rate, trade rate over time), and the selected agent's full state: needs, inventory, grudges (with reasons), plan, and mind.
4. **Event log** — filterable feed: ⚔️ Drama, 🤝 Social, 🧠 Minds (inner thoughts and plans).
5. **End screen** — why the winner won (score breakdown + narrative), final stats table (trades / gifts / peace / thefts / raids / attacks / kills / built), a three-lane story timeline (⚔️ conflict / 🌍 world / 🕊️ diplomacy), top-10 most dramatic events, the relationship matrix, and **"What they'll remember"** — the memories carrying into the next life.

![End screen: final leaderboard, three-lane story timeline, and the most dramatic events of a 600-day run](docs/screenshot-end.png)
*The end of a 600-day, 6-agent run: a day-114 earthquake leveled every campfire, Maya razed Ana's base, and by day 164 Kai had lost the will to keep fighting Vex.*

---

## Scripts & tooling

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with AI proxy at `localhost:5199` |
| `npm run build` | Production build to `dist/` |
| `npm run serve` | Standalone Node server (static + AI proxy), for deployment |
| `npm run test:headless` | **14-gate regression suite**: stockpile caps, trespass grievance caps, the justification gate (no cause → no violence), justified violence, reconciliation, positive-sum trade, storage protection, war burnout, trait drift, diplomat viability, gossip transfer, negotiated trade (+ guard), catastrophe frequency |
| `npm run experiment -- --runs 30 --days 1000 --seed 1` | Seeded, reproducible instinct-mode batch; CSV per run to stdout, win/score summary to stderr |
| `npm run experiment -- --runs 5 --days 500 --ai --memory` | AI-minded batch in Node (direct provider calls); `--memory` carries memories across the batch's runs — for testing how history changes outcomes statistically |

The experiment runner is how balance changes get validated here: every mechanic landed with before/after win-rate tables across 30–60 seeded runs (e.g., the Hermit rebalance moved Luna from 0/30 wins at mean 111 to 9–11/30 at mean ~185 without breaking the other archetypes). The same approach made every archetype viable: **industry** (the drive to gather and build) runs on `max(greed, self-reliance, proven commerce)` — so the greedy build, loners homestead behind granaries (Hermit), and merchants who have traded enough reinvest their wealth in construction (Diplomat). No personality is a dead end.

---

## Project structure

```
src/
  simulation/        # deterministic core — no AI, no DOM
    world.ts         #   20×20 island generation, territory, spawns
    agent.ts         #   agent factory, personality presets
    actions.ts       #   utility scoring + action execution (the "instinct" brain)
    relationships.ts #   relationships, grievances, decay
    conversation.ts  #   gossip transfer + negotiated-trade execution (pure, tested)
    buildings.ts     #   bases, granaries, build priorities
    tick.ts          #   the day loop: needs, catastrophes, seasons, metrics
    seasons.ts       #   120-day year, regen/hunger multipliers
    scoring.ts       #   score breakdown + "why X won" narrative
    rng.ts           #   seeded RNG (mulberry32) for reproducible experiments
  ai/
    controller.ts    #   plan/conversation cadence, prompts, adaptive pacing, per-mind backoff
    client.ts        #   OpenAI-compatible chat client, JSON repair, call stats
    settings.ts      #   provider presets, mind profiles, GLM-default enforcement
    memory.ts        #   past-life memory build/store/recall
  store/useSimStore.ts  # Zustand store + AI bridge (plans, convos, gossip, deals)
  ui/                # SetupScreen, SimScreen, MapCanvas (beams, webs), Leaderboard,
                     # SocietyPanel, AgentPanel, EventLog, EndScreen
scripts/
  headless.ts        # the 14-gate regression suite
  experiment.ts      # seeded batch runner (instinct or --ai)
server.mjs           # production server: static dist/ + AI proxy
```

The simulation core is pure TypeScript with zero DOM/AI dependencies — the same `runTick` powers the browser, the test suite, and the batch runner.

---

## Tuning the society

Every behavioral dial lives in `src/constants.ts`, documented inline. The ones that matter most:

| Constant | Default | Effect |
|---|---|---|
| `ATTACK_MIN_JUSTIFICATION` | 30 | How much grievance legitimizes violence |
| `WEARINESS_EXHAUSTED` / `WEARINESS_BURNOUT` | 24 / 60 | When wars burn out, and how long burnout holds |
| `PEACE_COST_FOOD` + `PEACE_REPEAT_SURCHARGE` | 4 + 3 | Reparations price and its escalation |
| `GOSSIP_TRANSFER` | 0.3 | How much of a grudge rubs off in conversation |
| `STORAGE_PROTECTED_FOOD` | 6 | How much food a granary locks away |
| `DRIFT_BETRAYED_COOP` | −1 | Personality damage per betrayal |
| `SEASON_REGEN_MULT.winter` | 0.45 | How hard winter bites |
| `CATASTROPHE_DAILY_CHANCE` | 0.02 | Pressure dial for disasters |
| `AI_PLAN_INTERVAL_DAYS` | 15 | LLM strategy cadence (auto-scales with population) |

Change a dial → `npm run experiment` → read the win-rate table. That's the whole balancing workflow.

---

## Findings from 12+ simulated lifetimes

The same island, run over and over with memories on, produced a coherent arc:

1. **Massacres** — early builds: the warrior killed everyone. Deterrence didn't exist.
2. **Forever wars** — justification fixed unprovoked violence, but wars couldn't end: 495 fruitless attacks across 1,500 days.
3. **Diplomacy** — reconciliation + escalating reparations ended feuds, until war weariness made endings *inevitable*: attacks per 2,000-day run collapsed from 594 → 14 → 0.
4. **The kleptocracy** — with war capped, theft became the unpunished crime (340 thefts/run). Granaries fixed it the human way: fortification, not punishment.
5. **The golden age** — a clean-slate run with no memories: zero attacks in 1,000 days, three archetypes within 2 points, the Warrior won *by out-trading everyone* (118 trades, 1 attack).
6. **The fall** — the very next run, with memories of that golden age, collapsed: remembered trust lowered everyone's guard, which raised the payoff of betrayal. Scores dropped ~15%, every relationship ended negative. **Peace between strangers proved easier than peace between old friends with open tabs.**
7. **The hardened generation** — trait drift now writes trauma forward: three of four agents carried *"this life hardened you — you trust less now"* into their next life.

The recurring lesson: every time one form of conflict gets patched, the agents find the next cheapest one — massacres → wars → theft → litigation. Exactly like us.

---

## Troubleshooting

- **"🧠 AI off — instinct mode"** — no key found. Add `ZAI_API_KEY` to `.env` (restart the dev server) or enter a key on the setup screen.
- **"🧠 AI resting (rate limit) — auto-resuming"** — your provider throttled. The sim continues on instinct and the mind auto-resumes; adaptive pacing widens intervals so it won't re-trip immediately. Persistent throttling on a free-tier key with 8 agents is normal — fewer agents or a paid tier fixes it.
- **Calls look stuck?** Hover the 🧠 badge: `sent / ok / failed / throttled` tells you exactly what's happening.
- **Want determinism?** Use the experiment runner with `--seed` — the browser run is intentionally non-deterministic (live LLM).
- **Forget the past**: the setup screen has a "forget past lives" control (and the Chronicle to review them first).

---

Built with [Claude Code](https://claude.com/claude-code).

# Launch posts — Tiny Civilization

Live demo: https://multiagentciv.netlify.app/
Repo: https://github.com/dhrupo/multi-agent-civilization

---

## 1) DEV.to article

**Title:** I gave 8 AI agents an island and watched a society emerge — wars, gossip, grudges, and peace

**Tags:** ai, gamedev, typescript, showdev

---

### Tiny Civilization: what happens when AI agents have to *live together*

I grew up on **Age of Empires**, **Sid Meier's Civilization**, and **Rise of Nations**. The thing that hooked me was never the graphics — it was the *systems*. You set a few rules in motion and a whole world spills out of them: economies, rivalries, alliances, betrayals.

Years later I watched OpenAI's [hide-and-seek multi-agent video](https://www.youtube.com/watch?v=kopoLzvh5jY) ([writeup](https://openai.com/index/emergent-tool-use/)), where agents that were only rewarded for hiding and seeking *invented tools and counter-strategies nobody coded* — ramps, box-surfing, fort-building. Emergent behavior from simple pressure. That broke something open for me.

So I asked a smaller question: **forget winning a game — what if AI agents just had to live in a society together?** Would they behave like us? Hold grudges? Gossip? Make peace because they're tired of fighting?

That became **Tiny Civilization** — a browser sim where 2–8 agents with distinct personalities live on a small island, gathering, building, trading, stealing, gossiping, holding grudges, making peace, and *remembering it all across lives*.

👉 **[Live demo](https://multiagentciv.netlify.app/)** — runs keyless in "instinct mode," or plug in a key for LLM minds.

The whole thing — every line — was built with **Claude Code, using the Fable model**, right before Fable retired. It felt fitting to send a storytelling model off by having it build a world full of little stories.

---

### The problem: pure-LLM agents are bankrupting and pure-utility agents are boring

The first design decision was the hardest. Two obvious options, both bad:

- **Call the LLM every tick.** Every agent, every day, makes an API call. Beautiful, expressive — and it costs a fortune and crawls.
- **Pure utility AI (the classic RTS approach).** Fast and free, but agents can't *scheme*, can't talk, can't surprise you. It's just min-maxing.

So I split the brain in two:

| Layer | Decides | Cadence | Cost |
|---|---|---|---|
| **LLM mind** | Strategy (`gather`/`build`/`trade`/`befriend`/`aggress`/`reconcile`/`defend`), per-neighbor stances, an inner thought, and all dialogue | ~every 15 sim-days | ~150 calls / 1,000 days |
| **Utility engine** | Each day's concrete action — eat, sleep, gather, steal, attack, gift, trade, make peace | every tick | free, local |

The LLM declares intent — *"aggress against Kai, he raided my base"* — and that biases the utility scores for the next two weeks. The *body* runs on instinct (hunger, energy, storms); the *mind* sets direction. This is the trick that makes it both affordable and alive.

---

### Memory across lives — where it got strange

When a run ends, each agent's life is distilled into memory lines:

- *"you won with score 200"*
- *"Maya destroyed your home"*
- *"you and Kai made peace after a feud"*
- *"this life hardened you — you trust less now"*

Stored in `localStorage`, keyed by agent **name**, and injected into next run's prompts. Agents start referencing past lives in dialogue, pre-emptively paying reparations to remembered enemies, trusting remembered allies — *sometimes to their own ruin.*

---

### How I actually built and balanced it

This is the part I'm proudest of, and it's pure childhood-strategy-game energy: **you can't balance a society by vibes.** So the workflow was:

1. **A pure, deterministic simulation core** — zero DOM, zero AI. The same `runTick` powers the browser, the tests, and a batch runner.
2. **A seeded experiment runner.** `npm run experiment -- --runs 30 --days 1000 --seed 1` runs 30 reproducible lifetimes and spits out a win-rate/score table. Every balance change landed with a before/after table. (Example: a Hermit rebalance moved one agent from 0/30 wins to 9–11/30 *without* breaking the other archetypes.)
3. **A 16-gate regression suite.** The justification gate (no grievance → no violence), war burnout, reconciliation pricing, positive-sum trade, granary protection, homelessness-death, trait drift — each one locked behind a headless test so balance changes can't silently regress behavior.

Change a dial in `constants.ts` → run the experiment → read the table. That was the entire loop.

---

### What emerged (none of this is scripted)

Running the same island over and over, with memory on, produced a coherent arc:

1. **Massacres.** Early on, the warrior just killed everyone. No deterrence existed.
2. **Forever wars.** I added a justification gate (violence needs a real grievance — theft, attack, trespass). That fixed unprovoked killing… but now wars never *ended*: 495 fruitless attacks across 1,500 days.
3. **Diplomacy.** Reconciliation + escalating reparations + war-weariness made endings *inevitable*. Attacks per 2,000-day run collapsed: 594 → 14 → 0.
4. **The kleptocracy.** With war capped, theft became the unpunished crime — 340 thefts/run. I fixed it the *human* way: granaries. Fortification, not punishment.
5. **The golden age.** A clean-slate run, no memories: zero attacks in 1,000 days, and the Warrior won *by out-trading everyone* (118 trades, 1 attack).
6. **The fall.** The very next run — now *remembering* that golden age — collapsed. Remembered trust lowered everyone's guard, which raised the payoff of betrayal. Scores dropped ~15%; every relationship ended negative. **Peace between strangers turned out to be easier than peace between old friends with open tabs.**

The recurring lesson: every time I patched one form of conflict, the agents found the next-cheapest one. Massacres → wars → theft → litigation. Exactly like us.

---

### Stack

TypeScript, React, Zustand, Vite, Recharts. Default mind is z.ai GLM, but any OpenAI-compatible provider works per-agent — so you can literally pit Claude vs GLM vs Gemini in the same village and watch model-vs-model diplomacy. Keys never touch the browser (server-side proxy), and an adaptive-pacing controller learns each key's real rate ceiling.

**Try it:** https://multiagentciv.netlify.app/
**Code:** https://github.com/dhrupo/multi-agent-civilization

If you played the same strategy games I did, I think you'll feel right at home watching this thing run.

---

## 2) LinkedIn post

I grew up playing Age of Empires, Civilization, and Rise of Nations. What hooked me was never the graphics — it was watching a whole world spill out of a few simple rules.

Years later, OpenAI's multi-agent hide-and-seek experiment hit the same nerve: agents rewarded only for hiding and seeking *invented* tools and counter-strategies nobody coded. Emergent behavior from simple pressure.
Video: https://www.youtube.com/watch?v=kopoLzvh5jY
Writeup: https://openai.com/index/emergent-tool-use/

So I built **Tiny Civilization** — a browser sim where 2–8 AI agents live together on a small island. They gather, build, trade, steal, gossip, hold grudges, make peace... and remember it all across lives.

The honest question behind it: **forget winning — would AI agents in a society behave like us?**

They do, unsettlingly so. Across 12+ simulated lifetimes the same arc kept emerging:
→ Massacres, until I added a rule that violence needs a real grievance
→ Forever wars, until war-weariness made peace inevitable
→ Then theft became the unpunished crime — so the agents fortified instead of punishing (granaries, not police)
→ And in one run, remembered *trust* between old friends became the very thing that got them betrayed

Every time I patched one form of conflict, they found the next-cheapest one. Massacres → wars → theft → litigation. Exactly like us.

A few things I'm proud of on the engineering side:
• A hybrid brain — an LLM sets strategy every ~15 days; a fast local utility engine runs daily survival. Expressive *and* affordable.
• A seeded experiment runner — every balance change shipped with a before/after win-rate table across 30+ reproducible runs. You can't balance a society by vibes.
• Memory across lives, stored and replayed into prompts, so trauma and trust carry forward.

The whole thing was built with Claude Code using the Fable model, right before Fable retired — a storytelling model sent off by building a world full of little stories.

Full write-up on how I built it: https://dev.to/dhrupo/i-gave-8-ai-agents-an-island-and-watched-a-society-emerge-wars-gossip-grudges-and-peace-2edj
Try it (runs free in instinct mode, or plug in a key): https://multiagentciv.netlify.app/
Code's open source: https://github.com/dhrupo/multi-agent-civilization

#AI #MultiAgent #GameDev #EmergentBehavior #TypeScript

---

## 3) X / Twitter (single post)

I gave 8 AI agents an island and told them nothing except: survive together.

They invented war, then diplomacy, then theft, then granaries to stop the theft. None of it was scripted.

Inspired by Age of Empires + OpenAI's hide-and-seek agents. Built with Claude Code on the Fable model, right before it retired.

Write-up: https://dev.to/dhrupo/i-gave-8-ai-agents-an-island-and-watched-a-society-emerge-wars-gossip-grudges-and-peace-2edj
Try it (free): https://multiagentciv.netlify.app/
Code: https://github.com/dhrupo/multi-agent-civilization

---

## 4) Facebook post (Bangla)

ছোটবেলার একটা পাগলামি থেকে একটা জিনিস বানিয়ে ফেললাম, শেয়ার না করে পারছি না।

আমরা যারা Age of Empires, Civilization, Rise of Nations খেলে বড় হয়েছি — আমার কাছে এই গেমগুলোর আসল মজা কিন্তু যুদ্ধ-টুদ্ধ না। মজাটা ছিল এই দেখায় যে কয়েকটা সাধারণ নিয়ম ছেড়ে দিলে কেমন করে চোখের সামনে একটা গোটা সমাজ দাঁড়িয়ে যায় — ব্যবসা, বন্ধুত্ব, শত্রুতা, পেছন থেকে ছুরি মারা, সব।

বছর কয়েক আগে OpenAI-এর একটা ভিডিও দেখে মাথা পুরো নষ্ট হয়ে গিয়েছিল — কয়েকটা AI-কে শুধু লুকোচুরি খেলতে দেওয়া হয়েছিল, আর ওরা নিজে নিজেই এমন সব ট্রিক বের করে ফেলল যেগুলো কেউ শেখায়নি। তখন থেকেই মাথায় ঘুরছিল, একটা সহজ প্রশ্ন — জেতা-হারা বাদ দেন, কয়েকটা AI-কে যদি শুধু একসাথে বাঁচতে হয়, ওরা কি আমাদের মতোই হয়ে যাবে?

সেই কৌতূহল থেকেই বানালাম Tiny Civilization 🏝️

ছোট্ট একটা দ্বীপ, তাতে ৮টা AI চরিত্র — কেউ যোদ্ধা, কেউ ব্যবসায়ী, কেউ আবার একা থাকতে ভালোবাসে। ওরা খাবার জোগাড় করে, ঘর বানায়, কেনাবেচা করে, সুযোগ পেলে চুরিও করে, একজন আরেকজনের নামে কান-ভাঙানি দেয়, মনে মনে রাগ পুষে রাখে, আবার মিটমাটও করে ফেলে। আর সবচেয়ে অদ্ভুত ব্যাপার — এক জীবনের কথা ওরা পরের জীবনে মনে রাখে। কে কাকে ঠকিয়েছিল, কার সাথে শান্তি হয়েছিল, সব।

কোনো কিছুই আমি স্ক্রিপ্ট করে দিইনি। তাও একই দ্বীপ বারবার চালাতে গিয়ে দেখি, প্রতিবার মোটামুটি একই গল্প ফিরে আসে। শুরুতে সবাই সবাইকে মারে। তারপর একটা নিয়ম দিলাম — কারণ ছাড়া কাউকে মারা যাবে না — তখন শুরু হলো বছরের পর বছর ধরে চলা অর্থহীন যুদ্ধ। সেটা থামাতে যেই "যুদ্ধক্লান্তি" যোগ করলাম, অমনি যুদ্ধ থামল ঠিকই, কিন্তু এবার সবচেয়ে সহজ অপরাধ হয়ে দাঁড়াল চুরি। মজার ব্যাপার, এই AI-গুলো চুরি ঠেকাল পুলিশ দিয়ে না — গোলাঘর বানিয়ে নিজেরটা তালাবন্ধ করে। আর সবচেয়ে গায়ে কাঁটা দেওয়া ঘটনাটা — একবার পুরোনো বন্ধুত্বের বিশ্বাসটাই হয়ে দাঁড়াল ঠকানোর সুযোগ।

মানে প্রতিবার এক রকম ঝামেলা ঠিক করি, ওরা পরের সবচেয়ে সস্তা ঝামেলাটা খুঁজে বের করে। খুন → যুদ্ধ → চুরি → মামলা। হুবহু আমাদের মতোই। 😅

আর একটা কথা না বললেই না — পুরোটা বানিয়েছি Claude Code দিয়ে, Fable নামের একটা মডেল দিয়ে, ওটা retire হওয়ার ঠিক আগের মুহূর্তে। গল্প বলতে ওস্তাদ একটা মডেলকে দিয়ে ছোট ছোট গল্পে ভরা একটা দুনিয়া বানিয়ে বিদায় দিলাম — ভাবতে ভালোই লাগে। 🙂

ফ্রি-তে নিজে চালিয়ে দেখেন, কোনো key-টে লাগে না 👇
🔗 https://multiagentciv.netlify.app/

কীভাবে বানালাম, পুরো গল্প (DEV.to):
📝 https://dev.to/dhrupo/i-gave-8-ai-agents-an-island-and-watched-a-society-emerge-wars-gossip-grudges-and-peace-2edj

কোড দেখতে চাইলে (open source):
💻 https://github.com/dhrupo/multi-agent-civilization

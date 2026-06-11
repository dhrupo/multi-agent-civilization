import type { SimState } from "../types"
import { DRIFT_MEMORY_THRESHOLD, MEMORY_MAX_RUNS } from "../constants"

// Memories persist across runs, keyed by agent NAME (lowercase): an agent named
// "Kai" is the same "soul" in every run that includes a Kai.

export type RunMemory = {
  runNumber: number
  endedDay: number
  perAgent: Record<string, string[]> // lowercase name → first-person memory lines
}

const STORAGE_KEY = "tiny-civ-memories"

// In Node (batch experiments) there is no localStorage — an in-process map
// stands in, so memories persist across sequential runs within one batch.
const nodeStore = new Map<string, string>()
const storage =
  typeof localStorage !== "undefined"
    ? localStorage
    : {
        getItem: (k: string) => nodeStore.get(k) ?? null,
        setItem: (k: string, v: string) => void nodeStore.set(k, v),
        removeItem: (k: string) => void nodeStore.delete(k),
      }

type MemoryFile = { nextRunNumber: number; runs: RunMemory[] }

function readFile(): MemoryFile {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as MemoryFile
      if (Array.isArray(parsed.runs) && typeof parsed.nextRunNumber === "number") return parsed
    }
  } catch (error) {
    console.error("[memory] failed to read past runs:", error)
  }
  return { nextRunNumber: 1, runs: [] }
}

function writeFile(file: MemoryFile): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(file))
  } catch (error) {
    console.error("[memory] failed to persist run:", error)
  }
}

export function buildRunMemory(state: SimState, runNumber: number): RunMemory {
  const perAgent: Record<string, string[]> = {}
  const nameOf = (id: string) => state.agents.find((a) => a.id === id)?.name ?? "someone"

  // Dialogue (💬) and plan (🧠) events quote agents TALKING about kills and
  // raids — only plain action events are facts the memory may record.
  const factual = state.events.filter((e) => !e.text.includes("💬") && !e.text.includes("🧠"))

  // kills, from dramatic events: involvedIds = [killer, victim]
  const kills = factual.filter((e) => e.text.includes(" killed ") && e.involvedIds.length === 2)

  for (const agent of state.agents) {
    const lines: string[] = []
    const winner = state.winner?.id === agent.id

    if (winner) lines.push(`you won with score ${agent.score}`)
    if (!agent.isAlive) {
      const killedBy = kills.find((k) => k.involvedIds[1] === agent.id)
      lines.push(
        killedBy
          ? `${nameOf(killedBy.involvedIds[0])} killed you on day ${killedBy.day}`
          : `you starved to death on day ${agent.deathDay}`
      )
    } else if (!winner) {
      lines.push(`you survived to the end (score ${agent.score})`)
    }

    for (const kill of kills) {
      if (kill.involvedIds[0] === agent.id) {
        lines.push(`you killed ${nameOf(kill.involvedIds[1])} on day ${kill.day}`)
      }
    }

    // base destructions cut deep
    const baseRuined = factual.find(
      (e) => e.text.includes("destroyed") && e.text.includes("base") && e.involvedIds[1] === agent.id
    )
    if (baseRuined) lines.push(`${nameOf(baseRuined.involvedIds[0])} destroyed your home`)

    // peace made (or rejected) is a defining memory
    const peaceMade = factual.find(
      (e) => e.text.includes("reparations") && e.involvedIds.includes(agent.id)
    )
    if (peaceMade) {
      const otherId = peaceMade.involvedIds.find((id) => id !== agent.id)
      if (otherId) lines.push(`you and ${nameOf(otherId)} made peace after a feud`)
    }

    // generosity is remembered too
    const gifts = factual.filter((e) => e.text.includes("shared food") && e.involvedIds[0] === agent.id)
    if (gifts.length >= 2) lines.push(`you were generous, sharing food in hard times`)
    const received = factual.filter((e) => e.text.includes("shared food") && e.involvedIds[1] === agent.id)
    if (received.length >= 1) {
      lines.push(`${nameOf(received[received.length - 1].involvedIds[0])} fed you when you were struggling`)
    }

    if (state.catastropheCount > 0) {
      lines.push(`you lived through ${state.catastropheCount} catastrophe${state.catastropheCount > 1 ? "s" : ""}`)
    }

    // a life that reshaped your character is worth remembering
    const coopShift = agent.personality.cooperation - agent.basePersonality.cooperation
    if (coopShift <= -DRIFT_MEMORY_THRESHOLD) lines.push(`this life hardened you — you trust less now`)
    else if (coopShift >= DRIFT_MEMORY_THRESHOLD) lines.push(`this life softened you — kindness reached you`)

    for (const other of state.agents) {
      if (other.id === agent.id) continue
      const rel = agent.relationships[other.id] ?? 0
      if (rel >= 50) lines.push(`${other.name} was your trusted ally`)
      else if (rel <= -50) lines.push(`${other.name} was your bitter enemy`)
    }

    perAgent[agent.name.toLowerCase()] = lines.slice(0, 7)
  }

  return { runNumber, endedDay: state.day, perAgent }
}

export function saveRunMemory(state: SimState): void {
  const file = readFile()
  const memory = buildRunMemory(state, file.nextRunNumber)
  writeFile({
    nextRunNumber: file.nextRunNumber + 1,
    runs: [...file.runs, memory].slice(-MEMORY_MAX_RUNS),
  })
}

export function currentRunNumber(): number {
  return readFile().nextRunNumber
}

// First-person past-life lines for one agent, oldest run first.
export function memoriesForAgent(name: string): string[] {
  const key = name.toLowerCase()
  const lines: string[] = []
  for (const run of readFile().runs) {
    const mine = run.perAgent[key]
    if (mine?.length) {
      lines.push(`In life #${run.runNumber} (lasted ${run.endedDay} days): ${mine.join("; ")}.`)
    }
  }
  return lines.slice(-4)
}

export function clearMemories(): void {
  storage.removeItem(STORAGE_KEY)
}

export function pastRunCount(): number {
  return readFile().runs.length
}

export function listRuns(): RunMemory[] {
  return readFile().runs
}

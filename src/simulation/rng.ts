// Simulation-core randomness goes through here so experiments can be seeded
// and reproduced exactly. Defaults to Math.random for normal play.

let rand: () => number = Math.random

// mulberry32 — small, fast, good-enough statistical quality for a sim
export function setSeed(seed: number): void {
  let a = seed >>> 0
  rand = () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function resetRng(): void {
  rand = Math.random
}

export function random(): number {
  return rand()
}

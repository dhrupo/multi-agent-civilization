import type { Season } from "../types"
import { SEASON_LENGTH, SEASON_REGEN_MULT, WINTER_HUNGER_MULT } from "../constants"

const ORDER: Season[] = ["spring", "summer", "autumn", "winter"]

export const SEASON_EMOJI: Record<Season, string> = {
  spring: "🌸",
  summer: "☀️",
  autumn: "🍂",
  winter: "❄️",
}

export function getSeason(day: number): Season {
  return ORDER[Math.floor((day % (SEASON_LENGTH * 4)) / SEASON_LENGTH)]
}

export function seasonDay(day: number): number {
  return (day % SEASON_LENGTH) + 1
}

export function seasonRegenMult(day: number): number {
  return SEASON_REGEN_MULT[getSeason(day)]
}

export function seasonHungerMult(day: number): number {
  return getSeason(day) === "winter" ? WINTER_HUNGER_MULT : 1
}

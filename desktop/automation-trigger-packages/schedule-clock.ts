import type { ScheduleClock } from "./schedule-constraints"

export function sameWallDay(clock: ScheduleClock, day: Date): boolean {
  return clock.year === day.getUTCFullYear() && clock.month === day.getUTCMonth() + 1 && clock.day === day.getUTCDate()
}

export function sameWallMinute(clock: ScheduleClock, day: Date, minute: number): boolean {
  return sameWallDay(clock, day) && clock.minute === minute
}

export function offsetsAroundDay(day: Date, readClock: (date: Date) => ScheduleClock): Set<number> {
  const offsets = new Set<number>()
  // Probe both sides of local clock changes so repeated minutes retain both instants.
  for (const hours of [-36, -12, 12, 36]) {
    const probe = day.getTime() + hours * 3_600_000
    offsets.add(clockOffsetMs(probe, readClock))
  }
  return offsets
}

export function clockOffsetMs(instant: number, readClock: (date: Date) => ScheduleClock): number {
  const clock = readClock(new Date(instant))
  return Date.UTC(clock.year, clock.month - 1, clock.day) + clock.minute * 60_000 - instant
}

import fs from "node:fs"

export function extractI64(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (typeof value === "number") return Math.floor(value)
  if (typeof value === "string") {
    const parsed = parseInt(value, 10)
    return Number.isNaN(parsed) ? 0 : parsed
  }
  return 0
}

export function parseTimestamp(value: unknown): number {
  if (value === null || value === undefined) return 0
  if (typeof value === "string") {
    const date = new Date(value)
    if (!Number.isNaN(date.getTime())) return date.getTime()
    const numeric = parseInt(value, 10)
    if (!Number.isNaN(numeric)) {
      return numeric >= 1_000_000_000_000 ? numeric : numeric * 1000
    }
    return 0
  }
  if (typeof value === "number") {
    if (value <= 0) return 0
    return value >= 1_000_000_000_000 ? value : value * 1000
  }
  return 0
}

export function fileModifiedMs(filePath: string): number {
  try {
    return fs.statSync(filePath).mtimeMs
  } catch {
    return Date.now()
  }
}

export function timestampToLocalDate(ms: number): string {
  const d = new Date(ms)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function normalizeAgentName(raw: string): string {
  let name = raw.replace(/[​‌‍﻿]/g, "").trim()
  name = name.replace(/^(astrape|oh-my-claudecode|oh-my-codex):/, "")
  name = name.replace(/\s+/g, " ").trim()
  if (!name) return "unknown"

  const lower = name.toLowerCase()
  if (lower === "omo" || lower === "sisyphus") return "Sisyphus"
  if (lower === "orchestrator-sisyphus") return "Atlas"
  if (lower === "omo-plan") return "Planner-Sisyphus"

  return name
    .split(/[-\s]+/)
    .map((w) => {
      const upper = w.toUpperCase()
      if (["UI", "UX", "API"].includes(upper)) return upper
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    })
    .join(" ")
}

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

function containsDelimited(haystack: string, needle: string): boolean {
  let pos = 0
  while (true) {
    const idx = haystack.indexOf(needle, pos)
    if (idx === -1) return false
    const beforeOk = idx === 0 || !/[a-z0-9]/i.test(haystack[idx - 1])
    const afterPos = idx + needle.length
    const afterOk = afterPos === haystack.length || !/[a-z0-9]/i.test(haystack[afterPos])
    if (beforeOk && afterOk) return true
    pos = idx + 1
  }
}

export function inferProvider(model: string, fallback?: string): string {
  const lower = model.toLowerCase()

  if (lower.includes("claude") || lower.includes("anthropic") || containsDelimited(lower, "opus") || containsDelimited(lower, "sonnet") || containsDelimited(lower, "haiku")) {
    return "anthropic"
  }
  if (lower.includes("gpt") || lower.includes("openai") || containsDelimited(lower, "o1") || containsDelimited(lower, "o3") || containsDelimited(lower, "o4")) {
    return "openai"
  }
  if (lower.includes("gemini") || lower.includes("google")) return "google"
  if (lower.includes("grok")) return "xai"
  if (lower.includes("deepseek")) return "deepseek"
  if (lower.includes("mistral") || lower.includes("mixtral")) return "mistral"
  if (lower.includes("llama") || containsDelimited(lower, "meta")) return "meta"
  if (lower.includes("qwen")) return "qwen"

  return fallback ?? "unknown"
}

export function canonicalProvider(raw: string): string | null {
  const normalized = raw.trim().replace(/\/$/, "").toLowerCase().replace(/-/g, "_")
  switch (normalized) {
    case "": case "unknown": return null
    case "x_ai": case "xai": return "xai"
    case "moonshot": case "moonshotai": return "moonshotai"
    case "meta": case "meta_llama": return "meta_llama"
    case "azure": case "azure_ai": return "azure_ai"
    case "anthropic": case "vertex": case "vertex_ai": return "anthropic"
    case "together": case "together_ai": return "together_ai"
    case "fireworks": case "fireworks_ai": return "fireworks_ai"
    case "google": case "gemini": return "google"
    case "openai": case "openai_codex": return "openai"
    case "mistral": case "mistralai": return "mistralai"
    default: return normalized
  }
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

export function timestampToLocalHour(ms: number): string {
  const d = new Date(ms)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  const hour = String(d.getHours()).padStart(2, "0")
  return `${year}-${month}-${day} ${hour}`
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

export function normalizeWorkspaceKey(raw: string): string | null {
  if (!raw || !raw.trim()) return null
  let key = raw.replace(/\\/g, "/")
  const hasUncPrefix = key.startsWith("//")
  key = key.replace(/\/\//g, "/")
  if (hasUncPrefix) key = "/" + key
  key = key.replace(/\/+$/, "")
  return key || null
}

export function workspaceLabelFromKey(key: string | null): string | null {
  if (!key) return null
  const parts = key.split("/").filter(Boolean)
  return parts[parts.length - 1] || null
}

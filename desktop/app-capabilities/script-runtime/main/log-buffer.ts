import { SCRIPT_LOG_MAX_BYTES } from "../shared/json"
import type { ScriptRunLog } from "./types"

const TRUNCATION_MARKER = "[log output truncated]"
const TRUNCATION_MARKER_BYTES = Buffer.byteLength(TRUNCATION_MARKER, "utf8")

export class ScriptLogBuffer {
  private bytes = 0
  private truncated = false
  private readonly entries: ScriptRunLog[] = []

  append(label: ScriptRunLog["label"], value: string): void {
    if (this.truncated) return
    const remaining = SCRIPT_LOG_MAX_BYTES - this.bytes
    if (remaining <= 0) {
      this.truncate(label, value)
      return
    }
    const encoded = new TextEncoder().encode(value)
    if (encoded.byteLength <= remaining) {
      this.bytes += encoded.byteLength
      this.entries.push({ label, value })
      return
    }
    this.truncate(label, value)
  }

  values(): readonly ScriptRunLog[] {
    return Object.freeze(this.entries.map((entry) => Object.freeze({ ...entry })))
  }

  private truncate(label: ScriptRunLog["label"], value: string): void {
    if (this.truncated) return
    this.truncated = true
    const contentBudget = SCRIPT_LOG_MAX_BYTES - TRUNCATION_MARKER_BYTES
    this.trimEntriesToBudget(contentBudget)
    const remaining = contentBudget - this.bytes
    const prefix = utf8Prefix(value, remaining)
    if (prefix) {
      this.entries.push({ label, value: prefix })
      this.bytes += Buffer.byteLength(prefix, "utf8")
    }
    this.entries.push({ label, value: TRUNCATION_MARKER })
    this.bytes += TRUNCATION_MARKER_BYTES
  }

  private trimEntriesToBudget(maxBytes: number): void {
    if (this.bytes <= maxBytes) return
    let retainedBytes = 0
    const retained: ScriptRunLog[] = []
    for (const entry of this.entries) {
      const remaining = maxBytes - retainedBytes
      if (remaining <= 0) break
      const entryBytes = Buffer.byteLength(entry.value, "utf8")
      if (entryBytes <= remaining) {
        retained.push(entry)
        retainedBytes += entryBytes
        continue
      }
      const prefix = utf8Prefix(entry.value, remaining)
      if (prefix) {
        retained.push({ ...entry, value: prefix })
        retainedBytes += Buffer.byteLength(prefix, "utf8")
      }
      break
    }
    this.entries.splice(0, this.entries.length, ...retained)
    this.bytes = retainedBytes
  }
}

function utf8Prefix(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return ""
  const encoded = new TextEncoder().encode(value)
  if (encoded.byteLength <= maxBytes) return value
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let end = maxBytes
  while (end > 0) {
    try {
      return decoder.decode(encoded.subarray(0, end))
    } catch {
      end -= 1
    }
  }
  return ""
}

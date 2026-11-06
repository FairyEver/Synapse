import type { AutomationTriggerVariableDescriptor } from "./types.shared"

export const TEMPLATE_VARIABLE_RE = /\{\{\s*\$?([\p{L}\p{N}_.-]+(?:#\/[^{}]*?)?)\s*\}\}/gu

export function readVariablePath(root: unknown, suffix: string): { found: boolean; value?: unknown } {
  if (!suffix) return { found: true, value: root }
  if (suffix.length > 2048) throw new Error("字段路径超过 2048 字符上限")
  let segments: string[]
  if (suffix.startsWith("#/")) {
    if (/[{}]/u.test(suffix)) throw new Error("字段名中的花括号请使用 %7B 或 %7D 编码")
    let pointer: string
    try { pointer = decodeURIComponent(suffix.slice(2)) } catch { throw new Error("JSON Pointer 路径编码无效") }
    if (/~(?![01])/u.test(pointer)) throw new Error("JSON Pointer 路径转义无效，请使用 ~0 或 ~1")
    segments = pointer.split("/").map(key => key.replace(/~1/gu, "/").replace(/~0/gu, "~"))
  } else if (/^\.[\p{L}\p{N}_-]+(?:\.[\p{L}\p{N}_-]+)*$/u.test(suffix)) {
    segments = suffix.slice(1).split(".")
  } else throw new Error("字段路径格式无效，请使用 order.id 或 #/order.id")
  if (segments.length > 64) throw new Error("字段路径超过 64 层上限")
  let value = root
  for (const segment of segments) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, segment)) return { found: false }
    value = (value as Record<string, unknown>)[segment]
  }
  return { found: true, value }
}

export function variableMatches(variable: AutomationTriggerVariableDescriptor, key: string): boolean {
  return [variable.key, ...variable.aliases ?? []].some(prefix => {
    if (prefix === key) return true
    if (!variable.dynamic || (!key.startsWith(`${prefix}.`) && !key.startsWith(`${prefix}#/`))) return false
    readVariablePath({}, key.slice(prefix.length))
    return true
  })
}

export function validateAutomationPrompt(prompt: unknown, variables: readonly AutomationTriggerVariableDescriptor[] | undefined): string | null {
  if (typeof prompt !== "string" || !variables) return null
  if (/\{\{\s*\$?trigger\./u.test(prompt.replace(/\{\{[\s\S]*?\}\}/gu, ""))) return "变量模板未闭合，请使用 {{trigger.变量名}}"
  for (const match of prompt.matchAll(/\{\{([\s\S]*?)\}\}/gu)) {
    const key = match[1]!.trim().replace(/^\$/u, "")
    if (!key.startsWith("trigger.") && !/^[\p{L}\p{N}_.-]+$/u.test(key)) continue
    try {
      if (variables.some(variable => variableMatches(variable, key))) continue
    } catch (error) { return error instanceof Error ? error.message : "字段路径无效" }
    return key === "trigger.payload.messageId"
      ? "信件 ID 变量已移除，请改用 {{trigger.payload.id}}"
      : `未知变量：${key}，请从当前触发器的变量列表重新选择`
  }
  return null
}

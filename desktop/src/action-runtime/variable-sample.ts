import { readVariablePath } from "../../automation-trigger-packages/variable-contract"

export function variablePathSuffix(path: string): string {
  const normalized = path.trim().replace(/^\.+/u, "")
  return normalized ? normalized.startsWith("#/") ? normalized : `.${normalized}` : ""
}

export function previewVariableSample(sample: string, suffix: string): { text?: string; error?: string } | null {
  if (!sample.trim()) return null
  let value: unknown
  try { value = JSON.parse(sample) } catch { return { error: "JSON 格式无效" } }
  try {
    const result = readVariablePath(value, suffix)
    if (!result.found) return { error: "字段不存在，请检查测试数据或字段路径" }
    return { text: result.value === null ? "空值（null，执行时替换为空文本）" : result.value === "" ? "空文本" : typeof result.value === "string" ? result.value : JSON.stringify(result.value) }
  } catch (error) { return { error: error instanceof Error ? error.message : "字段路径无效" } }
}

export const userHandleMaxLength = 64
export const reservedUserHandles = ["api", "console", "files", "share", "sites", "webhooks"] as const

const namePattern = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/u
const nameBoundaryPattern = /^[a-z0-9].*[a-z0-9]$|^[a-z0-9]$/u
const windowsReservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/iu
const reservedUserHandleSet = new Set<string>(reservedUserHandles)

export function normalizeUserHandle(value: string): string {
  const normalized = normalizeDashedIdentifier(value, "用户名", userHandleMaxLength)
  if (reservedUserHandleSet.has(normalized)) throw new Error("用户名不能使用保留路由名称。")
  return normalized
}

function normalizeDashedIdentifier(value: string, label: string, maxLength: number): string {
  const normalized = value.trim().toLowerCase()
  if (!normalized) throw new Error(`${label}不能为空。`)
  if (normalized.length > maxLength) throw new Error(`${label}不能超过 ${maxLength} 个字符。`)
  if (normalized.includes(".")) throw new Error(`${label}不能包含点。`)
  if (!nameBoundaryPattern.test(normalized)) throw new Error(`${label}必须以字母或数字开头和结尾。`)
  if (!namePattern.test(normalized)) throw new Error(`${label}必须以字母或数字开头和结尾，只能包含小写字母、数字和连字符。`)
  if (windowsReservedNames.test(normalized)) throw new Error(`${label}不能使用 Windows 保留名称。`)
  return normalized
}

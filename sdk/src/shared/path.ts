import { StateSyncError } from "./errors"

export const STATE_SYNC_PATH_SEGMENT_REGEX = /^[a-zA-Z0-9._:-]{1,64}$/
export const STATE_SYNC_CANONICAL_INDEX_REGEX = /^(0|[1-9]\d*)$/
export const STATE_SYNC_MAX_PATH_DEPTH = 16
export const STATE_SYNC_MAX_VALUE_DEPTH = 32

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"])

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.prototype.toString.call(value) === "[object Object]"
  )
}

export function cloneJsonValue<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== "object") {
    return value
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneJsonValue(item)) as unknown as T
  }
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (FORBIDDEN_KEYS.has(key)) continue
    out[key] = cloneJsonValue((value as Record<string, unknown>)[key])
  }
  return out as T
}

export function parsePath(
  path: string,
): { readonly ok: true; readonly segments: string[]; readonly normalized: string } | { readonly ok: false; readonly message: string } {
  if (typeof path !== "string" || path.length === 0) {
    return { ok: false, message: "路径不能为空。" }
  }
  if (!path.startsWith("/")) {
    return { ok: false, message: "路径必须以 / 开头。" }
  }
  if (path === "/") {
    return { ok: true, segments: [], normalized: "/" }
  }
  if (path.endsWith("/")) {
    return { ok: false, message: "子路径不能以 / 结尾。" }
  }

  const segments = path.slice(1).split("/")
  if (segments.length > STATE_SYNC_MAX_PATH_DEPTH) {
    return { ok: false, message: `路径深度不能超过 ${STATE_SYNC_MAX_PATH_DEPTH} 层。` }
  }

  for (const segment of segments) {
    if (segment.length === 0) {
      return { ok: false, message: "路径中不能包含空段。" }
    }
    if (FORBIDDEN_KEYS.has(segment)) {
      return { ok: false, message: "路径段不能包含 __proto__、constructor 或 prototype。" }
    }
    if (!STATE_SYNC_PATH_SEGMENT_REGEX.test(segment)) {
      return { ok: false, message: `路径段 "${segment}" 包含非法字符或长度超出限制。` }
    }
  }

  return { ok: true, segments, normalized: `/${segments.join("/")}` }
}

export function assertValidPath(path: string): { readonly segments: string[]; readonly normalized: string } {
  const parsed = parsePath(path)
  if (!parsed.ok) {
    throw new StateSyncError("INVALID_PATH", parsed.message)
  }
  return { segments: parsed.segments, normalized: parsed.normalized }
}

export function validateJsonValue(value: unknown, depth = 0): void {
  if (depth > STATE_SYNC_MAX_VALUE_DEPTH) {
    throw new StateSyncError("INVALID_INPUT", `JSON 嵌套深度超过上限 (${STATE_SYNC_MAX_VALUE_DEPTH} 层)。`)
  }
  if (value === undefined) {
    throw new StateSyncError("INVALID_INPUT", "JSON 值中不能包含 undefined。")
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new StateSyncError("INVALID_INPUT", "数字必须为有限数值。")
    }
    return
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      validateJsonValue(item, depth + 1)
    }
    return
  }
  if (!isPlainObject(value)) {
    throw new StateSyncError("INVALID_INPUT", "对象必须为普通 JSON 对象。")
  }
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new StateSyncError("INVALID_INPUT", `禁止使用属性名 "${key}"。`)
    }
    validateJsonValue(value[key], depth + 1)
  }
}

export function isAncestorOrEqualPath(ancestor: string, target: string): boolean {
  if (ancestor === target) return true
  if (ancestor === "/") return target.startsWith("/")
  return target.startsWith(`${ancestor}/`)
}

export function isPathCoveredBySubscriptions(targetPath: string, subscribedPaths: Iterable<string>): boolean {
  for (const subPath of subscribedPaths) {
    if (isAncestorOrEqualPath(subPath, targetPath)) {
      return true
    }
  }
  return false
}

export function readPath(
  root: Record<string, unknown>,
  path: string,
): { readonly exists: boolean; readonly value: unknown } {
  const parsed = parsePath(path)
  if (!parsed.ok) {
    return { exists: false, value: undefined }
  }
  if (parsed.segments.length === 0) {
    return { exists: true, value: cloneJsonValue(root) }
  }

  let current: unknown = root
  for (const segment of parsed.segments) {
    if (current === null || typeof current !== "object") {
      return { exists: false, value: undefined }
    }
    if (Array.isArray(current)) {
      if (!STATE_SYNC_CANONICAL_INDEX_REGEX.test(segment)) {
        return { exists: false, value: undefined }
      }
      const index = Number(segment)
      if (index >= current.length) {
        return { exists: false, value: undefined }
      }
      current = current[index]
    } else {
      if (!Object.prototype.hasOwnProperty.call(current, segment)) {
        return { exists: false, value: undefined }
      }
      current = (current as Record<string, unknown>)[segment]
    }
  }

  return { exists: true, value: cloneJsonValue(current) }
}

export function applyMutationToMirror(
  root: Record<string, unknown>,
  op: "set" | "patch" | "delete",
  path: string,
  value?: unknown,
): Record<string, unknown> {
  const parsed = parsePath(path)
  if (!parsed.ok) return root

  if (parsed.segments.length === 0) {
    if (op === "set" && isPlainObject(value)) {
      return cloneJsonValue(value)
    }
    if (op === "patch" && isPlainObject(value)) {
      const next = cloneJsonValue(root)
      for (const key of Object.keys(value)) {
        if (FORBIDDEN_KEYS.has(key)) continue
        next[key] = cloneJsonValue(value[key])
      }
      return next
    }
    return root
  }

  const nextRoot = cloneJsonValue(root)
  const parentSegments = parsed.segments.slice(0, -1)
  const leaf = parsed.segments[parsed.segments.length - 1]!

  let current: Record<string, unknown> = nextRoot
  for (const segment of parentSegments) {
    const child = current[segment]
    if (!Object.prototype.hasOwnProperty.call(current, segment) || child === undefined) {
      if (op === "delete") return nextRoot
      const created: Record<string, unknown> = {}
      current[segment] = created
      current = created
    } else if (isPlainObject(child)) {
      current = child
    } else {
      if (op === "delete") return nextRoot
      const created: Record<string, unknown> = {}
      current[segment] = created
      current = created
    }
  }

  if (op === "set") {
    current[leaf] = cloneJsonValue(value)
  } else if (op === "patch" && isPlainObject(value)) {
    const existing = current[leaf]
    const target = isPlainObject(existing) ? existing : {}
    current[leaf] = target
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(key)) continue
      target[key] = cloneJsonValue(value[key])
    }
  } else if (op === "delete") {
    if (Object.prototype.hasOwnProperty.call(current, leaf)) {
      delete current[leaf]
    }
  }

  return nextRoot
}

export function applySnapshotToMirror(
  root: Record<string, unknown>,
  path: string,
  exists: boolean,
  value: unknown,
): Record<string, unknown> {
  const parsed = parsePath(path)
  if (!parsed.ok) return root

  if (parsed.segments.length === 0) {
    return exists && isPlainObject(value) ? cloneJsonValue(value) : {}
  }

  if (!exists) {
    return applyMutationToMirror(root, "delete", parsed.normalized)
  }
  return applyMutationToMirror(root, "set", parsed.normalized, value)
}

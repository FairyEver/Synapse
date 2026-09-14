import { createHash, timingSafeEqual } from "node:crypto"

import { TERMINAL_SESSION_REFERENCE_PREFIX } from "../shared/deep-link"

const REFERENCE_PAYLOAD_BYTES = 16
const REFERENCE_CHECKSUM_BYTES = 2
const REFERENCE_PATTERN = new RegExp(`^${TERMINAL_SESSION_REFERENCE_PREFIX}([A-Za-z0-9_-]{22})\\.([A-Za-z0-9_-]{3})$`)

/**
 * 终端会话的短校验引用：`tsr_<payload>.<checksum>`。
 *
 * 深度链接只携带 `payload.checksum` 主体，主进程按实际 session 列表反查唯一目标，因此链接不需要也不
 * 暴露原始 sessionId。引用是带校验和的单向摘要，任何改写都会在解析阶段被拒绝。
 */
export function terminalSessionReference(sessionId: string): string {
  const payload = digestBytes(
    `synapse-terminal-session-reference\0${sessionId}`,
    REFERENCE_PAYLOAD_BYTES,
  )
  return `${TERMINAL_SESSION_REFERENCE_PREFIX}${payload}.${referenceChecksum(payload)}`
}

export function isValidTerminalSessionReference(value: string): boolean {
  const match = REFERENCE_PATTERN.exec(value)
  if (!match) return false
  const actual = Buffer.from(match[2] as string, "base64url")
  const expected = Buffer.from(referenceChecksum(match[1] as string), "base64url")
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function looksLikeTerminalSessionReference(value: string): boolean {
  return value.startsWith(TERMINAL_SESSION_REFERENCE_PREFIX)
}

export function resolveTerminalSessionReference<T extends { readonly id: string }>(
  sessions: readonly T[],
  locator: string,
): T | null {
  if (!isValidTerminalSessionReference(locator)) return null
  const matching = sessions.filter((session) => terminalSessionReference(session.id) === locator)
  return matching.length === 1 ? matching[0] as T : null
}

function referenceChecksum(payload: string): string {
  return digestBytes(`synapse-terminal-session-reference-checksum\0${payload}`, REFERENCE_CHECKSUM_BYTES)
}

function digestBytes(value: string, length: number): string {
  return createHash("sha256").update(value, "utf8").digest().subarray(0, length).toString("base64url")
}

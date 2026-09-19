import { createHash } from "node:crypto"

import { TERMINAL_SESSION_REFERENCE_PREFIX } from "../shared/session-reference"

const REFERENCE_PAYLOAD_BYTES = 16
const REFERENCE_CHECKSUM_BYTES = 2

/**
 * 终端会话的短校验引用：`tsr_<payload>.<checksum>`。
 *
 * 引用是 sessionId 的带校验和单向摘要，不暴露原始 sessionId，供渲染层展示与复制。它不承担反查：
 * 会话不跨重启（ADR 0215），任何写下来的引用在下一次启动时都已失效，定位一律使用不可变 `sessionId`。
 */
export function terminalSessionReference(sessionId: string): string {
  const payload = digestBytes(
    `synapse-terminal-session-reference\0${sessionId}`,
    REFERENCE_PAYLOAD_BYTES,
  )
  return `${TERMINAL_SESSION_REFERENCE_PREFIX}${payload}.${referenceChecksum(payload)}`
}

function referenceChecksum(payload: string): string {
  return digestBytes(`synapse-terminal-session-reference-checksum\0${payload}`, REFERENCE_CHECKSUM_BYTES)
}

function digestBytes(value: string, length: number): string {
  return createHash("sha256").update(value, "utf8").digest().subarray(0, length).toString("base64url")
}

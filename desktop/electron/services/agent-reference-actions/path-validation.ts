import path from "node:path"
import { fileURLToPath } from "node:url"

import { AGENT_REFERENCE_MAX_CODE_POINTS } from "../../../src/types/agent-reference-action"
import { parseLocalReferenceInput } from "../agent-runtime/references"
import { AgentReferenceActionFailure } from "./failure"

export type ResolvedAgentReference = {
  readonly surfacePath: string
  readonly uncBoundary?: string
  readonly pathApi: typeof path.posix
}

export function resolveAgentReference(
  reference: string,
  projectRoot: string,
  platform: NodeJS.Platform,
): ResolvedAgentReference {
  if ([...reference].length > AGENT_REFERENCE_MAX_CODE_POINTS) {
    throw new AgentReferenceActionFailure("invalid_reference", "input_length")
  }
  const parsed = parseLocalReferenceInput(reference)
  if (!parsed) throw new AgentReferenceActionFailure("invalid_reference", "parse")

  const pathApi = platform === "win32" ? path.win32 : path.posix
  let candidate = parsed.path
  if (candidate.startsWith("file://")) {
    try {
      candidate = fileURLToPath(candidate)
    } catch {
      throw new AgentReferenceActionFailure("invalid_reference", "file_url")
    }
  }
  if (isForeignPlatformAbsolute(candidate, platform)) {
    throw new AgentReferenceActionFailure("foreign_platform_path", "platform")
  }
  if (platform === "win32" && (isWindowsDevicePath(candidate) || hasWindowsAlternateDataStream(candidate))) {
    throw new AgentReferenceActionFailure("invalid_reference", "windows_path")
  }

  const surfacePath = pathApi.isAbsolute(candidate)
    ? pathApi.normalize(candidate)
    : pathApi.resolve(projectRoot, candidate)
  const uncBoundary = platform === "win32" ? standardUncBoundary(surfacePath) : undefined
  return { surfacePath, uncBoundary, pathApi }
}

function isForeignPlatformAbsolute(value: string, platform: NodeJS.Platform): boolean {
  const windowsDrive = /^[A-Za-z]:[\\/]/
  const windowsUnc = /^\\\\[^\\/]+[\\/][^\\/]+/
  if (platform === "win32") {
    return value.startsWith("/") && !value.startsWith("//")
  }
  return windowsDrive.test(value) || windowsUnc.test(value)
}

function isWindowsDevicePath(value: string): boolean {
  return /^(?:\\\\[?.]\\|\\\?\?\\)/.test(value)
}

function hasWindowsAlternateDataStream(value: string): boolean {
  const withoutDrive = /^[A-Za-z]:/.test(value) ? value.slice(2) : value
  return withoutDrive.includes(":")
}

function standardUncBoundary(value: string): string | undefined {
  const match = /^(\\\\[^\\/]+[\\/][^\\/]+)(?:[\\/]|$)/.exec(value)
  return match?.[1]
}

import { formatBytes } from "@synapse/shared"

export function formatDriveBytes(value: string | number | null | undefined): string {
  return formatBytes(value, { invalidFallback: "0 B" })
}

export function driveErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || !error.message) return fallback
  return readableDriveErrorMessage(error.message) || fallback
}

export function readableDriveErrorMessage(message: string): string {
  return message
    .replace(/^Error invoking remote method '[^']+':\s*/, "")
    .replace(/^Error:\s*/, "")
    .trim()
}

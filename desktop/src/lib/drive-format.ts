const DRIVE_BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const
const DRIVE_BYTE_NUMBER_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })

export function formatDriveBytes(value: string | number | null | undefined): string {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B"

  let nextValue = bytes
  let unitIndex = 0
  while (nextValue >= 1024 && unitIndex < DRIVE_BYTE_UNITS.length - 1) {
    nextValue /= 1024
    unitIndex += 1
  }

  const formattedValue = unitIndex === 0
    ? String(Math.round(nextValue))
    : DRIVE_BYTE_NUMBER_FORMAT.format(nextValue)
  return `${formattedValue} ${DRIVE_BYTE_UNITS[unitIndex]}`
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

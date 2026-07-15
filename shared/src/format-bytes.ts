const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const
const BYTE_NUMBER_FORMAT = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })

export interface FormatBytesOptions {
  readonly invalidFallback?: string
}

export function formatBytes(
  value: string | number | null | undefined,
  options: FormatBytesOptions = {},
): string {
  const bytes = Number(value)
  if (value === null || value === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return options.invalidFallback ?? "-"
  }

  let nextValue = bytes
  let unitIndex = 0
  while (nextValue >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    nextValue /= 1024
    unitIndex += 1
  }

  const formattedValue = unitIndex === 0
    ? String(Math.round(nextValue))
    : BYTE_NUMBER_FORMAT.format(nextValue)
  return `${formattedValue} ${BYTE_UNITS[unitIndex]}`
}

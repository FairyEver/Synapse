/**
 * Phase 0.2 — ExporterRegistry skeleton.
 * SPEC §15.11.
 *
 * Default exporters:
 *   - "json" / "*" → JSON.stringify of the items array.
 *   - "csv" / "*" → very small CSV serializer; columns inferred from first row.
 *
 * Markdown / sqlite exporters are intentionally NOT implemented in Phase 0;
 * they have no in-tree consumer yet. Future PRs register them on demand.
 */

import {
  BackupFormatError,
} from "./errors"
import type {
  ExporterFormat,
  ExporterRegistry,
  NamespaceExporter,
} from "./types"

export class InMemoryExporterRegistry implements ExporterRegistry {
  private readonly exporters = new Map<string, NamespaceExporter[]>()

  register<T>(exporter: NamespaceExporter<T>): void {
    const list = this.exporters.get(exporter.namespace) ?? []
    if (list.find((e) => e.format === exporter.format)) {
      throw new Error(
        `Exporter for ${exporter.namespace}/${exporter.format} already registered`,
      )
    }
    list.push(exporter as NamespaceExporter)
    this.exporters.set(exporter.namespace, list)
  }

  list(): readonly NamespaceExporter[] {
    const all: NamespaceExporter[] = []
    for (const list of this.exporters.values()) all.push(...list)
    return all
  }

  async exportAs(
    namespace: string,
    format: ExporterFormat,
    items: readonly unknown[],
  ): Promise<Uint8Array | string> {
    const list = this.exporters.get(namespace)
    const exporter = list?.find((e) => e.format === format)
    if (!exporter) {
      throw new BackupFormatError(`no exporter registered for ${namespace}/${format}`)
    }
    return exporter.export(items)
  }
}

/** Default JSON exporter — works for any namespace. */
export function jsonExporterFor<T>(namespace: string): NamespaceExporter<T> {
  return {
    namespace,
    format: "json",
    async export(items) {
      return JSON.stringify(items, null, 2)
    },
  }
}

/**
 * Default CSV exporter — works for any namespace whose items are flat record
 * objects with stringifiable scalar fields. Nested objects are JSON-stringified
 * inside their cell. Headers come from the union of keys in `items`.
 */
export function csvExporterFor<T extends Record<string, unknown>>(
  namespace: string,
): NamespaceExporter<T> {
  return {
    namespace,
    format: "csv",
    async export(items) {
      if (items.length === 0) return ""
      const headerSet = new Set<string>()
      for (const item of items) {
        for (const key of Object.keys(item)) headerSet.add(key)
      }
      const headers = [...headerSet]
      const rows: string[] = [headers.map(csvEscape).join(",")]
      for (const item of items) {
        const cells = headers.map((h) => csvCell(item[h]))
        rows.push(cells.join(","))
      }
      return rows.join("\n") + "\n"
    },
  }
}

function csvEscape(value: string): string {
  const needsQuoting = /[",\n\r]/.test(value)
  if (!needsQuoting) return value
  return `"${value.replace(/"/g, '""')}"`
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "string") return csvEscape(value)
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  // Objects / arrays: JSON-stringify, then CSV-escape.
  return csvEscape(JSON.stringify(value))
}

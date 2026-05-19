/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ExportButton } from "../export-button"
import type { AgentRow, ModelRow } from "../../hooks/use-token-usage"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

describe("ExportButton", () => {
  it("exports reasoning token breakdowns for model and agent rows", async () => {
    let exportedBlob: Blob | undefined
    vi.spyOn(URL, "createObjectURL").mockImplementation((object) => {
      if (object instanceof Blob) {
        exportedBlob = object
      }
      return "blob:token-usage-export"
    })
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined)

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <ExportButton
          models={[modelRow({ reasoning: 7 })]}
          agents={[agentRow({ reasoning: 11 })]}
          dailyRows={[]}
          graphResult={null}
          isFiltering
        />,
      )
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>("button")?.click()
    })

    expect(exportedBlob).toBeDefined()
    if (!exportedBlob) throw new Error("export blob was not created")
    const data = JSON.parse(await readBlobText(exportedBlob)) as {
      models: Array<{ tokens: { reasoning?: number; total: number } }>
      agents: Array<{ tokens: { reasoning?: number; total: number } }>
    }
    expect(data.models[0]?.tokens).toMatchObject({ reasoning: 7, total: 27 })
    expect(data.agents[0]?.tokens).toMatchObject({ reasoning: 11, total: 41 })
  })
})

function modelRow(overrides: Partial<ModelRow> = {}): ModelRow {
  return {
    client: "codex",
    model: "gpt-test",
    provider: "openai",
    input: 10,
    output: 5,
    cacheRead: 3,
    cacheWrite: 2,
    reasoning: 0,
    messageCount: 4,
    cost: 0.5,
    ...overrides,
  }
}

function agentRow(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    client: "codex",
    models: ["gpt-test"],
    providers: ["openai"],
    input: 13,
    output: 9,
    cacheRead: 4,
    cacheWrite: 4,
    reasoning: 0,
    messageCount: 8,
    cost: 0.8,
    activeDays: 2,
    firstSeen: "2026-05-18",
    lastSeen: "2026-05-19",
    ...overrides,
  }
}

function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(blob)
  })
}

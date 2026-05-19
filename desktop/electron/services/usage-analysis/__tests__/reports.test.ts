import { afterEach, describe, expect, it } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { closeUsageAnalysisDbForTests, getUsageAnalysisDb } from "../db"
import { CcUsageAnalysisService } from "../cc-service"

const tempDirs: string[] = []

afterEach(() => {
  closeUsageAnalysisDbForTests()
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("usage analysis reports", () => {
  it("stores parsed CC events and returns overview totals", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "usage-analysis-reports-"))
    tempDirs.push(dir)
    const projectDir = path.join(dir, ".claude", "projects", "-tmp-project")
    fs.mkdirSync(projectDir, { recursive: true })
    fs.writeFileSync(path.join(projectDir, "session.jsonl"), JSON.stringify({
      type: "assistant",
      timestamp: "2026-05-19T01:00:01.000Z",
      message: {
        role: "assistant",
        model: "claude-opus-4.6",
        usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40 },
        content: [{ type: "tool_use", name: "Bash", id: "tool-1" }],
      },
    }))

    const db = getUsageAnalysisDb(dir)
    const service = new CcUsageAnalysisService({ db, roots: [path.join(dir, ".claude", "projects")] })
    const refresh = await service.refresh()
    expect(refresh.parsedFiles).toBe(1)

    const overview = service.getOverview({ preset: "all" })
    expect(overview.totals.tokens).toBe(190)
    expect(overview.totals.requests).toBe(1)
    expect(overview.totals.toolCalls).toBe(1)
    expect(overview.topModels[0].model).toBe("claude-opus-4.6")
    expect(overview.trend[0].modelBreakdown).toEqual([{
      model: "claude-opus-4.6",
      tokens: 190,
      input: 100,
      output: 20,
      cacheRead: 30,
      cacheWrite: 40,
      reasoning: 0,
    }])
  })
})

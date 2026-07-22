import { readFile } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { NodeExecutionInput, NodeRuntimeDeps } from "../../../../workflow-nodes/types"
import type { FileOpenerService } from "../../main/service"
import { fileOpenerNodeExecutor } from "../executor.main"
import type { FileOpenerNodeConfig } from "../schema"

describe("fileOpenerNodeExecutor", () => {
  it("executes the open-file-workflow 2.3.0 fixture through FileOpenerService", async () => {
    const fixturePath = path.resolve(
      __dirname,
      "../../../../electron/services/workflow/__fixtures__/workflow-schema/2.3.0.json",
    )
    const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as {
      id: string
      nodes: Array<{ type: string; config: FileOpenerNodeConfig }>
    }
    const node = fixture.nodes.find((candidate) => candidate.type === "file_opener_file_open")
    expect(fixture.id).toBe("open-file-workflow")
    expect(node).toBeDefined()

    const open = vi.fn(async ({ path: filePath }: { path: string }) => ({ path: filePath }))
    const result = await fileOpenerNodeExecutor.execute({
      config: node!.config,
      resolvedVariables: { report_path: "/tmp/report.html" },
      context: {
        runId: "run-1",
        workflowId: fixture.id,
        nodeId: "open-file",
        abortSignal: new AbortController().signal,
      },
      agentDeps: {} as NodeExecutionInput<FileOpenerNodeConfig>["agentDeps"],
      runtimeDeps: {
        resolveService: () => ({ open } as unknown as FileOpenerService),
      } as NodeRuntimeDeps,
    })

    expect(open).toHaveBeenCalledWith(
      { path: "/tmp/report.html" },
      expect.objectContaining({ source: "workflow" }),
    )
    expect(result).toMatchObject({
      status: "success",
      output: "/tmp/report.html",
      outputs: { path: "/tmp/report.html" },
    })
  })
})

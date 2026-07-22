import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { NodeExecutionInput } from "../../../../workflow-nodes/types"
import { TextFileWriteError } from "../../shared/errors"
import { textFileWriterNodeExecutor } from "../executor.main"
import type { TextFileWriterNodeConfig } from "../schema"

const outputPattern = path.resolve("tmp", "{{name}}.md")
const outputPath = path.resolve("tmp", "Ada.md")

describe("textFileWriterNodeExecutor", () => {
  it("interpolates explicit variables and returns the canonical path plus structured output", async () => {
    const result = {
      path: outputPath,
      fileName: "Ada.md",
      format: "md" as const,
      encoding: "utf8" as const,
      size: 9,
      overwritten: false,
    }
    const write = vi.fn(async () => result)
    const input = createInput({
      path: outputPattern,
      text: "Hello {{name}}",
      encoding: "utf8",
      overwrite: false,
      variables: [],
    }, write)

    await expect(textFileWriterNodeExecutor.execute(input)).resolves.toMatchObject({
      status: "success",
      output: outputPath,
      outputs: result,
    })
    expect(write).toHaveBeenCalledWith({
      path: outputPath,
      text: "Hello Ada",
      encoding: "utf8",
      overwrite: false,
    }, expect.objectContaining({
      source: "workflow",
      abortSignal: input.context.abortSignal,
    }))
  })

  it("returns stable retryable errors and maps cancellation", async () => {
    const changed = await textFileWriterNodeExecutor.execute(createInput(defaultConfig(), vi.fn(async () => {
      throw new TextFileWriteError("TARGET_CHANGED")
    })))
    expect(changed).toMatchObject({
      status: "failed",
      output: "",
      outputs: {
        code: "TARGET_CHANGED",
        message: "目标文件已发生变化，请重试。",
        retryable: true,
      },
    })

    const aborted = await textFileWriterNodeExecutor.execute(createInput(defaultConfig(), vi.fn(async () => {
      throw new TextFileWriteError("ABORTED")
    })))
    expect(aborted).toMatchObject({ status: "cancelled", outputs: { code: "ABORTED", retryable: false } })
  })
})

function defaultConfig(): TextFileWriterNodeConfig {
  return { path: outputPattern, text: "Hello", encoding: "utf8", overwrite: false, variables: [] }
}

function createInput(
  config: TextFileWriterNodeConfig,
  write: ReturnType<typeof vi.fn>,
): NodeExecutionInput<TextFileWriterNodeConfig> {
  return {
    config,
    resolvedVariables: { name: "Ada" },
    context: {
      workflowId: "workflow-1",
      runId: "run-1",
      nodeId: "node-1",
      abortSignal: new AbortController().signal,
    },
    agentDeps: { sendToAgent: vi.fn() },
    runtimeDeps: {
      resolveService: () => ({ write }),
    } as never,
  }
}

import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import type { NodeExecutionInput } from "../../../../workflow-nodes/types"
import { htmlGeneratorEjsFileNodeExecutor, htmlGeneratorEjsNodeExecutor } from "../executor.main"
import type { HtmlGeneratorEjsFileNodeConfig, HtmlGeneratorEjsNodeConfig } from "../schema"

describe("HTML Generator workflow executors", () => {
  it("strictly parses upstream JSON and passes EJS template text without Workflow interpolation", async () => {
    const generate = vi.fn(async () => ({ html: "<div>{{ clientSideValue }}</div>", size: 32 }))
    const input = baseInput<HtmlGeneratorEjsNodeConfig>({
      template: "<div>{{ clientSideValue }}</div><%= data.title %>",
      variables: [{ name: "data", source: { type: "node_output", node: "source" } }],
    }, { data: "{\"title\":\"Report\"}" }, () => ({ generate }))

    await expect(htmlGeneratorEjsNodeExecutor.execute(input)).resolves.toMatchObject({
      status: "success",
      output: "<div>{{ clientSideValue }}</div>",
      outputs: { size: 32 },
    })
    expect(generate).toHaveBeenCalledWith({
      template: "<div>{{ clientSideValue }}</div><%= data.title %>",
      data: { title: "Report" },
    }, expect.objectContaining({ source: "workflow" }))
  })

  it.each(["", "null", "[]", "42", "```json\n{}\n```", "{} extra"])(
    "rejects non-object pure JSON data %j before rendering",
    async (data) => {
      const generate = vi.fn()
      const input = baseInput<HtmlGeneratorEjsNodeConfig>({
        template: "ok",
        variables: [{ name: "data", source: { type: "node_output", node: "source" } }],
      }, { data }, () => ({ generate }))
      await expect(htmlGeneratorEjsNodeExecutor.execute(input)).resolves.toMatchObject({
        status: "failed",
        outputs: { code: "INVALID_DATA" },
      })
      expect(generate).not.toHaveBeenCalled()
    },
  )

  it("excludes data from outputPath interpolation and returns Writer metadata", async () => {
    const outputPath = path.resolve("reports", "Ada.html")
    const generateToFile = vi.fn(async () => ({
      output: {
        path: outputPath,
        fileName: "Ada.html",
        format: "html" as const,
        encoding: "utf8" as const,
        size: 10,
        overwritten: false,
      },
    }))
    const input = baseInput<HtmlGeneratorEjsFileNodeConfig>({
      template: "<%= data.title %>",
      outputPath: path.resolve("reports", "{{name}}.html"),
      overwrite: false,
      variables: [
        { name: "data", source: { type: "node_output", node: "source" } },
        { name: "name", source: { type: "static", value: "Ada" } },
      ],
    }, { data: "{\"title\":\"Report\"}", name: "Ada" }, () => ({ generateToFile }))

    await expect(htmlGeneratorEjsFileNodeExecutor.execute(input)).resolves.toMatchObject({
      status: "success",
      output: outputPath,
      outputs: { path: outputPath, format: "html", encoding: "utf8" },
    })
    expect(generateToFile).toHaveBeenCalledWith(expect.objectContaining({
      data: { title: "Report" },
      outputPath,
    }), expect.any(Object))
  })

  it("fails when outputPath tries to interpolate the reserved data binding", async () => {
    const generateToFile = vi.fn()
    const input = baseInput<HtmlGeneratorEjsFileNodeConfig>({
      template: "ok",
      outputPath: path.resolve("{{data}}.html"),
      overwrite: false,
      variables: [{ name: "data", source: { type: "node_output", node: "source" } }],
    }, { data: "{}" }, () => ({ generateToFile }))

    await expect(htmlGeneratorEjsFileNodeExecutor.execute(input)).resolves.toMatchObject({ status: "failed" })
    expect(generateToFile).not.toHaveBeenCalled()
  })
})

function baseInput<T>(
  config: T,
  resolvedVariables: Record<string, string>,
  resolveService: (serviceId: string) => unknown,
): NodeExecutionInput<T> {
  return {
    config,
    resolvedVariables,
    context: {
      workflowId: "workflow-1",
      runId: "run-1",
      nodeId: "node-1",
      abortSignal: new AbortController().signal,
    },
    agentDeps: { sendToAgent: vi.fn() },
    runtimeDeps: { resolveService } as never,
  }
}

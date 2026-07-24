import { describe, expect, it, vi } from "vitest"
import type { AuditSink } from "../../../../electron/runtime/security"
import { utf8ByteLength, validateJsonRepairInput } from "../../shared/schema"
import { JsonRepairService, unwrapSingleJsonFence } from "../service"

const context = {
  source: "test",
  actor: { kind: "user" as const, id: "test-user" },
}

function validated(text: string) {
  const result = validateJsonRepairInput({ text })
  if (!result.ok) throw new Error(result.error.code)
  return result.data
}

describe("JsonRepairService", () => {
  it.each([
    ["123", "123"],
    ["true", "true"],
    ["\"text\"", "\"text\""],
    ["{'key': 'value'}", "{\"key\": \"value\"}"],
    ["{name: 'Ada', active: True}", "{\"name\": \"Ada\", \"active\": true}"],
    ["callback({\"a\":1})", "{\"a\":1}"],
    ["{\"count\": NumberLong(123)}", "{\"count\": 123}"],
    ["{/* note */ foo:1}", "{ \"foo\":1}"],
    ["{foo: \"a\" + \"b\"}", "{\"foo\": \"ab\"}"],
    ["{\"a\":1}\n{\"b\":2}", "[{\"a\":1} ,{\"b\":2}]"],
    ["```json\n{\"a\":1}\n```", "{\"a\":1}"],
  ])("locks the upstream compatibility corpus", (input, expected) => {
    const result = new JsonRepairService().repair(validated(input), context)
    expect(result).toEqual({ json: expected })
    expect(() => JSON.parse(result.json)).not.toThrow()
  })

  it("keeps the repaired JSON text authoritative without re-serializing it", () => {
    const text = "{\"big\":9007199254740993,\"spaced\": 1}"
    expect(new JsonRepairService().repair(validated(text), context)).toEqual({ json: text })
  })

  it("prioritizes embedded json fences before permissive whole-text repair", () => {
    const text = [
      "Verification checklist:",
      "- selected titles: [0]",
      "",
      "```json",
      "{\"ok\":true}",
      "```",
    ].join("\n")
    const service = new JsonRepairService({
      upstream: {
        repairJson: (input) => input === text ? "[0]" : input,
        stripLlmWrapper: (input) => input,
        extractAllJson: () => [],
      },
    })

    expect(service.repair(validated(text), context)).toEqual({
      json: "{\"ok\":true}",
    })
  })

  it("keeps valid JSON authoritative when a string contains a json fence", () => {
    const text = JSON.stringify({
      content: "```json\n{\"nested\":true}\n```",
    })

    expect(new JsonRepairService().repair(validated(text), context)).toEqual({
      json: text,
    })
  })

  it("repairs unescaped quoted phrases inside LLM string values", () => {
    const text = [
      "{\"course\":{\"learning_title_structure\":[",
      "{\"pattern\":\"以\"聚焦/掌握/吃透/洞察/抓\"开头\"}",
      "]},\"schemes\":[",
      "{\"style_note\":\"首句用\"吃透\"\"抓实\"强化操作感\"}",
      "]}",
    ].join("")

    const result = new JsonRepairService().repair(validated(text), context)

    expect(JSON.parse(result.json)).toEqual({
      course: {
        learning_title_structure: [
          { pattern: "以\"聚焦/掌握/吃透/洞察/抓\"开头" },
        ],
      },
      schemes: [
        { style_note: "首句用\"吃透\"\"抓实\"强化操作感" },
      ],
    })
  })

  it("preserves all legal object keys", () => {
    const text = "{\"__proto__\":{\"x\":1},\"constructor\":2,\"prototype\":3}"
    expect(new JsonRepairService().repair(validated(text), context)).toEqual({ json: text })
  })

  it("extracts embedded objects or arrays in source order and skips failed candidates", () => {
    const text = "first {\"bad\": NaN} then {\"ok\": true} finally [3]"
    expect(new JsonRepairService().repair(validated(text), context)).toEqual({
      json: "{\"ok\": true}",
    })
  })

  it("does not extract scalar fragments from ordinary prose", () => {
    expect(() => new JsonRepairService().repair(
      validated("there are 12 items and the answer is true"),
      context,
    )).toThrowError(expect.objectContaining({ code: "NO_JSON_FOUND" }))
  })

  it("reports non-finite numbers at the root or in nested values", () => {
    for (const text of ["1e400", "{\"nested\":[1e400]}"]) {
      expect(() => new JsonRepairService().repair(validated(text), context))
        .toThrowError(expect.objectContaining({ code: "NON_FINITE_NUMBER" }))
    }
  })

  it.each([
    {
      name: "non-finite candidates outrank embedded candidates and upstream failures",
      upstream: {
        repairJson: () => "1e400",
        stripLlmWrapper: () => {
          throw new Error("private strip failure")
        },
        extractAllJson: () => ["{candidate:true}"],
      },
      code: "NON_FINITE_NUMBER",
    },
    {
      name: "embedded candidates outrank no-json",
      upstream: {
        repairJson: () => "not json",
        stripLlmWrapper: (input: string) => input,
        extractAllJson: () => ["{candidate:true}"],
      },
      code: "JSON_REPAIR_FAILED",
    },
    {
      name: "upstream failures outrank no-json",
      upstream: {
        repairJson: () => {
          throw new Error("private repair failure")
        },
        stripLlmWrapper: (input: string) => input,
        extractAllJson: () => [],
      },
      code: "JSON_REPAIR_FAILED",
    },
  ])("applies terminal precedence: $name", ({ upstream, code }) => {
    const service = new JsonRepairService({ upstream })
    expect(() => service.repair(validated("source"), context))
      .toThrowError(expect.objectContaining({ code }))
  })

  it("continues after repair and wrapper failures and normalizes exhausted failures", () => {
    const repairAfterThrow = vi.fn((input: string) => {
      if (input === "source") throw new Error("private repair failure")
      return input
    })
    const recoveredFromRepair = new JsonRepairService({
      upstream: {
        repairJson: repairAfterThrow,
        stripLlmWrapper: () => "{\"ok\":true}",
        extractAllJson: () => [],
      },
    })
    expect(recoveredFromRepair.repair(validated("source"), context)).toEqual({
      json: "{\"ok\":true}",
    })

    const recoveredFromWrapper = new JsonRepairService({
      upstream: {
        repairJson: (input) => input === "candidate" ? "{\"ok\":true}" : "not json",
        stripLlmWrapper: () => {
          throw new Error("private wrapper failure")
        },
        extractAllJson: () => ["candidate"],
      },
    })
    expect(recoveredFromWrapper.repair(validated("source"), context)).toEqual({
      json: "{\"ok\":true}",
    })

    const extractionFailure = new JsonRepairService({
      upstream: {
        repairJson: () => "not json",
        stripLlmWrapper: (input) => input,
        extractAllJson: () => {
          throw new Error("private extraction failure")
        },
      },
    })
    expect(() => extractionFailure.repair(validated("source"), context))
      .toThrowError(expect.objectContaining({
        code: "JSON_REPAIR_FAILED",
        message: "无法产出有效的 JSON 文本。",
      }))
  })

  it("allows 128 levels and immediately stops at 129 levels", () => {
    const atLimit = `${"[".repeat(128)}0${"]".repeat(128)}`
    const overLimit = `${"[".repeat(129)}0${"]".repeat(129)}`
    expect(new JsonRepairService().repair(validated(atLimit), context).json).toBe(atLimit)
    expect(() => new JsonRepairService().repair(validated(overLimit), context))
      .toThrowError(expect.objectContaining({ code: "MAX_DEPTH_EXCEEDED" }))
  })

  it("does not continue to later candidates after a resource failure", () => {
    const tooDeep = `${"[".repeat(129)}0${"]".repeat(129)}`
    const text = `first ${tooDeep} then {"ok":true}`
    expect(() => new JsonRepairService().repair(validated(text), context))
      .toThrowError(expect.objectContaining({ code: "MAX_DEPTH_EXCEEDED" }))
  })

  it("handles near-limit strings and damaged input without changing the error contract", () => {
    const longValue = "a".repeat(128 * 1024 - 32)
    const longText = `{"value":"${longValue}"}`
    expect(new JsonRepairService().repair(validated(longText), context).json).toBe(longText)

    const repaired = new JsonRepairService().repair(
      validated(`prefix {"value":"${"x".repeat(100_000)}`),
      context,
    )
    expect(() => JSON.parse(repaired.json)).not.toThrow()
  })

  it("records one minimal audit event for accepted success and failure", () => {
    const record = vi.fn<AuditSink["record"]>()
    const service = new JsonRepairService({ auditSink: { record } })
    const callContext = {
      ...context,
      clientId: "client",
      controllerInstanceId: "controller",
      workflowId: "workflow",
      runId: "run",
      nodeId: "node",
    }

    service.repair(validated("{\"ok\":true}"), callContext)
    expect(() => service.repair(validated("no json here"), callContext)).toThrow()

    expect(record).toHaveBeenCalledTimes(2)
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      action: "json.repair",
      resource: "app.json_repair.text.repair",
      outcome: "allowed",
      metadata: {
        source: "test",
        inputBytes: utf8ByteLength("{\"ok\":true}"),
        outputBytes: utf8ByteLength("{\"ok\":true}"),
        clientId: "client",
        controllerInstanceId: "controller",
        workflowId: "workflow",
        runId: "run",
        nodeId: "node",
      },
    })
    expect(record.mock.calls[1]?.[0]).toMatchObject({
      outcome: "failed",
      metadata: {
        source: "test",
        errorCode: "NO_JSON_FOUND",
      },
    })
    expect(JSON.stringify(record.mock.calls)).not.toContain("no json here")
  })

  it("keeps audit failure outside the result contract", () => {
    const warn = vi.fn()
    const service = new JsonRepairService({
      auditSink: { record: () => { throw new Error("private sink detail") } },
      logger: { warn },
    })
    expect(service.repair(validated("{\"ok\":true}"), context)).toEqual({
      json: "{\"ok\":true}",
    })
    expect(warn).toHaveBeenCalledWith("JSON repair audit record failed.", {
      stage: "audit_record",
      reason: "sink_failure",
    })
  })

  it("does not audit an oversized input rejected before acceptance", () => {
    const record = vi.fn<AuditSink["record"]>()
    const service = new JsonRepairService({ auditSink: { record } })

    expect(() => service.repair({
      text: "x".repeat(128 * 1024 + 1),
      inputBytes: 128 * 1024 + 1,
    }, context)).toThrowError(expect.objectContaining({ code: "INPUT_TOO_LARGE" }))
    expect(record).not.toHaveBeenCalled()
  })
})

describe("unwrapSingleJsonFence", () => {
  it("only unwraps one complete unlabeled or json fenced block", () => {
    expect(unwrapSingleJsonFence(" \n```json\r\n{\"a\":1}\r\n```\n")).toBe("{\"a\":1}")
    expect(unwrapSingleJsonFence("```\n[1]\n```")).toBe("[1]")
    expect(unwrapSingleJsonFence("```javascript\n{}\n```")).toBe("```javascript\n{}\n```")
    expect(unwrapSingleJsonFence("prefix ```json\n{}\n```")).toBe("prefix ```json\n{}\n```")
  })
})

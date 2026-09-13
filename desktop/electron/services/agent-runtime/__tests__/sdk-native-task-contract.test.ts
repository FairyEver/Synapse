import { randomUUID } from "node:crypto"
import { expect, it } from "vitest"
import type { HookInput, PostToolUseHookInput } from "@anthropic-ai/claude-agent-sdk"
import { collectNativeResult, createNativeSdkFixture, toolResult } from "./fixtures/native-sdk-fixture"

it("observes native Task metadata receipts, failures, metadata-free reads and preallocated session identity", async () => {
  let taskId = ""
  const hooks: HookInput[] = []
  const declare = { protocolVersion: 1, operationId: randomUUID(), kind: "declare" }
  const progress = { protocolVersion: 1, operationId: randomUUID(), kind: "progress" }
  const fixture = await createNativeSdkFixture((_request, index) => {
    const steps = [
      { name: "TaskCreate", input: { subject: "Coverage fixture", description: "Verify native metadata", metadata: { synapse: declare } } },
      { name: "TaskUpdate", input: { taskId, status: "in_progress", metadata: { synapse: progress } } },
      { name: "TaskGet", input: { taskId } },
      { name: "TaskList", input: {} },
      { name: "TaskUpdate", input: { taskId, status: "completed", metadata: { synapse: null } } },
      { name: "TaskUpdate", input: { taskId: "missing-fixture-task", status: "completed", metadata: { synapse: progress } } },
    ]
    return steps[index] ? [{ ...steps[index], id: `task_${index}` }] : "Task fixture complete"
  })
  const sessionId = randomUUID()
  const run = fixture.start({ sessionId, tools: ["TaskCreate", "TaskUpdate", "TaskGet", "TaskList"], hooks: {
    UserPromptSubmit: [{ hooks: [async (input) => { hooks.push(input); return {} }] }],
    TaskCompleted: [{ hooks: [async (input) => { hooks.push(input); return {} }] }],
    PostToolUse: [{ hooks: [async (input) => {
      hooks.push(input)
      if (input.hook_event_name === "PostToolUse" && input.tool_name === "TaskCreate") {
        taskId = (input.tool_response as { task: { id: string } }).task.id
      }
      return { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: "host-receipt-confirmed" } }
    }] }],
  } })
  try {
    expect(await collectNativeResult(run)).toMatchObject({ is_error: false, session_id: sessionId })
    const receipts = hooks.filter((input): input is PostToolUseHookInput => input.hook_event_name === "PostToolUse")
    expect(receipts[0]).toMatchObject({ tool_input: { metadata: { synapse: declare } }, tool_response: { task: { id: taskId } } })
    expect(taskId).not.toBe("")
    expect(receipts[1]).toMatchObject({ tool_input: { metadata: { synapse: progress } }, tool_response: {
      success: true, statusChange: { from: "pending", to: "in_progress" }, updatedFields: expect.arrayContaining(["metadata"]),
    } })
    expect(receipts[2]).toMatchObject({ tool_response: { task: { id: taskId, status: "in_progress" } } })
    expect(receipts[2]?.tool_response).not.toHaveProperty("task.metadata")
    expect(receipts[3]?.tool_response).not.toHaveProperty("tasks.0.metadata")
    expect(receipts[4]).toMatchObject({ tool_input: { metadata: { synapse: null } }, tool_response: {
      success: true, statusChange: { from: "in_progress", to: "completed" },
    } })
    expect(receipts[5]).toMatchObject({ tool_response: { success: false } })
    expect(hooks.find((input) => input.hook_event_name === "UserPromptSubmit")).toMatchObject({ session_id: sessionId })
    expect(JSON.stringify(toolResult(fixture.requests[1], "task_0"))).toContain(taskId)
    expect(JSON.stringify(fixture.requests[1]?.messages)).toContain("host-receipt-confirmed")
    expect(JSON.stringify(toolResult(fixture.requests[3], "task_2"))).not.toContain(declare.operationId)
    expect(fixture.requestBytes.every((bytes) => bytes > 0)).toBe(true)
  } finally { await fixture.close() }
}, 30_000)

it("receives structured native output as a schema result without treating its claims as verified evidence", async () => {
  const fixture = await createNativeSdkFixture((request, index) => {
    if (index === 0) {
      const tool = request.tools?.find((entry) => /StructuredOutput/.test(entry.name))
      if (!tool) throw new Error("Native structured output tool unavailable")
      return [{ name: tool.name, id: "structured", input: { conclusion: "Unverified fixture claim" } }]
    }
    return "Structured fixture complete"
  })
  const run = fixture.start({ tools: [], outputFormat: { type: "json_schema", schema: {
    type: "object", properties: { conclusion: { type: "string" } }, required: ["conclusion"], additionalProperties: false,
  } } })
  try {
    expect(await collectNativeResult(run)).toMatchObject({ is_error: false,
      structured_output: { conclusion: "Unverified fixture claim" } })
  } finally { await fixture.close() }
}, 15_000)

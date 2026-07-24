import { describe, expect, it } from "vitest"
import {
  TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID,
  TERMINAL_MCP_TOOL_NAMES,
  TERMINAL_SESSION_DELETE_CAPABILITY_ID,
  TERMINAL_SESSION_RENAME_CAPABILITY_ID,
  TERMINAL_SESSION_RESIZE_CAPABILITY_ID,
} from "../../app-capabilities/terminal/shared/capability"
import {
  SOUND_NOTIFIER_PLAY_CAPABILITY_ID,
  SOUND_NOTIFIER_PLAY_MCP_TOOL_NAME,
} from "../../app-capabilities/sound-notifier/shared/capability"
import {
  SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID,
  SYSTEM_NOTIFIER_TRIGGER_MCP_TOOL_NAME,
} from "../../app-capabilities/system-notifier/shared/capability"
import {
  PROBLEM_FEEDBACK_SUBMIT_CAPABILITY_ID,
  PROBLEM_FEEDBACK_SUBMIT_MCP_TOOL_NAME,
} from "../../app-capabilities/problem-feedback/shared/capability"
import { SECRETS_MCP_TOOL_NAMES } from "../../app-capabilities/secrets/shared/capability"
import { DOCUMENT_TEMPLATE_MCP_TOOL_NAME } from "../../app-capabilities/document-template/shared/capability"
import {
  JSON_REPAIR_CAPABILITY_ID,
  JSON_REPAIR_MCP_TOOL_NAME,
} from "../../app-capabilities/json-repair/shared/capability"
import {
  TEXT_FILE_WRITER_CAPABILITY_ID,
  TEXT_FILE_WRITER_MCP_TOOL_NAME,
} from "../../app-capabilities/text-file-writer/shared/capability"
import { APP_DOMAIN, APP_MCP_TOOL_ACTIONS, buildAppTools } from "./app-domain"
import { assertCanonicalCapabilityId, capabilityIdToMcpTool } from "./naming"
import { MCP_TOOL_ACTIONS, buildAllMcpTools, getActionDomainId } from "./registry"

describe("App capability domain", () => {
  it("allows terminal session write and stop capability ids", () => {
    expect(() => assertCanonicalCapabilityId("app.terminal.session.write")).not.toThrow()
    expect(() => assertCanonicalCapabilityId("app.terminal.session.stop")).not.toThrow()
    expect(() => assertCanonicalCapabilityId("app.terminal.session.rename")).not.toThrow()
    expect(() => assertCanonicalCapabilityId("app.terminal.session.delete")).not.toThrow()
  })

  it("maps the terminal session resize capability to the public resize tool name", () => {
    expect(TERMINAL_SESSION_RESIZE_CAPABILITY_ID).toBe("app.terminal.session.resize")
    expect(() => assertCanonicalCapabilityId(TERMINAL_SESSION_RESIZE_CAPABILITY_ID)).not.toThrow()
    expect(capabilityIdToMcpTool(TERMINAL_SESSION_RESIZE_CAPABILITY_ID)).toBe(
      TERMINAL_MCP_TOOL_NAMES.sessionResize,
    )
  })

  it("lists terminal MCP tools with their public names", () => {
    const names = buildAppTools().map((tool) => tool.name)

    expect(names).toEqual(expect.arrayContaining(Object.values(TERMINAL_MCP_TOOL_NAMES)))
  })

  it("maps the public terminal resize tool to the resize capability", () => {
    expect(APP_MCP_TOOL_ACTIONS[TERMINAL_MCP_TOOL_NAMES.sessionResize]).toBe(
      TERMINAL_SESSION_RESIZE_CAPABILITY_ID,
    )
  })

  it("documents document template data source validation without top-level combinators", () => {
    const tool = buildAppTools().find((item) => item.name === DOCUMENT_TEMPLATE_MCP_TOOL_NAME)

    expect(tool?.inputSchema).toMatchObject({
      required: ["templatePath", "outputPath"],
    })
    expect(tool?.description).toContain("exactly one of dataPath or data")
    expect(tool?.inputSchema).not.toHaveProperty("oneOf")
    expect(tool?.inputSchema).not.toHaveProperty("anyOf")
  })

  it("registers the strict text file writer schema without a text length limit", () => {
    const tool = buildAppTools().find((item) => item.name === TEXT_FILE_WRITER_MCP_TOOL_NAME)

    expect(APP_DOMAIN.capabilities).toContainEqual(expect.objectContaining({
      id: TEXT_FILE_WRITER_CAPABILITY_ID,
      mutates: true,
      risk: "high",
    }))
    expect(APP_MCP_TOOL_ACTIONS[TEXT_FILE_WRITER_MCP_TOOL_NAME]).toBe(TEXT_FILE_WRITER_CAPABILITY_ID)
    expect(tool?.inputSchema).toMatchObject({
      required: ["text", "path"],
      additionalProperties: false,
      properties: {
        text: expect.objectContaining({ type: "string" }),
        path: expect.objectContaining({ type: "string" }),
        encoding: expect.objectContaining({ enum: ["utf8", "utf16le"], default: "utf8" }),
        overwrite: expect.objectContaining({ type: "boolean", default: false }),
      },
    })
    expect((tool?.inputSchema.properties.text as Record<string, unknown> | undefined)).not.toHaveProperty("maxLength")
    expect(tool?.description).toContain("arbitrary extensions or no extension")
    expect((tool?.inputSchema.properties.path as Record<string, unknown> | undefined)?.description)
      .toContain("Any extension or no extension")
  })

  it("registers one strict, non-mutating JSON Repair MCP tool", () => {
    const tool = buildAppTools().find((item) => item.name === JSON_REPAIR_MCP_TOOL_NAME)

    expect(APP_DOMAIN.capabilities).toContainEqual({
      id: JSON_REPAIR_CAPABILITY_ID,
      title: "Repair JSON text",
      description: "Best-effort repair of one input string into validated JSON text.",
      mutates: false,
    })
    expect(APP_MCP_TOOL_ACTIONS[JSON_REPAIR_MCP_TOOL_NAME]).toBe(JSON_REPAIR_CAPABILITY_ID)
    expect(tool?.inputSchema).toEqual({
      type: "object",
      properties: {
        text: expect.objectContaining({
          type: "string",
          minLength: 1,
          maxLength: 131_072,
        }),
      },
      required: ["text"],
      additionalProperties: false,
    })
    expect(tool?.description).toContain("best-effort")
    expect(tool?.description).toContain("heuristic repairs can change meaning")
    expect(tool?.description).toContain("remains untrusted data")
    expect(tool?.description).toContain("not sanitized")
    expect(tool?.description).toContain("Schema")
    expect(tool?.description).toContain("Do not retry automatically")
  })

  it("maps public terminal rename and delete tools to their capabilities", () => {
    expect(TERMINAL_SESSION_RENAME_CAPABILITY_ID).toBe("app.terminal.session_metadata.rename")
    expect(TERMINAL_SESSION_DELETE_CAPABILITY_ID).toBe("app.terminal.session.delete")
    expect(APP_MCP_TOOL_ACTIONS[TERMINAL_MCP_TOOL_NAMES.sessionRename]).toBe(
      TERMINAL_SESSION_RENAME_CAPABILITY_ID,
    )
    expect(APP_MCP_TOOL_ACTIONS[TERMINAL_MCP_TOOL_NAMES.sessionDelete]).toBe(
      TERMINAL_SESSION_DELETE_CAPABILITY_ID,
    )
  })

  it("maps terminal group settings MCP tool to its capability", () => {
    expect(TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID).toBe("app.terminal.group_launch.update")
    expect(APP_MCP_TOOL_ACTIONS[TERMINAL_MCP_TOOL_NAMES.groupUpdateSettings]).toBe(
      TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID,
    )
  })

  it("marks terminal list tool input schemas as strict empty objects", () => {
    const tools = new Map(buildAppTools().map((tool) => [tool.name, tool]))

    expect(tools.get(TERMINAL_MCP_TOOL_NAMES.groupList)?.inputSchema).toMatchObject({
      type: "object",
      properties: {},
      additionalProperties: false,
    })
    expect(tools.get(TERMINAL_MCP_TOOL_NAMES.sessionList)?.inputSchema).toMatchObject({
      type: "object",
      properties: {},
      additionalProperties: false,
    })
  })

  it("describes terminal group list permission behavior", () => {
    const tool = buildAppTools().find((item) => item.name === TERMINAL_MCP_TOOL_NAMES.groupList)

    expect(tool?.description).toContain("Permissions: discover")
    expect(tool?.description).toContain("risk: normal")
  })

  it("describes terminal group create and rename permission behavior", () => {
    const tools = new Map(buildAppTools().map((tool) => [tool.name, tool]))

    expect(tools.get(TERMINAL_MCP_TOOL_NAMES.groupCreate)?.description).toContain("Permissions: group.manage")
    expect(tools.get(TERMINAL_MCP_TOOL_NAMES.groupRename)?.description).toContain("Permissions: group.manage")
  })

  it("keeps secret names immutable in the update MCP schema", () => {
    const updateTool = buildAppTools().find((tool) => tool.name === SECRETS_MCP_TOOL_NAMES.update)

    expect(updateTool?.description).not.toContain("renam")
    expect(updateTool?.inputSchema).toMatchObject({
      type: "object",
      required: ["name"],
      properties: expect.not.objectContaining({
        newName: expect.anything(),
      }),
      additionalProperties: false,
    })
    expect(updateTool?.description).toContain("at least one of value or description")
    expect(updateTool?.inputSchema).not.toHaveProperty("anyOf")
  })

  it("requires a value in the secret upsert MCP schema", () => {
    const upsertTool = buildAppTools().find((tool) => tool.name === SECRETS_MCP_TOOL_NAMES.upsert)

    expect(upsertTool?.description).toContain("metadata-only")
    expect(upsertTool?.inputSchema).toMatchObject({
      required: ["name", "value"],
    })
  })

  it("does not expose session-level agent control in terminal MCP create schema", () => {
    const tools = new Map(buildAppTools().map((tool) => [tool.name, tool]))
    const createSchema = tools.get(TERMINAL_MCP_TOOL_NAMES.sessionCreate)?.inputSchema

    expect(createSchema).toMatchObject({
      type: "object",
      properties: expect.not.objectContaining({
        agentControl: expect.anything(),
      }),
    })
  })

  it("defines terminal rename and delete MCP schemas", () => {
    const tools = new Map(buildAppTools().map((tool) => [tool.name, tool]))

    expect(tools.get(TERMINAL_MCP_TOOL_NAMES.sessionRename)?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        sessionId: expect.objectContaining({ type: "string", format: "uuid" }),
        title: expect.objectContaining({ type: "string", minLength: 1, maxLength: 120 }),
        expectedMetadataRevision: expect.objectContaining({ type: "integer", exclusiveMinimum: 0 }),
        idempotencyKey: expect.objectContaining({ type: "string", minLength: 16, maxLength: 200 }),
      },
      required: ["sessionId", "title", "expectedMetadataRevision", "idempotencyKey"],
      additionalProperties: false,
    })
    expect(tools.get(TERMINAL_MCP_TOOL_NAMES.sessionDelete)?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        sessionId: expect.objectContaining({ type: "string", format: "uuid" }),
        idempotencyKey: expect.objectContaining({ type: "string", minLength: 16, maxLength: 200 }),
      },
      required: ["sessionId", "idempotencyKey"],
      additionalProperties: false,
    })
  })

  it("defines terminal group settings MCP schema", () => {
    const tools = new Map(buildAppTools().map((tool) => [tool.name, tool]))

    expect(tools.get(TERMINAL_MCP_TOOL_NAMES.groupUpdateSettings)?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        groupId: expect.objectContaining({ type: "string", format: "uuid" }),
        expectedLaunchRevision: expect.objectContaining({ type: "integer", exclusiveMinimum: 0 }),
        settings: expect.objectContaining({
          type: "object",
          properties: {
            defaultCwd: expect.objectContaining({ anyOf: expect.arrayContaining([
              expect.objectContaining({ type: "string", minLength: 1 }),
              expect.objectContaining({ type: "null" }),
            ]) }),
            shell: expect.objectContaining({ anyOf: expect.arrayContaining([
              expect.objectContaining({ type: "string", minLength: 1 }),
              expect.objectContaining({ type: "null" }),
            ]) }),
            environment: expect.objectContaining({ type: "object" }),
          },
          additionalProperties: false,
        }),
        idempotencyKey: expect.objectContaining({ type: "string", minLength: 16, maxLength: 200 }),
      },
      required: ["groupId", "expectedLaunchRevision", "settings", "idempotencyKey"],
      additionalProperties: false,
    })
  })

  it("registers Sound Notifier MCP play tool", () => {
    expect(() => assertCanonicalCapabilityId(SOUND_NOTIFIER_PLAY_CAPABILITY_ID)).not.toThrow()
    expect(APP_DOMAIN.capabilities.map((capability) => capability.id)).toContain(SOUND_NOTIFIER_PLAY_CAPABILITY_ID)
    expect(APP_MCP_TOOL_ACTIONS[SOUND_NOTIFIER_PLAY_MCP_TOOL_NAME]).toBe(SOUND_NOTIFIER_PLAY_CAPABILITY_ID)
    expect(buildAppTools().find((tool) => tool.name === SOUND_NOTIFIER_PLAY_MCP_TOOL_NAME)?.inputSchema)
      .toMatchObject({
        type: "object",
        properties: {
          eventType: expect.objectContaining({ enum: expect.arrayContaining(["message", "input-required"]) }),
          presetId: expect.objectContaining({ enum: expect.arrayContaining(["soft-chime", "done"]) }),
          repeatCount: expect.objectContaining({ minimum: 1, maximum: 10 }),
          intervalMs: expect.objectContaining({ minimum: 100, maximum: 60000 }),
        },
        additionalProperties: false,
      })
    expect(JSON.stringify(buildAppTools().find((tool) => tool.name === SOUND_NOTIFIER_PLAY_MCP_TOOL_NAME)?.inputSchema))
      .not.toContain("volume")
    expect(JSON.stringify(buildAppTools().find((tool) => tool.name === SOUND_NOTIFIER_PLAY_MCP_TOOL_NAME)?.inputSchema))
      .toContain("legacy")
  })

  it("registers the stable System Notifier trigger contract", () => {
    expect(() => assertCanonicalCapabilityId(SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID)).not.toThrow()
    expect(APP_DOMAIN.capabilities).toContainEqual({
      id: SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID,
      title: "Trigger system notification",
      description: expect.any(String),
      mutates: false,
    })
    expect(APP_MCP_TOOL_ACTIONS[SYSTEM_NOTIFIER_TRIGGER_MCP_TOOL_NAME])
      .toBe(SYSTEM_NOTIFIER_TRIGGER_CAPABILITY_ID)
    const tool = buildAppTools().find((item) => item.name === SYSTEM_NOTIFIER_TRIGGER_MCP_TOOL_NAME)
    expect(tool).toMatchObject({
      inputSchema: {
        type: "object",
        required: ["title", "body"],
        additionalProperties: false,
        properties: {
          title: expect.objectContaining({ type: "string", maxLength: 64 }),
          body: expect.objectContaining({ type: "string", maxLength: 256 }),
        },
      },
    })
    expect(tool?.description).toContain("does not mean the notification was delivered or displayed")
  })

  it("registers the high-risk problem feedback submission contract", () => {
    expect(APP_DOMAIN.capabilities).toContainEqual({
      id: PROBLEM_FEEDBACK_SUBMIT_CAPABILITY_ID,
      title: "Submit problem feedback",
      description: expect.any(String),
      mutates: true,
      risk: "high",
    })
    expect(APP_MCP_TOOL_ACTIONS[PROBLEM_FEEDBACK_SUBMIT_MCP_TOOL_NAME])
      .toBe(PROBLEM_FEEDBACK_SUBMIT_CAPABILITY_ID)
    expect(buildAppTools().find((item) => item.name === PROBLEM_FEEDBACK_SUBMIT_MCP_TOOL_NAME))
      .toMatchObject({
        inputSchema: {
          type: "object",
          required: ["content"],
          additionalProperties: false,
          properties: {
            content: expect.objectContaining({
              type: "string",
              minLength: 1,
              maxLength: 262144,
            }),
          },
        },
      })
  })

})

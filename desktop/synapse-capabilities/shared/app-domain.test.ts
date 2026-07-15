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
  SWARM_TASK_CAPABILITY_IDS,
  SWARM_TASK_MCP_TOOL_NAMES,
  SWARM_TASK_TASK_CREATE_CAPABILITY_ID,
  SWARM_TASK_TASK_LIST_CAPABILITY_ID,
} from "../../app-capabilities/swarm-task/shared/capability"
import { SECRETS_MCP_TOOL_NAMES } from "../../app-capabilities/secrets/shared/capability"
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

  it("maps public terminal rename and delete tools to their capabilities", () => {
    expect(TERMINAL_SESSION_RENAME_CAPABILITY_ID).toBe("app.terminal.session.rename")
    expect(TERMINAL_SESSION_DELETE_CAPABILITY_ID).toBe("app.terminal.session.delete")
    expect(APP_MCP_TOOL_ACTIONS[TERMINAL_MCP_TOOL_NAMES.sessionRename]).toBe(
      TERMINAL_SESSION_RENAME_CAPABILITY_ID,
    )
    expect(APP_MCP_TOOL_ACTIONS[TERMINAL_MCP_TOOL_NAMES.sessionDelete]).toBe(
      TERMINAL_SESSION_DELETE_CAPABILITY_ID,
    )
  })

  it("maps terminal group settings MCP tool to its capability", () => {
    expect(TERMINAL_GROUP_UPDATE_SETTINGS_CAPABILITY_ID).toBe("app.terminal.group.updateSettings")
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

  it("describes terminal group list saved command and permission behavior", () => {
    const tool = buildAppTools().find((item) => item.name === TERMINAL_MCP_TOOL_NAMES.groupList)

    expect(tool?.description).toContain("saved command settings")
    expect(tool?.description).toContain("permission approval")
  })

  it("keeps secret names immutable in the update MCP schema", () => {
    const updateTool = buildAppTools().find((tool) => tool.name === SECRETS_MCP_TOOL_NAMES.update)

    expect(updateTool?.description).not.toContain("renam")
    expect(updateTool?.inputSchema).toMatchObject({
      type: "object",
      properties: expect.not.objectContaining({
        newName: expect.anything(),
      }),
      additionalProperties: false,
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
        sessionId: expect.objectContaining({ type: "string", minLength: 1 }),
        title: expect.objectContaining({ type: "string", minLength: 1, maxLength: 120 }),
      },
      required: ["sessionId", "title"],
    })
    expect(tools.get(TERMINAL_MCP_TOOL_NAMES.sessionDelete)?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        sessionId: expect.objectContaining({ type: "string", minLength: 1 }),
      },
      required: ["sessionId"],
    })
  })

  it("defines terminal group settings MCP schema", () => {
    const tools = new Map(buildAppTools().map((tool) => [tool.name, tool]))

    expect(tools.get(TERMINAL_MCP_TOOL_NAMES.groupUpdateSettings)?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        groupId: expect.objectContaining({ type: "string", minLength: 1 }),
        name: expect.objectContaining({ type: "string", minLength: 1, maxLength: 80 }),
        settings: expect.objectContaining({
          type: "object",
          properties: {
            defaultCwd: expect.objectContaining({ type: "string", minLength: 1 }),
            startupCommand: expect.objectContaining({ type: "string", minLength: 1 }),
          },
        }),
      },
      required: ["groupId", "name"],
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

  it("registers Swarm Task MCP tools in the app domain and global registry", () => {
    const appCapabilityIds = APP_DOMAIN.capabilities.map((capability) => capability.id)
    const appToolNames = buildAppTools().map((tool) => tool.name)
    const allToolNames = buildAllMcpTools().map((tool) => tool.name)

    for (const capabilityId of SWARM_TASK_CAPABILITY_IDS) {
      expect(appCapabilityIds).toContain(capabilityId)
      expect(getActionDomainId(capabilityId)).toBe("app")
    }

    expect(APP_MCP_TOOL_ACTIONS[SWARM_TASK_MCP_TOOL_NAMES.taskCreate]).toBe(SWARM_TASK_TASK_CREATE_CAPABILITY_ID)
    expect(APP_MCP_TOOL_ACTIONS[SWARM_TASK_MCP_TOOL_NAMES.taskList]).toBe(SWARM_TASK_TASK_LIST_CAPABILITY_ID)
    expect(MCP_TOOL_ACTIONS[SWARM_TASK_MCP_TOOL_NAMES.taskCreate]).toBe(SWARM_TASK_TASK_CREATE_CAPABILITY_ID)
    expect(MCP_TOOL_ACTIONS[SWARM_TASK_MCP_TOOL_NAMES.taskList]).toBe(SWARM_TASK_TASK_LIST_CAPABILITY_ID)
    expect(appToolNames).toEqual(expect.arrayContaining(Object.values(SWARM_TASK_MCP_TOOL_NAMES)))
    expect(allToolNames).toEqual(expect.arrayContaining(Object.values(SWARM_TASK_MCP_TOOL_NAMES)))
  })

  it("defines Swarm Task create and start schemas", () => {
    const tools = new Map(buildAppTools().map((tool) => [tool.name, tool]))
    const taskCreateSchema = tools.get(SWARM_TASK_MCP_TOOL_NAMES.taskCreate)?.inputSchema
    const configSchema = taskCreateSchema?.properties.config as {
      properties: Record<string, unknown>
      required: readonly string[]
    }

    expect(taskCreateSchema).toMatchObject({
      type: "object",
      properties: {
        name: expect.objectContaining({ type: "string", minLength: 1, maxLength: 120 }),
        config: expect.objectContaining({
          type: "object",
          required: ["projectId", "prompt"],
          properties: expect.objectContaining({
            promptInjection: expect.objectContaining({
              type: "object",
              properties: expect.objectContaining({
                sequenceBatch: expect.any(Object),
                previousHandoff: expect.any(Object),
                summary: expect.any(Object),
                fileWrite: expect.any(Object),
                customAppendix: expect.any(Object),
              }),
              additionalProperties: false,
            }),
          }),
        }),
      },
      required: ["name", "config"],
      additionalProperties: false,
    })
    expect(configSchema.properties).not.toHaveProperty("workspacePath")
    expect(configSchema.properties).not.toHaveProperty("injectOptions")
    expect(configSchema.properties).not.toHaveProperty("output")
    expect(configSchema.properties).not.toHaveProperty("handoff")
    expect(tools.get(SWARM_TASK_MCP_TOOL_NAMES.runStart)?.inputSchema).toMatchObject({
      type: "object",
      properties: {
        taskId: expect.objectContaining({ type: "string", minLength: 1 }),
      },
      required: ["taskId"],
      additionalProperties: false,
    })
  })
})

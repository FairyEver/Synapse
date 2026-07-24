import { describe, expect, it } from "vitest"
import { build } from "esbuild"
import { fileURLToPath } from "node:url"
import {
  filterDiscoverableTypes,
  listDiscoverableBuiltinAutomationActionTypes,
  listDiscoverableBuiltinWorkflowNodeTypes,
  listBuiltinCapabilityPackages,
  validateBuiltinCapabilityPackages,
} from "../surface-discovery"
import {
  JAVASCRIPT_RUN_AUTOMATION_ACTION_TYPE,
  JAVASCRIPT_RUN_CAPABILITY_ID,
  JAVASCRIPT_RUN_WORKFLOW_NODE_TYPE,
  NODEJS_RUN_AUTOMATION_ACTION_TYPE,
  NODEJS_RUN_CAPABILITY_ID,
  NODEJS_RUN_WORKFLOW_NODE_TYPE,
} from "../script-runtime/shared/capability"
import { APP_DOMAIN, APP_MCP_TOOL_ACTIONS, buildAppTools } from "../../synapse-capabilities/shared/app-domain"
import { resolveDeclaredAppDeepLink } from "../manifest-registry"
import { listSystemAppDefinitions } from "../../src/modules/apps/definitions"
import { listSystemApps } from "../../src/modules/apps/registry"
import { javascriptRunActionManifest } from "../javascript-run/automation-action/manifest"
import { nodejsRunActionManifest } from "../nodejs-run/automation-action/manifest"
import {
  CLIPBOARD_TEXT_READ_CAPABILITY_ID,
  CLIPBOARD_TEXT_READ_WORKFLOW_NODE_TYPE,
  CLIPBOARD_TEXT_WRITE_CAPABILITY_ID,
  CLIPBOARD_TEXT_WRITE_WORKFLOW_NODE_TYPE,
} from "../clipboard/shared/capability"

describe("script capability packages", () => {
  it("keeps Renderer surface discovery free of Node built-ins", async () => {
    const result = await build({
      entryPoints: [fileURLToPath(new URL("../surface-discovery.ts", import.meta.url))],
      bundle: true,
      platform: "browser",
      format: "esm",
      write: false,
      logLevel: "silent",
    })

    expect(result.outputFiles.map((file) => file.text).join("\n")).not.toContain("node:path")
  })

  it("declares exactly Workflow and Automation surfaces", async () => {
    const packages = listBuiltinCapabilityPackages()
    expect(packages).toHaveLength(3)
    expect(packages.every((pkg) =>
      pkg.systemApp === null
      && pkg.mcpTools.length === 0
      && pkg.deepLinks.length === 0)).toBe(true)

    await import("../../workflow-nodes/register.renderer")
    const { nodeTypeRegistry } = await import("../../workflow-nodes/registry")
    const { rendererActionRegistry } = await import("../../src/action-runtime/builtin-actions")
    validateBuiltinCapabilityPackages({
      workflowNodeTypes: nodeTypeRegistry.listTypes().filter((type) =>
        type === JAVASCRIPT_RUN_WORKFLOW_NODE_TYPE
        || type === NODEJS_RUN_WORKFLOW_NODE_TYPE
        || type === CLIPBOARD_TEXT_WRITE_WORKFLOW_NODE_TYPE
        || type === CLIPBOARD_TEXT_READ_WORKFLOW_NODE_TYPE),
      automationActionTypes: rendererActionRegistry.list().map((action) => action.manifest.id).filter((type) =>
        type === JAVASCRIPT_RUN_AUTOMATION_ACTION_TYPE || type === NODEJS_RUN_AUTOMATION_ACTION_TYPE),
      capabilityIds: APP_DOMAIN.capabilities.map((capability) => capability.id),
    })
  })

  it("does not create MCP tools or aliases", () => {
    expect(Object.values(APP_MCP_TOOL_ACTIONS)).not.toContain(JAVASCRIPT_RUN_CAPABILITY_ID)
    expect(Object.values(APP_MCP_TOOL_ACTIONS)).not.toContain(NODEJS_RUN_CAPABILITY_ID)
    expect(Object.values(APP_MCP_TOOL_ACTIONS)).not.toContain(CLIPBOARD_TEXT_WRITE_CAPABILITY_ID)
    expect(Object.values(APP_MCP_TOOL_ACTIONS)).not.toContain(CLIPBOARD_TEXT_READ_CAPABILITY_ID)
    const toolNames = buildAppTools().map((tool) => tool.name)
    expect(toolNames).not.toContain("app_javascript_script_execute")
    expect(toolNames).not.toContain("app_nodejs_script_execute")
    expect(toolNames).not.toContain("app_clipboard_text_write")
    expect(toolNames).not.toContain("app_clipboard_text_read")
  })

  it("uses discovery metadata only to filter creation discovery", () => {
    expect(filterDiscoverableTypes(
      ["visible", "hidden", "core"],
      [
        { type: "visible", discovery: "visible" },
        { type: "hidden", discovery: "hidden" },
      ],
    )).toEqual(["visible", "core"])
    expect(listDiscoverableBuiltinWorkflowNodeTypes([
      JAVASCRIPT_RUN_WORKFLOW_NODE_TYPE,
      NODEJS_RUN_WORKFLOW_NODE_TYPE,
      CLIPBOARD_TEXT_WRITE_WORKFLOW_NODE_TYPE,
      CLIPBOARD_TEXT_READ_WORKFLOW_NODE_TYPE,
    ])).toEqual([
      JAVASCRIPT_RUN_WORKFLOW_NODE_TYPE,
      NODEJS_RUN_WORKFLOW_NODE_TYPE,
      CLIPBOARD_TEXT_WRITE_WORKFLOW_NODE_TYPE,
      CLIPBOARD_TEXT_READ_WORKFLOW_NODE_TYPE,
    ])
    expect(listDiscoverableBuiltinAutomationActionTypes([
      JAVASCRIPT_RUN_AUTOMATION_ACTION_TYPE,
      NODEJS_RUN_AUTOMATION_ACTION_TYPE,
    ])).toEqual([
      JAVASCRIPT_RUN_AUTOMATION_ACTION_TYPE,
      NODEJS_RUN_AUTOMATION_ACTION_TYPE,
    ])
  })

  it("rejects package declarations that are missing from runtime registries", () => {
    expect(() => validateBuiltinCapabilityPackages({
      workflowNodeTypes: [
        JAVASCRIPT_RUN_WORKFLOW_NODE_TYPE,
        CLIPBOARD_TEXT_WRITE_WORKFLOW_NODE_TYPE,
        CLIPBOARD_TEXT_READ_WORKFLOW_NODE_TYPE,
      ],
      automationActionTypes: [
        JAVASCRIPT_RUN_AUTOMATION_ACTION_TYPE,
        NODEJS_RUN_AUTOMATION_ACTION_TYPE,
      ],
      capabilityIds: APP_DOMAIN.capabilities.map((capability) => capability.id),
    })).toThrow(`Workflow node contribution is missing: ${NODEJS_RUN_WORKFLOW_NODE_TYPE}`)
  })

  it("does not register an App, launcher, window, Dock, or Deep Link identity", () => {
    const forbiddenIds = [
      "clipboard",
      "javascript-run",
      "nodejs-run",
      CLIPBOARD_TEXT_WRITE_CAPABILITY_ID,
      CLIPBOARD_TEXT_READ_CAPABILITY_ID,
      JAVASCRIPT_RUN_CAPABILITY_ID,
      NODEJS_RUN_CAPABILITY_ID,
    ]
    expect(listSystemAppDefinitions().map((app) => app.id)).not.toEqual(expect.arrayContaining(forbiddenIds))
    expect(listSystemApps().map((app) => app.id)).not.toEqual(expect.arrayContaining(forbiddenIds))
    expect(resolveDeclaredAppDeepLink("javascript-run", "run")).toBeNull()
    expect(resolveDeclaredAppDeepLink("nodejs-run", "run")).toBeNull()
    expect(resolveDeclaredAppDeepLink("clipboard", "read")).toBeNull()
    expect(resolveDeclaredAppDeepLink("clipboard", "write")).toBeNull()
  })

  it("declares the same no-authorization Automation policy for both runtimes", () => {
    expect(javascriptRunActionManifest.authorization).toBe("none")
    expect(nodejsRunActionManifest.authorization).toBe("none")
    expect(javascriptRunActionManifest.automationPolicy).toEqual({
      initiallyDisabled: true,
      disableOnExecutionChange: true,
      nonExecutionConfigFields: ["saveRunContent"],
      runContentPersistenceConfigField: "saveRunContent",
    })
    expect(nodejsRunActionManifest.automationPolicy)
      .toEqual(javascriptRunActionManifest.automationPolicy)
  })
})

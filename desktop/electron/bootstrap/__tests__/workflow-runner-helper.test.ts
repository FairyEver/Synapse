import { describe, expect, it, vi } from "vitest"
import type { WorkflowDefinition, WorkflowEvent } from "../../../src/types/workflow"
import { createRunWorkflowAndWait } from "../descriptors"

vi.mock("electron-updater", () => ({
  autoUpdater: {
    on: () => {},
    once: () => {},
    setFeedURL: () => {},
    checkForUpdates: () => Promise.resolve(null),
    downloadUpdate: () => Promise.resolve([]),
    quitAndInstall: () => {},
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    fullChangelog: false,
    forceDevUpdateConfig: false,
    logger: null,
  },
  CancellationToken: class {},
}))

vi.mock("electron", () => ({
  app: {
    getPath: (which: string) => `/tmp/synapse-workflow-helper-${which}`,
    getName: () => "synapse-test",
    getVersion: () => "0.0.0-test",
    getAppPath: () => "/tmp/synapse-test-app",
    isPackaged: false,
    on: () => {},
    once: () => {},
  },
  BrowserWindow: class {
    static getAllWindows() {
      return []
    }
  },
  dialog: {},
  ipcMain: { handle: () => {}, on: () => {} },
  shell: {},
  Tray: class {},
  Menu: { buildFromTemplate: () => ({}) },
  Notification: class {
    static isSupported() {
      return false
    }
    on() {}
  },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
  safeStorage: { isEncryptionAvailable: () => false },
  webContents: {},
}))

vi.mock("../../services/config-store", () => ({
  configStore: {
    load: vi.fn(async () => ({
      activeRepoUuid: "repo-1",
      repositories: [{ uuid: "repo-1", name: "Test", localPath: "/test" }],
      global: { projects: [] },
    })),
  },
}))

const definition: WorkflowDefinition = {
  id: "wf-1",
  name: "每日汇总",
  version: "v1",
  createdAt: 1,
  updatedAt: 2,
  params: [],
  nodes: [
    {
      id: "end",
      name: "结束",
      type: "end",
      position: { x: 0, y: 0 },
      config: { outputType: "text", template: "", variables: [] },
    },
  ],
  edges: [],
}

describe("createRunWorkflowAndWait", () => {
  it("resolves with run result when the workflow completes", async () => {
    const actor = { kind: "user" as const, id: "automation", display: "Automation" }
    const workflowEngine = {
      run: vi.fn(async (
        _def: WorkflowDefinition,
        _params: Record<string, unknown>,
        runId: string,
        emit: (event: WorkflowEvent) => void,
      ) => {
        const result = { status: "completed" as const, nodeResults: {}, durationMs: 12, output: "done" }
        emit({ type: "workflow:completed", runId, workflowId: "wf-1", result })
        return result
      }),
    }
    const runWorkflowAndWait = createRunWorkflowAndWait({
      workflowService: { get: vi.fn(async () => definition) },
      workflowEngine: workflowEngine as never,
      snapshotService: { save: vi.fn(async () => undefined) },
      eventBus: { emit: vi.fn() } as never,
      runAborts: new Map(),
      runStatuses: new Map(),
      runCompletions: new Map(),
      capabilityLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as never,
    })

    await expect(runWorkflowAndWait({
      workflowId: "wf-1",
      params: {},
      abortSignal: new AbortController().signal,
      triggerSource: "automation",
      automationId: "auto-1",
      automationRunId: "auto-run-1",
      actor,
    })).resolves.toMatchObject({
      definition,
      result: { status: "completed", output: "done" },
    })
    expect(workflowEngine.run).toHaveBeenCalledWith(
      definition,
      {},
      expect.any(String),
      expect.any(Function),
      expect.any(AbortSignal),
      "repo-1",
      "automation",
      actor,
      undefined,
      { automationId: "auto-1", automationRunId: "auto-run-1" },
      new Map([["wf-1", definition]]),
    )
  })

  it("aborts the workflow run when the outer signal aborts", async () => {
    const runAborts = new Map<string, AbortController>()
    const outer = new AbortController()
    const runWorkflowAndWait = createRunWorkflowAndWait({
      workflowService: { get: vi.fn(async () => definition) },
      workflowEngine: {
        run: vi.fn(async () => {
          outer.abort()
          return { status: "cancelled", nodeResults: {}, durationMs: 1 }
        }),
      } as never,
      snapshotService: { save: vi.fn(async () => undefined) },
      eventBus: { emit: vi.fn() } as never,
      runAborts,
      runStatuses: new Map(),
      runCompletions: new Map(),
      capabilityLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as never,
    })

    await runWorkflowAndWait({
      workflowId: "wf-1",
      params: {},
      abortSignal: outer.signal,
      triggerSource: "automation",
      automationId: "auto-1",
      automationRunId: "auto-run-1",
    })

    expect([...runAborts.values()].every((controller) => controller.signal.aborted)).toBe(true)
  })
})

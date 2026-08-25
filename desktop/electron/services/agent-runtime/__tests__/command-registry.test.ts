import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import type {
  AgentCommandEntryV1,
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
} from "../../../runtime/data-repo"
import { createRecordingLogger } from "../../../runtime/lib/test-helpers"
import { describe, expect, it, vi } from "vitest"

import {
  BUILTIN_COMMANDS,
  CustomCommandRegistry,
  expandCustomCommandPrompt,
} from "../command-registry"

describe("CustomCommandRegistry", () => {
  it("publishes /mode as a list-only command", () => {
    expect(BUILTIN_COMMANDS.find((command) => command.name === "mode")).toEqual(
      expect.objectContaining({
        description: "List modes",
      }),
    )
  })

  it("publishes the SDK-native /compact command without the removed /compress alias", () => {
    expect(BUILTIN_COMMANDS).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "compact" }),
    ]))
    expect(BUILTIN_COMMANDS.some((command) => command.name === "compress")).toBe(false)
  })

  it("stores prompt and exec commands", async () => {
    const commands = new MemoryNamespace<AgentCommandEntryV1>("agent.commands")
    const registry = new CustomCommandRegistry({
      projectId: "project-1",
      commands,
      now: fixedNow,
    })

    await registry.addPrompt({ name: "Review", prompt: "Review {{args}}" })
    await registry.addExec({ name: "Build", exec: "pnpm build", shell: "powershell" })

    expect(await registry.resolve("review")).toEqual(expect.objectContaining({
      name: "review",
      kind: "prompt",
    }))
    expect(await registry.resolve("build")).toEqual(expect.objectContaining({
      name: "build",
      kind: "exec",
      shell: "powershell",
      adminOnly: true,
      allowedPlatforms: ["local-renderer"],
    }))
  })

  it("expands placeholders and appends args when no placeholders exist", () => {
    expect(expandCustomCommandPrompt({ prompt: "A {{1}} {{2*}} {{args}}" }, ["one", "two", "three"]))
      .toBe("A one two three one two three")
    expect(expandCustomCommandPrompt({ prompt: "Review" }, ["src/app.ts"]))
      .toBe("Review\n\nsrc/app.ts")
  })

  it("skips unreadable file commands and logs a diagnostic", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-command-"))
    const commandDir = path.join(workspace, ".agents", "commands")
    await fs.mkdir(commandDir, { recursive: true })
    const goodPath = path.join(commandDir, "good.md")
    const badPath = path.join(commandDir, "bad.md")
    await fs.writeFile(goodPath, "Good command")
    await fs.writeFile(badPath, "Bad command")

    const logger = createRecordingLogger()
    const originalReadFile = fs.readFile.bind(fs)
    const readFileSpy = vi.spyOn(fs, "readFile").mockImplementation(async (filePath, options) => {
      if (filePath.toString() === badPath) {
        throw new Error("EACCES: permission denied, open '/secret/bad.md'")
      }
      return originalReadFile(filePath, options)
    })

    try {
      const registry = new CustomCommandRegistry({
        projectId: "project-1",
        commands: new MemoryNamespace<AgentCommandEntryV1>("agent.commands"),
        workspacePath: workspace,
        now: fixedNow,
        logger,
      })

      const commands = await registry.list()

      expect(commands.map((command) => command.name)).toContain("good")
      expect(commands.map((command) => command.name)).not.toContain("bad")
      expect(logger.records).toContainEqual(expect.objectContaining({
        level: "warn",
        message: "Agent command file skipped.",
        meta: expect.objectContaining({
          boundary: "agent.command.file-read",
          projectId: "project-1",
          commandName: "bad",
          fileName: "bad.md",
          error: "EACCES: permission denied, open '[path redacted]'",
          errorName: "Error",
          errorLength: "EACCES: permission denied, open '/secret/bad.md'".length,
        }),
      }))
    } finally {
      readFileSpy.mockRestore()
      await fs.rm(workspace, { recursive: true, force: true })
    }
  })

  it("logs command directory discovery failures with a runtime boundary", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-command-"))
    const commandDir = path.join(workspace, ".agents", "commands")
    await fs.mkdir(commandDir, { recursive: true })

    const logger = createRecordingLogger()
    const originalReadDir = fs.readdir.bind(fs)
    const readDirSpy = vi.spyOn(fs, "readdir").mockImplementation(async (dir, options) => {
      if (dir.toString() === commandDir) {
        throw new Error("EACCES: permission denied, scandir '/secret/commands'")
      }
      return originalReadDir(dir, options)
    })

    try {
      const registry = new CustomCommandRegistry({
        projectId: "project-1",
        commands: new MemoryNamespace<AgentCommandEntryV1>("agent.commands"),
        workspacePath: workspace,
        now: fixedNow,
        logger,
      })

      await registry.list()

      expect(logger.records).toContainEqual(expect.objectContaining({
        level: "warn",
        message: "Agent command directory skipped.",
        meta: expect.objectContaining({
          boundary: "agent.command.directory-discovery",
          projectId: "project-1",
          directoryName: "commands",
          rootName: "commands",
          error: "EACCES: permission denied, scandir '[path redacted]'",
          errorName: "Error",
          errorLength: "EACCES: permission denied, scandir '/secret/commands'".length,
        }),
      }))
    } finally {
      readDirSpy.mockRestore()
      await fs.rm(workspace, { recursive: true, force: true })
    }
  })

  it("redacts unquoted absolute paths in file command diagnostics", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-command-"))
    const commandDir = path.join(workspace, ".agents", "commands")
    await fs.mkdir(commandDir, { recursive: true })
    const badPath = path.join(commandDir, "bad.md")
    await fs.writeFile(badPath, "Bad command")

    const logger = createRecordingLogger()
    const readFileSpy = vi.spyOn(fs, "readFile").mockRejectedValue(
      new Error("EACCES: permission denied, open /Users/example/.claude/commands/bad.md"),
    )

    try {
      const registry = new CustomCommandRegistry({
        projectId: "project-1",
        commands: new MemoryNamespace<AgentCommandEntryV1>("agent.commands"),
        workspacePath: workspace,
        now: fixedNow,
        logger,
      })

      await registry.list()

      expect(logger.records).toContainEqual(expect.objectContaining({
        level: "warn",
        message: "Agent command file skipped.",
        meta: expect.objectContaining({
          commandName: "bad",
          error: "EACCES: permission denied, open [path redacted]",
        }),
      }))
      expect(JSON.stringify(logger.records)).not.toContain("/Users/example")
    } finally {
      readFileSpy.mockRestore()
      await fs.rm(workspace, { recursive: true, force: true })
    }
  })

  it("keeps single-segment slash commands in command diagnostics", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-command-"))
    const commandDir = path.join(workspace, ".agents", "commands")
    await fs.mkdir(commandDir, { recursive: true })
    const badPath = path.join(commandDir, "bad.md")
    await fs.writeFile(badPath, "Bad command")

    const logger = createRecordingLogger()
    const readFileSpy = vi.spyOn(fs, "readFile").mockRejectedValue(
      new Error("Command /mode failed while loading custom command"),
    )

    try {
      const registry = new CustomCommandRegistry({
        projectId: "project-1",
        commands: new MemoryNamespace<AgentCommandEntryV1>("agent.commands"),
        workspacePath: workspace,
        now: fixedNow,
        logger,
      })

      await registry.list()

      expect(logger.records).toContainEqual(expect.objectContaining({
        level: "warn",
        message: "Agent command file skipped.",
        meta: expect.objectContaining({
          commandName: "bad",
          error: "Command /mode failed while loading custom command",
        }),
      }))
    } finally {
      readFileSpy.mockRestore()
      await fs.rm(workspace, { recursive: true, force: true })
    }
  })

  it("redacts secret-like values in file command diagnostics", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "synapse-command-"))
    const commandDir = path.join(workspace, ".agents", "commands")
    await fs.mkdir(commandDir, { recursive: true })
    const badPath = path.join(commandDir, "bad.md")
    await fs.writeFile(badPath, "Bad command")

    const logger = createRecordingLogger()
    const readFileSpy = vi.spyOn(fs, "readFile").mockRejectedValue(
      new Error("EACCES: token=sk-secret authorization=Bearer-secret cookie=session-secret"),
    )

    try {
      const registry = new CustomCommandRegistry({
        projectId: "project-1",
        commands: new MemoryNamespace<AgentCommandEntryV1>("agent.commands"),
        workspacePath: workspace,
        now: fixedNow,
        logger,
      })

      await registry.list()

      expect(logger.records).toContainEqual(expect.objectContaining({
        level: "warn",
        message: "Agent command file skipped.",
        meta: expect.objectContaining({
          commandName: "bad",
          error: "EACCES: token=[redacted] authorization=[redacted] cookie=[redacted]",
        }),
      }))
      expect(JSON.stringify(logger.records)).not.toContain("sk-secret")
      expect(JSON.stringify(logger.records)).not.toContain("Bearer-secret")
      expect(JSON.stringify(logger.records)).not.toContain("session-secret")
    } finally {
      readFileSpy.mockRestore()
      await fs.rm(workspace, { recursive: true, force: true })
    }
  })
})

class MemoryNamespace<T extends { id: string }> implements DataNamespace<T> {
  readonly schemaVersion = 1
  readonly backend = "json" as const
  readonly name: string
  private readonly values = new Map<string, T>()
  private readonly listeners: DataChangeListener<T>[] = []

  constructor(name: string) {
    this.name = name
  }

  async getSingleton(): Promise<T | null> {
    return null
  }

  async setSingleton(): Promise<void> {}

  async list(): Promise<T[]> {
    return [...this.values.values()]
  }

  async get(id: string): Promise<T | null> {
    return this.values.get(id) ?? null
  }

  async upsert(item: T): Promise<void> {
    const previous = this.values.get(item.id)
    this.values.set(item.id, item)
    this.emit({
      namespace: this.name,
      kind: "upsert",
      id: item.id,
      value: item,
      previous,
      timestamp: new Date().toISOString(),
    })
  }

  async remove(id: string): Promise<void> {
    const previous = this.values.get(id)
    this.values.delete(id)
    this.emit({
      namespace: this.name,
      kind: "remove",
      id,
      previous,
      timestamp: new Date().toISOString(),
    })
  }

  onChange(listener: DataChangeListener<T>): () => void {
    this.listeners.push(listener)
    return () => {
      const index = this.listeners.indexOf(listener)
      if (index >= 0) this.listeners.splice(index, 1)
    }
  }

  private emit(event: DataChangeEvent<T>): void {
    for (const listener of this.listeners) listener(event)
  }
}

function fixedNow(): Date {
  return new Date("2026-04-26T00:00:00.000Z")
}

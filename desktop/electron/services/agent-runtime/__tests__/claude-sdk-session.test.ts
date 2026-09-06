import type {
  PermissionResult,
  PermissionUpdate,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk" with { "resolution-mode": "import" }
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import {
  ClaudeSDKSession,
  type QueryFactory,
  type QueryLike,
} from "../claude-sdk-session"
import type { AgentMessage } from "../types"

describe("ClaudeSDKSession", () => {
  it("send yields user messages into the SDK input stream", async () => {
    const { factory, getPrompt } = createQueryFactory()
    const session = createSession(factory)

    const input = getPrompt()[Symbol.asyncIterator]().next()
    await session.send(message("hello"))

    await expect(input).resolves.toEqual({
      done: false,
      value: {
        type: "user",
        message: {
          role: "user",
          content: "hello",
        },
        parent_tool_use_id: null,
      },
    })
  })

  it("send exposes image attachments as ordered Read paths", async () => {
    const { factory, getPrompt } = createQueryFactory()
    const session = createSession(factory)

    const input = getPrompt()[Symbol.asyncIterator]().next()
    await session.send({
      ...message("分析图片"),
      attachments: [{
        kind: "path",
        path: "/controlled/draft/image-1/original.png",
        entryType: "image",
        name: "pixel.png",
        size: 3,
      }],
    })

    await expect(input).resolves.toEqual({
      done: false,
      value: {
        type: "user",
        message: {
          role: "user",
          content: expect.stringContaining(
            '[Image #1] name="pixel.png" path="/controlled/draft/image-1/original.png"',
          ),
        },
        parent_tool_use_id: null,
      },
    })
  })

  it("uses identical attachment messages and directory settings for every provider", async () => {
    const providers = ["bailian-kimi", "bailian-qwen", "custom-compatible"]
    const runs = providers.map((providerId) => {
      const query = createQueryFactory()
      const session = createSession(query.factory, {
        providerId,
        additionalDirectories: ["/controlled/draft"],
      })
      return { query, session }
    })
    const inputs = runs.map(({ query }) => query.getPrompt()[Symbol.asyncIterator]().next())
    const attachmentMessage: AgentMessage = {
      ...message("分析全部图片"),
      attachments: [{
        kind: "path",
        path: "/controlled/draft/image-1/original.png",
        entryType: "image",
        name: "pixel.png",
      }],
    }

    await Promise.all(runs.map(({ session }) => session.send(attachmentMessage)))
    const contents = await Promise.all(inputs.map(async (input) =>
      (await input).value?.message.content as string))

    expect(new Set(contents)).toHaveProperty("size", 1)
    for (const { query } of runs) {
      expect(query.getOptions().additionalDirectories).toEqual(["/controlled/draft"])
    }
  })

  it("send combines path attachments with the actual user text", async () => {
    const { factory, getPrompt } = createQueryFactory()
    const session = createSession(factory)

    const input = getPrompt()[Symbol.asyncIterator]().next()
    await session.send({
      ...message("Attached file: /tmp/project/report.md"),
      attachments: [{
        kind: "path",
        path: "/tmp/project/report.md",
        entryType: "file",
        name: "report.md",
      }],
    })

    const result = await input
    expect(result).toMatchObject({
      done: false,
      value: {
        message: {
          content: expect.stringContaining("Attached file: /tmp/project/report.md"),
        },
      },
    })
    expect((result.value?.message.content as string)).toContain(
      '[File #1] name="report.md" path="/tmp/project/report.md"',
    )
  })

  it("sends fifty image paths through the only main query", async () => {
    const { factory, getPrompt } = createQueryFactory()
    const factorySpy = vi.fn(factory)
    const session = createSession(factorySpy, { model: "qwen3.5-plus" })
    const input = getPrompt()[Symbol.asyncIterator]().next()

    await expect(session.send({
      ...message("比较全部图片"),
      attachments: Array.from({ length: 50 }, (_, index) => ({
        kind: "path" as const,
        path: `/controlled/draft/image-${index + 1}/original.png`,
        entryType: "image" as const,
        name: `image-${index + 1}.png`,
      })),
    })).resolves.toBe(true)

    const result = await input
    const content = result.value?.message.content as string
    expect(content).toContain("[Image #1]")
    expect(content).toContain("[Image #50]")
    expect(factorySpy).toHaveBeenCalledOnce()
  })

  it("interrupts only the main query", async () => {
    const mainQuery = new FakeQuery()
    const session = createSession(() => mainQuery)

    await expect(session.cancelCurrentTurn()).resolves.toBe(true)
    expect(mainQuery.interrupt).toHaveBeenCalledOnce()
  })

  it("requests partial SDK messages so renderer can stream tokens", () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory)

    expect(getOptions()).toMatchObject({
      includePartialMessages: true,
      enableFileCheckpointing: true,
      extraArgs: { "replay-user-messages": null },
    })
  })

  it("sets a default SDK turn cap to stop runaway tool loops", () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory)

    expect(getOptions()).toMatchObject({
      maxTurns: 200,
    })
  })

  it("does not combine file checkpointing with the incompatible SDK session store", () => {
    const { factory, getOptions } = createQueryFactory()
    const onConversationTitle = vi.fn()
    createSession(factory, { onConversationTitle })

    const options = getOptions()
    expect(options.enableFileCheckpointing).toBe(true)
    expect(options.sessionStore).toBeUndefined()
    expect(options.sessionStoreFlush).toBeUndefined()
  })

  it("does not install an SDK session store when resuming a conversation", () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory, {
      sdkSessionId: "sdk-existing",
      onConversationTitle: vi.fn(),
    })

    expect(getOptions().sessionStore).toBeUndefined()
  })

  it("allows callers to override the default SDK turn cap", () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory, { maxTurns: 12 })

    expect(getOptions()).toMatchObject({
      maxTurns: 12,
    })
  })

  it("passes additional directories to Claude Agent SDK", () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory, {
      additionalDirectories: ["/Users/liyang/Desktop"],
    })

    expect(getOptions()).toMatchObject({
      additionalDirectories: ["/Users/liyang/Desktop"],
    })
  })

  it("updates the SDK with the complete normalized directory set", async () => {
    const grantAdditionalDirectories = vi.fn(async (_directories: readonly string[]) => {})
    const { factory } = createQueryFactory({ grantAdditionalDirectories })
    const session = createSession(factory, {
      additionalDirectories: ["/Users/liyang/Desktop"],
    })

    await session.grantAdditionalDirectories(["/Users/liyang/Downloads"])
    await session.grantAdditionalDirectories(["/Users/liyang/Desktop/reports"])
    await session.grantAdditionalDirectories(["/Users/liyang"])

    expect(grantAdditionalDirectories.mock.calls).toEqual([
      [["/Users/liyang/Desktop", "/Users/liyang/Downloads"]],
      [["/Users/liyang"]],
    ])
  })

  it("loads local Claude Code rules, memory, skills, and project MCP configuration", () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory)

    expect(getOptions()).toMatchObject({
      settingSources: ["user", "project", "local"],
      skills: "all",
      settings: {
        enableAllProjectMcpServers: true,
        disableAllHooks: true,
      },
    })
  })

  it("merges runtime SDK settings without leaking non-provider env into settings.env", () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory, {
      env: {
        ANTHROPIC_BASE_URL: "https://dashscope.aliyuncs.com",
        ANTHROPIC_AUTH_TOKEN: "sk-provider",
        SYNAPSE_SIDE_CHANNEL_TOKEN: "side-token",
      },
      sdkSettings: {
        skipWebFetchPreflight: true,
      },
    })

    expect(getOptions()).toMatchObject({
      settings: {
        enableAllProjectMcpServers: true,
        disableAllHooks: true,
        skipWebFetchPreflight: true,
        env: {
          ANTHROPIC_BASE_URL: "https://dashscope.aliyuncs.com",
          ANTHROPIC_AUTH_TOKEN: "sk-provider",
        },
      },
    })
    expect(JSON.stringify(getOptions().settings)).not.toContain("side-token")
    expect(JSON.stringify(getOptions().settings)).not.toContain("SYNAPSE_SIDE_CHANNEL_TOKEN")
  })

  it("passes local SDK plugins to Claude Agent SDK", () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory, {
      plugins: [{ type: "local", path: "/Applications/Synapse/resources/example-plugin" }],
    })

    expect(getOptions()).toMatchObject({
      plugins: [{ type: "local", path: "/Applications/Synapse/resources/example-plugin" }],
    })
  })

  it("does not configure SDK plugins for ordinary sessions", () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory)

    expect(getOptions()).not.toHaveProperty("plugins")
  })

  it("keeps hooks disabled when a session-scoped SDK plugin is loaded", () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory, {
      plugins: [{ type: "local", path: "/Applications/Synapse/resources/example-plugin" }],
    })

    expect(getOptions()).toMatchObject({
      settingSources: ["user", "project", "local"],
      skills: "all",
      settings: {
        disableAllHooks: true,
      },
    })
  })

  it("allows plugin hooks only when explicitly requested", () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory, {
      plugins: [{ type: "local", path: "/Applications/Synapse/resources/example-plugin" }],
      allowPluginHooks: true,
    })

    expect(getOptions()).toMatchObject({
      settingSources: ["user", "project", "local"],
      settings: {
        disableAllHooks: false,
      },
    })
  })

  it("keeps user project and local settings visible when plugin hooks are enabled", () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory, {
      plugins: [{ type: "local", path: "/Applications/Synapse/resources/kb-plugin" }],
      allowPluginHooks: true,
    })

    expect(getOptions()).toMatchObject({
      settingSources: ["user", "project", "local"],
      settings: {
        disableAllHooks: false,
      },
    })
  })

  it("passes programmatic SDK agents to Claude Agent SDK", () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory, {
      agents: {
        "synapse-example-worker": {
          description: "Processes assigned project tasks.",
          prompt: "Only process assigned tasks.",
          tools: ["Read", "Write"],
        },
      },
    })

    expect(getOptions()).toMatchObject({
      agents: {
        "synapse-example-worker": {
          description: "Processes assigned project tasks.",
          prompt: "Only process assigned tasks.",
          tools: ["Read", "Write"],
        },
      },
    })
  })

  it("passes main-thread agent to Claude Agent SDK options", () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory, {
      agent: "synapse-persona__builtin-zh-en-translator",
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: "Translate only.",
      },
      tools: [],
      disallowedTools: ["*"],
      personaToolPolicy: { mode: "disabled", allowedTools: [] },
      agents: {
        "synapse-persona__builtin-zh-en-translator": {
          description: "Translates between Chinese and English.",
          prompt: "Translate only.",
          tools: [],
          disallowedTools: ["*"],
        },
      },
      agentDefinitionsHash: "hash-1",
    })

    expect(getOptions()).toMatchObject({
      agent: "synapse-persona__builtin-zh-en-translator",
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: expect.stringContaining(
          'Translate only.\n\nSynapse configured the exact workspace root for this session as "/tmp/project".',
        ),
      },
      tools: [],
      disallowedTools: ["*"],
      agents: {
        "synapse-persona__builtin-zh-en-translator": {
          prompt: "Translate only.",
        },
      },
    })
  })

  it("denies every tool in persona disabled mode before SDK permissions", async () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory, {
      personaToolPolicy: { mode: "disabled", allowedTools: [] },
    })

    const guard = preToolUseHook(getOptions(), "*")

    await expect(guard({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git status" },
    })).resolves.toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringContaining("当前智能体未启用工具"),
      },
    })
  })

  it("denies tools outside the persona allowlist before SDK permissions", async () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory, {
      personaToolPolicy: { mode: "allowlist", allowedTools: ["Read", "mcp__synapse-mcp__database_query"] },
    })

    const guard = preToolUseHook(getOptions(), "*")

    await expect(guard({
      hook_event_name: "PreToolUse",
      tool_name: "Read",
      tool_input: { file_path: "README.md" },
    })).resolves.toEqual({})
    await expect(guard({
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      tool_input: { command: "git status" },
    })).resolves.toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringContaining("当前智能体未允许使用该工具"),
      },
    })
  })

  it("denies repeated identical TodoWrite calls twice before stopping the turn", async () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory)
    const guard = preToolUseHook(getOptions())
    const input = {
      todos: [{
        content: "展示今日工作计划",
        status: "completed",
        activeForm: "展示今日工作计划",
      }],
    }

    await expect(guard(todoWriteHookInput(input))).resolves.toEqual({})
    await expect(guard(todoWriteHookInput(input))).resolves.toEqual({})
    await expect(guard(todoWriteHookInput(input))).resolves.toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringContaining("Do not retry TodoWrite"),
        additionalContext: expect.stringContaining("Answer the user directly"),
      },
    })
    await expect(guard(todoWriteHookInput(input))).resolves.toEqual({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: expect.stringContaining("Do not retry TodoWrite"),
        additionalContext: expect.stringContaining("Answer the user directly"),
      },
    })
    await expect(guard(todoWriteHookInput(input))).resolves.toEqual({
      continue: false,
      stopReason: expect.stringContaining("Stopped repeated TodoWrite"),
    })
  })

  it("resets the TodoWrite repetition guard when the tool input changes", async () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory)
    const guard = preToolUseHook(getOptions())
    const firstInput = {
      todos: [{
        content: "展示今日工作计划",
        status: "completed",
        activeForm: "展示今日工作计划",
      }],
    }
    const secondInput = {
      todos: [{
        content: "展示明日工作计划",
        status: "completed",
        activeForm: "展示明日工作计划",
      }],
    }

    await expect(guard(todoWriteHookInput(firstInput))).resolves.toEqual({})
    await expect(guard(todoWriteHookInput(firstInput))).resolves.toEqual({})
    await expect(guard(todoWriteHookInput(secondInput))).resolves.toEqual({})
    await expect(guard(todoWriteHookInput(secondInput))).resolves.toEqual({})
  })

  it("denies restricted subagent writes outside allowed paths before prompting", async () => {
    const { factory, getOptions } = createQueryFactory()
    const session = createSession(factory, {
      subagentToolPolicies: {
        "synapse-example-worker": {
          allowedWriteRoots: ["project/outputs"],
          deniedWritePaths: ["project/state.json", ".vault-meta", "project/index.md"],
        },
      },
    })
    const hooks = getOptions().hooks as {
      PreToolUse: [{ matcher: string, hooks: [(
        input: Record<string, unknown>,
        toolUseID: string | undefined,
        context: { signal: AbortSignal },
      ) => Promise<unknown>] }]
      SubagentStart: [{ hooks: [(
        input: Record<string, unknown>,
        toolUseID: string | undefined,
        context: { signal: AbortSignal },
      ) => Promise<unknown>] }]
      SubagentStop: [{ hooks: [(
        input: Record<string, unknown>,
        toolUseID: string | undefined,
        context: { signal: AbortSignal },
      ) => Promise<unknown>] }]
    }
    expect(hooks.PreToolUse[0].matcher).toBe("TodoWrite")
    expect(hooks.SubagentStop).toHaveLength(1)
    await hooks.SubagentStart[0].hooks[0]({
      hook_event_name: "SubagentStart",
      agent_id: "agent-1",
      agent_type: "synapse-example-worker",
    }, undefined, { signal: new AbortController().signal })

    const result = await canUseTool(getOptions())("Write", {
      file_path: "project/index.md",
      content: "# Index\n",
    }, {
      signal: new AbortController().signal,
      toolUseID: "tool-1",
      agentID: "agent-1",
    } as never)

    expect(result).toEqual({
      behavior: "deny",
      message: "Subagent synapse-example-worker may write only inside: project/outputs.",
    })
    await expect(resolveSoon(session.nextEvent())).resolves.toBe("timeout")
  })

  it("denies direct session writes through an injected tool policy before prompting", async () => {
    const { factory, getOptions } = createQueryFactory()
    const session = createSession(factory, {
      toolPolicy: (toolName, input) => {
        if (toolName !== "Write" || input.file_path === "project/outputs/a.md") return undefined
        return { behavior: "deny", message: "Only the assigned source page may be written." }
      },
    })

    const result = await canUseTool(getOptions())("Write", {
      file_path: "project/index.md",
      content: "# Index\n",
    }, {
      signal: new AbortController().signal,
    })

    expect(result).toEqual({
      behavior: "deny",
      message: "Only the assigned source page may be written.",
    })
    await expect(resolveSoon(session.nextEvent())).resolves.toBe("timeout")
  })

  it("enables the SDK bypass permission confirmation for bypass mode", () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory, { mode: "bypassPermissions" })

    expect(getOptions()).toMatchObject({
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    })
  })

  it("passes provider env together with the host process env to the SDK", () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory, {
      env: {
        ANTHROPIC_BASE_URL: "https://api.example.test/anthropic",
        ANTHROPIC_AUTH_TOKEN: "sk-auth",
        ANTHROPIC_API_KEY: "sk-api",
        ANTHROPIC_MODEL: "provider-model",
        SYNAPSE_SIDE_CHANNEL_TOKEN: "side-token",
      },
    })

    const sdkEnv = getOptions().env as NodeJS.ProcessEnv
    expect(sdkEnv).toEqual(expect.objectContaining({
      ANTHROPIC_BASE_URL: "https://api.example.test/anthropic",
      ANTHROPIC_AUTH_TOKEN: "sk-auth",
      ANTHROPIC_API_KEY: "sk-api",
      ANTHROPIC_MODEL: "provider-model",
      SYNAPSE_SIDE_CHANNEL_TOKEN: "side-token",
      BASH_DEFAULT_TIMEOUT_MS: "3600000",
      BASH_MAX_TIMEOUT_MS: "3600000",
    }))
    expect(sdkEnv.PATH).toContain((process.env.PATH ?? "").split(":").filter(Boolean)[0] ?? "")
    expect(getOptions().settings).toMatchObject({
      enableAllProjectMcpServers: true,
      disableAllHooks: true,
      env: {
        ANTHROPIC_BASE_URL: "https://api.example.test/anthropic",
        ANTHROPIC_AUTH_TOKEN: "sk-auth",
        ANTHROPIC_API_KEY: "sk-api",
        ANTHROPIC_MODEL: "provider-model",
      },
    })
    expect(JSON.stringify(getOptions().settings)).not.toContain("side-token")
  })

  it("aligns the SDK PWD with a nested project cwd", () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory, {
      cwd: "/workspace/repository/nested-project",
      hostEnv: {
        PATH: "/usr/bin:/bin",
        PWD: "/workspace/repository",
      },
    })

    expect(getOptions()).toMatchObject({
      cwd: "/workspace/repository/nested-project",
      env: {
        PWD: "/workspace/repository/nested-project",
      },
    })
  })

  it("pins the configured workspace when it is nested inside another repository", () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory, {
      cwd: "/workspace/repository/nested-project",
    })

    expect(getOptions().systemPrompt).toEqual({
      type: "preset",
      preset: "claude_code",
      append: [
        "Synapse configured the exact workspace root for this session as",
        '"/workspace/repository/nested-project".',
        "Treat that exact directory as the project root.",
        "Resolve relative file paths and project commands from it.",
        "Do not substitute an ancestor repository root.",
      ].join(" "),
    })
  })

  it.each([
    ["Write", "file_path"],
    ["Edit", "file_path"],
    ["MultiEdit", "file_path"],
    ["NotebookEdit", "notebook_path"],
  ] as const)("denies %s outside the configured workspace before SDK permissions", async (toolName, pathKey) => {
    const fixture = createWorkspaceWriteFixture()
    try {
      const { factory, getOptions } = createQueryFactory()
      createSession(factory, { cwd: fixture.workspace })
      const guard = preToolUseHook(getOptions(), "*")

      await expect(workspaceWriteGuard(guard, toolName, pathKey, path.join(fixture.outside, "note.txt")))
        .resolves.toEqual(workspaceWriteDenied())
    } finally {
      fixture.cleanup()
    }
  })

  it("allows new and existing files under real workspace or additional-directory roots", async () => {
    const fixture = createWorkspaceWriteFixture()
    try {
      const existingPath = path.join(fixture.workspace, "existing.md")
      writeFileSync(existingPath, "existing")
      const { factory, getOptions } = createQueryFactory()
      createSession(factory, {
        cwd: fixture.workspace,
        additionalDirectories: [fixture.additional],
      })
      const guard = preToolUseHook(getOptions(), "*")

      await expect(workspaceWriteGuard(guard, "Write", "file_path", "new/deep/note.md"))
        .resolves.toEqual({})
      await expect(workspaceWriteGuard(guard, "Edit", "file_path", existingPath))
        .resolves.toEqual({})
      await expect(workspaceWriteGuard(
        guard,
        "Write",
        "file_path",
        path.join(fixture.additional, "note.md"),
      )).resolves.toEqual({})
    } finally {
      fixture.cleanup()
    }
  })

  it.skipIf(process.platform === "win32")("denies a new file through a workspace symlink directory", async () => {
    const fixture = createWorkspaceWriteFixture()
    try {
      const linkedDirectory = path.join(fixture.workspace, "linked-outside")
      symlinkSync(fixture.outside, linkedDirectory, "dir")
      const { factory, getOptions } = createQueryFactory()
      createSession(factory, { cwd: fixture.workspace })
      const guard = preToolUseHook(getOptions(), "*")

      await expect(workspaceWriteGuard(
        guard,
        "Write",
        "file_path",
        path.join(linkedDirectory, "new.md"),
      )).resolves.toEqual(workspaceWriteDenied())
    } finally {
      fixture.cleanup()
    }
  })

  it.skipIf(process.platform === "win32")("denies an existing workspace file symlink that resolves outside", async () => {
    const fixture = createWorkspaceWriteFixture()
    try {
      const outsideFile = path.join(fixture.outside, "outside.md")
      const linkedFile = path.join(fixture.workspace, "linked.md")
      writeFileSync(outsideFile, "outside")
      symlinkSync(outsideFile, linkedFile)
      const { factory, getOptions } = createQueryFactory()
      createSession(factory, { cwd: fixture.workspace })
      const guard = preToolUseHook(getOptions(), "*")

      await expect(workspaceWriteGuard(guard, "Edit", "file_path", linkedFile))
        .resolves.toEqual(workspaceWriteDenied())
    } finally {
      fixture.cleanup()
    }
  })

  it("fails closed when the target parent is not a directory or an authorized root cannot resolve", async () => {
    const fixture = createWorkspaceWriteFixture()
    try {
      const nonDirectoryParent = path.join(fixture.workspace, "not-a-directory")
      const missingAdditional = path.join(fixture.root, "missing-additional")
      writeFileSync(nonDirectoryParent, "file")
      const { factory, getOptions } = createQueryFactory()
      createSession(factory, {
        cwd: fixture.workspace,
        additionalDirectories: [missingAdditional],
      })
      const guard = preToolUseHook(getOptions(), "*")

      await expect(workspaceWriteGuard(
        guard,
        "Write",
        "file_path",
        path.join(nonDirectoryParent, "new.md"),
      )).resolves.toEqual(workspaceWriteDenied())
      await expect(workspaceWriteGuard(
        guard,
        "Write",
        "file_path",
        path.join(missingAdditional, "new.md"),
      )).resolves.toEqual(workspaceWriteDenied())
    } finally {
      fixture.cleanup()
    }
  })

  it("redacts secret-shaped env values in permission tool input summaries", async () => {
    const { factory, getOptions } = createQueryFactory()
    const session = createSession(factory)

    void canUseTool(getOptions())("Bash", {
      command: "ANTHROPIC_AUTH_TOKEN=sk-auth ANTHROPIC_API_KEY=sk-api SYNAPSE_SIDE_CHANNEL_TOKEN=side-token curl -H 'Authorization: Bearer sk-bearer' http://127.0.0.1",
    }, {
      signal: new AbortController().signal,
    })

    const event = await session.nextEvent()
    expect(event?.type).toBe("permissionRequest")
    const serialized = JSON.stringify(event)
    expect(serialized).toContain("[redacted]")
    expect(serialized).not.toContain("sk-auth")
    expect(serialized).not.toContain("sk-api")
    expect(serialized).not.toContain("side-token")
    expect(serialized).not.toContain("sk-bearer")
  })

  it("merges login shell PATH and Synapse node fallback into SDK env", () => {
    withProcessPlatform("darwin", () => {
      const { factory, getOptions } = createQueryFactory()
      createSession(factory, {
        env: { FOO: "bar" },
        hostEnv: {
          PATH: "/usr/bin:/bin",
          HOME: "/Users/ada",
        },
        resolveShellPath: () => "/opt/homebrew/bin:/usr/local/bin:/usr/bin",
        nodeRuntimeBinPath: "/Users/ada/Library/Application Support/Synapse/runtime-bin",
      })

      expect(getOptions().env).toEqual(expect.objectContaining({
        PATH: "/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin:/Users/ada/Library/Application Support/Synapse/runtime-bin",
        FOO: "bar",
      }))
    })
  })

  it.each(packagedRuntimeCases)(
    "uses the unpacked Claude binary for $platform-$arch packaged apps",
    async ({ platform, arch, packageName, binaryName }) => {
      await withPackagedRuntime({
        platform,
        arch,
        files: [["node_modules", packageName, binaryName]],
      }, ({ unpackedPath }) => {
        const { factory, getOptions } = createQueryFactory()
        createSession(factory)

        expect(getOptions().pathToClaudeCodeExecutable).toBe(
          unpackedPath("node_modules", packageName, binaryName),
        )
      })
    },
  )

  it("prefers the Linux musl unpacked Claude binary when both Linux variants exist", async () => {
    await withPackagedRuntime({
      platform: "linux",
      arch: "x64",
      files: [
        ["node_modules", "@anthropic-ai/claude-agent-sdk-linux-x64-musl", "claude"],
        ["node_modules", "@anthropic-ai/claude-agent-sdk-linux-x64", "claude"],
      ],
    }, ({ unpackedPath }) => {
      const { factory, getOptions } = createQueryFactory()
      createSession(factory)

      expect(getOptions().pathToClaudeCodeExecutable).toBe(
        unpackedPath("node_modules", "@anthropic-ai/claude-agent-sdk-linux-x64-musl", "claude"),
      )
    })
  })

  it("emits a clear packaged runtime error when the unpacked Claude binary is missing", async () => {
    await withPackagedRuntime({
      platform: "darwin",
      arch: "arm64",
      files: [],
    }, async () => {
      let factoryCalled = false
      const factory: QueryFactory = () => {
        factoryCalled = true
        return new FakeQuery()
      }

      const session = createSession(factory)
      const event = await resolveSoon(session.nextEvent())

      expect(factoryCalled).toBe(false)
      expect(event).toMatchObject({
        type: "error",
        message: expect.stringContaining("内置 Claude Code runtime 缺失"),
      })
    })
  })

  it("nextEvent returns bridged SDK messages", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory)

    const event = session.nextEvent()
    query.push({
      type: "system",
      subtype: "init",
      session_id: "sdk-1",
      tools: ["Read"],
      mcp_servers: [],
    } as unknown as SDKMessage)

    await expect(event).resolves.toMatchObject({
      type: "sessionInit",
      conversationId: "conversation-1",
      providerId: "claude-sdk",
      sdkSessionId: "sdk-1",
      timestamp: "2026-05-13T00:00:00.000Z",
      tools: ["Read"],
    })
    expect(session.currentSessionId()).toBe("sdk-1")
  })

  it("publishes realtime main-thread context snapshots and persists the final snapshot", async () => {
    const getContextUsage = vi.fn(async () => ({
      totalTokens: 87_400,
      maxTokens: 200_000,
      model: "claude-sonnet-4-5",
    }))
    const { factory, query } = createQueryFactory({ getContextUsage: getContextUsage as never })
    const session = createSession(factory)

    const assistantEvent = session.nextEvent()
    query.push({
      type: "assistant",
      session_id: "sdk-context",
      parent_tool_use_id: null,
      message: {
        role: "assistant",
        model: "claude-sonnet-4-5",
        content: [],
        usage: {
          input_tokens: 100,
          cache_read_input_tokens: 20,
          cache_creation_input_tokens: 10,
          output_tokens: 5,
        },
      },
    } as unknown as SDKMessage)
    await expect(assistantEvent).resolves.toMatchObject({
      type: "assistant",
      contextUsage: { usedTokens: 135, model: "claude-sonnet-4-5" },
    })

    const deltaEvent = session.nextEvent()
    query.push({
      type: "stream_event",
      session_id: "sdk-context",
      parent_tool_use_id: null,
      event: {
        type: "message_delta",
        usage: { output_tokens: 25 },
      },
    } as unknown as SDKMessage)
    await expect(deltaEvent).resolves.toMatchObject({
      type: "stream",
      contextUsage: { usedTokens: 155, model: "claude-sonnet-4-5" },
    })

    const compactEvent = session.nextEvent()
    query.push({
      type: "system",
      subtype: "compact_boundary",
      session_id: "sdk-context",
      compact_metadata: { pre_tokens: 155, post_tokens: 60 },
    } as unknown as SDKMessage)
    await expect(compactEvent).resolves.toMatchObject({
      type: "compactBoundary",
      contextUsage: {
        usedTokens: 87_400,
        contextWindowTokens: 200_000,
        model: "claude-sonnet-4-5",
      },
    })
    expect(getContextUsage).toHaveBeenCalledOnce()

    const resultEvent = session.nextEvent()
    query.push({
      type: "result",
      subtype: "success",
      session_id: "sdk-context",
      result: "done",
      modelUsage: {
        "claude-sonnet-4-5": { contextWindow: 200_000 },
      },
    } as unknown as SDKMessage)
    await expect(resultEvent).resolves.toMatchObject({
      type: "result",
      metadata: {
        contextUsage: {
          usedTokens: 87_400,
          contextWindowTokens: 200_000,
          model: "claude-sonnet-4-5",
        },
      },
    })
  })

  it("projects catalog reference metadata without replacing the SDK runtime window", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory, {
      contextWindowConfigurationSource: "catalog",
      modelContext: {
        providerScopeId: "bailian-cn",
        modelId: "qwen3.7-plus",
        contextWindowTokens: 1_000_000,
        maxInputTokens: 991_808,
        sourceLabel: "Alibaba Cloud Model Studio",
        sourceUrl: "https://help.aliyun.com/zh/model-studio/qwen3-7-plus",
        verifiedAt: "2026-08-25T00:00:00.000Z",
      },
    })

    const assistantEvent = session.nextEvent()
    query.push({
      type: "assistant",
      session_id: "sdk-context-reference",
      parent_tool_use_id: null,
      message: {
        role: "assistant",
        model: "qwen3.7-plus",
        content: [],
        usage: { input_tokens: 35_000, output_tokens: 333 },
      },
    } as unknown as SDKMessage)
    await expect(assistantEvent).resolves.toMatchObject({
      contextUsage: {
        usedTokens: 35_333,
        contextWindowConfigurationSource: "catalog",
        modelContext: { contextWindowTokens: 1_000_000 },
      },
    })

    const resultEvent = session.nextEvent()
    query.push({
      type: "result",
      subtype: "success",
      session_id: "sdk-context-reference",
      result: "done",
      modelUsage: { "qwen3.7-plus": { contextWindow: 200_000 } },
    } as unknown as SDKMessage)
    await expect(resultEvent).resolves.toMatchObject({
      metadata: {
        contextUsage: {
          contextWindowTokens: 200_000,
          modelContext: { contextWindowTokens: 1_000_000 },
        },
      },
    })
  })

  it("does not expose compact summary tokens when the SDK context refresh fails", async () => {
    const logger = { warn: vi.fn() }
    const getContextUsage = vi.fn(async () => {
      throw new Error("context usage unavailable")
    })
    const { factory, query } = createQueryFactory({ getContextUsage })
    const session = createSession(factory, { logger })

    const assistantEvent = session.nextEvent()
    query.push({
      type: "assistant",
      session_id: "sdk-context-fallback",
      parent_tool_use_id: null,
      message: {
        role: "assistant",
        model: "qwen3.7-plus",
        content: [],
        usage: { input_tokens: 90_000, output_tokens: 848 },
      },
    } as unknown as SDKMessage)
    await expect(assistantEvent).resolves.toMatchObject({
      contextUsage: { usedTokens: 90_848 },
    })

    const compactEvent = session.nextEvent()
    query.push({
      type: "system",
      subtype: "compact_boundary",
      session_id: "sdk-context-fallback",
      compact_metadata: { pre_tokens: 90_848, post_tokens: 416 },
    } as unknown as SDKMessage)
    await expect(compactEvent).resolves.not.toHaveProperty("contextUsage")
    expect(getContextUsage).toHaveBeenCalledOnce()
    expect(logger.warn).toHaveBeenCalledWith(
      "Claude SDK context usage refresh failed after compaction.",
      expect.objectContaining({ boundary: "claude-sdk-context-usage" }),
    )
  })

  it("maps SDK tool result ids back to the tool name for timeline display", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory)

    const assistantEvent = session.nextEvent()
    query.push({
      type: "assistant",
      session_id: "sdk-tools",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "toolu-read-1",
            name: "Read",
            input: {
              file_path: "/tmp/project/README.md",
            },
          },
        ],
      },
    } as unknown as SDKMessage)

    await expect(assistantEvent).resolves.toMatchObject({ type: "assistant" })
    await expect(session.nextEvent()).resolves.toMatchObject({
      type: "toolUse",
      toolName: "Read",
    })

    const resultEvent = session.nextEvent()
    query.push({
      type: "user",
      session_id: "sdk-tools",
      message: {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu-read-1",
            content: "file contents",
            is_error: false,
          },
        ],
      },
    } as unknown as SDKMessage)

    await expect(resultEvent).resolves.toMatchObject({
      type: "toolResult",
      toolName: "Read",
      content: "file contents",
    })
  })

  it("projects routed invoke tool use and result events to the original Synapse tool", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory, { synapseToolRouter: toolRouterOptions() })
    query.push({
      type: "assistant",
      session_id: "sdk-router",
      parent_tool_use_id: null,
      message: {
        role: "assistant",
        content: [{
          type: "tool_use",
          id: "tool-router-1",
          name: "mcp__synapse-tool-router__invoke",
          input: {
            toolName: "app_database_table_list",
            arguments: { includeSystem: false },
          },
        }],
      },
    } as unknown as SDKMessage)

    await expect(session.nextEvent()).resolves.toMatchObject({
      type: "assistant",
      message: {
        content: [{
          name: "mcp__synapse-mcp__app_database_table_list",
          input: { includeSystem: false },
        }],
      },
    })
    await expect(session.nextEvent()).resolves.toMatchObject({
      type: "toolUse",
      toolUseId: "tool-router-1",
      toolName: "mcp__synapse-mcp__app_database_table_list",
      toolInputRaw: { includeSystem: false },
    })

    query.push({
      type: "user",
      session_id: "sdk-router",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "tool-router-1",
          content: "[]",
        }],
      },
    } as unknown as SDKMessage)
    await expect(session.nextEvent()).resolves.toMatchObject({
      type: "toolResult",
      toolUseId: "tool-router-1",
      toolName: "mcp__synapse-mcp__app_database_table_list",
    })
  })

  it("emits one visible fallback event without exposing discovery configuration", async () => {
    const { factory, getSynapseToolRouter } = createQueryFactory()
    const session = createSession(factory, { synapseToolRouter: toolRouterOptions() })

    getSynapseToolRouter().onFallback?.("unsupported-server-config")
    getSynapseToolRouter().onFallback?.("discovery-failed")

    await expect(session.nextEvent()).resolves.toEqual(expect.objectContaining({
      type: "sdkEvent",
      sdkType: "synapseToolRouterFallback",
      payload: {},
    }))
    await expect(resolveSoon(session.nextEvent())).resolves.toBe("timeout")
  })

  it("projects controlled attachment paths out of SDK tool events", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory)
    const controlledPath = "/controlled/draft/image-1/original.png"
    await session.send({
      ...message("分析图片"),
      runtimeAttachmentDirectories: ["/controlled/draft"],
      attachments: [{
        kind: "path",
        path: controlledPath,
        entryType: "image",
        name: "screen.png",
      }],
    })

    const assistantEvent = session.nextEvent()
    query.push({
      type: "assistant",
      session_id: "sdk-tools",
      message: {
        role: "assistant",
        content: [{
          type: "tool_use",
          id: "toolu-read-attachment",
          name: "Read",
          input: { file_path: controlledPath },
        }],
      },
    } as unknown as SDKMessage)

    expect(JSON.stringify(await assistantEvent)).not.toContain(controlledPath)
    const toolEvent = await session.nextEvent()
    expect(toolEvent).toMatchObject({
      type: "toolUse",
      toolName: "Read",
      toolInputRaw: { file_path: "[Synapse attachment: screen.png]" },
    })
    expect(JSON.stringify(toolEvent)).not.toContain(controlledPath)

    const rootAssistantEvent = session.nextEvent()
    query.push({
      type: "assistant",
      session_id: "sdk-tools",
      message: {
        role: "assistant",
        content: [{
          type: "tool_use",
          id: "toolu-glob-attachment-root",
          name: "Glob",
          input: { path: "/controlled/draft", pattern: "**/*" },
        }],
      },
    } as unknown as SDKMessage)

    expect(JSON.stringify(await rootAssistantEvent)).not.toContain("/controlled/draft")
    const rootToolEvent = await session.nextEvent()
    expect(rootToolEvent).toMatchObject({
      type: "toolUse",
      toolName: "Glob",
      toolInputRaw: { path: "[Synapse attachment root]", pattern: "**/*" },
    })
    expect(JSON.stringify(rootToolEvent)).not.toContain("/controlled/draft")

    const streamEvent = session.nextEvent()
    query.push({
      type: "stream_event",
      session_id: "sdk-tools",
      event: {
        type: "content_block_delta",
        index: 0,
        delta: {
          type: "input_json_delta",
          partial_json: `{"file_path":"${controlledPath}"}`,
        },
      },
    } as unknown as SDKMessage)

    const streamed = await streamEvent
    expect(streamed).toMatchObject({
      type: "stream",
      deltaType: "input_json_delta",
    })
    expect(streamed).not.toHaveProperty("partialJson")
    expect(JSON.stringify(streamed)).not.toContain(controlledPath)
  })

  it("cancelCurrentTurn interrupts an alive query", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory)

    await expect(session.cancelCurrentTurn()).resolves.toBe(true)
    expect(query.interrupt).toHaveBeenCalledOnce()
  })

  it("forwards permission mode switches to the SDK query", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory)

    await session.setPermissionMode("acceptEdits")

    expect(query.setPermissionMode).toHaveBeenCalledWith("acceptEdits")
  })

  it("rejects invalid runtime permission modes", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory)

    await expect(session.setPermissionMode("free-for-all")).rejects.toThrow(
      "Unsupported permission mode: free-for-all",
    )
    expect(query.setPermissionMode).not.toHaveBeenCalled()
  })

  it("close closes the SDK query", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory)

    await session.close()

    expect(query.close).toHaveBeenCalledOnce()
    expect(session.alive()).toBe(false)
  })

  it("canUseTool enqueues a pending permission and resolves after respondPermission", async () => {
    const { factory, getOptions } = createQueryFactory()
    const session = createSession(factory)

    const canUseTool = getOptions().canUseTool as (
      toolName: string,
      input: Record<string, unknown>,
      context: { signal: AbortSignal },
    ) => Promise<PermissionResult>
    const permission = canUseTool("Bash", { command: "pwd" }, {
      signal: new AbortController().signal,
    })

    const event = await session.nextEvent()

    expect(event).toMatchObject({
      type: "permissionRequest",
      requestId: expect.any(String),
      toolName: "Bash",
      toolInput: "pwd",
      toolInputRaw: { command: "pwd" },
      conversationId: "conversation-1",
      providerId: "claude-sdk",
      timestamp: "2026-05-13T00:00:00.000Z",
    })

    if (event?.type !== "permissionRequest") {
      throw new Error("expected permission request")
    }
    await session.respondPermission(event.requestId, {
      behavior: "allow",
      updatedInput: { command: "pwd" },
    })

    await expect(permission).resolves.toEqual({
      behavior: "allow",
      updatedInput: { command: "pwd" },
    })
  })

  it("canUseTool returns the original input when allowed without updated input", async () => {
    const { factory, getOptions } = createQueryFactory()
    const session = createSession(factory)

    const input = { command: "pwd" }
    const permission = canUseTool(getOptions())("Bash", input, {
      signal: new AbortController().signal,
    })
    const event = await session.nextEvent()

    if (event?.type !== "permissionRequest") {
      throw new Error("expected permission request")
    }
    await session.respondPermission(event.requestId, {
      behavior: "allow",
    })

    await expect(permission).resolves.toEqual({
      behavior: "allow",
      updatedInput: input,
    })
  })

  it("projects routed invoke permissions to the original Synapse tool and wraps edited input", async () => {
    const { factory, getOptions } = createQueryFactory()
    const session = createSession(factory, { synapseToolRouter: toolRouterOptions() })
    const permission = canUseTool(getOptions())("mcp__synapse-tool-router__invoke", {
      toolName: "app_database_table_list",
      arguments: { includeSystem: false },
    }, { signal: new AbortController().signal })
    const event = await session.nextEvent()

    expect(event).toMatchObject({
      type: "permissionRequest",
      toolName: "mcp__synapse-mcp__app_database_table_list",
      toolInputRaw: { includeSystem: false },
    })
    if (event?.type !== "permissionRequest") throw new Error("expected permission request")
    await session.respondPermission(event.requestId, {
      behavior: "allow",
      updatedInput: { includeSystem: true },
    })

    await expect(permission).resolves.toEqual({
      behavior: "allow",
      updatedInput: {
        toolName: "app_database_table_list",
        arguments: { includeSystem: true },
      },
    })
  })

  it("enforces routed invoke permission modes against original action mutability", async () => {
    const signal = new AbortController().signal
    const plan = createQueryFactory()
    const planSession = createSession(plan.factory, { mode: "plan", synapseToolRouter: toolRouterOptions() })
    await expect(canUseTool(plan.getOptions())("mcp__synapse-tool-router__search", {
      query: "database",
    }, { signal })).resolves.toMatchObject({ behavior: "allow" })
    await expect(canUseTool(plan.getOptions())("mcp__synapse-tool-router__invoke", {
      toolName: "app_database_table_list",
      arguments: {},
    }, { signal })).resolves.toMatchObject({ behavior: "allow" })
    await expect(canUseTool(plan.getOptions())("mcp__synapse-tool-router__invoke", {
      toolName: "app_database_row_create",
      arguments: {},
    }, { signal })).resolves.toMatchObject({ behavior: "deny" })
    await expect(resolveSoon(planSession.nextEvent())).resolves.toBe("timeout")

    const dontAsk = createQueryFactory()
    createSession(dontAsk.factory, { mode: "dontAsk", synapseToolRouter: toolRouterOptions() })
    await expect(canUseTool(dontAsk.getOptions())("mcp__synapse-tool-router__invoke", {
      toolName: "app_database_table_list",
      arguments: {},
    }, { signal })).resolves.toMatchObject({ behavior: "deny" })

    const bypass = createQueryFactory()
    createSession(bypass.factory, { mode: "bypassPermissions", synapseToolRouter: toolRouterOptions() })
    await expect(canUseTool(bypass.getOptions())("mcp__synapse-tool-router__invoke", {
      toolName: "app_database_row_create",
      arguments: { tableName: "items" },
    }, { signal })).resolves.toEqual({
      behavior: "allow",
      updatedInput: {
        toolName: "app_database_row_create",
        arguments: { tableName: "items" },
      },
    })
  })

  it("enforces the original persona allowlist for routed invokes", async () => {
    const { factory, getOptions } = createQueryFactory()
    const session = createSession(factory, {
      synapseToolRouter: toolRouterOptions(),
      personaToolPolicy: {
        mode: "allowlist",
        allowedTools: ["mcp__synapse-mcp__app_database_table_list"],
      },
    })

    await expect(canUseTool(getOptions())("mcp__synapse-tool-router__invoke", {
      toolName: "app_database_row_create",
      arguments: {},
    }, { signal: new AbortController().signal })).resolves.toMatchObject({ behavior: "deny" })
    await expect(resolveSoon(session.nextEvent())).resolves.toBe("timeout")
  })

  it("returns only SDK-suggested directory updates for session permission scope", async () => {
    const grantAdditionalDirectories = vi.fn(async (_directories: readonly string[]) => {})
    const { factory, getOptions } = createQueryFactory({ grantAdditionalDirectories })
    const session = createSession(factory)
    const input = { command: "cat /Users/liyang/Downloads/report.md" }
    const permission = canUseTool(getOptions())("Bash", input, {
      signal: new AbortController().signal,
      blockedPath: "/Users/liyang/Downloads/report.md",
      suggestions: [
        {
          type: "addRules",
          rules: [{ toolName: "Bash", ruleContent: "cat *" }],
          behavior: "allow",
          destination: "localSettings",
        },
        {
          type: "addDirectories",
          directories: [
            "/Users/liyang/Downloads",
            "/Users/liyang/Downloads/reports",
          ],
          destination: "localSettings",
        },
      ],
    })
    const event = await session.nextEvent()

    expect(event).toMatchObject({
      type: "permissionRequest",
      blockedPath: "/Users/liyang/Downloads/report.md",
      sessionDirectoryGrantAvailable: true,
    })
    expect(JSON.stringify(event)).not.toContain("addDirectories")
    if (event?.type !== "permissionRequest") throw new Error("expected permission request")

    await session.respondPermission(event.requestId, {
      behavior: "allow",
      scope: "session",
    })

    await expect(permission).resolves.toEqual({
      behavior: "allow",
      updatedInput: input,
      updatedPermissions: [{
        type: "addDirectories",
        directories: ["/Users/liyang/Downloads"],
        destination: "session",
      }],
    })

    await session.grantAdditionalDirectories(["/Users/liyang/Desktop"])
    expect(grantAdditionalDirectories).toHaveBeenCalledWith([
      "/Users/liyang/Downloads",
      "/Users/liyang/Desktop",
    ])
  })

  it("rejects session permission scope without an SDK directory suggestion", async () => {
    const { factory, getOptions } = createQueryFactory()
    const session = createSession(factory)
    const permission = canUseTool(getOptions())("Bash", { command: "pwd" }, {
      signal: new AbortController().signal,
      blockedPath: "/Users/liyang/Downloads/report.md",
    })
    const event = await session.nextEvent()
    if (event?.type !== "permissionRequest") throw new Error("expected permission request")

    await expect(session.respondPermission(event.requestId, {
      behavior: "allow",
      scope: "session",
    })).rejects.toThrow("当前权限请求不支持会话级目录授权")
    await session.respondPermission(event.requestId, { behavior: "allow", scope: "once" })
    await expect(permission).resolves.toEqual({
      behavior: "allow",
      updatedInput: { command: "pwd" },
    })
  })

  it("canUseTool returns the original ExitPlanMode input when allowed", async () => {
    const { factory, getOptions } = createQueryFactory()
    const session = createSession(factory)

    const input = {
      plan: "# Plan",
      planFilePath: "/Users/liyang/.claude/plans/example.md",
      allowedPrompts: [
        { tool: "Bash", prompt: "List files" },
      ],
    }
    const permission = canUseTool(getOptions())("ExitPlanMode", input, {
      signal: new AbortController().signal,
    })
    const event = await session.nextEvent()

    expect(event).toMatchObject({
      type: "permissionRequest",
      toolName: "ExitPlanMode",
      toolInputRaw: input,
    })

    if (event?.type !== "permissionRequest") {
      throw new Error("expected permission request")
    }
    await session.respondPermission(event.requestId, {
      behavior: "allow",
    })

    await expect(permission).resolves.toEqual({
      behavior: "allow",
      updatedInput: input,
    })
  })

  it("canUseTool forwards AskUserQuestion as a structured user question request", async () => {
    const { factory, getOptions } = createQueryFactory()
    const session = createSession(factory)
    const questionInput = {
      questions: [{
        id: "question-id",
        key: "question-key",
        question: "该怎么处理？",
        header: "处理方式",
        options: [
          { label: "跳过", description: "保持现状" },
          { label: "重试", description: "重新处理" },
        ],
        multiSelect: false,
      }],
    }

    const canUseTool = getOptions().canUseTool as (
      toolName: string,
      input: Record<string, unknown>,
      context: { signal: AbortSignal },
    ) => Promise<PermissionResult>
    const permission = canUseTool("AskUserQuestion", questionInput, {
      signal: new AbortController().signal,
    })

    const event = await session.nextEvent()

    expect(event).toMatchObject({
      type: "permissionRequest",
      requestId: expect.any(String),
      toolName: "AskUserQuestion",
      questions: questionInput.questions,
      toolInputRaw: questionInput,
      conversationId: "conversation-1",
      providerId: "claude-sdk",
      timestamp: "2026-05-13T00:00:00.000Z",
    })

    if (event?.type !== "permissionRequest") {
      throw new Error("expected user question request")
    }
    const updatedInput = {
      questions: questionInput.questions,
      answers: { "该怎么处理？": "重试" },
    }
    await session.respondPermission(event.requestId, {
      behavior: "allow",
      updatedInput,
    })

    await expect(permission).resolves.toEqual({
      behavior: "allow",
      updatedInput,
    })
  })

  it("canUseTool rejects AskUserQuestion options with duplicate labels", async () => {
    const { factory, getOptions } = createQueryFactory()
    createSession(factory)
    const canUseTool = getOptions().canUseTool as (
      toolName: string,
      input: Record<string, unknown>,
      context: { signal: AbortSignal },
    ) => Promise<PermissionResult>

    await expect(canUseTool("AskUserQuestion", {
      questions: [{
        question: "该怎么处理？",
        options: [
          { label: "重试", description: "重新处理" },
          { label: "重试", description: "再次尝试" },
        ],
        multiSelect: true,
      }],
    }, {
      signal: new AbortController().signal,
    })).resolves.toEqual({
      behavior: "deny",
      message: "用户确认请求格式无效，已停止本次操作。",
    })
  })

  it("rejects stale permission responses when the SDK pending request is missing", async () => {
    const { factory } = createQueryFactory()
    const logger = { warn: vi.fn() }
    const session = createSession(factory, { logger, sdkSessionId: "sdk-1" })

    await expect(session.respondPermission("conversation-1-permission-stale", {
      behavior: "deny",
      message: "denied because prompt contained secret",
    })).rejects.toThrow("该权限请求已不在等待中。")

    expect(logger.warn).toHaveBeenCalledWith("Claude SDK permission response rejected.", {
      boundary: "claude-sdk-permission-response",
      projectId: "project-1",
      conversationId: "conversation-1",
      providerId: "claude-sdk",
      sdkSessionId: "sdk-1",
      requestId: "conversation-1-permission-stale",
      behavior: "deny",
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("prompt contained secret")
  })

  it("redacts and bounds permission request tool input summaries and raw event input", async () => {
    const { factory, getOptions } = createQueryFactory()
    const session = createSession(factory)

    void canUseTool(getOptions())("HttpRequest", {
      authorization: "Bearer sk-live",
      headers: { cookie: "sid=secret" },
      nested: { password: "pass-1", value: "safe" },
      body: "x".repeat(400),
    }, {
      signal: new AbortController().signal,
    })

    const event = await session.nextEvent()

    expect(event?.type).toBe("permissionRequest")
    if (event?.type !== "permissionRequest") {
      throw new Error("expected permission request")
    }
    expect(event.toolInput).toContain("[redacted]")
    expect(event.toolInput).toContain("\"value\":\"safe\"")
    expect(event.toolInput).not.toContain("Bearer sk-live")
    expect(event.toolInput).not.toContain("sid=secret")
    expect(event.toolInput).not.toContain("pass-1")
    expect(event.toolInput).not.toContain("x".repeat(200))
    expect(event.toolInputRaw).toMatchObject({
      authorization: "[redacted]",
      headers: { cookie: "[redacted]" },
      nested: { password: "[redacted]", value: "safe" },
    })
    expect(JSON.stringify(event)).not.toContain("Bearer sk-live")
    expect(JSON.stringify(event)).not.toContain("sid=secret")
    expect(JSON.stringify(event)).not.toContain("pass-1")
  })

  it("redacts Bash permission request header and cookie secrets", async () => {
    const { factory, getOptions } = createQueryFactory()
    const session = createSession(factory)

    void canUseTool(getOptions())("Bash", {
      command: "curl -H 'Authorization: Bearer sk-command' --cookie sid=command https://example.test",
    }, {
      signal: new AbortController().signal,
    })

    const event = await session.nextEvent()

    expect(event?.type).toBe("permissionRequest")
    if (event?.type !== "permissionRequest") {
      throw new Error("expected permission request")
    }
    expect(event.toolInput).toContain("[redacted]")
    expect(event.toolInput).not.toContain("sk-command")
    expect(event.toolInput).not.toContain("sid=command")
    expect(event.toolInputRaw).toMatchObject({
      command: expect.stringContaining("[redacted]"),
    })
    expect(JSON.stringify(event)).not.toContain("sk-command")
    expect(JSON.stringify(event)).not.toContain("sid=command")
  })

  it("preserves local paths in permission request summaries and raw event input", async () => {
    const { factory, getOptions } = createQueryFactory()
    const session = createSession(factory)

    void canUseTool(getOptions())("Read", {
      file_path: "/Users/liyang/private/project/secret.ts",
      windowsPath: "C:\\Users\\liyang\\private\\secret.txt",
      nested: {
        cwd: "/Users/liyang/private/project",
      },
    }, {
      signal: new AbortController().signal,
    })

    const event = await session.nextEvent()

    expect(event?.type).toBe("permissionRequest")
    if (event?.type !== "permissionRequest") {
      throw new Error("expected permission request")
    }
    expect(event.toolInput).toContain("/Users/liyang/private/project/secret.ts")
    expect(event.toolInput).toContain("C:\\\\Users\\\\liyang\\\\private\\\\secret.txt")
    expect(event.toolInputRaw).toMatchObject({
      file_path: "/Users/liyang/private/project/secret.ts",
      windowsPath: "C:\\Users\\liyang\\private\\secret.txt",
      nested: {
        cwd: "/Users/liyang/private/project",
      },
    })
    expect(JSON.stringify(event)).toContain("/Users/liyang/private")
    expect(JSON.stringify(event)).toContain("C:\\\\Users\\\\liyang")
  })

  it("generates permission request ids that are unique across conversations", async () => {
    const first = createQueryFactory()
    const second = createQueryFactory()
    const sessionA = createSession(first.factory, { conversationId: "conversation-a" })
    const sessionB = createSession(second.factory, { conversationId: "conversation-b" })

    void canUseTool(first.getOptions())("Bash", { command: "pwd" }, {
      signal: new AbortController().signal,
    })
    void canUseTool(second.getOptions())("Bash", { command: "pwd" }, {
      signal: new AbortController().signal,
    })

    const eventA = await sessionA.nextEvent()
    const eventB = await sessionB.nextEvent()

    expect(eventA).toMatchObject({
      type: "permissionRequest",
      conversationId: "conversation-a",
      requestId: expect.stringContaining("conversation-a"),
    })
    expect(eventB).toMatchObject({
      type: "permissionRequest",
      conversationId: "conversation-b",
      requestId: expect.stringContaining("conversation-b"),
    })
    expect(eventA?.type).toBe("permissionRequest")
    expect(eventB?.type).toBe("permissionRequest")
    if (eventA?.type !== "permissionRequest" || eventB?.type !== "permissionRequest") {
      throw new Error("Expected permission request events")
    }
    expect(eventA?.requestId).not.toBe(eventB?.requestId)
  })

  it("returns an error event when the SDK query rejects", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory)

    const event = session.nextEvent()
    query.rejectNext(new Error("sdk exploded"))

    await expect(event).resolves.toMatchObject({
      type: "error",
      message: "Agent 执行失败。诊断信息：sdk exploded",
      conversationId: "conversation-1",
      providerId: "claude-sdk",
      timestamp: "2026-05-13T00:00:00.000Z",
    })
    await expect(session.nextEvent()).resolves.toBeNull()
  })

  it("marks tool-use interrupted SDK query rejections as recoverable", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory)

    const event = session.nextEvent()
    query.rejectNext(new Error("[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use"))

    await expect(event).resolves.toMatchObject({
      type: "error",
      message: "Agent 在工具调用后中断，发送“继续”可接着执行。",
      errorKind: "tool_use_interrupted",
      recoverable: true,
      conversationId: "conversation-1",
      providerId: "claude-sdk",
    })
  })

  it("sanitizes SDK query rejection messages before publishing error events", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory, { sdkSessionId: "sdk-1" })

    const event = session.nextEvent()
    query.rejectNext(
      new Error(
        "Authorization: Bearer sk-secret failed in /Users/liyang/private/project/file.ts",
      ),
    )

    await expect(event).resolves.toMatchObject({
      type: "error",
      message: expect.stringContaining("[redacted]"),
      conversationId: "conversation-1",
      providerId: "claude-sdk",
      sdkSessionId: "sdk-1",
      timestamp: "2026-05-13T00:00:00.000Z",
    })
    const resolved = await event
    expect(JSON.stringify(resolved)).not.toContain("sk-secret")
    expect(JSON.stringify(resolved)).toContain("/Users/liyang/private")
  })

  it("logs SDK query rejection failures with session context", async () => {
    const { factory, query } = createQueryFactory()
    const logger = { warn: vi.fn() }
    const session = createSession(factory, {
      logger,
      sdkSessionId: "sdk-1",
    })

    const event = session.nextEvent()
    query.rejectNext(new Error("sdk exploded"))

    await expect(event).resolves.toMatchObject({
      type: "error",
      message: "Agent 执行失败。诊断信息：sdk exploded",
    })
    await waitFor(() => logger.warn.mock.calls.length > 0)

    expect(logger.warn).toHaveBeenCalledWith("Claude SDK query failed.", {
      boundary: "claude-sdk-query",
      conversationId: "conversation-1",
      errorLength: 12,
      errorName: "Error",
      projectId: "project-1",
      providerId: "claude-sdk",
      sdkSessionId: "sdk-1",
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sdk exploded")
  })

  it("logs connection interruptions without raw SDK diagnostics", async () => {
    const { factory, query } = createQueryFactory()
    const logger = { warn: vi.fn() }
    const session = createSession(factory, {
      logger,
      sdkSessionId: "sdk-1",
    })

    const event = session.nextEvent()
    query.push({
      type: "result",
      subtype: "success",
      session_id: "sdk-1",
      uuid: "result-disconnected",
      is_error: true,
      result: "API Error: Connection lost mid-response. Authorization: Bearer sk-secret",
      terminal_reason: "api_error",
      api_error_status: null,
    } as unknown as SDKMessage)

    await expect(event).resolves.toMatchObject({
      type: "error",
      errorKind: "connection_interrupted",
      recoverable: true,
    })
    expect(logger.warn).toHaveBeenCalledWith("Claude SDK connection interrupted.", {
      boundary: "claude-sdk-query.connection-interrupted",
      projectId: "project-1",
      conversationId: "conversation-1",
      providerId: "claude-sdk",
      sdkSessionId: "sdk-1",
      sdkResultUuid: "result-disconnected",
      terminalReason: "api_error",
      apiErrorStatus: undefined,
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("Connection lost mid-response")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sk-secret")
  })

  it("stays alive until queued terminal events are drained", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory)

    query.rejectNext(new Error("sdk exploded"))
    await waitFor(() => !query.hasWaiters())

    expect(session.alive()).toBe(true)
    await expect(session.nextEvent()).resolves.toMatchObject({
      type: "error",
      message: "Agent 执行失败。诊断信息：sdk exploded",
    })
    expect(session.alive()).toBe(false)
  })

  it("ignores sends after the SDK query has finished", async () => {
    const { factory, query } = createQueryFactory()
    const logger = { warn: vi.fn() }
    const session = createSession(factory, { logger, sdkSessionId: "sdk-1" })

    const event = session.nextEvent()
    query.rejectNext(new Error("sdk exploded"))
    await expect(event).resolves.toMatchObject({ type: "error" })
    expect(session.alive()).toBe(false)

    expect(session.finished).toBe(true)
    await expect(session.send(message("late message"))).resolves.toBe(false)
    expect(logger.warn).toHaveBeenCalledWith("Claude SDK send rejected after query finished.", {
      boundary: "claude-sdk-send",
      conversationId: "conversation-1",
      projectId: "project-1",
      providerId: "claude-sdk",
      sdkSessionId: "sdk-1",
    })
  })

  it("releases event waiters when SDK close throws", async () => {
    const { factory, query } = createQueryFactory()
    const session = createSession(factory)
    query.close.mockImplementation(() => {
      throw new Error("close failed")
    })

    const event = session.nextEvent()
    await expect(session.close()).resolves.toBeUndefined()

    await expect(event).resolves.toBeNull()
    expect(query.close).toHaveBeenCalledOnce()
    expect(session.alive()).toBe(false)
  })

  it("logs SDK query close failures with session context", async () => {
    const { factory, query } = createQueryFactory()
    const logger = { warn: vi.fn() }
    const session = createSession(factory, {
      logger,
      sdkSessionId: "sdk-1",
    })
    query.close.mockImplementation(() => {
      throw new Error("close failed")
    })

    await session.close()
    await waitFor(() => logger.warn.mock.calls.length > 0)

    expect(logger.warn).toHaveBeenCalledWith("Claude SDK query close failed.", {
      boundary: "claude-sdk-query.close",
      conversationId: "conversation-1",
      errorLength: 12,
      errorName: "Error",
      projectId: "project-1",
      providerId: "claude-sdk",
      sdkSessionId: "sdk-1",
    })
  })

  it("settles pending permission requests when cancelling the current turn", async () => {
    const { factory, getOptions, query } = createQueryFactory()
    const session = createSession(factory)

    const permission = canUseTool(getOptions())("Bash", { command: "pwd" }, {
      signal: new AbortController().signal,
    })
    const event = await session.nextEvent()

    await expect(session.cancelCurrentTurn()).resolves.toBe(true)

    expect(event?.type).toBe("permissionRequest")
    expect(query.interrupt).toHaveBeenCalledOnce()
    await expect(resolveSoon(permission)).resolves.toEqual({
      behavior: "deny",
      message: "本轮执行已停止，未继续等待权限确认。",
    })
  })

  it("cleans up forwarded abort listeners on close", async () => {
    const abortController = new AbortController()
    const remove = vi.spyOn(abortController.signal, "removeEventListener")
    const { factory, getOptions } = createQueryFactory()
    const session = createSession(factory, { abortSignal: abortController.signal })

    await session.close()

    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function))
    expect((getOptions().abortController as AbortController).signal.aborted).toBe(true)
  })

  it("denies immediately when permission signal is already aborted", async () => {
    const { factory, getOptions } = createQueryFactory()
    const session = createSession(factory)
    const abortController = new AbortController()
    abortController.abort()

    await expect(resolveSoon(canUseTool(getOptions())("Bash", { command: "pwd" }, {
      signal: abortController.signal,
    }))).resolves.toEqual({
      behavior: "deny",
      message: "权限请求已取消。",
    })
  })
})

interface PackagedRuntimeCase {
  readonly platform: NodeJS.Platform
  readonly arch: NodeJS.Architecture
  readonly packageName: string
  readonly binaryName: string
}

const packagedRuntimeCases: readonly PackagedRuntimeCase[] = [
  {
    platform: "darwin",
    arch: "arm64",
    packageName: "@anthropic-ai/claude-agent-sdk-darwin-arm64",
    binaryName: "claude",
  },
  {
    platform: "win32",
    arch: "x64",
    packageName: "@anthropic-ai/claude-agent-sdk-win32-x64",
    binaryName: "claude.exe",
  },
  {
    platform: "linux",
    arch: "x64",
    packageName: "@anthropic-ai/claude-agent-sdk-linux-x64",
    binaryName: "claude",
  },
]

function withProcessPlatform(platform: NodeJS.Platform, run: () => void): void {
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")

  try {
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: platform,
    })

    run()
  } finally {
    if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor)
  }
}

async function withPackagedRuntime(
  options: {
    readonly platform: NodeJS.Platform
    readonly arch: NodeJS.Architecture
    readonly files: readonly (readonly string[])[]
  },
  run: (helpers: { unpackedPath(...segments: string[]): string }) => void | Promise<void>,
): Promise<void> {
  const resourcesPath = mkdtempSync(path.join(tmpdir(), "synapse-resources-"))
  const unpackedPath = (...segments: string[]): string =>
    path.join(resourcesPath, "app.asar.unpacked", ...segments)
  const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, "resourcesPath")
  const platformDescriptor = Object.getOwnPropertyDescriptor(process, "platform")
  const archDescriptor = Object.getOwnPropertyDescriptor(process, "arch")

  try {
    writeFileSync(path.join(resourcesPath, "app.asar"), "")
    for (const fileSegments of options.files) {
      const filePath = unpackedPath(...fileSegments)
      mkdirSync(path.dirname(filePath), { recursive: true })
      writeFileSync(filePath, "")
    }
    Object.defineProperty(process, "resourcesPath", {
      configurable: true,
      value: resourcesPath,
    })
    Object.defineProperty(process, "platform", {
      configurable: true,
      value: options.platform,
    })
    Object.defineProperty(process, "arch", {
      configurable: true,
      value: options.arch,
    })

    await run({ unpackedPath })
  } finally {
    if (resourcesDescriptor) {
      Object.defineProperty(process, "resourcesPath", resourcesDescriptor)
    } else {
      Reflect.deleteProperty(process, "resourcesPath")
    }
    if (platformDescriptor) Object.defineProperty(process, "platform", platformDescriptor)
    if (archDescriptor) Object.defineProperty(process, "arch", archDescriptor)
    rmSync(resourcesPath, { recursive: true, force: true })
  }
}

function createSession(
  queryFactory: QueryFactory,
  overrides: Partial<ConstructorParameters<typeof ClaudeSDKSession>[0]> = {},
): ClaudeSDKSession {
  return new ClaudeSDKSession({
    projectId: "project-1",
    conversationId: "conversation-1",
    providerId: "claude-sdk",
    cwd: "/tmp/project",
    env: { FOO: "bar" },
    queryFactory,
    now: () => new Date("2026-05-13T00:00:00.000Z"),
    ...overrides,
  })
}

function canUseTool(options: Record<string, unknown>): (
  toolName: string,
  input: Record<string, unknown>,
  context: {
    signal: AbortSignal
    suggestions?: PermissionUpdate[]
    blockedPath?: string
  },
) => Promise<PermissionResult> {
  return options.canUseTool as (
    toolName: string,
    input: Record<string, unknown>,
    context: {
      signal: AbortSignal
      suggestions?: PermissionUpdate[]
      blockedPath?: string
    },
  ) => Promise<PermissionResult>
}

function preToolUseHook(options: Record<string, unknown>, matcher = "TodoWrite"): (
  input: Record<string, unknown>,
) => Promise<unknown> {
  const hooks = options.hooks as {
    PreToolUse: Array<{ matcher?: string, hooks: [(
      input: Record<string, unknown>,
      toolUseID: string | undefined,
      context: { signal: AbortSignal },
    ) => Promise<unknown>] }>
  }
  const hook = hooks.PreToolUse.find((entry) => (entry.matcher ?? "*") === matcher)
  if (!hook) throw new Error(`missing PreToolUse hook: ${matcher}`)
  return (input) => hook.hooks[0](
    input,
    "toolu-todo",
    { signal: new AbortController().signal },
  )
}

function createWorkspaceWriteFixture(): {
  readonly root: string
  readonly workspace: string
  readonly additional: string
  readonly outside: string
  cleanup(): void
} {
  const root = mkdtempSync(path.join(tmpdir(), "synapse-agent-workspace-write-"))
  const workspace = path.join(root, "workspace")
  const additional = path.join(root, "additional")
  const outside = path.join(root, "outside")
  mkdirSync(workspace)
  mkdirSync(additional)
  mkdirSync(outside)
  return {
    root,
    workspace,
    additional,
    outside,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

function workspaceWriteGuard(
  guard: (input: Record<string, unknown>) => Promise<unknown>,
  toolName: string,
  pathKey: "file_path" | "notebook_path",
  requestedPath: string,
): Promise<unknown> {
  return guard({
    hook_event_name: "PreToolUse",
    tool_name: toolName,
    tool_input: { [pathKey]: requestedPath },
  })
}

function workspaceWriteDenied(): Record<string, unknown> {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "文件写入仅允许当前项目或已明确授权的附加目录。",
    },
  }
}

function todoWriteHookInput(toolInput: Record<string, unknown>): Record<string, unknown> {
  return {
    hook_event_name: "PreToolUse",
    tool_name: "TodoWrite",
    tool_input: toolInput,
  }
}

function message(content: string): AgentMessage {
  return {
    projectId: "project-1",
    sessionKey: "session-1",
    platform: "test",
    content,
  }
}

function resolveSoon<T>(promise: Promise<T>): Promise<T | "timeout"> {
  return Promise.race([
    promise,
    new Promise<"timeout">((resolve) => {
      setTimeout(() => resolve("timeout"), 20)
    }),
  ])
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (condition()) return
    await new Promise((resolve) => {
      setTimeout(resolve, 0)
    })
  }
  throw new Error("condition was not met")
}

function createQueryFactory(overrides: Partial<QueryLike> = {}): {
  readonly factory: QueryFactory
  readonly query: FakeQuery
  getPrompt(): AsyncIterable<SDKUserMessage>
  getOptions(): Record<string, unknown>
  getSynapseToolRouter(): NonNullable<Parameters<QueryFactory>[0]["synapseToolRouter"]>
} {
  const query = Object.assign(new FakeQuery(), overrides)
  let prompt: AsyncIterable<SDKUserMessage> | undefined
  let options: Record<string, unknown> | undefined
  let synapseToolRouter: Parameters<QueryFactory>[0]["synapseToolRouter"]
  const factory: QueryFactory = (input) => {
    prompt = input.prompt
    options = input.options
    synapseToolRouter = input.synapseToolRouter
    return query
  }

  return {
    factory,
    query,
    getPrompt() {
      if (!prompt) throw new Error("queryFactory was not called")
      return prompt
    },
    getOptions() {
      if (!options) throw new Error("queryFactory was not called")
      return options
    },
    getSynapseToolRouter() {
      if (!synapseToolRouter) throw new Error("queryFactory was not called with a Synapse tool router")
      return synapseToolRouter
    },
  }
}

function toolRouterOptions(): NonNullable<ConstructorParameters<typeof ClaudeSDKSession>[0]["synapseToolRouter"]> {
  return {
    cwd: "/tmp/project",
    settingSources: ["user", "project", "local"],
    executeTool: vi.fn(),
  }
}

class FakeQuery implements QueryLike {
  readonly interrupt = vi.fn(async () => {})
  readonly close = vi.fn()
  readonly setPermissionMode = vi.fn(async (_mode: string) => {})

  private readonly messages: SDKMessage[] = []
  private readonly waiters: Array<(value: IteratorResult<SDKMessage, void>) => void> = []
  private readonly rejecters: Array<(error: unknown) => void> = []

  push(message: SDKMessage): void {
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ done: false, value: message })
      return
    }
    this.messages.push(message)
  }

  next(): Promise<IteratorResult<SDKMessage, void>> {
    const message = this.messages.shift()
    if (message) return Promise.resolve({ done: false, value: message })
    return new Promise((resolve, reject) => {
      this.waiters.push(resolve)
      this.rejecters.push(reject)
    })
  }

  rejectNext(error: unknown): void {
    const reject = this.rejecters.shift()
    this.waiters.shift()
    if (reject) reject(error)
  }

  hasWaiters(): boolean {
    return this.waiters.length > 0
  }
}

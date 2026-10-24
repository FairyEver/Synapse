import { EventEmitter } from "node:events"
import type { ChildProcess } from "node:child_process"
import { PassThrough } from "node:stream"
import { access, mkdtemp, mkdir, open, readdir, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { runNodeCliScript } from "../node-cli-runner"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("runNodeCliScript", () => {
  it("rejects non-strict input without invoking toJSON or spawning Node.js", async () => {
    let toJsonCalls = 0
    const input = { retained: true }
    Object.defineProperty(input, "toJSON", {
      enumerable: false,
      value() {
        toJsonCalls += 1
        return { rewritten: true }
      },
    })
    const spawnProcess = vi.fn()

    const outcome = await runNodeCliScript({
      source: "process.stdout.write('null')",
      input,
      timeoutSeconds: 5,
      abortSignal: new AbortController().signal,
      cwd: "/workspace",
      moduleMode: "commonjs",
    }, {
      executablePath: process.execPath,
      baseEnv: process.env,
      spawnProcess: spawnProcess as never,
    })

    expect(outcome).toMatchObject({ status: "failed", code: "INVALID_INPUT" })
    expect(toJsonCalls).toBe(0)
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it("rejects an accessor without invoking its getter or touching runtime resources", async () => {
    let getterCalls = 0
    const input = {}
    Object.defineProperty(input, "value", {
      enumerable: true,
      get() {
        getterCalls += 1
        return 1
      },
    })
    const accessPath = vi.fn()
    const openFile = vi.fn()
    const spawnProcess = vi.fn()

    const outcome = await runNodeCliScript({
      source: "process.stdout.write('null')",
      input,
      timeoutSeconds: 5,
      abortSignal: new AbortController().signal,
      cwd: "/workspace",
      moduleMode: "commonjs",
    }, {
      executablePath: process.execPath,
      baseEnv: process.env,
      accessPath,
      openFile: openFile as never,
      spawnProcess: spawnProcess as never,
    })

    expect(outcome).toMatchObject({ status: "failed", code: "INVALID_INPUT" })
    expect(getterCalls).toBe(0)
    expect(accessPath).not.toHaveBeenCalled()
    expect(openFile).not.toHaveBeenCalled()
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it.each([null, "text", 7, [1]])(
    "rejects a non-object top-level input before touching runtime resources",
    async (input) => {
      const accessPath = vi.fn()
      const openFile = vi.fn()
      const spawnProcess = vi.fn()
      const outcome = await runNodeCliScript({
        source: "process.stdout.write('null')",
        input: input as never,
        timeoutSeconds: 5,
        abortSignal: new AbortController().signal,
        cwd: "/workspace",
        moduleMode: "commonjs",
      }, {
        executablePath: process.execPath,
        baseEnv: process.env,
        accessPath,
        openFile: openFile as never,
        spawnProcess: spawnProcess as never,
      })

      expect(outcome).toMatchObject({ status: "failed", code: "INVALID_INPUT" })
      expect(accessPath).not.toHaveBeenCalled()
      expect(openFile).not.toHaveBeenCalled()
      expect(spawnProcess).not.toHaveBeenCalled()
    },
  )

  it.each(["root", "nested"] as const)(
    "rejects a %s Proxy without invoking any trap or touching runtime resources",
    async (placement) => {
      const tracked = trackedProxy()
      const accessPath = vi.fn()
      const openFile = vi.fn()
      const spawnProcess = vi.fn()
      const outcome = await runNodeCliScript({
        source: "process.stdout.write('null')",
        input: (placement === "root" ? tracked.proxy : { nested: tracked.proxy }) as never,
        timeoutSeconds: 5,
        abortSignal: new AbortController().signal,
        cwd: "/workspace",
        moduleMode: "commonjs",
      }, {
        executablePath: process.execPath,
        baseEnv: process.env,
        accessPath,
        openFile: openFile as never,
        spawnProcess: spawnProcess as never,
      })

      expect(outcome).toMatchObject({ status: "failed", code: "INVALID_INPUT" })
      expect(tracked.trapCalls()).toBe(0)
      expect(accessPath).not.toHaveBeenCalled()
      expect(openFile).not.toHaveBeenCalled()
      expect(spawnProcess).not.toHaveBeenCalled()
    },
  )

  it("writes descriptor values to stdin without inherited toJSON hooks", async () => {
    const cwd = await createRoot()
    const objectToJson = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON")
    const arrayToJson = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON")
    let objectToJsonCalls = 0
    let arrayToJsonCalls = 0
    const child = fakeChildProcess()
    const stdin: Buffer[] = []
    child.stdin?.on("data", (chunk: Buffer) => stdin.push(chunk))
    const spawnProcess = vi.fn(() => child)
    const shared = Object.assign(Object.create(null) as Record<string, unknown>, { value: 1 })
    const input = Object.assign(Object.create(null) as Record<string, unknown>, {
      object: { retained: true },
      array: [1, null],
      shared,
      alias: shared,
    })
    const expected = '{"object":{"retained":true},"array":[1,null],"shared":{"value":1},"alias":{"value":1}}'

    try {
      Object.defineProperty(Object.prototype, "toJSON", {
        configurable: true,
        value() {
          objectToJsonCalls += 1
          return { rewritten: "object" }
        },
      })
      Object.defineProperty(Array.prototype, "toJSON", {
        configurable: true,
        value() {
          arrayToJsonCalls += 1
          return ["rewritten"]
        },
      })

      const run = runNodeCliScript({
        source: "process.stdout.write('null')",
        input,
        timeoutSeconds: 5,
        abortSignal: new AbortController().signal,
        cwd,
        moduleMode: "commonjs",
      }, {
        executablePath: process.execPath,
        baseEnv: process.env,
        spawnProcess: spawnProcess as never,
      })
      await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce())
      child.stdout?.emit("data", Buffer.from("null"))
      Object.assign(child, { exitCode: 0 })
      child.emit("close", 0, null)

      await expect(run).resolves.toMatchObject({ status: "success", result: null })
      expect(Buffer.concat(stdin).toString("utf8")).toBe(expected)
      expect(objectToJsonCalls).toBe(0)
      expect(arrayToJsonCalls).toBe(0)
    } finally {
      restoreProperty(Object.prototype, "toJSON", objectToJson)
      restoreProperty(Array.prototype, "toJSON", arrayToJson)
    }
  })

  it("runs a CommonJS file with stdin JSON, cwd, native globals, and local node_modules", async () => {
    const cwd = await createRoot()
    const dependency = join(cwd, "node_modules", "local-value")
    await mkdir(dependency, { recursive: true })
    await writeFile(join(dependency, "index.js"), "module.exports = 41\n", "utf8")

    const outcome = await runNodeCliScript({
      source: `
        let body = "";
        process.stdin.setEncoding("utf8");
        process.stdin.on("data", chunk => body += chunk);
        process.stdin.on("end", () => {
          const input = JSON.parse(body);
          const value = require("local-value");
          console.error("node-log");
          process.stdout.write(JSON.stringify({
            value: value + input.increment,
            cwd: process.cwd(),
            hasFilename: typeof __filename === "string",
            hasDirname: typeof __dirname === "string"
          }));
        });
      `,
      input: { increment: 1 },
      timeoutSeconds: 5,
      abortSignal: new AbortController().signal,
      cwd: await realpath(cwd),
      moduleMode: "commonjs",
    }, {
      executablePath: process.execPath,
      baseEnv: process.env,
    })

    expect(outcome.status).toBe("success")
    if (outcome.status !== "success") return
    expect(outcome.result).toEqual({
      value: 42,
      cwd: await realpath(cwd),
      hasFilename: true,
      hasDirname: true,
    })
    expect(outcome.logs).toContainEqual({ label: "stderr", value: "node-log\n" })
    expect((await readdir(cwd)).some((name) => name.startsWith(".synapse-node-"))).toBe(false)
  })

  it("runs an ESM file with native import.meta semantics", async () => {
    const cwd = await createRoot()
    const outcome = await runNodeCliScript({
      source: `process.stdout.write(JSON.stringify({ url: import.meta.url.startsWith("file:"), dirname: typeof globalThis.__dirname }));`,
      input: {},
      timeoutSeconds: 5,
      abortSignal: new AbortController().signal,
      cwd,
      moduleMode: "esm",
    }, {
      executablePath: process.execPath,
      baseEnv: process.env,
    })

    expect(outcome.status).toBe("success")
    if (outcome.status === "success") {
      expect(outcome.result).toEqual({ url: true, dirname: "undefined" })
    }
  })

  it("rejects non-UTF-8 stdout instead of accepting replacement characters", async () => {
    const cwd = await createRoot()
    const outcome = await runNodeCliScript({
      source: "process.stdout.write(Buffer.from([0x22, 0xc3, 0x28, 0x22]))",
      input: {},
      timeoutSeconds: 5,
      abortSignal: new AbortController().signal,
      cwd,
      moduleMode: "commonjs",
    }, {
      executablePath: process.execPath,
      baseEnv: process.env,
    })

    expect(outcome).toMatchObject({
      status: "failed",
      code: "INVALID_RESULT",
      reason: "invalid_json",
      error: "Node.js stdout is not valid UTF-8.",
    })
  })

  it.each([
    ["", "missing"],
    ["{}{}", "multiple_json_values"],
    ["not json", "invalid_json"],
  ])("classifies invalid stdout results", async (stdout, reason) => {
    const cwd = await createRoot()
    const child = fakeChildProcess()
    const spawnProcess = vi.fn(() => child)
    const run = runNodeCliScript({
      source: "",
      input: {},
      timeoutSeconds: 5,
      abortSignal: new AbortController().signal,
      cwd,
      moduleMode: "commonjs",
    }, {
      executablePath: process.execPath,
      baseEnv: process.env,
      spawnProcess: spawnProcess as never,
    })
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce())
    if (stdout) child.stdout?.emit("data", Buffer.from(stdout))
    Object.assign(child, { exitCode: 0 })
    child.emit("close", 0, null)

    const outcome = await run

    expect(outcome).toMatchObject({
      status: "failed",
      code: "INVALID_RESULT",
      reason,
    })
  })

  it("times out a script that leaves a live handle", async () => {
    const cwd = await createRoot()
    const outcome = await runNodeCliScript({
      source: `process.stdout.write("null"); setInterval(() => {}, 1000);`,
      input: {},
      timeoutSeconds: 1,
      abortSignal: new AbortController().signal,
      cwd,
      moduleMode: "commonjs",
    }, {
      executablePath: process.execPath,
      baseEnv: process.env,
    })

    expect(outcome).toMatchObject({ status: "timeout", code: "TIMEOUT" })
  })

  it("does not pass input through argv or a Synapse control environment variable", async () => {
    const cwd = await createRoot()
    const marker = "input-only-marker"
    const outcome = await runNodeCliScript({
      source: `
        let body = "";
        process.stdin.on("data", chunk => body += chunk);
        process.stdin.on("end", () => process.stdout.write(JSON.stringify({
          stdin: JSON.parse(body).marker,
          argv: process.argv.includes(${JSON.stringify(marker)}),
          env: Object.values(process.env).includes(${JSON.stringify(marker)}),
          electronRunAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null,
          execArgv: process.execArgv
        })));
      `,
      input: { marker },
      timeoutSeconds: 5,
      abortSignal: new AbortController().signal,
      cwd,
      moduleMode: "commonjs",
    }, {
      executablePath: process.execPath,
      baseEnv: process.env,
    })
    expect(outcome.status).toBe("success")
    if (outcome.status === "success") {
      expect(outcome.result).toEqual({
        stdin: marker,
        argv: false,
        env: false,
        electronRunAsNode: null,
        execArgv: [],
      })
    }
  })

  it.each([
    ["missing cwd", { code: "ENOENT", message: "/private/path-do-not-leak" }],
    ["non-directory cwd", { code: "ENOTDIR", message: "/private/path-do-not-leak" }],
    ["unwritable cwd", { code: "EACCES", message: "/private/path-do-not-leak" }],
  ])("returns a stable error for %s", async (_label, failure) => {
    const logger = { warn: vi.fn() }
    const outcome = await runNodeCliScript(requestFor("/private/path-do-not-leak"), {
      executablePath: process.execPath,
      baseEnv: process.env,
      accessPath: vi.fn(async () => {
        throw Object.assign(new Error(failure.message), { code: failure.code })
      }),
      logger,
    })

    expect(outcome).toMatchObject({
      status: "failed",
      code: "RUNNER_START_FAILED",
      error: "Unable to start Node.js script execution.",
    })
    expect(JSON.stringify(outcome)).not.toContain("/private/path-do-not-leak")
    expect(logger.warn).toHaveBeenCalledWith("script runner infrastructure failure", {
      runner: "node",
      stage: "cwd_access",
      reason: failure.code === "EACCES" ? "permission_denied" : failure.code === "ENOENT" ? "not_found" : "not_directory",
    })
  })

  it.each([
    ["create", "temp_create"],
    ["write", "temp_write"],
    ["sync", "temp_sync"],
    ["close", "temp_close"],
  ] as const)("returns a stable error when temporary file %s fails", async (failurePoint, expectedStage) => {
    const cwd = await createRoot()
    const logger = { warn: vi.fn() }
    const handle = await open(join(cwd, "injected-temp"), "w+")
    const openFile = vi.fn(async () => {
      if (failurePoint === "create") throw Object.assign(new Error("secret temp path"), { code: "EIO" })
      return {
        writeFile: failurePoint === "write"
          ? vi.fn(async () => { throw Object.assign(new Error("secret source"), { code: "EIO" }) })
          : handle.writeFile.bind(handle),
        sync: failurePoint === "sync"
          ? vi.fn(async () => { throw Object.assign(new Error("secret source"), { code: "EIO" }) })
          : handle.sync.bind(handle),
        close: failurePoint === "close"
          ? vi.fn(async () => { throw Object.assign(new Error("secret source"), { code: "EIO" }) })
          : handle.close.bind(handle),
      } as Awaited<ReturnType<typeof open>>
    })

    const outcome = await runNodeCliScript(requestFor(cwd), {
      executablePath: process.execPath,
      baseEnv: process.env,
      openFile: openFile as typeof open,
      logger,
    })
    await handle.close().catch(() => undefined)

    expect(outcome).toMatchObject({
      status: "failed",
      code: "RUNNER_START_FAILED",
      error: "Unable to start Node.js script execution.",
    })
    expect(JSON.stringify(outcome)).not.toContain("secret")
    expect(logger.warn).toHaveBeenCalledWith("script runner infrastructure failure", {
      runner: "node",
      stage: expectedStage,
      reason: "io",
    })
  })

  it("cancels while cwd access never resolves without spawning", async () => {
    const controller = new AbortController()
    const accessPath = vi.fn(() => new Promise<void>(() => {}))
    const spawnProcess = vi.fn()
    const run = runNodeCliScript({
      ...requestFor("/pending"),
      abortSignal: controller.signal,
    }, {
      executablePath: process.execPath,
      baseEnv: process.env,
      accessPath,
      spawnProcess: spawnProcess as never,
    })

    await vi.waitFor(() => expect(accessPath).toHaveBeenCalledOnce())
    controller.abort()

    await expect(Promise.race([run, rejectAfter(500)]))
      .resolves.toMatchObject({ status: "cancelled", code: "CANCELLED" })
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it("returns before late temporary-file creation and cleans up the late handle", async () => {
    const cwd = await createRoot()
    const controller = new AbortController()
    const close = vi.fn(async () => undefined)
    const unlinkFile = vi.fn(async () => undefined)
    let resolveOpen!: (handle: Awaited<ReturnType<typeof open>>) => void
    const openFile = vi.fn(() => new Promise<Awaited<ReturnType<typeof open>>>((resolve) => {
      resolveOpen = resolve
    }))
    const run = runNodeCliScript({
      ...requestFor(cwd),
      abortSignal: controller.signal,
    }, {
      executablePath: process.execPath,
      baseEnv: process.env,
      openFile: openFile as typeof open,
      unlinkFile,
      spawnProcess: vi.fn() as never,
    })

    await vi.waitFor(() => expect(openFile).toHaveBeenCalledOnce())
    controller.abort()
    await expect(Promise.race([run, rejectAfter(500)]))
      .resolves.toMatchObject({ status: "cancelled", code: "CANCELLED" })

    resolveOpen({
      close,
      writeFile: vi.fn(),
      sync: vi.fn(),
    } as unknown as Awaited<ReturnType<typeof open>>)
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
    expect(unlinkFile).toHaveBeenCalled()
  })

  it("removes a real temporary file created by open after cancellation", async () => {
    const cwd = await createRoot()
    const controller = new AbortController()
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on("unhandledRejection", onUnhandled)
    let releaseOpen!: () => void
    const openGate = new Promise<void>((resolve) => {
      releaseOpen = resolve
    })
    let tempPath = ""
    const openFile: typeof open = async (path, flags, mode) => {
      tempPath = String(path)
      await openGate
      return open(path, flags, mode)
    }

    try {
      const run = runNodeCliScript({
        ...requestFor(cwd),
        abortSignal: controller.signal,
      }, {
        executablePath: process.execPath,
        baseEnv: process.env,
        openFile,
        spawnProcess: vi.fn() as never,
      })

      await vi.waitFor(() => expect(tempPath).not.toBe(""))
      controller.abort()
      await expect(Promise.race([run, rejectAfter(500)]))
        .resolves.toMatchObject({ status: "cancelled", code: "CANCELLED" })

      releaseOpen()
      await new Promise((resolve) => setTimeout(resolve, 50))
      await expect(access(tempPath)).rejects.toMatchObject({ code: "ENOENT" })
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })

  it.each(["write", "sync", "close"] as const)(
    "cancels while temporary-file %s never resolves",
    async (pendingStage) => {
      const cwd = await createRoot()
      const controller = new AbortController()
      const stageStarted = vi.fn()
      const pending = () => {
        stageStarted()
        return new Promise<void>(() => {})
      }
      const handle = {
        writeFile: pendingStage === "write" ? pending : vi.fn(async () => undefined),
        sync: pendingStage === "sync" ? pending : vi.fn(async () => undefined),
        close: pendingStage === "close" ? pending : vi.fn(async () => undefined),
      } as unknown as Awaited<ReturnType<typeof open>>
      const unlinkFile = vi.fn(async () => undefined)
      const run = runNodeCliScript({
        ...requestFor(cwd),
        abortSignal: controller.signal,
      }, {
        executablePath: process.execPath,
        baseEnv: process.env,
        openFile: vi.fn(async () => handle) as typeof open,
        unlinkFile,
        spawnProcess: vi.fn() as never,
      })

      await vi.waitFor(() => expect(stageStarted).toHaveBeenCalled())
      controller.abort()

      await expect(Promise.race([run, rejectAfter(500)]))
        .resolves.toMatchObject({ status: "cancelled", code: "CANCELLED" })
      expect(unlinkFile).toHaveBeenCalled()
    },
  )

  it("returns TIMEOUT when termination hangs and the child never closes", async () => {
    const cwd = await createRoot()
    const child = fakeChildProcess()
    const terminateProcess = vi.fn(() => new Promise<void>(() => {}))
    const spawnProcess = vi.fn(() => child)
    const run = runNodeCliScript({
      ...requestFor(cwd),
      timeoutSeconds: 0.5,
    }, {
      executablePath: process.execPath,
      baseEnv: process.env,
      spawnProcess: spawnProcess as never,
      terminateProcess,
    })

    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce())
    await expect(Promise.race([run, rejectAfter(2_000)]))
      .resolves.toMatchObject({ status: "timeout", code: "TIMEOUT" })
    expect(terminateProcess).toHaveBeenCalledOnce()
  })

  it("retries unlink after a late handle closes even when the first unlink never settles", async () => {
    const cwd = await createRoot()
    const controller = new AbortController()
    const close = vi.fn(async () => undefined)
    const unlinkFile = vi.fn()
      .mockImplementationOnce(() => new Promise<void>(() => {}))
      .mockResolvedValue(undefined)
    let resolveOpen!: (handle: Awaited<ReturnType<typeof open>>) => void
    const openFile = vi.fn(() => new Promise<Awaited<ReturnType<typeof open>>>((resolve) => {
      resolveOpen = resolve
    }))
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on("unhandledRejection", onUnhandled)

    try {
      const run = runNodeCliScript({
        ...requestFor(cwd),
        abortSignal: controller.signal,
      }, {
        executablePath: process.execPath,
        baseEnv: process.env,
        openFile: openFile as typeof open,
        unlinkFile,
        spawnProcess: vi.fn() as never,
      })

      await vi.waitFor(() => expect(openFile).toHaveBeenCalledOnce())
      controller.abort()
      await expect(Promise.race([run, rejectAfter(500)]))
        .resolves.toMatchObject({ status: "cancelled", code: "CANCELLED" })

      resolveOpen({
        close,
        writeFile: vi.fn(),
        sync: vi.fn(),
      } as unknown as Awaited<ReturnType<typeof open>>)

      await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
      await vi.waitFor(() => expect(unlinkFile).toHaveBeenCalledTimes(2))
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })

  it("decodes stderr across UTF-8 chunk boundaries and flushes an incomplete tail", async () => {
    const cwd = await createRoot()
    const child = fakeChildProcess()
    const spawnProcess = vi.fn(() => child)
    const run = runNodeCliScript(requestFor(cwd), {
      executablePath: process.execPath,
      baseEnv: process.env,
      spawnProcess: spawnProcess as never,
    })
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce())

    const text = Buffer.from("中😀", "utf8")
    child.stderr?.emit("data", text.subarray(0, 2))
    child.stderr?.emit("data", text.subarray(2, 5))
    child.stderr?.emit("data", text.subarray(5))
    child.stderr?.emit("data", Buffer.from([0xe4, 0xb8]))
    child.stdout?.emit("data", Buffer.from("null"))
    Object.assign(child, { exitCode: 0 })
    child.emit("close", 0, null)

    const outcome = await run
    expect(outcome).toMatchObject({ status: "success", result: null })
    expect(outcome.logs.map((entry) => entry.value).join("")).toBe("中😀\uFFFD")
  })

  it("ignores stderr emitted after timeout has settled the returned logs", async () => {
    const cwd = await createRoot()
    const child = fakeChildProcess()
    const spawnProcess = vi.fn(() => child)
    const run = runNodeCliScript({
      ...requestFor(cwd),
      timeoutSeconds: 0.2,
    }, {
      executablePath: process.execPath,
      baseEnv: process.env,
      spawnProcess: spawnProcess as never,
      terminateProcess: vi.fn(() => new Promise<void>(() => {})),
    })
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce())
    child.stderr?.emit("data", Buffer.from("before"))

    const outcome = await run
    expect(outcome).toMatchObject({ status: "timeout", code: "TIMEOUT" })
    const returnedLogs = outcome.logs
    child.stderr?.emit("data", Buffer.from("after"))

    expect(returnedLogs).toEqual([{ label: "stderr", value: "before" }])
  })

  it("cancels during temporary file creation and removes the partial file", async () => {
    const cwd = await createRoot()
    const controller = new AbortController()
    const spawnProcess = vi.fn()
    const unlinkFile = vi.fn(async () => undefined)
    const close = vi.fn(async () => undefined)
    const sync = vi.fn(async () => undefined)
    const openFile = vi.fn(async () => ({
      writeFile: vi.fn(async () => {
        controller.abort()
      }),
      sync,
      close,
    } as Awaited<ReturnType<typeof open>>))

    const outcome = await runNodeCliScript({
      ...requestFor(cwd),
      abortSignal: controller.signal,
    }, {
      executablePath: process.execPath,
      baseEnv: process.env,
      openFile: openFile as typeof open,
      unlinkFile,
      spawnProcess: spawnProcess as never,
    })

    expect(outcome).toMatchObject({ status: "cancelled", code: "CANCELLED" })
    expect(sync).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledOnce()
    expect(unlinkFile).toHaveBeenCalledTimes(2)
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it("cancels at the spawn boundary and best-effort terminates the child", async () => {
    const cwd = await createRoot()
    const controller = new AbortController()
    const child = fakeChildProcess()
    const terminateProcess = vi.fn(async () => undefined)
    const spawnProcess = vi.fn(() => {
      controller.abort()
      return child
    })

    const outcome = await runNodeCliScript({
      ...requestFor(cwd),
      abortSignal: controller.signal,
    }, {
      executablePath: process.execPath,
      baseEnv: process.env,
      spawnProcess: spawnProcess as never,
      terminateProcess,
    })

    expect(outcome).toMatchObject({ status: "cancelled", code: "CANCELLED" })
    expect(terminateProcess).toHaveBeenCalledWith(child, process.platform)
    expect((await readdir(cwd)).some((name) => name.startsWith(".synapse-node-"))).toBe(false)
  })

  it("handles spawn and pipe errors without exposing raw infrastructure messages", async () => {
    const cwd = await createRoot()
    const spawnFailure = await runNodeCliScript(requestFor(cwd), {
      executablePath: "/private/missing-electron",
      baseEnv: process.env,
      spawnProcess: vi.fn(() => {
        throw new Error("/private/missing-electron")
      }) as never,
    })
    expect(spawnFailure).toMatchObject({
      status: "failed",
      code: "RUNNER_START_FAILED",
      error: "Unable to start Node.js script execution.",
    })
    expect(JSON.stringify(spawnFailure)).not.toContain("/private/missing-electron")

    const child = fakeChildProcess()
    const spawnProcess = vi.fn(() => child)
    const pipeRun = runNodeCliScript(requestFor(cwd), {
      executablePath: process.execPath,
      baseEnv: process.env,
      spawnProcess: spawnProcess as never,
      terminateProcess: vi.fn(async () => undefined),
    })
    await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce())
    child.stdin?.emit("error", new Error("secret pipe detail"))
    const pipeFailure = await pipeRun
    expect(pipeFailure).toMatchObject({
      status: "failed",
      code: "RUNNER_START_FAILED",
      error: "Node.js process I/O failed.",
    })
    expect(JSON.stringify(pipeFailure)).not.toContain("secret pipe detail")
  })

  it("handles asynchronous spawn and stdout/stderr pipe errors with stable diagnostics", async () => {
    const cwd = await createRoot()
    const cases = [
      { event: "spawn" as const, stage: "spawn" },
      { event: "stdout" as const, stage: "stdout" },
      { event: "stderr" as const, stage: "stderr" },
    ]
    for (const testCase of cases) {
      const child = fakeChildProcess()
      const spawnProcess = vi.fn(() => child)
      const logger = { warn: vi.fn() }
      const run = runNodeCliScript(requestFor(cwd), {
        executablePath: process.execPath,
        baseEnv: process.env,
        spawnProcess: spawnProcess as never,
        terminateProcess: vi.fn(async () => undefined),
        logger,
      })
      await vi.waitFor(() => expect(spawnProcess).toHaveBeenCalledOnce())
      if (testCase.event === "spawn") child.emit("error", new Error("raw spawn detail"))
      else child[testCase.event]?.emit("error", new Error(`raw ${testCase.event} detail`))

      const outcome = await run
      expect(outcome).toMatchObject({
        status: "failed",
        code: "RUNNER_START_FAILED",
        error: testCase.event === "spawn"
          ? "Unable to start Node.js script execution."
          : "Node.js process I/O failed.",
      })
      expect(JSON.stringify(outcome)).not.toContain("raw")
      expect(logger.warn).toHaveBeenCalledWith("script runner infrastructure failure", {
        runner: "node",
        stage: testCase.stage,
        reason: "unknown",
      })
    }
  })

  it("logs cleanup failures with finite diagnostics without changing the result", async () => {
    const cwd = await createRoot()
    const logger = { warn: vi.fn() }
    const outcome = await runNodeCliScript(requestFor(cwd), {
      executablePath: process.execPath,
      baseEnv: process.env,
      unlinkFile: vi.fn(async () => {
        throw Object.assign(new Error("secret cleanup path"), { code: "EACCES" })
      }),
      logger,
    })

    expect(outcome).toMatchObject({ status: "success", result: null })
    expect(logger.warn).toHaveBeenCalledWith("script runner infrastructure failure", {
      runner: "node",
      stage: "cleanup_temp",
      reason: "permission_denied",
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret cleanup path")
  })
})

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "synapse-node-runner-"))
  roots.push(root)
  return root
}

function requestFor(cwd: string) {
  return {
    source: "process.stdout.write('null')",
    input: {},
    timeoutSeconds: 5,
    abortSignal: new AbortController().signal,
    cwd,
    moduleMode: "commonjs" as const,
  }
}

function fakeChildProcess(): ChildProcess {
  const child = new EventEmitter() as ChildProcess
  Object.assign(child, {
    pid: 12345,
    exitCode: null,
    signalCode: null,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  })
  return child
}

function rejectAfter(milliseconds: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error("operation did not stop")), milliseconds)
  })
}

function trackedProxy(): {
  readonly proxy: Record<string, unknown>
  readonly trapCalls: () => number
} {
  let trapCalls = 0
  const trap = (): never => {
    trapCalls += 1
    throw new Error("Proxy trap must not run")
  }
  const handler = {
    apply: trap,
    construct: trap,
    defineProperty: trap,
    deleteProperty: trap,
    get: trap,
    getOwnPropertyDescriptor: trap,
    getPrototypeOf: trap,
    has: trap,
    isExtensible: trap,
    ownKeys: trap,
    preventExtensions: trap,
    set: trap,
    setPrototypeOf: trap,
  } as ProxyHandler<Record<string, unknown>>
  return {
    proxy: new Proxy({ retained: true }, handler),
    trapCalls: () => trapCalls,
  }
}

function restoreProperty(
  target: object,
  key: PropertyKey,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor)
  } else {
    Reflect.deleteProperty(target, key)
  }
}

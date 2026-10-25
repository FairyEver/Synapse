import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { pathToFileURL } from "node:url"
import vm from "node:vm"
import { guardPtyWorkerInspector as exportedGuard } from "../windows-pty-worker-inspector.mjs"

const expectedWorkerFile = "/owned/node-pty/lib/worker/conoutSocketWorker.js"
const ownedInspectorArgument = "--inspect-brk=127.0.0.1:19798"
const guardPtyWorkerInspector = vm.runInNewContext(`(${exportedGuard.toString()})`)

function createWorkerBoundary() {
  class Worker {
    static marker = "native-worker"
    constructor(...args) { this.args = args }
  }
  const workerThreads = { Worker }
  return { Worker, workerThreads }
}

test("removes inherited inspector waiting only from the exact PTY worker without mutating options", () => {
  const { Worker, workerThreads } = createWorkerBoundary()
  const options = Object.freeze({ workerData: Object.freeze({ conoutPipeName: "owned" }) })
  const restore = guardPtyWorkerInspector(workerThreads, expectedWorkerFile, [ownedInspectorArgument], ownedInspectorArgument)
  try {
    const worker = new workerThreads.Worker(expectedWorkerFile, options)
    assert.ok(worker instanceof Worker)
    assert.equal(worker.args[0], expectedWorkerFile)
    assert.deepEqual(Object.keys(worker.args[1]).sort(), ["execArgv", "workerData"])
    assert.deepEqual(Array.from(worker.args[1].execArgv), [])
    assert.equal(worker.args[1].workerData, options.workerData)
    assert.equal(Object.hasOwn(options, "execArgv"), false)
    const withoutOptions = new workerThreads.Worker(expectedWorkerFile)
    assert.equal(withoutOptions.args[0], expectedWorkerFile)
    assert.deepEqual(Object.keys(withoutOptions.args[1]), ["execArgv"])
    assert.deepEqual(Array.from(withoutOptions.args[1].execArgv), [])
  } finally { restore() }
  assert.equal(workerThreads.Worker, Worker)
})

test("preserves unrelated workers and explicitly supplied execution arguments", () => {
  const { Worker, workerThreads } = createWorkerBoundary()
  const restore = guardPtyWorkerInspector(workerThreads, expectedWorkerFile, [], ownedInspectorArgument)
  try {
    for (const file of ["/other/conoutSocketWorker.js", `${expectedWorkerFile}.other`, pathToFileURL(expectedWorkerFile)]) {
      const options = { workerData: { owned: false } }
      const worker = new workerThreads.Worker(file, options)
      assert.equal(worker.args[0], file)
      assert.equal(worker.args[1], options)
    }
    for (const options of [{ execArgv: [] }, { execArgv: ["--no-warnings"] }, { execArgv: null }, null, [], "invalid", true, 5]) {
      assert.equal(new workerThreads.Worker(expectedWorkerFile, options).args[1], options)
    }
    assert.deepEqual(new workerThreads.Worker("/other/worker.js").args, ["/other/worker.js"])
  } finally { restore() }
  assert.equal(workerThreads.Worker, Worker)
})

test("fails closed on unexpected parent arguments without replacing the worker constructor", () => {
  for (const argv of [undefined, null, {}, "", ["--inspect-brk=127.0.0.1:19799"], [ownedInspectorArgument, "--no-warnings"], [ownedInspectorArgument, "private-value"]]) {
    const { Worker, workerThreads } = createWorkerBoundary()
    assert.throws(() => guardPtyWorkerInspector(workerThreads, expectedWorkerFile, argv, ownedInspectorArgument), /inspector arguments/i)
    assert.equal(workerThreads.Worker, Worker)
  }
})

test("preserves constructor targets, prototypes, return values and errors", () => {
  const { Worker, workerThreads } = createWorkerBoundary()
  const restore = guardPtyWorkerInspector(workerThreads, expectedWorkerFile, [ownedInspectorArgument], ownedInspectorArgument)
  try {
    class SpecializedWorker extends workerThreads.Worker {}
    const instance = new SpecializedWorker(expectedWorkerFile)
    assert.ok(instance instanceof SpecializedWorker)
    assert.ok(instance instanceof Worker)
    assert.equal(Object.getPrototypeOf(instance), SpecializedWorker.prototype)
    assert.equal(workerThreads.Worker.marker, "native-worker")
  } finally { restore() }
  const returned = {}
  const returning = { Worker: function Worker() { return returned } }
  const restoreReturning = guardPtyWorkerInspector(returning, expectedWorkerFile, [], ownedInspectorArgument)
  try { assert.equal(new returning.Worker(expectedWorkerFile), returned) } finally { restoreReturning() }
  const originalError = new Error("controlled constructor failure")
  const throwingWorker = function Worker() { throw originalError }
  const throwing = { Worker: throwingWorker }
  const restoreThrowing = guardPtyWorkerInspector(throwing, expectedWorkerFile, [], ownedInspectorArgument)
  try { assert.throws(() => new throwing.Worker(expectedWorkerFile), (error) => error === originalError) } finally { restoreThrowing() }
  assert.equal(throwing.Worker, throwingWorker)
  restoreThrowing()
  assert.equal(throwing.Worker, throwingWorker)
})

test("can be embedded into the installed inspector context without module dependencies", () => {
  const { Worker, workerThreads } = createWorkerBoundary()
  const restore = vm.runInNewContext(`(${guardPtyWorkerInspector.toString()})(workerThreads, expectedWorkerFile, [], ownedInspectorArgument)`, {
    workerThreads, expectedWorkerFile, ownedInspectorArgument,
  })
  try { assert.equal(new workerThreads.Worker(expectedWorkerFile).args[1].execArgv.length, 0) } finally { restore() }
  assert.equal(workerThreads.Worker, Worker)
})

async function runInspectedWorkerFixture(mainFile, workerFile, guarded) {
  const child = spawn(process.execPath, ["--inspect-brk=127.0.0.1:0", mainFile, workerFile, guarded ? "guarded" : "original"], {
    stdio: ["ignore", "ignore", "pipe"], env: { ...process.env, NODE_OPTIONS: "" },
  })
  let stderr = ""
  let socket
  let sequence = 0
  const pending = new Map()
  let protocolFailure
  const exited = new Promise((resolve) => child.once("exit", resolve))
  const timer = setTimeout(() => child.kill(), 10_000)
  child.stderr.on("data", (chunk) => { stderr += chunk.toString() })
  const waitFor = async (predicate) => {
    const deadline = Date.now() + 4000
    while (!predicate()) {
      assert.equal(child.exitCode, null, "Owned worker fixture exited before observation")
      assert.ok(Date.now() < deadline, "Owned worker fixture observation timed out")
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence
    const deadline = setTimeout(() => { pending.delete(id); reject(new Error("Owned worker fixture inspector timed out")) }, 4000)
    pending.set(id, {
      resolve: (value) => { clearTimeout(deadline); resolve(value) },
      reject: (error) => { clearTimeout(deadline); reject(error) },
    })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async (expression) => {
    const result = await command("Runtime.evaluate", { expression, returnByValue: true })
    assert.ok(!result.exceptionDetails, "Owned worker fixture evaluation failed")
    return result.result.value
  }
  try {
    await waitFor(() => /Debugger listening on (ws:\/\/[^\s]+)/.test(stderr))
    socket = new WebSocket(/Debugger listening on (ws:\/\/[^\s]+)/.exec(stderr)[1])
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(String(data))
      if (message.id) {
        const waiter = pending.get(message.id)
        if (waiter) {
          pending.delete(message.id)
          message.error ? waiter.reject(new Error("Owned worker fixture inspector command failed")) : waiter.resolve(message.result)
        }
      }
      if (message.method === "Debugger.paused") void command("Debugger.resume").catch((error) => { protocolFailure = error })
    }
    socket.onclose = () => {
      for (const waiter of pending.values()) waiter.reject(new Error("Owned worker fixture inspector disconnected"))
      pending.clear()
    }
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
    await command("Debugger.enable")
    await command("Runtime.runIfWaitingForDebugger")
    await waitFor(() => stderr.includes("OWNED_FIXTURE_READY"))
    await command("Debugger.disable")
    assert.equal(await evaluate("process.pid"), child.pid)
    const result = await evaluate("startOwnedWorker()")
    assert.equal(await evaluate("process.pid"), child.pid)
    assert.equal(await evaluate("isWorkerConstructorRestored()"), true)
    assert.equal(protocolFailure, undefined)
    return result
  } finally {
    clearTimeout(timer)
    socket?.close()
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await exited
  }
}

test("unblocks the real PTY-style worker pipe dependency under an attached startup inspector", { timeout: 20_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "synapse-pty-worker-inspector-"))
  try {
    const mainFile = path.join(root, "main.mjs")
    const workerFile = path.join(root, "worker.mjs")
    const guardUrl = new URL("../windows-pty-worker-inspector.mjs", import.meta.url).href
    await writeFile(workerFile, "import { workerData } from 'node:worker_threads'; const flag=new Int32Array(workerData); Atomics.store(flag,0,1); Atomics.notify(flag,0);\n")
    await writeFile(mainFile, `
      import workerThreads from 'node:worker_threads';
      import {guardPtyWorkerInspector} from ${JSON.stringify(guardUrl)};
      const originalWorker=workerThreads.Worker;
      globalThis.isWorkerConstructorRestored=()=>workerThreads.Worker===originalWorker;
      globalThis.startOwnedWorker=()=>{
        let restore;
        try {
          if(process.argv[3]==='guarded')restore=guardPtyWorkerInspector(workerThreads,process.argv[2],process.execArgv,'--inspect-brk=127.0.0.1:0');
          const flag=new Int32Array(new SharedArrayBuffer(4));
          new workerThreads.Worker(process.argv[2],{workerData:flag.buffer});
          const waitResult=Atomics.wait(flag,0,0,1500);
          return {waitResult,workerReady:Atomics.load(flag,0)===1,parentInspectorArgumentPreserved:process.execArgv.length===1&&process.execArgv[0]==='--inspect-brk=127.0.0.1:0'};
        } finally {restore?.()}
      };
      process.stderr.write('OWNED_FIXTURE_READY\\n');
      setInterval(()=>{},1000);
    `)
    const original = await runInspectedWorkerFixture(mainFile, workerFile, false)
    assert.deepEqual(original, { waitResult: "timed-out", workerReady: false, parentInspectorArgumentPreserved: true })
    const guarded = await runInspectedWorkerFixture(mainFile, workerFile, true)
    assert.equal(guarded.workerReady, true)
    assert.notEqual(guarded.waitResult, "timed-out")
    assert.equal(guarded.parentInspectorArgumentPreserved, true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

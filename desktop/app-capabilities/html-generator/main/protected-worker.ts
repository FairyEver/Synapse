import { spawn, type ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import type { ProtectProcess } from "../../../electron/runtime/process/private-storage-protection"
import type { HtmlGenerationWorkerFactory } from "./worker-launch"

// Keep user EJS in a worker, but put the worker's entire process family behind the OS boundary.
const BOOTSTRAP = `
const { Worker } = require('node:worker_threads');
process.once('message', ({filename, options}) => {
  const worker = new Worker(filename, {...options, stdout:true, stderr:true});
  worker.stdout.pipe(process.stdout); worker.stderr.pipe(process.stderr);
  worker.on('message', value => process.send({kind:'message', value}));
  worker.on('error', error => process.send({kind:'error', code:error.code}));
  worker.on('exit', code => { process.exitCode=code; if(process.connected) process.disconnect(); });
});
`

export function createProtectedHtmlWorkerFactory(deps: {
  readonly executablePath: string
  readonly protectProcess: ProtectProcess
}): HtmlGenerationWorkerFactory {
  return (filename, options) => {
    const launch = deps.protectProcess({ command: deps.executablePath, args: ["-e", BOOTSTRAP] })
    const child = spawn(launch.command, [...launch.args], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      stdio: ["ignore", "pipe", "pipe", "ipc"], serialization: "advanced", detached: process.platform !== "win32", windowsHide: true,
    })
    const worker = new ProtectedHtmlWorker(child)
    child.send({ filename, options }, error => { if (error) worker.reportError(new Error("HTML worker input failed")) })
    return worker
  }
}

class ProtectedHtmlWorker extends EventEmitter {
  private terminating = false
  readonly stdout
  readonly stderr
  constructor(private readonly child: ChildProcess) {
    super()
    if (!child.stdout || !child.stderr) throw new Error("HTML worker output pipes unavailable")
    this.stdout = child.stdout
    this.stderr = child.stderr
    child.on("message", raw => {
      if (this.terminating) return
      const message = raw as { kind?: string; value?: unknown; code?: string }
      if (message.kind === "message") this.emit("message", message.value)
      else if (message.kind === "error") this.emit("error", Object.assign(new Error("HTML worker failed"), { code: message.code }))
    })
    child.on("error", error => this.reportError(error))
    child.on("exit", code => this.emit("exit", code ?? 1))
  }

  reportError(error: Error): void {
    if (!this.terminating) this.emit("error", error)
  }

  async terminate(): Promise<number> {
    this.terminating = true
    if (!this.child.pid || this.child.exitCode !== null || this.child.signalCode !== null) return this.child.exitCode ?? 1
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (process.platform !== "win32" && this.child.pid) process.kill(-this.child.pid, signal)
        else this.child.kill(signal)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
      }
    }
    return new Promise<number>(resolve => {
      const timer = setTimeout(() => kill("SIGKILL"), 500)
      timer.unref()
      this.child.once("exit", code => { clearTimeout(timer); resolve(code ?? 1) })
      kill("SIGTERM")
    })
  }
}

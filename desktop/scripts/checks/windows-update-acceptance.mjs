#!/usr/bin/env node
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { createReadStream, createWriteStream, readFileSync, realpathSync } from "node:fs"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parse as parseYaml } from "yaml"

const desktopRoot = fileURLToPath(new URL("../..", import.meta.url))
const cdnBase = "https://desktop.release.synapse.d2.pub/"
const maximumInstallerBytes = 2 * 1024 ** 3

export function parseAcceptanceMode(args) {
  if (args.length === 0) return "full"
  assert.equal(args.length, 1, "Choose exactly one Windows acceptance mode")
  if (args[0] === "--observe-processes") return "observer"
  if (args[0] === "--previous-startup-only") return "previous-startup"
  throw new Error("Unknown Windows acceptance mode")
}

export function parseWindowsMetadata(text, expectedVersion) {
  const metadata = parseYaml(text)
  assert.match(expectedVersion, /^\d+\.\d+\.\d+$/, "Invalid expected version")
  assert.equal(metadata?.version, expectedVersion, "Windows metadata version changed")
  const file = `Synapse-${expectedVersion}-win-x64.exe`
  const acceptedPaths = [file, `v${expectedVersion}/${file}`]
  assert.ok(acceptedPaths.includes(metadata.path), "Unexpected Windows installer path")
  const entry = metadata.files?.find((item) => item?.url === metadata.path)
  assert.ok(entry, "Expected Windows installer missing or path changed")
  assert.match(entry.sha512 ?? "", /^[A-Za-z0-9+/]{86}==$/, "Invalid installer SHA512")
  assert.equal(metadata.sha512, entry.sha512, "Conflicting root SHA512")
  return { version: expectedVersion, file, sha512: entry.sha512 }
}

export async function verifyFileSha512(file, expected) {
  const hash = createHash("sha512")
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  assert.equal(hash.digest("base64"), expected, "Installer SHA512 mismatch")
}

async function waitFor(label, probe, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await probe()
    if (result) return result
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out observing ${label}`)
}

function appEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|USERPROFILE|APPDATA|LOCALAPPDATA|TEMP|TMP|HOMEDRIVE|HOMEPATH|USERNAME|PROGRAMFILES|PROGRAMFILES\(X86\)|COMMONPROGRAMFILES|COMMONPROGRAMFILES\(X86\)|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(key)))
}

async function run(command, args, options = {}) {
  const child = spawn(command, args, { stdio: "inherit", windowsHide: true, ...options })
  const timer = setTimeout(() => child.kill(), options.timeoutMs ?? 300_000)
  try {
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject)
      child.once("exit", resolve)
    })
    assert.equal(code, 0, `${path.basename(command)} failed`)
  } finally {
    clearTimeout(timer)
  }
}

async function downloadInstaller(url, file, digest) {
  assert.equal(new URL(url).origin, new URL(cdnBase).origin, "Unexpected installer origin")
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000), redirect: "error" })
  assert.ok(response.ok && response.body, `Installer HTTP ${response.status}`)
  let bytes = 0
  const limit = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length
    callback(bytes > maximumInstallerBytes ? new Error("Installer exceeds download budget") : null, chunk)
  } })
  await pipeline(Readable.fromWeb(response.body), limit, createWriteStream(file, { flags: "wx" }))
  await verifyFileSha512(file, digest)
}

async function readVendorMetadata() {
  const response = await fetch(new URL("latest-windows.yml", cdnBase), { signal: AbortSignal.timeout(20_000), redirect: "error" })
  assert.ok(response.ok && response.body, `Metadata HTTP ${response.status}`)
  const chunks = []
  let bytes = 0
  for await (const chunk of response.body) {
    bytes += chunk.length
    assert.ok(bytes <= 64 * 1024, "Metadata exceeds size budget")
    chunks.push(Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf8")
}

function readRegistryCaptureLine(archivePath) {
  const buffer = readFileSync(archivePath)
  const header = JSON.parse(buffer.subarray(16, 16 + buffer.readUInt32LE(12)))
  let entry = header
  for (const part of "dist-electron/electron/bootstrap/app-ready.js".split("/")) entry = entry.files[part]
  const offset = 8 + buffer.readUInt32LE(4) + Number(entry.offset)
  const source = buffer.subarray(offset, offset + Number(entry.size)).toString("utf8")
  const line = source.split("\n").findIndex((value) => value.includes("const registry =")) + 1
  assert.ok(line > 0, "Actual packaged registry startup statement not found")
  return line
}

class Inspector {
  sequence = 0
  pending = new Map()
  listeners = new Set()

  constructor(socket) {
    this.socket = socket
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(String(data))
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result)
      } else for (const listener of this.listeners) listener(message)
    }
    socket.onclose = () => {
      for (const pending of this.pending.values()) pending.reject(new Error("Main inspector disconnected"))
      this.pending.clear()
    }
  }

  async command(method, params = {}) {
    let id
    let timer
    try {
      return await Promise.race([
        new Promise((resolve, reject) => {
          id = ++this.sequence
          this.pending.set(id, { resolve, reject })
          this.socket.send(JSON.stringify({ id, method, params }))
        }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Inspector ${method} timed out`)), 30_000) }),
      ])
    } finally {
      clearTimeout(timer)
      this.pending.delete(id)
    }
  }

  async evaluate(expression) {
    const result = await this.command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, timeout: 25_000 })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }

  close() { this.socket.close() }
}

export function isOwnedInspectorAddress(url, startupLog) {
  if (!URL.canParse(url)) return false
  const address = new URL(url)
  return address.protocol === "ws:" && address.hostname === "127.0.0.1" && address.port === "19798"
    && startupLog.split(/\r?\n/).includes(`Debugger listening on ${address.href}`)
}

async function launchInstalledApp(executable, outputRoot, phase) {
  const log = createWriteStream(path.join(outputRoot, `${phase}-app.log`))
  const child = spawn(executable, ["--inspect-brk=127.0.0.1:19798"], { env: appEnvironment(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
  let startupLog = ""
  child.stderr.on("data", (chunk) => { startupLog = (startupLog + chunk.toString("utf8")).slice(-8192) })
  child.stdout.pipe(log, { end: false })
  child.stderr.pipe(log, { end: false })
  child.once("close", () => log.end())
  const target = await waitFor("owned main inspector", async () => {
    try {
      const response = await fetch("http://127.0.0.1:19798/json/list", { signal: AbortSignal.timeout(1000) })
      const targets = await response.json()
      return targets.length === 1 ? targets[0] : null
    } catch (error) {
      if (child.exitCode !== null) throw new Error(`App exited before inspector: ${child.exitCode}`, { cause: error })
      return null
    }
  }, 30_000)
  await waitFor("inspector address emitted by the owned child", () => isOwnedInspectorAddress(target.webSocketDebuggerUrl, startupLog), 10_000)
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  const inspector = new Inspector(socket)
  const captureLine = readRegistryCaptureLine(path.join(path.dirname(executable), "resources", "app.asar"))
  const scripts = new Map()
  let resolveCapture, rejectCapture
  const capture = new Promise((resolve, reject) => { resolveCapture = resolve; rejectCapture = reject })
  const listener = (message) => {
    if (message.method === "Debugger.scriptParsed") scripts.set(message.params.scriptId, message.params.url)
    if (message.method === "Debugger.paused") void (async () => {
      const frame = message.params.callFrames.find((value) => /[/\\]bootstrap[/\\]app-ready\.js$/.test(scripts.get(value.location.scriptId) ?? "") && value.location.lineNumber >= captureLine && value.location.lineNumber < captureLine + 3)
      if (frame) {
        const result = await inspector.command("Debugger.evaluateOnCallFrame", { callFrameId: frame.callFrameId, expression: "globalThis.__updateAcceptanceRegistry = registry; true", returnByValue: true })
        assert.ok(!result.exceptionDetails, "Cannot capture actual service registry")
      }
      await inspector.command("Debugger.resume")
      if (frame) resolveCapture()
    })().catch(rejectCapture)
  }
  inspector.listeners.add(listener)
  await inspector.command("Debugger.enable")
  await inspector.command("Debugger.setBreakpointByUrl", { lineNumber: captureLine, urlRegex: "[/\\\\]bootstrap[/\\\\]app-ready\\.js$" })
  await inspector.command("Runtime.runIfWaitingForDebugger")
  let captureTimer
  try {
    await Promise.race([capture, new Promise((_, reject) => { captureTimer = setTimeout(() => reject(new Error("Service registry capture timed out")), 30_000) })])
  } finally {
    clearTimeout(captureTimer)
    inspector.listeners.delete(listener)
    await inspector.command("Debugger.disable")
  }
  assert.equal(await inspector.evaluate("process.pid"), child.pid, "Inspector belongs to a different process")
  await waitFor("running terminal service and visible loaded app window", async () => {
    const startup = await inspector.evaluate(`(() => {
      const req=process.mainModule.require.bind(process.mainModule);const e=req('electron');const r=globalThis.__updateAcceptanceRegistry;
      return {version:e.app.getVersion(),isPackaged:e.app.isPackaged,appPath:e.app.getAppPath(),expectedRendererUrl:req('node:url').pathToFileURL(req('node:path').join(e.app.getAppPath(),'dist/index.html')).href,terminalRunning:r.inspect().some(s=>s.id==='core.terminal'&&s.status==='running'),windows:e.BrowserWindow.getAllWindows().filter(w=>!w.isDestroyed()).map(w=>({url:w.webContents.getURL(),visible:w.isVisible(),loading:w.webContents.isLoading()}))};
    })()`)
    await writeFile(path.join(outputRoot, `${phase}-startup.json`), JSON.stringify(startup, null, 2))
    return startup.terminalRunning && startup.windows.some((window) => window.visible && !window.loading)
  })
  await inspector.evaluate(`(async()=>{
    const e=process.mainModule.require('electron');const w=e.BrowserWindow.getAllWindows().find(w=>!w.isDestroyed()&&w.isVisible());
    return w.webContents.executeJavaScript('window.synapse.config.get().then(() => true)');
  })()`)
  return { inspector, child }
}

export function ownedProcessIds(executable, mainOnly = false, execute = spawnSync) {
  const script = "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; @(Get-CimInstance Win32_Process -Filter \"Name = 'Synapse.exe'\" | Where-Object { $_.ExecutablePath -eq $env:SYNAPSE_ACCEPTANCE_EXE -and ($env:SYNAPSE_ACCEPTANCE_MAIN_ONLY -ne '1' -or $_.CommandLine -notmatch '(?:^|\\s)--type=') } | ForEach-Object { $_.ProcessId }) | ConvertTo-Json -Compress"
  const result = execute("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", timeout: 60_000, env: { ...appEnvironment(), SYNAPSE_ACCEPTANCE_EXE: executable, SYNAPSE_ACCEPTANCE_MAIN_ONLY: mainOnly ? "1" : "0" } })
  assert.equal(result.status, 0, `Cannot inspect owned installer app processes: ${JSON.stringify({ status: result.status, signal: result.signal, code: result.error?.code, message: result.error?.message, stderr: result.stderr?.trim().slice(0, 1000) })}`)
  assert.ok(!result.stderr?.trim(), `Windows process observer reported an error: ${result.stderr?.trim().slice(0, 1000)}`)
  const parsed = JSON.parse(result.stdout.trim() || "[]")
  return Array.isArray(parsed) ? parsed : [parsed]
}

function stopOwnedApp(executable) {
  const ids = ownedProcessIds(executable)
  for (const id of ids) {
    const result = spawnSync("taskkill.exe", ["/PID", String(id), "/T", "/F"], { encoding: "utf8", timeout: 10_000, env: appEnvironment() })
    if (result.status !== 0 && ownedProcessIds(executable).includes(id)) throw new Error(`Cannot stop owned acceptance process ${id}`)
  }
}

async function serveCandidate(releaseRoot, metadata, filename) {
  const data = await readFile(path.join(releaseRoot, filename))
  const versionPrefix = `/v${parseYaml(metadata).version}/${filename}`
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1:19797")
    if (!["GET", "HEAD"].includes(request.method)) { response.writeHead(405).end(); return }
    const body = url.pathname === "/latest.yml" ? Buffer.from(metadata) : [ `/${filename}`, versionPrefix ].includes(url.pathname) ? data : null
    if (!body) { response.writeHead(404).end(); return }
    let start = 0, end = body.length - 1
    if (request.headers.range) {
      const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range)
      if (!range) { response.writeHead(416).end(); return }
      start = Number(range[1]); end = range[2] ? Number(range[2]) : end
      if (start > end || end >= body.length) { response.writeHead(416).end(); return }
    }
    const headers = { "content-length": end - start + 1, "cache-control": "no-store" }
    if (request.headers.range) headers["content-range"] = `bytes ${start}-${end}/${body.length}`
    response.writeHead(request.headers.range ? 206 : 200, headers)
    response.end(request.method === "HEAD" ? undefined : body.subarray(start, end + 1))
  })
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(19797, "127.0.0.1", resolve) })
  return server
}

function assertDisposableWindowsRunner() {
  assert.equal(process.platform, "win32", "Actual installer acceptance is Windows-only")
  assert.equal(process.env.GITHUB_ACTIONS, "true", "Run only on a disposable GitHub Actions runner")
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted", "Refusing installation on a persistent runner")
}

export async function runWindowsAcceptance({ previousStartupOnly = false } = {}) {
  assertDisposableWindowsRunner()
  const previousVersion = (process.env.PREVIOUS_TAG ?? "v1.0.79").replace(/^v/, "")
  const version = JSON.parse(await readFile(path.join(desktopRoot, "package.json"), "utf8")).version
  assert.match(version, /^\d+\.\d+\.\d+$/)
  assert.match(previousVersion, /^\d+\.\d+\.\d+$/)
  assert.ok(new Intl.Collator("en", { numeric: true }).compare(version, previousVersion) > 0, "Real cross-version acceptance requires a newer candidate")
  const outputRoot = path.join(desktopRoot, "release", "windows-update-acceptance")
  await mkdir(outputRoot, { recursive: true })
  const temporaryRoot = realpathSync.native(await mkdtemp(path.join(os.tmpdir(), "synapse-update-acceptance-")))
  const installDirectory = path.join(temporaryRoot, "Synapse")
  const executable = path.join(installDirectory, "Synapse.exe")
  const releaseRoot = path.join(desktopRoot, "release")
  const evidence = { sourceSha: process.env.GITHUB_SHA, previousVersion, candidateVersion: version, syntheticCredentialOnly: true, diagnosticOnly: previousStartupOnly, checks: {} }
  const record = async (name, value) => {
    evidence.checks[name] = value
    await writeFile(path.join(outputRoot, "evidence.json"), JSON.stringify(evidence, null, 2))
    process.stdout.write(`${name}: ${JSON.stringify(value)}\n`)
  }
  let server, inspector
  try {
    const previous = parseWindowsMetadata(await readVendorMetadata(), previousVersion)
    const installer = path.join(temporaryRoot, previous.file)
    await downloadInstaller(new URL(`v${previousVersion}/${previous.file}`, cdnBase), installer, previous.sha512)
    await run(installer, ["/S", "/currentuser", `/D=${installDirectory}`], { env: appEnvironment() })
    await waitFor("old installed executable", async () => { try { await readFile(executable); return true } catch (error) { if (error.code === "ENOENT") return false; throw error } })
    stopOwnedApp(executable)
    let launched = await launchInstalledApp(executable, outputRoot, "old")
    inspector = launched.inspector
    const old = await inspector.evaluate(`(() => {
      const req=process.mainModule.require.bind(process.mainModule);const e=req('electron');
      const fixture=req('node:path').join(e.app.getPath('userData'),'upgrade-acceptance-synthetic.bin');
      if(!e.safeStorage.isEncryptionAvailable())throw new Error('Old DPAPI unavailable');
      req('node:fs').writeFileSync(fixture,e.safeStorage.encryptString('synapse-update-acceptance-not-a-secret'),{flag:'wx'});
      return {version:e.app.getVersion(),platform:process.platform,arch:process.arch,isPackaged:e.app.isPackaged,window:e.BrowserWindow.getAllWindows().some(w=>w.isVisible())};
    })()`)
    assert.equal(old.version, previousVersion); assert.ok(old.isPackaged && old.window)
    await record("oldInstalledStartup", old)
    if (previousStartupOnly) {
      await record("previousStartupDiagnostic", { passed: true, installedRendererIpc: true })
      return
    }
    const metadata = await readFile(path.join(releaseRoot, "latest.yml"), "utf8")
    const candidate = parseWindowsMetadata(metadata, version)
    await verifyFileSha512(path.join(releaseRoot, candidate.file), candidate.sha512)
    server = await serveCandidate(releaseRoot, metadata, candidate.file)
    await inspector.evaluate(`(async()=>{process.mainModule.require('electron-updater').autoUpdater.setFeedURL({provider:'generic',url:'http://127.0.0.1:19797/'});const u=process.mainModule.require('./services/update-service.js').updateService;const s=await u.checkForUpdates();if(s.releaseVersion!==${JSON.stringify(version)}||s.status!=='available')throw new Error('Candidate not available');await u.downloadUpdate();return true})()`)
    await waitFor("actual candidate download", async () => {
      const state = await inspector.evaluate("process.mainModule.require('./services/update-service.js').updateService.getState()")
      if (state.error) throw new Error(state.error)
      return state.status === "downloaded"
    }, 180_000)
    await record("candidateDownloaded", { version, sha512Verified: true })
    await inspector.evaluate(`(()=>{
      const u=process.mainModule.require('./services/update-service.js').updateService;
      if(u.getState().status!=='downloaded'||!u.installQuitHandlers?.canQuit())throw new Error('Production safe-quit gate rejected installation');
      u.installQuitHandlers.allowQuit();
      process.mainModule.require('electron-updater').autoUpdater.quitAndInstall(true,true);
      return true;
    })()`)
    inspector.close(); inspector = null
    await waitFor("old main process exit", () => launched.child.exitCode !== null, 60_000)
    await waitFor("new installed app version", async () => {
      const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-Item -LiteralPath $env:SYNAPSE_ACCEPTANCE_EXE).VersionInfo.ProductVersion"], { encoding: "utf8", timeout: 10_000, env: { ...appEnvironment(), SYNAPSE_ACCEPTANCE_EXE: executable } })
      return result.status === 0 && [version, `${version}.0`].includes(result.stdout.trim())
    }, 180_000)
    await waitFor("native installer relaunch", () => ownedProcessIds(executable, true).length > 0, 60_000)
    await record("nativeCrossVersionUpdate", { from: previousVersion, to: version, oldProcessExited: true, installerRelaunched: true, silentNativeInstaller: true, interactiveWizardTested: false })
    stopOwnedApp(executable)
    launched = await launchInstalledApp(executable, outputRoot, "new")
    inspector = launched.inspector
    const upgraded = await inspector.evaluate(`(() => {
      const req=process.mainModule.require.bind(process.mainModule);const e=req('electron');const fixture=req('node:path').join(e.app.getPath('userData'),'upgrade-acceptance-synthetic.bin');
      const decrypted=e.safeStorage.decryptString(req('node:fs').readFileSync(fixture));
      if(decrypted!=='synapse-update-acceptance-not-a-secret')throw new Error('Old synthetic DPAPI fixture changed');
      return {version:e.app.getVersion(),electron:process.versions.electron,platform:process.platform,arch:process.arch,isPackaged:e.app.isPackaged,window:e.BrowserWindow.getAllWindows().some(w=>w.isVisible()),oldSyntheticCipherReadable:true};
    })()`)
    assert.equal(upgraded.version, version); assert.equal(upgraded.electron, "44.9.3"); assert.ok(upgraded.isPackaged && upgraded.window)
    assert.equal(upgraded.platform, "win32"); assert.equal(upgraded.arch, "x64")
    await record("newInstalledStartup", upgraded)
    const pty = await inspector.evaluate(`(async()=>{
      const req=process.mainModule.require.bind(process.mainModule);const r=globalThis.__updateAcceptanceRegistry;const ctx=r.getContext();const t=r.get('core.terminal');
      const actor={kind:'user',id:'release-windows-acceptance'};const resource='release-acceptance:owned-pty';
      const permission=await ctx.permissionGuard.check({action:'terminal.session.create',actor,resource,context:{source:'release.windows-acceptance'}});if(!permission.allowed)throw new Error('PTY permission denied');
      ctx.auditSink.record({action:'terminal.session.create',actor,resource,outcome:'allowed',metadata:{source:'release.windows-acceptance'}});
      let s;const live=()=>s?t.listSessions().find(x=>x.id===s.id):undefined;const wait=async test=>{const end=Date.now()+6000;while(Date.now()<end){if(test())return;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Actual Windows PTY IO timed out')};
      try{s=await t.createSessionWithEphemeralEnvironment({title:'Windows upgrade acceptance',cwd:req('electron').app.getPath('userData'),shell:process.env.ComSpec||process.env.COMSPEC||'C:\\\\Windows\\\\System32\\\\cmd.exe',args:['/Q','/D'],environment:{},cols:80,rows:24});if(s.status!=='running')throw new Error('Actual Windows PTY failed to start');const output=()=>t.readSession({sessionId:s.id,limitBytes:16384}).chunks.map(c=>c.data).join('');t.writeSession({sessionId:s.id,data:'echo SYNAPSE_WINDOWS_PTY_OK\\r'});await wait(()=>output().includes('SYNAPSE_WINDOWS_PTY_OK'));await t.resizeSession({sessionId:s.id,cols:100,rows:30});const resized=t.getSession({sessionId:s.id});if(resized.cols!==100||resized.rows!==30)throw new Error('PTY size mismatch');t.writeSession({sessionId:s.id,data:'exit\\r'});await wait(()=>!live());return{actualInputOutput:true,naturalExit:true,cols:100,rows:30};}
      finally{if(live()){await t.stopSession({sessionId:s.id});await wait(()=>!live());}await t.flushPersistQueue();}
    })()`)
    await record("installedNativePty", pty)
    await inspector.evaluate("(()=>{process.mainModule.require('electron').app.quit();return true})()")
    inspector.close(); inspector = null
    await waitFor("new inspected process normal exit", () => launched.child.exitCode !== null, 30_000)
    await run(process.execPath, [path.join(desktopRoot, "scripts/checks/verify-packaged-asar.mjs"), installDirectory], { env: appEnvironment() })
    await run(process.execPath, [path.join(desktopRoot, "scripts/checks/verify-packaged-script-runtime.mjs"), executable], { env: appEnvironment() })
    await record("installedPackageAndScriptRuntime", { passed: true })
    await record("complete", true)
  } catch (error) {
    await record("failure", { message: error.message })
    throw error
  } finally {
    inspector?.close()
    if (server) await new Promise((resolve) => { server.closeAllConnections(); server.close(resolve) })
    stopOwnedApp(executable)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = parseAcceptanceMode(process.argv.slice(2))
  if (mode === "observer") {
    assertDisposableWindowsRunner()
    const target = path.join(os.tmpdir(), "synapse-process-observer-preflight", "Synapse.exe")
    process.stdout.write(`Windows process observer: ${JSON.stringify(ownedProcessIds(target))}\n`)
  } else runWindowsAcceptance({ previousStartupOnly: mode === "previous-startup" }).catch((error) => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1 })
}

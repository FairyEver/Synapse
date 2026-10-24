import { execFile, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { createServer } from "node:net"
import { promisify } from "node:util"
import { describe, expect, it } from "vitest"
import { PrivateStorageProtection } from "../private-storage-protection"

describe("private storage OS process boundary", () => {
  it.runIf(process.platform === "darwin" && process.env.SYNAPSE_RUN_DNS_TEST === "1")("retains system DNS resolution for protected MCP package startup", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "sy-dns-"))
    const protection = new PrivateStorageProtection([path.join(root, "private")])
    const source = "require('node:dns').lookup('registry.npmjs.org', {family:4}, e => { if(e) { process.stderr.write(e.code); process.exitCode=1 } else process.stdout.write('DNS_OK') })"
    const launch = protection.protectProcess({ command: process.execPath, args: ["-e", source] })
    try {
      // Explicit opt-in: exercises the OS resolver rather than /etc/hosts' localhost shortcut.
      const result = await promisify(execFile)(launch.command, [...launch.args], { timeout: 10_000 })
      expect(result.stdout).toBe("DNS_OK")
      expect(result.stderr).toBe("")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.runIf(process.platform === "darwin")("blocks Unix socket delegation while retaining public TCP tool connections", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "sy-ipc-")), socketPath = path.join(root, "mDNSResponder")
    let brokerReached = false
    const broker = createServer(socket => { brokerReached = true; socket.end("private-canary") })
    const publicServer = createServer(socket => socket.end("public-api"))
    await new Promise<void>(resolve => broker.listen(socketPath, resolve))
    await new Promise<void>(resolve => publicServer.listen(0, "127.0.0.1", resolve))
    const protection = new PrivateStorageProtection([path.join(root, "private")])
    const source = "const c=require('node:net').connect(JSON.parse(process.argv[1])); c.on('data',d=>process.stdout.write(d)); c.on('error',()=>process.stdout.write('BLOCKED'))"
    const read = async (address: unknown) => {
      const launch = protection.protectProcess({ command: process.execPath, args: ["-e", source, JSON.stringify(address)] })
      return (await promisify(execFile)(launch.command, [...launch.args], { timeout: 10_000 })).stdout
    }
    try {
      expect(await read({ path: socketPath })).toBe("BLOCKED")
      expect(brokerReached).toBe(false)
      const address = publicServer.address()
      if (!address || typeof address === "string") throw new Error("Missing test TCP port")
      expect(await read({ host: "127.0.0.1", port: address.port })).toBe("public-api")
    } finally {
      await Promise.all([new Promise<void>(resolve => broker.close(() => resolve())), new Promise<void>(resolve => publicServer.close(() => resolve()))])
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("refuses a protected cwd before host-side script staging or process launch", () => {
    const protection = new PrivateStorageProtection([tmpdir()], "darwin")
    expect(() => protection.protectProcess({ command: process.execPath, args: [], cwd: tmpdir() })).toThrow("阻止执行")
  })
  it.each(["win32", "linux"] as const)("refuses unsupported %s instead of launching without protection", platform => {
    expect(() => new PrivateStorageProtection([tmpdir()], platform).protectProcess({ command: "node", args: [] })).toThrow()
  })

  it.runIf(process.platform === "darwin")("blocks direct, child-process and stdio MCP reads while keeping public files readable", () => {
    const root = mkdtempSync(path.join(tmpdir(), "synapse-storage-boundary-")), privateRoot = path.join(root, "private")
    mkdirSync(privateRoot)
    const secret = path.join(privateRoot, "runtime.sqlite"), publicFile = path.join(root, "public.txt")
    writeFileSync(secret, "private-canary-never-return")
    writeFileSync(publicFile, "public-canary")
    symlinkSync(privateRoot, path.join(root, "alias"), "dir")
    const protection = new PrivateStorageProtection([privateRoot])
    const readSource = "try { process.stdout.write(require('node:fs').readFileSync(process.argv[1], 'utf8')) } catch { process.stdout.write('BLOCKED') }"
    try {
      for (const target of [secret, path.join(root, "alias", "runtime.sqlite")]) {
        const launch = protection.protectProcess({ command: process.execPath, args: ["-e", readSource, target] })
        const result = spawnSync(launch.command, [...launch.args], { encoding: "utf8", timeout: 10_000 })
        expect(result.status).toBe(0)
        expect(result.stdout).toBe("BLOCKED")
      }
      const childSource = `const r = require('node:child_process').spawnSync(process.execPath, ['-e', ${JSON.stringify(readSource)}, process.argv[1]], {encoding:'utf8'}); process.stdout.write(r.stdout);`
      const descendant = protection.protectProcess({ command: process.execPath, args: ["-e", childSource, secret] })
      expect(spawnSync(descendant.command, [...descendant.args], { encoding: "utf8", timeout: 10_000 }).stdout).toBe("BLOCKED")
      const mcpSource = "process.stdin.on('data', chunk => { const r = JSON.parse(chunk); try { process.stdout.write(JSON.stringify({id:r.id,result:require('node:fs').readFileSync(r.params.path,'utf8')})) } catch {process.stdout.write(JSON.stringify({id:r.id,error:'BLOCKED'}))} });"
      const mcp = protection.protectProcess({ command: process.execPath, args: ["-e", mcpSource] })
      const rpc = spawnSync(mcp.command, [...mcp.args], { encoding: "utf8", timeout: 10_000, input: JSON.stringify({ id: 1, params: { path: secret } }) })
      expect(JSON.parse(rpc.stdout)).toEqual({ id: 1, error: "BLOCKED" })
      const allowed = protection.protectProcess({ command: process.execPath, args: ["-e", readSource, publicFile] })
      expect(spawnSync(allowed.command, [...allowed.args], { encoding: "utf8", timeout: 10_000 }).stdout).toBe("public-canary")
      const dns = protection.protectProcess({ command: process.execPath, args: ["-e", "require('node:dns').lookup('localhost', e => process.stdout.write(e ? e.code : 'OK'))"] })
      const dnsResult = spawnSync(dns.command, [...dns.args], { encoding: "utf8", timeout: 10_000 })
      expect({ status: dnsResult.status, stdout: dnsResult.stdout, stderr: dnsResult.stderr, signal: dnsResult.signal }).toMatchObject({ status: 0, stdout: "OK", stderr: "" })
      const rename = protection.protectProcess({ command: process.execPath, args: ["-e", "try { require('node:fs').renameSync(process.argv[1],process.argv[1]+'-moved'); process.stdout.write('MOVED') } catch {process.stdout.write('BLOCKED')}", root] })
      expect(spawnSync(rename.command, [...rename.args], { encoding: "utf8", timeout: 10_000 }).stdout).toBe("BLOCKED")
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(`${root}-moved`, { recursive: true, force: true })
    }
  })
})

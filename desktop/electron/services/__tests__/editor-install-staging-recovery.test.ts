import { spawn } from "node:child_process"
import { once } from "node:events"
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { build } from "esbuild"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createPermissionGuard, InMemoryAuditSink } from "../../runtime/security"
import { EditorInstallStagingRecovery } from "../editor-install-staging-recovery"

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(deniedActions: readonly string[] = []) {
  const root = await mkdtemp(path.join(os.tmpdir(), "sy-install-recovery-"))
  roots.push(root)
  const skills = path.join(root, "skills")
  const trash = path.join(root, "trash")
  await mkdir(skills)
  await mkdir(trash)
  const auditSink = new InMemoryAuditSink()
  const permissionGuard = createPermissionGuard({ constraints: [{
    id: "fixture-deny", decide: request => deniedActions.includes(request.action) ? "deny" : "defer-to-next",
  }] })
  const logger = { info: vi.fn(), warn: vi.fn() }
  const service = new EditorInstallStagingRecovery({
    listSkillDirectories: async () => [skills, skills],
    // The filesystem move is real; only the OS-specific trash service is replaced.
    trashItem: async item => rename(item, path.join(trash, path.basename(item))),
    permissionGuard, auditSink, logger,
  })
  return { root, skills, trash, auditSink, permissionGuard, logger, service }
}

async function legacySkill(root: string, name: string, old: boolean, id = "synapse-skill") {
  const directory = path.join(root, name)
  await mkdir(directory)
  await writeFile(path.join(directory, "SKILL.md"), "---\nname: synapse-skill\n---\nold skill")
  await writeFile(path.join(directory, ".synapse.json"), JSON.stringify({ id }))
  if (old) {
    const yesterday = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    await utimes(directory, yesterday, yesterday)
  }
  return directory
}

describe("editor install staging recovery", () => {
  it.each(["population", "marker-write"])("recovers a real installation killed during %s, without changing the installed Skill", async (interruptedPhase) => {
    const f = await fixture()
    const target = await legacySkill(f.skills, "synapse-skill", false)
    const script = path.join(f.root, "install.cjs")
    await build({
      stdin: {
        contents: `import { replaceDirectoryAtomically } from ${JSON.stringify(path.resolve("electron/services/editor-file-write-utils.ts"))};
          import { writeFile } from 'node:fs/promises';
          import path from 'node:path';
          replaceDirectoryAtomically(process.argv[2], async staging => {
            await writeFile(path.join(staging, 'SKILL.md'), 'partial new skill');
            process.stdout.write('STAGED\\n');
            await new Promise(() => {});
          }).catch(error => { process.stderr.write(String(error)); process.exitCode = 1 });
          setInterval(() => {}, 1000);`,
        resolveDir: process.cwd(),
      },
      bundle: true, platform: "node", format: "cjs", outfile: script,
      plugins: [{ name: "isolate-log-sink", setup(builder) {
        builder.onResolve({ filter: /\/log-store$/ }, () => ({ path: "logger", namespace: "test" }))
        builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export const createMainLogger = () => ({ info() {}, warn() {} })" }))
        if (interruptedPhase === "marker-write") {
          builder.onResolve({ filter: /^node:fs\/promises$/ }, args => args.namespace === "fs-interruption"
            ? { path: args.path, external: true }
            : { path: args.path, namespace: "fs-interruption" })
          builder.onLoad({ filter: /.*/, namespace: "fs-interruption" }, () => ({ contents: `
            export * from 'node:fs/promises';
            import { writeFile as realWriteFile } from 'node:fs/promises';
            export async function writeFile(file, ...args) {
              if (String(file).endsWith('/transaction.json')) {
                await realWriteFile(file, '{"version":');
                process.stdout.write('STAGED\\n');
                await new Promise(() => {});
              }
              return realWriteFile(file, ...args);
            }`,
          }))
        }
      } }],
    })
    const child = spawn(process.execPath, [script, target], { stdio: ["ignore", "pipe", "pipe"] })
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("child did not stage the Skill")), 5000)
        child.stdout.on("data", data => {
          if (String(data).includes("STAGED")) { clearTimeout(timer); resolve() }
        })
        child.once("error", error => { clearTimeout(timer); reject(error) })
        child.once("exit", code => { clearTimeout(timer); reject(new Error(`installer exited before staging: ${code}`)) })
      })
      // A second app starting while this installation runs must leave it alone.
      await f.service.recover()
      expect(await readdir(f.trash)).toEqual([])
      const exited = once(child, "exit")
      child.kill("SIGKILL")
      await exited
      expect((await readdir(f.skills)).filter(name => name.startsWith(".synapse-install-dir-"))).toHaveLength(1)

      await f.service.recover()
      expect(await readdir(f.skills)).toEqual(["synapse-skill"])
      const recovered = await readdir(f.trash)
      expect(recovered).toHaveLength(1)
      if (interruptedPhase === "population") {
        await expect(readFile(path.join(f.trash, recovered[0]!, "payload/SKILL.md"), "utf8"))
          .resolves.toBe("partial new skill")
      } else {
        await expect(readFile(path.join(f.trash, recovered[0]!, "transaction.json"), "utf8"))
          .resolves.toBe('{"version":')
      }
      await expect(readFile(path.join(target, "SKILL.md"), "utf8")).resolves.toContain("old skill")
      await f.service.recover()
      expect(await readdir(f.trash)).toEqual(recovered)
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, "exit")
        child.kill("SIGKILL")
        await exited
      }
    }
  })

  it("trashes only old legacy staging with an installed identity match and preserves backups and unknown entries", async () => {
    const f = await fixture()
    await legacySkill(f.skills, "synapse-skill", false)
    await legacySkill(f.skills, ".synapse-install-dir-Ab1234", true)
    await legacySkill(f.skills, ".synapse-install-dir-New123", false)
    await legacySkill(f.skills, ".synapse-install-dir-No1234", true, "not-installed")
    await legacySkill(f.skills, ".synapse-install-backup-synapse-skill-123", true)
    await legacySkill(f.skills, ".custom-hidden", true)
    const external = await legacySkill(f.root, "external", true)
    await symlink(external, path.join(f.skills, ".synapse-install-dir-Link12"))

    await f.service.recover()

    expect(await readdir(f.trash)).toEqual([".synapse-install-dir-Ab1234"])
    expect(await readdir(f.skills)).toEqual([
      ".custom-hidden", ".synapse-install-backup-synapse-skill-123", ".synapse-install-dir-Link12",
      ".synapse-install-dir-New123", ".synapse-install-dir-No1234", "synapse-skill",
    ])
    await expect(readFile(path.join(external, "SKILL.md"), "utf8")).resolves.toContain("old skill")
  })

  it("preserves a container owned by a live process and a malformed transaction", async () => {
    const f = await fixture()
    for (const [name, marker] of [
      [".synapse-install-dir-Live12", { version: 1, ownerPid: process.pid, targetName: "skill" }],
      [".synapse-install-dir-Bad123", { version: 1, ownerPid: -1, targetName: "skill" }],
    ] as const) {
      const dir = await legacySkill(f.skills, name, true)
      await writeFile(path.join(dir, "transaction.json"), JSON.stringify(marker))
    }
    await f.service.recover()
    expect(await readdir(f.trash)).toEqual([])
    expect(await readdir(f.skills)).toHaveLength(2)
  })

  it("honors a write denial without changing the staging directory", async () => {
    const f = await fixture(["fs.write.outside-userdata"])
    await legacySkill(f.skills, "synapse-skill", false)
    const dir = await legacySkill(f.skills, ".synapse-install-dir-Ab1234", true)
    await f.service.recover()
    expect((await lstat(dir)).isDirectory()).toBe(true)
    expect(await readdir(f.trash)).toEqual([])
    expect(f.auditSink.list().some(event => event.outcome === "denied" && event.resource === dir)).toBe(true)
  })

  it("retains staging when the trash service fails, audits failure, and retries on the next recovery", async () => {
    const f = await fixture()
    await legacySkill(f.skills, "synapse-skill", false)
    const dir = await legacySkill(f.skills, ".synapse-install-dir-Ab1234", true)
    let fail = true
    const service = new EditorInstallStagingRecovery({
      ...f,
      listSkillDirectories: async () => [f.skills],
      trashItem: async directory => {
        if (fail) throw Object.assign(new Error("private-path secret must not be logged"), { code: "EACCES" })
        await rename(directory, path.join(f.trash, path.basename(directory)))
      },
    })
    await service.recover()
    expect((await lstat(dir)).isDirectory()).toBe(true)
    expect(f.auditSink.list().some(event => event.resource === dir && event.outcome === "failed")).toBe(true)
    expect(JSON.stringify(f.logger.warn.mock.calls)).not.toContain("private-path secret")
    fail = false
    await service.recover()
    expect(await readdir(f.trash)).toEqual([".synapse-install-dir-Ab1234"])
    service.stop()
  })

  it("does not inspect or move entries when root reads are denied", async () => {
    const f = await fixture(["fs.read.outside-userdata"])
    await legacySkill(f.skills, "synapse-skill", false)
    await legacySkill(f.skills, ".synapse-install-dir-Ab1234", true)
    await f.service.recover()
    expect(await readdir(f.trash)).toEqual([])
    expect(f.auditSink.list().some(event => event.resource === f.skills && event.outcome === "denied")).toBe(true)
  })

  it("recovers an old empty container but preserves recent empty and unknown nonempty containers", async () => {
    const f = await fixture()
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000)
    for (const name of [".synapse-install-dir-Old123", ".synapse-install-dir-New123", ".synapse-install-dir-Unk123"]) {
      await mkdir(path.join(f.skills, name))
    }
    await writeFile(path.join(f.skills, ".synapse-install-dir-Unk123", "notes.txt"), "keep")
    await utimes(path.join(f.skills, ".synapse-install-dir-Old123"), old, old)
    await utimes(path.join(f.skills, ".synapse-install-dir-Unk123"), old, old)
    await f.service.recover()
    expect(await readdir(f.trash)).toEqual([".synapse-install-dir-Old123"])
    expect(await readdir(f.skills)).toEqual([".synapse-install-dir-New123", ".synapse-install-dir-Unk123"])
  })

  it("does not revoke unrelated live permissions after background recovery", async () => {
    const f = await fixture()
    let revoked = false
    f.permissionGuard.onRevoked(() => { revoked = true })
    await f.service.recover()
    expect(revoked).toBe(false)
    f.service.stop()
    expect(revoked).toBe(true)
  })

  it("preserves malformed PID names even when they contain an old matching Skill", async () => {
    const f = await fixture()
    await legacySkill(f.skills, "synapse-skill", false)
    for (const name of [
      ".synapse-install-dir-p0-Ab1234", ".synapse-install-dir-p99999999999999999999-Ab1234",
      ".synapse-install-dir-p-1-Ab1234", ".synapse-install-dir-p123-Ab12345",
    ]) await legacySkill(f.skills, name, true)
    await f.service.recover()
    expect(await readdir(f.trash)).toEqual([])
    expect(await readdir(f.skills)).toHaveLength(5)
  })
})

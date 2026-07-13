import { chmod, lstat, mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { isSkillTargetDiscoverable, scanSkillNames, scanSkillRoots } from "../scanner"

const roots: string[] = []

async function fixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "skill-uninstaller-scan-"))
  roots.push(root)
  return root
}

async function skill(root: string, relative: string, frontmatterName?: string): Promise<string> {
  const dir = path.join(root, relative)
  await mkdir(dir, { recursive: true })
  const frontmatter = frontmatterName
    ? `---\nname: ${frontmatterName}\ndescription: test\n---\n`
    : "# Skill\n"
  await writeFile(path.join(dir, "SKILL.md"), frontmatter)
  return dir
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises")
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("scanSkillNames", () => {
  it("uses frontmatter names, falls back to directory names, and deduplicates case-insensitively", async () => {
    const firstRoot = await fixture()
    const secondRoot = await fixture()
    await skill(firstRoot, "folder-z", "zulu")
    await skill(firstRoot, "Alpha")
    await skill(secondRoot, "duplicate-z", "ZULU")

    const result = await scanSkillNames({
      roots: [firstRoot, secondRoot].map((root) => ({ path: root, editorIds: [] })),
    })

    expect(result).toEqual({
      names: ["Alpha", "zulu"],
      complete: true,
      warnings: [],
    })
  })

  it("shares traversal exclusions and cancellation behavior with candidate scans", async () => {
    const root = await fixture()
    await skill(root, "node_modules/excluded")
    const parent = await skill(root, "bundle", "bundle")
    await skill(parent, "nested/hidden", "hidden")

    const result = await scanSkillNames({ roots: [{ path: root, editorIds: [] }] })
    expect(result.names).toEqual(["bundle"])

    const controller = new AbortController()
    controller.abort()
    await expect(scanSkillNames({
      roots: [{ path: root, editorIds: [] }],
      signal: controller.signal,
    })).resolves.toMatchObject({
      names: [],
      complete: false,
      warnings: ["扫描已取消。"],
    })
  })
})

describe("scanSkillRoots", () => {
  it("matches directory or frontmatter name case-insensitively and returns every location", async () => {
    const root = await fixture()
    const first = await skill(root, ".cursor/skills/Jenkins")
    const second = await skill(root, "nested/custom-folder", "JENKINS")

    const result = await scanSkillRoots({
      query: { name: "jenkins", searchRootPath: root },
      roots: [{ path: root, editorIds: [] }],
      classifyEditors: (candidatePath) => candidatePath === first ? ["cursor"] : [],
    })

    expect(result.complete).toBe(true)
    expect(result.candidates.map((candidate) => candidate.path).sort()).toEqual([first, second].sort())
    expect(result.candidates[0]?.source).toBe("external")
  })

  it("skips excluded directories and does not descend below a Skill root", async () => {
    const root = await fixture()
    await skill(root, "node_modules/jenkins")
    const parent = await skill(root, "bundle", "other")
    await skill(parent, "children/jenkins")

    const result = await scanSkillRoots({
      query: { name: "jenkins", searchRootPath: root },
      roots: [{ path: root, editorIds: [] }],
      classifyEditors: () => [],
    })

    expect(result.candidates).toEqual([])
  })

  it("does not follow symlink directories and deduplicates real paths", async () => {
    const root = await fixture()
    const target = await skill(root, "real/jenkins")
    await symlink(path.dirname(target), path.join(root, "linked"), "dir")

    const result = await scanSkillRoots({
      query: { name: "jenkins", searchRootPath: root },
      roots: [
        { path: root, editorIds: ["cursor"] },
        { path: root, editorIds: ["codex"] },
      ],
      classifyEditors: () => [],
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.editorIds.sort()).toEqual(["codex", "cursor"])
  })

  it("returns partial results when cancelled or limited", async () => {
    const root = await fixture()
    await skill(root, "a/jenkins")
    await mkdir(path.join(root, "b", "c", "d"), { recursive: true })

    const limited = await scanSkillRoots({
      query: { name: "jenkins", searchRootPath: root },
      roots: [{ path: root, editorIds: [] }],
      classifyEditors: () => [],
      limits: { maxDepth: 1, maxDirectories: 50, timeoutMs: 30_000, concurrency: 1 },
    })
    expect(limited.complete).toBe(false)
    expect(limited.warnings).toContain("目录层级超过上限，当前结果可能不完整。")

    const controller = new AbortController()
    controller.abort()
    const cancelled = await scanSkillRoots({
      query: { name: "jenkins", searchRootPath: root },
      roots: [{ path: root, editorIds: [] }],
      classifyEditors: () => [],
      signal: controller.signal,
    })
    expect(cancelled).toMatchObject({ complete: false, warnings: ["扫描已取消。"] })
  })

  it("scans the last directory allowed by the directory limit", async () => {
    const root = await fixture()
    await skill(root, ".", "jenkins")

    const result = await scanSkillRoots({
      query: { name: "jenkins", searchRootPath: root },
      roots: [{ path: root, editorIds: [] }],
      classifyEditors: () => [],
      limits: { maxDirectories: 1, concurrency: 1 },
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.complete).toBe(true)
  })

  it("lets admitted workers finish when another worker reaches the directory limit", async () => {
    const first = await fixture()
    const second = await fixture()
    const third = await fixture()
    await Promise.all([
      skill(first, ".", "jenkins"),
      skill(second, ".", "jenkins"),
      skill(third, ".", "jenkins"),
    ])

    const result = await scanSkillRoots({
      query: { name: "jenkins" },
      roots: [first, second, third].map((root) => ({ path: root, editorIds: [] })),
      classifyEditors: () => [],
      limits: { maxDirectories: 2, concurrency: 3 },
    })

    expect(result.candidates).toHaveLength(2)
    expect(result.warnings).toContain("目录数量超过上限，当前结果可能不完整。")
  })

  it("honors cancellation when there are no roots to schedule", async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await scanSkillRoots({
      query: { name: "jenkins" },
      roots: [],
      classifyEditors: () => [],
      signal: controller.signal,
    })

    expect(result).toMatchObject({ complete: false, warnings: ["扫描已取消。"] })
  })

  it("does not add a candidate when cancelled during editor classification", async () => {
    const root = await fixture()
    await skill(root, ".", "jenkins")
    const controller = new AbortController()
    let markClassificationStarted!: () => void
    const classificationStarted = new Promise<void>((resolve) => {
      markClassificationStarted = resolve
    })
    let releaseClassification!: () => void
    const classificationGate = new Promise<void>((resolve) => {
      releaseClassification = resolve
    })

    const scan = scanSkillRoots({
      query: { name: "jenkins" },
      roots: [{ path: root, editorIds: [] }],
      classifyEditors: async () => {
        markClassificationStarted()
        await classificationGate
        return []
      },
      signal: controller.signal,
    })
    await classificationStarted
    controller.abort()
    releaseClassification()

    const result = await scan
    expect(result).toMatchObject({
      candidates: [],
      complete: false,
      warnings: ["扫描已取消。"],
    })
  })

  it("does not add a candidate when timing out during editor classification", async () => {
    const root = await fixture()
    await skill(root, ".", "jenkins")

    const result = await scanSkillRoots({
      query: { name: "jenkins" },
      roots: [{ path: root, editorIds: [] }],
      classifyEditors: async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return []
      },
      limits: { timeoutMs: 1 },
    })

    expect(result).toMatchObject({
      candidates: [],
      complete: false,
      warnings: ["扫描超时，当前结果可能不完整。"],
    })
  })

  it("settles on timeout when editor classification never resolves", async () => {
    const root = await fixture()
    await skill(root, ".", "jenkins")

    const result = await scanSkillRoots({
      query: { name: "jenkins" },
      roots: [{ path: root, editorIds: [] }],
      classifyEditors: () => new Promise(() => undefined),
      limits: { timeoutMs: 5 },
    })

    expect(result).toMatchObject({
      candidates: [],
      complete: false,
      warnings: ["扫描超时，当前结果可能不完整。"],
    })
  })

  it("fails when the explicit root cannot be enumerated", async () => {
    const root = await fixture()
    const missing = path.join(root, "missing")

    await expect(scanSkillRoots({
      query: { name: "jenkins", searchRootPath: missing },
      roots: [{ path: missing, editorIds: [] }],
      classifyEditors: () => [],
      rootErrorsFatal: true,
    })).rejects.toThrow()
  })

  it("returns a warning for an unavailable registered root", async () => {
    const root = await fixture()
    const missing = path.join(root, "missing")
    const result = await scanSkillRoots({
      query: { name: "jenkins" },
      roots: [{ path: missing, editorIds: ["codex"] }],
      classifyEditors: () => [],
    })

    expect(result).toEqual({
      candidates: [],
      complete: true,
      warnings: [],
    })
  })

  it("returns a partial warning for a registered root with a non-ENOENT read error", async () => {
    const root = await fixture()
    await chmod(root, 0)
    try {
      const result = await scanSkillRoots({
        query: { name: "jenkins" },
        roots: [{ path: root, editorIds: ["codex"] }],
        classifyEditors: () => [],
      })

      expect(result.candidates).toEqual([])
      expect(result.complete).toBe(false)
      expect(result.warnings).not.toEqual([])
    } finally {
      await chmod(root, 0o700)
    }
  })

  it("continues below an unreadable SKILL.md instead of treating it as a Skill root", async () => {
    const root = await fixture()
    const parent = await skill(root, "parent", "other")
    const nested = await skill(parent, "nested/jenkins")
    const parentSkill = path.join(parent, "SKILL.md")
    await chmod(parentSkill, 0)
    try {
      const result = await scanSkillRoots({
        query: { name: "jenkins" },
        roots: [{ path: root, editorIds: [] }],
        classifyEditors: () => [],
      })

      expect(result.candidates.map((candidate) => candidate.path)).toEqual([nested])
      expect(result.complete).toBe(false)
      expect(result.warnings).toContain("部分 Skill 文件无法读取，当前结果可能不完整。")
    } finally {
      await chmod(parentSkill, 0o600)
    }
  })

  it("continues below a directory when lstat of its SKILL.md fails", async () => {
    const root = await fixture()
    const parent = path.join(root, "parent")
    await mkdir(parent)
    const nested = await skill(parent, "nested/jenkins")
    const parentSkill = path.join(parent, "SKILL.md")
    const result = await scanSkillRoots({
      query: { name: "jenkins" },
      roots: [{ path: root, editorIds: [] }],
      classifyEditors: () => [],
      skillFileSystem: {
        lstat: async (targetPath) => {
          if (targetPath === parentSkill) throw Object.assign(new Error("denied"), { code: "EACCES" })
          return lstat(targetPath)
        },
        readFile,
      },
    })

    expect(result.candidates.map((candidate) => candidate.path)).toEqual([nested])
    expect(result.complete).toBe(false)
    expect(result.warnings).toContain("部分 Skill 文件无法读取，当前结果可能不完整。")
  })

  it("does not let an ancestor SKILL.md lstat error hide a discoverable target", async () => {
    const root = await fixture()
    const parent = path.join(root, "parent")
    await mkdir(parent)
    const target = await skill(parent, "nested/jenkins")
    const parentSkill = path.join(parent, "SKILL.md")
    const canonicalParentSkill = path.join(await realpath(parent), "SKILL.md")

    await expect(isSkillTargetDiscoverable({
      query: { name: "jenkins" },
      roots: [await realpath(root)],
      targetPath: await realpath(target),
      skillFileSystem: {
        lstat: async (targetPath) => {
          if (targetPath === parentSkill || targetPath === canonicalParentSkill) {
            throw Object.assign(new Error("denied"), { code: "EACCES" })
          }
          return lstat(targetPath)
        },
        readFile,
      },
    })).resolves.toBe(true)
  })

  it("stops all workers after a fatal root failure", async () => {
    const hangingRoot = await fixture()
    const fatalRoot = await fixture()
    const lateRoot = await fixture()
    await skill(hangingRoot, ".", "jenkins")
    await skill(fatalRoot, ".", "jenkins")
    await skill(lateRoot, ".", "jenkins")
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let markHangingStarted!: () => void
    const hangingStarted = new Promise<void>((resolve) => { markHangingStarted = resolve })
    const classified: string[] = []

    const scan = scanSkillRoots({
      query: { name: "jenkins" },
      roots: [hangingRoot, fatalRoot, lateRoot].map((root) => ({ path: root, editorIds: [] })),
      classifyEditors: async (candidatePath) => {
        classified.push(candidatePath)
        if (candidatePath === hangingRoot) {
          markHangingStarted()
          await gate
        }
        if (candidatePath === fatalRoot) {
          await hangingStarted
          throw new Error("fatal")
        }
        return []
      },
      limits: { concurrency: 2 },
    })

    await expect(scan).rejects.toThrow()
    release()
    await Promise.resolve()
    await Promise.resolve()
    expect(classified).toHaveLength(2)
    expect(new Set(classified)).toEqual(new Set([hangingRoot, fatalRoot]))
    expect(classified).not.toContain(lateRoot)
  })

  it("settles on cancellation when editor classification never resolves", async () => {
    const root = await fixture()
    await skill(root, ".", "jenkins")
    const controller = new AbortController()
    let started!: () => void
    const classificationStarted = new Promise<void>((resolve) => { started = resolve })
    const scan = scanSkillRoots({
      query: { name: "jenkins" },
      roots: [{ path: root, editorIds: [] }],
      classifyEditors: () => {
        started()
        return new Promise(() => undefined)
      },
      signal: controller.signal,
    })
    await classificationStarted
    controller.abort()

    await expect(scan).resolves.toMatchObject({
      candidates: [],
      complete: false,
      warnings: ["扫描已取消。"],
    })
  })

  it("reports a timeout reached while the final empty directory read finishes", async () => {
    const root = await fixture()
    let calls = 0
    const now = vi.spyOn(Date, "now").mockImplementation(() => ++calls <= 4 ? 0 : 100)

    try {
      const result = await scanSkillRoots({
        query: { name: "jenkins" },
        roots: [{ path: root, editorIds: [] }],
        classifyEditors: () => [],
        limits: { timeoutMs: 50, concurrency: 1 },
      })

      expect(result).toMatchObject({
        candidates: [],
        complete: false,
        warnings: ["扫描超时，当前结果可能不完整。"],
      })
    } finally {
      now.mockRestore()
    }
  })
})

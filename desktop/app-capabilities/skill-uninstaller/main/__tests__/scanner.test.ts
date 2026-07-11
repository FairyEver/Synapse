import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { scanSkillRoots } from "../scanner"

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
})

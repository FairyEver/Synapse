import { constants } from "node:fs"
import { access, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { execFile } from "node:child_process"
import { afterEach, describe, expect, it } from "vitest"

import { DragonScaleBoundaryService } from "../dragonscale/boundary-service"
import type { DragonScaleBoundaryScoreResult } from "../dragonscale/boundary-types"

const execFileAsync = promisify(execFile)
const roots: string[] = []
const compatibilityTestTimeoutMs = process.platform === "win32" ? 30_000 : 5_000

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-kb-boundary-compat-"))
  roots.push(dir)
  return dir
}

async function writePage(root: string, relativePath: string, content: string): Promise<void> {
  const filePath = path.join(root, ...relativePath.split("/"))
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

async function hasPython3(): Promise<boolean> {
  try {
    await execFileAsync("python3", ["--version"])
    return true
  } catch {
    return false
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => (
    rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  )))
})

describe("DragonScaleBoundaryService upstream compatibility", () => {
  it("matches vendored boundary-score.py JSON output for a representative fixture", { timeout: compatibilityTestTimeoutMs }, async () => {
    if (!await hasPython3()) {
      console.warn("python3 not available; skipping boundary-score.py compatibility assertion.")
      return
    }

    const repoRoot = path.resolve(__dirname, "../../../..")
    const upstreamScript = path.join(
      repoRoot,
      "resources",
      "knowledge-base",
      "dragonscale",
      "upstream",
      "boundary-score.py",
    )
    await access(upstreamScript, constants.R_OK)

    const root = await tempDir()
    await mkdir(path.join(root, "scripts"), { recursive: true })
    await copyFile(upstreamScript, path.join(root, "scripts", "boundary-score.py"))

    await writePage(root, "wiki/concepts/Alpha.md", [
      "---",
      "type: concept",
      "title: Alpha Frontier",
      "created: 2999-01-01",
      "---",
      "",
      "[[Beta]] [[folder/Beta#Heading|Alias]] [[Missing]] [[Alpha]]",
      "    [[Gamma]]",
      "```",
      "[[Gamma]]",
      "```",
      "",
    ].join("\n"))
    await writePage(root, "wiki/concepts/Beta.md", [
      "---",
      "type: concept",
      "created: 2999-01-01",
      "---",
      "",
      "[[Gamma]]",
      "",
    ].join("\n"))
    await writePage(root, "wiki/concepts/Gamma.md", "---\ntype: concept\ncreated: 2999-01-01\n---\n\n# Gamma\n")
    await writePage(root, "wiki/concepts/Zero.md", "---\ntype: concept\ncreated: 2999-01-01\n---\n\n# Zero\n")
    await writePage(root, "wiki/meta/Ignored.md", "---\ntype: concept\ncreated: 2999-01-01\n---\n\n[[Gamma]]\n")

    const python = await execFileAsync("python3", [
      path.join(root, "scripts", "boundary-score.py"),
      "--json",
      "--include-score-zero",
      "--top",
      "20",
    ], { cwd: root })
    const upstream = JSON.parse(python.stdout) as {
      readonly halflife_days: number
      readonly page_count_scoreable: number
      readonly results: readonly UpstreamBoundaryScoreResult[]
    }
    const service = await new DragonScaleBoundaryService().score(root, {
      includeScoreZero: true,
      top: 20,
    })

    expect(service.halflifeDays).toBe(upstream.halflife_days)
    expect(service.pageCountScoreable).toBe(upstream.page_count_scoreable)
    expect(service.results).toEqual(upstream.results.map(normalizeUpstreamResult))
  })
})

interface UpstreamBoundaryScoreResult {
  readonly title: string
  readonly title_key: string
  readonly path: string
  readonly out_degree: number
  readonly in_degree: number
  readonly age_days: number
  readonly recency_weight: number
  readonly score: number
}

function normalizeUpstreamResult(result: UpstreamBoundaryScoreResult): DragonScaleBoundaryScoreResult {
  return {
    title: result.title,
    titleKey: result.title_key,
    path: result.path,
    outDegree: result.out_degree,
    inDegree: result.in_degree,
    ageDays: result.age_days,
    recencyWeight: result.recency_weight,
    score: result.score,
  }
}

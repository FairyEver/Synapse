# DragonScale Script Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the first production-safe DragonScale migration slice: vendor upstream scripts internally, add a guarded runner boundary, and replace address allocation with a Synapse service while keeping user vaults free of runnable scripts.

**Architecture:** Upstream scripts live under Synapse resources as a compatibility oracle. Production address allocation runs through `DragonScaleAddressService` in `desktop/electron/services/knowledge-base/dragonscale/`, while `.vault-meta/address-counter.txt` remains in the user vault as data. Tests verify template cleanliness and address behavior.

**Tech Stack:** Electron main process, TypeScript, Node filesystem APIs, Vitest, Synapse knowledge-base service resources.

---

### Task 1: Vendor Upstream DragonScale Scripts Internally

**Files:**
- Create: `desktop/resources/knowledge-base/dragonscale/upstream/UPSTREAM.md`
- Create: `desktop/resources/knowledge-base/dragonscale/upstream/allocate-address.sh`
- Create: `desktop/resources/knowledge-base/dragonscale/upstream/boundary-score.py`
- Create: `desktop/resources/knowledge-base/dragonscale/upstream/tiling-check.py`
- Test: `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`

- [ ] **Step 1: Add a vault cleanliness regression test**

Add this test to `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`:

```ts
it("does not copy DragonScale upstream scripts into a user vault", async () => {
  const root = await tempDir()
  const service = new KnowledgeBaseService({
    templateRoot: path.join(process.cwd(), "resources", "knowledge-base", "templates"),
  })

  await service.initialize({ projectPath: root, mode: "create" })

  await expect(pathExists(path.join(root, "scripts", "allocate-address.sh"))).resolves.toBe(false)
  await expect(pathExists(path.join(root, "scripts", "boundary-score.py"))).resolves.toBe(false)
  await expect(pathExists(path.join(root, "scripts", "tiling-check.py"))).resolves.toBe(false)
  await expect(pathExists(path.join(root, ".vault-meta", "address-counter.txt"))).resolves.toBe(false)
})
```

If the test file does not expose `pathExists`, import `access` from `node:fs/promises` and add a local helper:

```ts
async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 2: Run the test to verify current cleanliness**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts --testNamePattern "DragonScale upstream scripts"
```

Expected: PASS if templates are already clean. This is a regression guard, not a red test.

- [ ] **Step 3: Copy upstream scripts into Synapse resources**

Copy these files from `AgriciDaniel/claude-obsidian` commit `75d3b6f` into:

```text
desktop/resources/knowledge-base/dragonscale/upstream/allocate-address.sh
desktop/resources/knowledge-base/dragonscale/upstream/boundary-score.py
desktop/resources/knowledge-base/dragonscale/upstream/tiling-check.py
```

Create `UPSTREAM.md`:

```md
# DragonScale Upstream Scripts

Source repository: https://github.com/AgriciDaniel/claude-obsidian
Source commit: 75d3b6f

Vendored files:

- scripts/allocate-address.sh
- scripts/boundary-score.py
- scripts/tiling-check.py

These scripts are compatibility references for Synapse DragonScale behavior.
Do not copy them into user knowledge-base vaults.
Production behavior should move into Synapse services under
desktop/electron/services/knowledge-base/dragonscale/.
```

- [ ] **Step 4: Verify vendored files are not under templates**

Run:

```bash
find desktop/resources/knowledge-base/templates -maxdepth 5 -type f | sort | rg "(allocate-address|boundary-score|tiling-check|scripts/)" || true
```

Expected: no output.

### Task 2: Define DragonScale Service Types

**Files:**
- Create: `desktop/electron/services/knowledge-base/dragonscale/types.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/dragonscale-address-service.test.ts`

- [ ] **Step 1: Write a failing import test for service types**

Create `desktop/electron/services/knowledge-base/__tests__/dragonscale-address-service.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import type { DragonScaleAddress } from "../dragonscale/types"

describe("DragonScaleAddressService", () => {
  it("uses c-prefixed six digit addresses", () => {
    const address: DragonScaleAddress = "c-000042"
    expect(address).toBe("c-000042")
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/dragonscale-address-service.test.ts
```

Expected: FAIL because `../dragonscale/types` does not exist.

- [ ] **Step 3: Add DragonScale types**

Create `desktop/electron/services/knowledge-base/dragonscale/types.ts`:

```ts
export type DragonScaleAddress = `c-${string}`

export interface DragonScaleAddressAllocation {
  readonly address: DragonScaleAddress
  readonly nextCounter: number
}

export interface DragonScaleAddressServiceResult {
  readonly address: DragonScaleAddress
  readonly counterPath: string
}
```

- [ ] **Step 4: Run the type import test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/dragonscale-address-service.test.ts
```

Expected: PASS.

### Task 3: Implement DragonScaleAddressService

**Files:**
- Create: `desktop/electron/services/knowledge-base/dragonscale/address-service.ts`
- Modify: `desktop/electron/services/knowledge-base/__tests__/dragonscale-address-service.test.ts`

- [ ] **Step 1: Add failing allocation tests**

Replace `desktop/electron/services/knowledge-base/__tests__/dragonscale-address-service.test.ts` with:

```ts
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { DragonScaleAddressService } from "../dragonscale/address-service"

const roots: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-dragonscale-"))
  roots.push(dir)
  return dir
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("DragonScaleAddressService", () => {
  it("allocates the next address and increments the vault counter", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".vault-meta"), { recursive: true })
    await writeFile(path.join(root, ".vault-meta", "address-counter.txt"), "42\n")
    const service = new DragonScaleAddressService()

    const result = await service.allocate(root)

    expect(result.address).toBe("c-000042")
    await expect(readFile(path.join(root, ".vault-meta", "address-counter.txt"), "utf8"))
      .resolves.toBe("43\n")
  })

  it("peeks without incrementing", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".vault-meta"), { recursive: true })
    await writeFile(path.join(root, ".vault-meta", "address-counter.txt"), "7\n")
    const service = new DragonScaleAddressService()

    await expect(service.peek(root)).resolves.toBe(7)
    await expect(readFile(path.join(root, ".vault-meta", "address-counter.txt"), "utf8"))
      .resolves.toBe("7\n")
  })

  it("peeks a missing counter without creating it", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, "wiki"), { recursive: true })
    const service = new DragonScaleAddressService()

    await expect(service.peek(root)).resolves.toBe(1)
    await expect(pathExists(path.join(root, ".vault-meta", "address-counter.txt"))).resolves.toBe(false)
  })

  it("recovers a missing counter by scanning existing wiki frontmatter", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, "wiki", "concepts"), { recursive: true })
    await writeFile(path.join(root, "wiki", "concepts", "Alpha.md"), [
      "---",
      "type: concept",
      "address: c-000009",
      "---",
      "",
      "# Alpha",
      "",
    ].join("\n"))
    const service = new DragonScaleAddressService()

    const result = await service.allocate(root)

    expect(result.address).toBe("c-000010")
    await expect(readFile(path.join(root, ".vault-meta", "address-counter.txt"), "utf8"))
      .resolves.toBe("11\n")
  })

  it("rejects corrupt counters instead of silently resetting", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".vault-meta"), { recursive: true })
    await writeFile(path.join(root, ".vault-meta", "address-counter.txt"), "abc\n")
    const service = new DragonScaleAddressService()

    await expect(service.allocate(root)).rejects.toThrow("DragonScale address counter is corrupt")
  })

  it("serializes concurrent allocations for one vault", async () => {
    const root = await tempDir()
    await mkdir(path.join(root, ".vault-meta"), { recursive: true })
    await writeFile(path.join(root, ".vault-meta", "address-counter.txt"), "1\n")
    const service = new DragonScaleAddressService()

    const results = await Promise.all([
      service.allocate(root),
      service.allocate(root),
      service.allocate(root),
    ])

    expect(results.map((result) => result.address).sort()).toEqual([
      "c-000001",
      "c-000002",
      "c-000003",
    ])
    await expect(readFile(path.join(root, ".vault-meta", "address-counter.txt"), "utf8"))
      .resolves.toBe("4\n")
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/dragonscale-address-service.test.ts
```

Expected: FAIL because `DragonScaleAddressService` does not exist.

- [ ] **Step 3: Implement address service**

Create `desktop/electron/services/knowledge-base/dragonscale/address-service.ts`:

```ts
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import type { Dirent } from "node:fs"
import path from "node:path"

import type { DragonScaleAddress, DragonScaleAddressServiceResult } from "./types"

export class DragonScaleAddressService {
  private readonly locks = new Map<string, Promise<void>>()

  async allocate(vaultPath: string): Promise<DragonScaleAddressServiceResult> {
    return this.withVaultLock(vaultPath, async () => {
      const counterPath = await this.ensureCounter(vaultPath)
      const current = await this.readCounter(counterPath)
      await writeFile(counterPath, `${current + 1}\n`, "utf8")
      return { address: formatAddress(current), counterPath }
    })
  }

  async peek(vaultPath: string): Promise<number> {
    return this.withVaultLock(vaultPath, async () => {
      const counterPath = path.join(vaultPath, ".vault-meta", "address-counter.txt")
      try {
        return await this.readCounter(counterPath)
      } catch (error) {
        if (isMissingPathError(error)) return this.recoverNextCounter(vaultPath)
        throw error
      }
    })
  }

  async rebuild(vaultPath: string): Promise<number> {
    return this.withVaultLock(vaultPath, async () => {
      const next = await this.recoverNextCounter(vaultPath)
      const metaPath = path.join(vaultPath, ".vault-meta")
      await mkdir(metaPath, { recursive: true })
      await writeFile(path.join(metaPath, "address-counter.txt"), `${next}\n`, "utf8")
      return next
    })
  }

  private async ensureCounter(vaultPath: string): Promise<string> {
    const metaPath = path.join(vaultPath, ".vault-meta")
    const counterPath = path.join(metaPath, "address-counter.txt")
    await mkdir(metaPath, { recursive: true })
    try {
      await readFile(counterPath, "utf8")
      return counterPath
    } catch (error) {
      if (!isMissingPathError(error)) throw error
    }
    const next = await this.recoverNextCounter(vaultPath)
    await writeFile(counterPath, `${next}\n`, "utf8")
    return counterPath
  }

  private async readCounter(counterPath: string): Promise<number> {
    const raw = (await readFile(counterPath, "utf8")).trim()
    if (!/^[0-9]+$/.test(raw)) {
      throw new Error("DragonScale address counter is corrupt.")
    }
    return Number(raw)
  }

  private async recoverNextCounter(vaultPath: string): Promise<number> {
    const wikiPath = path.join(vaultPath, "wiki")
    const addresses = await scanMarkdownAddresses(wikiPath)
    const max = addresses.reduce((current, address) => Math.max(current, Number(address.slice(2))), 0)
    return max + 1
  }

  private async withVaultLock<T>(vaultPath: string, work: () => Promise<T>): Promise<T> {
    const key = path.resolve(vaultPath)
    const previous = this.locks.get(key) ?? Promise.resolve()
    let release: () => void = () => undefined
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.catch(() => undefined).then(() => current)
    this.locks.set(key, queued)
    await previous.catch(() => undefined)
    try {
      return await work()
    } finally {
      release()
      if (this.locks.get(key) === queued) {
        this.locks.delete(key)
      }
    }
  }
}

async function scanMarkdownAddresses(directoryPath: string): Promise<DragonScaleAddress[]> {
  let entries: Dirent[]
  try {
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch (error) {
    if (isMissingPathError(error)) return []
    throw error
  }
  const addresses: DragonScaleAddress[] = []
  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      addresses.push(...await scanMarkdownAddresses(entryPath))
      continue
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue
    const frontmatter = firstFrontmatterBlock(await readFile(entryPath, "utf8"))
    const match = frontmatter.match(/^address:\s+(c-[0-9]{6})\s*$/m)
    if (match?.[1]) addresses.push(match[1] as DragonScaleAddress)
  }
  return addresses
}

function firstFrontmatterBlock(content: string): string {
  if (!content.startsWith("---\n")) return ""
  const end = content.indexOf("\n---", 4)
  return end === -1 ? "" : content.slice(4, end)
}

function formatAddress(value: number): DragonScaleAddress {
  return `c-${String(value).padStart(6, "0")}` as DragonScaleAddress
}

function isMissingPathError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && ((error as { readonly code?: unknown }).code === "ENOENT"
      || (error as { readonly code?: unknown }).code === "ENOTDIR")
}
```

- [ ] **Step 4: Run address service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/dragonscale-address-service.test.ts
```

Expected: PASS.

### Task 4: Add A Guarded Script Runner Boundary

**Files:**
- Create: `desktop/electron/services/knowledge-base/dragonscale/script-runner.ts`
- Create: `desktop/electron/services/knowledge-base/__tests__/dragonscale-script-runner.test.ts`

- [ ] **Step 1: Write runner boundary tests**

Create `desktop/electron/services/knowledge-base/__tests__/dragonscale-script-runner.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import { DragonScaleScriptRunner } from "../dragonscale/script-runner"

describe("DragonScaleScriptRunner", () => {
  it("passes the vault root through SYNAPSE_KB_VAULT_ROOT", async () => {
    const run = vi.fn(async () => ({ exitCode: 0, stdout: "ok\n", stderr: "" }))
    const runner = new DragonScaleScriptRunner({
      scriptsRoot: "/Applications/Synapse/resources/knowledge-base/dragonscale/upstream",
      run,
    })

    await runner.run("allocate-address.sh", { vaultPath: "/Users/example/kb", args: ["--peek"] })

    expect(run).toHaveBeenCalledWith(expect.objectContaining({
      command: "/Applications/Synapse/resources/knowledge-base/dragonscale/upstream/allocate-address.sh",
      args: ["--peek"],
      env: expect.objectContaining({
        SYNAPSE_KB_VAULT_ROOT: "/Users/example/kb",
      }),
    }))
  })

  it("rejects script names outside the allowlist", async () => {
    const run = vi.fn()
    const runner = new DragonScaleScriptRunner({
      scriptsRoot: "/Applications/Synapse/resources/knowledge-base/dragonscale/upstream",
      run,
    })

    await expect(runner.run("../evil.sh", { vaultPath: "/Users/example/kb", args: [] }))
      .rejects.toThrow("Unsupported DragonScale script")
  })
})
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/dragonscale-script-runner.test.ts
```

Expected: FAIL because `DragonScaleScriptRunner` does not exist.

- [ ] **Step 3: Implement script runner boundary**

Create `desktop/electron/services/knowledge-base/dragonscale/script-runner.ts`:

```ts
import path from "node:path"

type ScriptName = "allocate-address.sh" | "boundary-score.py" | "tiling-check.py"

type ScriptRunRequest = {
  readonly command: string
  readonly args: readonly string[]
  readonly env: Record<string, string>
}

type ScriptRunResult = {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

type DragonScaleScriptRunnerDeps = {
  readonly scriptsRoot: string
  // Production wiring must provide a permission-checked, audited process runner.
  readonly run: (request: ScriptRunRequest) => Promise<ScriptRunResult>
}

export class DragonScaleScriptRunner {
  private readonly scriptsRoot: string
  private readonly runCommand: (request: ScriptRunRequest) => Promise<ScriptRunResult>

  constructor(deps: DragonScaleScriptRunnerDeps) {
    this.scriptsRoot = deps.scriptsRoot
    this.runCommand = deps.run
  }

  async run(scriptName: string, options: { readonly vaultPath: string; readonly args: readonly string[] }): Promise<ScriptRunResult> {
    if (!isSupportedScript(scriptName)) {
      throw new Error("Unsupported DragonScale script.")
    }
    return this.runCommand({
      command: path.join(this.scriptsRoot, scriptName),
      args: options.args,
      env: {
        SYNAPSE_KB_VAULT_ROOT: options.vaultPath,
      },
    })
  }
}

function isSupportedScript(scriptName: string): scriptName is ScriptName {
  return scriptName === "allocate-address.sh"
    || scriptName === "boundary-score.py"
    || scriptName === "tiling-check.py"
}
```

- [ ] **Step 4: Run runner tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/dragonscale-script-runner.test.ts
```

Expected: PASS.

### Task 5: Export DragonScale Services

**Files:**
- Modify: `desktop/electron/services/knowledge-base/index.ts`
- Test: `desktop/electron/services/knowledge-base/__tests__/dragonscale-address-service.test.ts`

- [ ] **Step 1: Add an export assertion**

Append to `desktop/electron/services/knowledge-base/__tests__/dragonscale-address-service.test.ts`:

```ts
it("exports the address service from the knowledge-base service barrel", async () => {
  const module = await import("../index")
  expect(module.DragonScaleAddressService).toBe(DragonScaleAddressService)
})
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/dragonscale-address-service.test.ts --testNamePattern "exports the address service"
```

Expected: FAIL because the barrel does not export `DragonScaleAddressService`.

- [ ] **Step 3: Export services**

Modify `desktop/electron/services/knowledge-base/index.ts`:

```ts
export {
  DragonScaleAddressService,
} from "./dragonscale/address-service"
export {
  DragonScaleScriptRunner,
} from "./dragonscale/script-runner"
export type {
  DragonScaleAddress,
  DragonScaleAddressAllocation,
  DragonScaleAddressServiceResult,
} from "./dragonscale/types"
```

- [ ] **Step 4: Run export test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/knowledge-base/__tests__/dragonscale-address-service.test.ts --testNamePattern "exports the address service"
```

Expected: PASS.

### Task 6: Run Focused Verification

**Files:**
- Verify: `desktop/electron/services/knowledge-base/__tests__/dragonscale-address-service.test.ts`
- Verify: `desktop/electron/services/knowledge-base/__tests__/dragonscale-script-runner.test.ts`
- Verify: `desktop/electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts`

- [ ] **Step 1: Run focused DragonScale and vault-template tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/services/knowledge-base/__tests__/dragonscale-address-service.test.ts \
  electron/services/knowledge-base/__tests__/dragonscale-script-runner.test.ts \
  electron/services/knowledge-base/__tests__/knowledge-base-service.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Inspect user-vault cleanliness**

Run:

```bash
find desktop/resources/knowledge-base/templates -maxdepth 5 -type f | sort | rg "(scripts/|allocate-address|boundary-score|tiling-check|SKILL.md|CLAUDE.md|hooks/|agents/|commands/)" || true
```

Expected: no output.

---

## Self-Review

- This plan implements only the first DragonScale migration slice.
- It does not wire address allocation into ingest yet; that belongs in the next plan after service behavior is verified.
- It does not implement boundary scoring or semantic tiling yet.
- It keeps scripts out of user vault templates.
- It gives Synapse an internal oracle path and a production TypeScript address service.

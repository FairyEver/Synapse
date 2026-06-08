# Dashboard Disaster Recovery Backup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the management dashboard backup archive so it contains database data, PostgreSQL globals, Drive COS object inventory, a backup manifest, and restore instructions without including `.env` or secrets.

**Architecture:** Keep the public dashboard API unchanged and expand `BackupService.performBackup()` internals. Add one focused backup package helper for manifest writing, checksums, and restore text so `BackupService` stays responsible for orchestration and COS IO. Drive file bytes are not copied; only Drive COS object metadata is listed.

**Tech Stack:** NestJS, TypeScript, `pg_dump`, `pg_dumpall`, `tar`, `cos-nodejs-sdk-v5`, Vitest.

---

## File Structure

- Modify `server/src/backup/backup.service.ts`: orchestrate the richer package, export PostgreSQL globals, generate Drive COS manifest, write backup manifest and restore instructions.
- Create `server/src/backup/backup-package.ts`: pure helpers and types for package manifest, JSON writing, SHA-256 file checksums, restore markdown, and secret scanning.
- Modify `server/src/backup/backup.service.spec.ts`: add regression tests for package contents, globals failure, Drive COS pagination, Drive COS failure, and secret exclusion.
- Modify `server/README.md`: update management backup and recovery documentation.
- Modify `RELEASE_NOTES_PENDING.md`: add a user-facing release note after implementation.

Do not modify dashboard UI in this plan.

## Task 1: Backup Package Helper

**Files:**
- Create: `server/src/backup/backup-package.ts`
- Test: `server/src/backup/backup.service.spec.ts`

- [ ] **Step 1: Write failing helper tests**

Add these imports near the top of `server/src/backup/backup.service.spec.ts`:

```ts
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import {
  createBackupManifest,
  createRestoreMarkdown,
  scanForSecretLikeText,
  sha256File,
  writeJsonFile,
} from "./backup-package"
```

Add this test block before `describe("BackupService", () => {`:

```ts
describe("backup package helpers", () => {
  it("writes stable JSON and calculates sha256 checksums", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-backup-package-"))
    const jsonPath = path.join(dir, "manifest.json")
    const textPath = path.join(dir, "payload.txt")

    try {
      await writeJsonFile(jsonPath, { ok: true, count: 2 })
      await writeFile(textPath, "payload", "utf8")

      await expect(readFile(jsonPath, "utf8")).resolves.toBe(
        "{\n  \"ok\": true,\n  \"count\": 2\n}\n",
      )
      await expect(sha256File(textPath)).resolves.toBe(
        "239f59ed55e737c77147cf55d72eec9c471e1b3874c1f8e7bd4f47494f2b4267",
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("creates a manifest without secret values", () => {
    const manifest = createBackupManifest({
      createdAt: "2026-06-08T14:23:25.189Z",
      appVersion: "0.1.0",
      migrationCount: 25,
      backupBucket: "synapse-file-backup-1252371654",
      backupRegion: "ap-beijing",
      driveBucket: "synapse-file-user-1252371654",
      driveRegion: "ap-beijing",
      contents: [
        {
          path: "database.sql.gz",
          sha256: "a".repeat(64),
          size: 1024,
        },
      ],
    })

    const serialized = JSON.stringify(manifest)
    expect(manifest.secretsIncluded).toBe(false)
    expect(manifest.driveObjectsIncluded).toBe(false)
    expect(serialized).not.toContain("SECRET")
    expect(serialized).not.toContain("TOKEN")
    expect(serialized).not.toContain("PASSWORD")
  })

  it("detects secret-like restore text regressions", () => {
    expect(scanForSecretLikeText("restore with bucket names only")).toBe(false)
    expect(scanForSecretLikeText("BACKUP_COS_SECRET_KEY=plain")).toBe(true)
    expect(scanForSecretLikeText("Authorization: Bearer token")).toBe(true)
  })

  it("creates restore markdown that points users to local server env", () => {
    const restore = createRestoreMarkdown({
      createdAt: "2026-06-08T14:23:25.189Z",
      filename: "synapse-backup-2026-06-08T14-23-25-189Z.tar",
    })

    expect(restore).toContain("server/.env")
    expect(restore).toContain("database.sql.gz")
    expect(restore).toContain("postgres-globals.sql")
    expect(scanForSecretLikeText(restore)).toBe(false)
  })
})
```

- [ ] **Step 2: Run helper tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/backup/backup.service.spec.ts
```

Expected: FAIL because `./backup-package` does not exist.

- [ ] **Step 3: Create the helper implementation**

Create `server/src/backup/backup-package.ts`:

```ts
import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { mkdir, stat, writeFile } from "node:fs/promises"
import path from "node:path"

export interface BackupContentManifestItem {
  readonly path: string
  readonly sha256: string
  readonly size: number
}

export interface BackupPackageManifestInput {
  readonly createdAt: string
  readonly appVersion: string
  readonly migrationCount: number
  readonly backupBucket: string
  readonly backupRegion: string
  readonly driveBucket?: string
  readonly driveRegion?: string
  readonly contents: BackupContentManifestItem[]
}

export interface BackupPackageManifest {
  readonly schemaVersion: 1
  readonly createdAt: string
  readonly app: {
    readonly package: "@synapse/server"
    readonly version: string
  }
  readonly database: {
    readonly migrationCount: number
  }
  readonly storage: {
    readonly backup: {
      readonly bucket: string
      readonly region: string
      readonly prefix: "backups/"
    }
    readonly drive?: {
      readonly bucket: string
      readonly region: string
      readonly prefix: "drive/"
    }
  }
  readonly contents: BackupContentManifestItem[]
  readonly secretsIncluded: false
  readonly driveObjectsIncluded: false
}

export interface RestoreMarkdownInput {
  readonly createdAt: string
  readonly filename: string
}

const secretLikePattern = /(?:secret|token|password|authorization|bearer|api[_-]?key)\s*[:=]/iu

export async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8")
}

export function createBackupManifest(input: BackupPackageManifestInput): BackupPackageManifest {
  return {
    schemaVersion: 1,
    createdAt: input.createdAt,
    app: {
      package: "@synapse/server",
      version: input.appVersion,
    },
    database: {
      migrationCount: input.migrationCount,
    },
    storage: {
      backup: {
        bucket: input.backupBucket,
        region: input.backupRegion,
        prefix: "backups/",
      },
      ...(input.driveBucket && input.driveRegion
        ? {
            drive: {
              bucket: input.driveBucket,
              region: input.driveRegion,
              prefix: "drive/" as const,
            },
          }
        : {}),
    },
    contents: input.contents,
    secretsIncluded: false,
    driveObjectsIncluded: false,
  }
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256")
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath)
    stream.on("data", (chunk) => hash.update(chunk))
    stream.on("error", reject)
    stream.on("end", resolve)
  })
  return hash.digest("hex")
}

export async function contentManifestItem(baseDir: string, relativePath: string): Promise<BackupContentManifestItem> {
  const filePath = path.join(baseDir, relativePath)
  const info = await stat(filePath)
  return {
    path: relativePath,
    sha256: await sha256File(filePath),
    size: info.size,
  }
}

export function createRestoreMarkdown(input: RestoreMarkdownInput): string {
  return [
    "# Synapse 轻量灾备恢复说明",
    "",
    `备份文件：${input.filename}`,
    `创建时间：${input.createdAt}`,
    "",
    "## 恢复前提",
    "",
    "- 使用你电脑上保存的 `server/.env` 作为配置来源。",
    "- 确认 Drive COS bucket 和对象仍存在。",
    "- 准备一台新服务器、当前源码或可用 Docker 镜像。",
    "- 恢复数据库会覆盖目标环境数据。",
    "",
    "## 文件说明",
    "",
    "- `database.sql.gz`：业务数据库 dump。",
    "- `postgres-globals.sql`：PostgreSQL 角色和全局权限。",
    "- `drive-cos-manifest.json`：Drive COS 对象清单，不包含文件内容。",
    "- `backup-manifest.json`：备份元信息和校验和。",
    "",
    "## 恢复步骤",
    "",
    "1. 解压备份包。",
    "2. 把本机 `server/.env` 放到新服务器的 `server/.env`。",
    "3. 启动 PostgreSQL。",
    "4. 按需导入 `postgres-globals.sql`。",
    "5. 解压并导入 `database.sql.gz`。",
    "6. 启动 Synapse server。",
    "7. 对照 `drive-cos-manifest.json` 抽查 Drive COS 对象是否仍可访问。",
    "",
  ].join("\n")
}

export function scanForSecretLikeText(value: string): boolean {
  return secretLikePattern.test(value)
}
```

- [ ] **Step 4: Run helper tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/backup/backup.service.spec.ts
```

Expected: PASS for helper tests; existing backup tests should still pass.

- [ ] **Step 5: Commit helper task**

Run:

```bash
git add server/src/backup/backup-package.ts server/src/backup/backup.service.spec.ts
git commit -m "feat(backup): add disaster recovery package helpers"
```

## Task 2: PostgreSQL Globals In Package

**Files:**
- Modify: `server/src/backup/backup.service.ts`
- Test: `server/src/backup/backup.service.spec.ts`

- [ ] **Step 1: Write failing globals export test**

Add this test inside `describe("BackupService", () => {`:

```ts
it("exports postgres globals into the backup package", async () => {
  const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
  const service = createBackupService({}, logger)
  const globalsPath = path.join(os.tmpdir(), `synapse-globals-${Date.now()}.sql`)

  await (service as unknown as {
    dumpPostgresGlobals(filePath: string): Promise<void>
  }).dumpPostgresGlobals(globalsPath)

  try {
    expect(fs.readFileSync(globalsPath, "utf8")).toContain("postgres globals")
  } finally {
    fs.rmSync(globalsPath, { force: true })
  }
})
```

Before the test, mock `execFileAsync` by replacing the existing `promisify(execFile)` behavior. Add this mock near the top of `server/src/backup/backup.service.spec.ts`:

```ts
vi.mock("node:child_process", () => ({
  execFile: vi.fn((_command, args, _options, callback) => {
    const outputPath = Array.isArray(args) ? args[args.length - 1] : undefined
    if (typeof outputPath === "string") fs.writeFileSync(outputPath, "postgres globals", "utf8")
    callback(null, "", "")
  }),
}))
```

- [ ] **Step 2: Run globals test and verify it fails**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/backup/backup.service.spec.ts -t "exports postgres globals"
```

Expected: FAIL because `dumpPostgresGlobals` does not exist.

- [ ] **Step 3: Implement globals export**

In `server/src/backup/backup.service.ts`, add this method after `dumpDatabase()`:

```ts
  private async dumpPostgresGlobals(filePath: string): Promise<void> {
    const pgDump = buildPgDumpOptions(this.env.databaseUrl, filePath)
    await execFileAsync("pg_dumpall", [
      "-h",
      pgDump.args[1],
      "-p",
      pgDump.args[3],
      "-U",
      pgDump.args[5],
      "--globals-only",
      "-f",
      filePath,
    ], { env: pgDump.env })
  }
```

- [ ] **Step 4: Run globals test and verify it passes**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/backup/backup.service.spec.ts -t "exports postgres globals"
```

Expected: PASS.

- [ ] **Step 5: Commit globals task**

Run:

```bash
git add server/src/backup/backup.service.ts server/src/backup/backup.service.spec.ts
git commit -m "feat(backup): include postgres globals in backups"
```

## Task 3: Drive COS Manifest

**Files:**
- Modify: `server/src/backup/backup.service.ts`
- Test: `server/src/backup/backup.service.spec.ts`

- [ ] **Step 1: Write failing Drive manifest tests**

Add these tests inside `describe("BackupService", () => {`:

```ts
it("writes a paginated Drive COS manifest when Drive COS is configured", async () => {
  const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
  const getBucket = vi.fn((options, callback) => {
    if (options.Marker === "next") {
      callback(null, {
        Contents: [
          {
            Key: "drive/item-b",
            Size: "22",
            ETag: "\"etag-b\"",
            LastModified: "2026-06-08T14:23:01.000Z",
          },
        ],
        IsTruncated: "false",
      })
      return
    }
    callback(null, {
      Contents: [
        {
          Key: "drive/item-a",
          Size: "11",
          ETag: "\"etag-a\"",
          LastModified: "2026-06-08T14:23:00.000Z",
        },
      ],
      IsTruncated: "true",
      NextMarker: "next",
    })
  })
  const service = createBackupService({ getBucket }, logger)
  vi.spyOn(service as unknown as {
    createDriveCosClient(): { getBucket: typeof getBucket }
  }, "createDriveCosClient").mockReturnValue({ getBucket })
  Object.assign(service as unknown as { env: Record<string, string> }, {
    env: {
      backupCosBucket: "backup-bucket",
      backupCosRegion: "ap-guangzhou",
      backupCosSecretId: "secret-id",
      backupCosSecretKey: "secret-key",
      driveCosBucket: "drive-bucket",
      driveCosRegion: "ap-beijing",
      driveCosSecretId: "drive-secret-id",
      driveCosSecretKey: "drive-secret-key",
      databaseUrl: "postgresql://synapse:secret@localhost:5432/synapse",
    },
  })
  const manifestPath = path.join(os.tmpdir(), `drive-cos-manifest-${Date.now()}.json`)

  await (service as unknown as {
    writeDriveCosManifest(filePath: string): Promise<void>
  }).writeDriveCosManifest(manifestPath)

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    expect(manifest).toEqual({
      bucket: "drive-bucket",
      region: "ap-beijing",
      prefix: "drive/",
      objects: [
        {
          key: "drive/item-a",
          size: 11,
          etag: "\"etag-a\"",
          lastModified: "2026-06-08T14:23:00.000Z",
        },
        {
          key: "drive/item-b",
          size: 22,
          etag: "\"etag-b\"",
          lastModified: "2026-06-08T14:23:01.000Z",
        },
      ],
    })
    expect(getBucket).toHaveBeenCalledTimes(2)
    expect(getBucket).toHaveBeenNthCalledWith(
      1,
      {
        Bucket: "drive-bucket",
        Region: "ap-beijing",
        Prefix: "drive/",
      },
      expect.any(Function),
    )
  } finally {
    fs.rmSync(manifestPath, { force: true })
  }
})

it("writes a local Drive manifest when Drive COS is not configured", async () => {
  const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
  const service = createBackupService({}, logger)
  Object.assign(service as unknown as { env: Record<string, string | undefined> }, {
    env: {
      backupCosBucket: "backup-bucket",
      backupCosRegion: "ap-guangzhou",
      backupCosSecretId: "secret-id",
      backupCosSecretKey: "secret-key",
      databaseUrl: "postgresql://synapse:secret@localhost:5432/synapse",
    },
  })
  const manifestPath = path.join(os.tmpdir(), `drive-local-manifest-${Date.now()}.json`)

  await (service as unknown as {
    writeDriveCosManifest(filePath: string): Promise<void>
  }).writeDriveCosManifest(manifestPath)

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    expect(manifest).toEqual({
      storage: "local",
      included: false,
      reason: "Drive COS is not configured.",
    })
  } finally {
    fs.rmSync(manifestPath, { force: true })
  }
})
```

- [ ] **Step 2: Run Drive manifest tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/backup/backup.service.spec.ts -t "Drive COS manifest"
```

Expected: FAIL because `writeDriveCosManifest` does not exist.

- [ ] **Step 3: Implement Drive manifest export**

In `server/src/backup/backup.service.ts`, import `writeJsonFile`:

```ts
import { writeJsonFile } from "./backup-package"
```

Add these methods after `dumpPostgresGlobals()`:

```ts
  private createDriveCosClient(): COS {
    const CosClient = require("cos-nodejs-sdk-v5") as typeof COS
    return new CosClient({
      SecretId: this.env.driveCosSecretId!,
      SecretKey: this.env.driveCosSecretKey!,
    })
  }

  private async writeDriveCosManifest(filePath: string): Promise<void> {
    if (!isDriveCosConfigured(this.env)) {
      await writeJsonFile(filePath, {
        storage: "local",
        included: false,
        reason: "Drive COS is not configured.",
      })
      return
    }

    const driveCos = this.createDriveCosClient()
    const objects: Array<{
      key: string
      size: number
      etag?: string
      lastModified?: string
    }> = []
    let marker: string | undefined

    do {
      const page = await new Promise<{
        readonly Contents?: Array<{
          readonly Key?: string
          readonly Size?: string | number
          readonly ETag?: string
          readonly LastModified?: string
        }>
        readonly IsTruncated?: string | boolean
        readonly NextMarker?: string
      }>((resolve, reject) => {
        driveCos.getBucket(
          {
            Bucket: this.env.driveCosBucket!,
            Region: this.env.driveCosRegion!,
            Prefix: "drive/",
            ...(marker ? { Marker: marker } : {}),
          },
          (err, data) => {
            if (err) reject(err)
            else resolve(data)
          },
        )
      })

      for (const item of page.Contents ?? []) {
        if (!item.Key) continue
        objects.push({
          key: item.Key,
          size: Number(item.Size ?? 0),
          ...(item.ETag ? { etag: item.ETag } : {}),
          ...(item.LastModified ? { lastModified: item.LastModified } : {}),
        })
      }

      marker = page.NextMarker
      if (page.IsTruncated !== true && page.IsTruncated !== "true") marker = undefined
    } while (marker)

    await writeJsonFile(filePath, {
      bucket: this.env.driveCosBucket,
      region: this.env.driveCosRegion,
      prefix: "drive/",
      objects,
    })
  }
```

Also import `isDriveCosConfigured` from `../config/env` in the existing import:

```ts
import { isBackupCosConfigured, isDriveCosConfigured, loadEnv, type ServerEnv } from "../config/env"
```

- [ ] **Step 4: Run Drive manifest tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/backup/backup.service.spec.ts -t "Drive COS manifest"
```

Expected: PASS.

- [ ] **Step 5: Commit Drive manifest task**

Run:

```bash
git add server/src/backup/backup.service.ts server/src/backup/backup.service.spec.ts
git commit -m "feat(backup): add drive cos manifest"
```

## Task 4: Assemble Full Disaster Recovery Package

**Files:**
- Modify: `server/src/backup/backup.service.ts`
- Test: `server/src/backup/backup.service.spec.ts`

- [ ] **Step 1: Write failing package assembly test**

Add this test inside `describe("BackupService", () => {`:

```ts
it("packs database, globals, Drive manifest, backup manifest, and restore instructions", async () => {
  const putObject = vi.fn((options, callback) => {
    ;(options.Body as NodeJS.ReadableStream).resume()
    callback(null)
  })
  const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
  const service = createBackupService({ putObject, getBucket: vi.fn((_options, callback) => callback(null, { Contents: [] })) }, logger)

  vi.spyOn(service as unknown as { dumpDatabase(): Promise<string> }, "dumpDatabase")
    .mockImplementation(async () => {
      const dumpPath = path.join(os.tmpdir(), `database-${Date.now()}.sql.gz`)
      fs.writeFileSync(dumpPath, "database", "utf8")
      return dumpPath
    })
  vi.spyOn(service as unknown as { dumpPostgresGlobals(filePath: string): Promise<void> }, "dumpPostgresGlobals")
    .mockImplementation(async (filePath) => {
      fs.writeFileSync(filePath, "globals", "utf8")
    })
  vi.spyOn(service as unknown as { writeDriveCosManifest(filePath: string): Promise<void> }, "writeDriveCosManifest")
    .mockImplementation(async (filePath) => {
      fs.writeFileSync(filePath, "{\n  \"objects\": []\n}\n", "utf8")
    })

  const result = await service.performBackup()

  expect(result.status).toBe("success")
  expect(result.filename).toMatch(/\.tar$/)
  const body = putObject.mock.calls[0]?.[0].Body as fs.ReadStream
  const archivePath = body.path as string
  const extractDir = path.join(os.tmpdir(), `synapse-backup-extract-${Date.now()}`)

  try {
    fs.mkdirSync(extractDir, { recursive: true })
    await tar.extract({ file: archivePath, cwd: extractDir })

    expect(fs.existsSync(path.join(extractDir, "database.sql.gz"))).toBe(true)
    expect(fs.readFileSync(path.join(extractDir, "postgres-globals.sql"), "utf8")).toBe("globals")
    expect(fs.existsSync(path.join(extractDir, "drive-cos-manifest.json"))).toBe(true)
    expect(fs.readFileSync(path.join(extractDir, "restore.md"), "utf8")).toContain("server/.env")

    const manifest = JSON.parse(fs.readFileSync(path.join(extractDir, "backup-manifest.json"), "utf8"))
    expect(manifest.secretsIncluded).toBe(false)
    expect(manifest.driveObjectsIncluded).toBe(false)
    expect(manifest.contents.map((item: { path: string }) => item.path)).toEqual([
      "database.sql.gz",
      "postgres-globals.sql",
      "drive-cos-manifest.json",
      "restore.md",
    ])
  } finally {
    fs.rmSync(extractDir, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run package assembly test and verify it fails**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/backup/backup.service.spec.ts -t "packs database"
```

Expected: FAIL because `performBackup()` still packs only `database.sql.gz`.

- [ ] **Step 3: Update package assembly implementation**

In `server/src/backup/backup.service.ts`, import helpers:

```ts
import {
  contentManifestItem,
  createBackupManifest,
  createRestoreMarkdown,
  scanForSecretLikeText,
  writeJsonFile,
} from "./backup-package"
```

Replace the `performBackup()` body between `const tempFiles: string[] = []` and the `try` block with this structure:

```ts
    const tempDirs: string[] = []
```

Inside `performBackup()`, replace the current try body with:

```ts
      const dbPath = await this.dumpDatabase()
      tempFiles.push(dbPath)

      const packageDir = path.join(os.tmpdir(), `synapse-backup-package-${Date.now()}`)
      tempDirs.push(packageDir)
      fs.mkdirSync(packageDir, { recursive: true })

      fs.copyFileSync(dbPath, path.join(packageDir, "database.sql.gz"))
      await this.dumpPostgresGlobals(path.join(packageDir, "postgres-globals.sql"))
      await this.writeDriveCosManifest(path.join(packageDir, "drive-cos-manifest.json"))

      const restoreMarkdown = createRestoreMarkdown({ createdAt: new Date().toISOString(), filename })
      if (scanForSecretLikeText(restoreMarkdown)) {
        throw new Error("恢复说明包含疑似敏感信息。")
      }
      fs.writeFileSync(path.join(packageDir, "restore.md"), restoreMarkdown, "utf8")

      const manifest = createBackupManifest({
        createdAt: new Date().toISOString(),
        appVersion: process.env.npm_package_version ?? "0.1.0",
        migrationCount: await this.countAppliedMigrations(),
        backupBucket: this.bucket,
        backupRegion: this.region,
        driveBucket: this.env.driveCosBucket,
        driveRegion: this.env.driveCosRegion,
        contents: [
          await contentManifestItem(packageDir, "database.sql.gz"),
          await contentManifestItem(packageDir, "postgres-globals.sql"),
          await contentManifestItem(packageDir, "drive-cos-manifest.json"),
          await contentManifestItem(packageDir, "restore.md"),
        ],
      })
      await writeJsonFile(path.join(packageDir, "backup-manifest.json"), manifest)

      const archivePath = await this.packDirectory(packageDir)
      tempFiles.push(archivePath)

      await this.uploadToCos(archivePath, filename)
```

Add final cleanup for temp dirs in `finally`:

```ts
      for (const dir of tempDirs) {
        fs.rmSync(dir, { recursive: true, force: true })
      }
```

Add these private methods:

```ts
  private async packDirectory(directoryPath: string): Promise<string> {
    const archivePath = path.join(os.tmpdir(), `synapse-backup-${Date.now()}.tar`)
    let completed = false

    try {
      await tar.create(
        { gzip: false, file: archivePath, cwd: directoryPath },
        [
          "database.sql.gz",
          "postgres-globals.sql",
          "drive-cos-manifest.json",
          "backup-manifest.json",
          "restore.md",
        ],
      )
      completed = true
      return archivePath
    } finally {
      if (!completed) {
        fs.rmSync(archivePath, { force: true })
      }
    }
  }

  private async countAppliedMigrations(): Promise<number> {
    const pg = buildPgDumpOptions(this.env.databaseUrl, "")
    const result = await execFileAsync("psql", [
      "-h",
      pg.args[1],
      "-p",
      pg.args[3],
      "-U",
      pg.args[5],
      "-d",
      pg.args[7],
      "-Atc",
      "SELECT COUNT(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL;",
    ], { env: pg.env })
    return Number(String(result.stdout).trim() || "0")
  }
```

Keep `packFiles()` for existing unit tests or remove it only after updating those tests. Prefer keeping it during this task to avoid unrelated churn.

- [ ] **Step 4: Run package assembly test and verify it passes**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/backup/backup.service.spec.ts -t "packs database"
```

Expected: PASS.

- [ ] **Step 5: Commit package assembly task**

Run:

```bash
git add server/src/backup/backup.service.ts server/src/backup/backup.service.spec.ts
git commit -m "feat(backup): build disaster recovery archives"
```

## Task 5: Documentation And Release Notes

**Files:**
- Modify: `server/README.md`
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update README backup section**

In `server/README.md`, replace the current “数据库备份” description around lines 334-336 with:

```md
### 后台轻量灾备备份

管理后台“备份”页面和每天凌晨 3 点的定时任务会把轻量灾备包上传到 `BACKUP_COS_BUCKET/backups/`。灾备包包含业务数据库、PostgreSQL globals、Drive COS 对象清单、备份 manifest 和恢复说明。灾备包不包含 `.env`、JWT secret、COS Secret、数据库密码或 Drive 文件字节。

恢复时需要使用你本机保存的 `server/.env` 作为配置来源。如果 Drive COS bucket 或对象已经被删除，灾备包只能恢复数据库和 Drive 元数据，不能恢复文件内容。

`deploy.sh` 的发布切换备份仍保存在 `/www/wwwroot/synapse/backups/`。在线预演备份文件名形如 `synapse-online-before-deploy-20260606_121500.sql`，最终切换前备份文件名形如 `synapse-final-before-switch-20260606_121500.sql`；远端 `.env` 备份在 `backups/env/`，Postgres globals 备份在 `backups/globals/`，本地 Drive fallback 备份在 `backups/drive/`。
```

- [ ] **Step 2: Update release notes**

Add this bullet under `## 功能优化` in `RELEASE_NOTES_PENDING.md`:

```md
- 管理后台备份升级为轻量灾备包，除数据库外会包含 PostgreSQL globals、Drive COS 对象清单、备份校验信息和恢复说明，恢复时继续使用本机保存的 `server/.env`。
```

- [ ] **Step 3: Run documentation grep**

Run:

```bash
rg -n "env\\.enc|BACKUP_ENCRYPT_KEY|加密后的 \\.env" server/README.md docs/superpowers/specs/2026-06-08-dashboard-disaster-recovery-backup-design.md RELEASE_NOTES_PENDING.md
```

Expected: no output.

- [ ] **Step 4: Commit docs task**

Run:

```bash
git add server/README.md RELEASE_NOTES_PENDING.md
git commit -m "docs(backup): document disaster recovery backups"
```

## Task 6: Verification And Deployment

**Files:**
- Verify only; no planned source edits.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --filter @synapse/server exec vitest run src/backup/backup.service.spec.ts src/backup/backup.controller.spec.ts src/common/all-exceptions.filter.spec.ts src/common/audit-log.interceptor.spec.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run server build**

Run:

```bash
pnpm --filter @synapse/server run build
```

Expected: build completes successfully.

- [ ] **Step 3: Deploy with the repository deploy script**

Run:

```bash
bash deploy.sh
```

Expected: all 18 deploy steps complete, final health check passes.

- [ ] **Step 4: Verify backup creation on production**

Run:

```bash
ssh root@120.53.17.64 'cd /www/wwwroot/synapse/server && set -a && . .env && set +a && node <<'"'"'NODE'"'"'
;(async () => {
  const base = "http://127.0.0.1:3000"
  const login = await fetch(`${base}/api/dashboard/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD }),
  })
  const cookies = login.headers.get("set-cookie")?.split(/, (?=[^=]+=)/).map((item) => item.split(";")[0]).join("; ") ?? ""
  const create = await fetch(`${base}/api/admin/backup`, { method: "POST", headers: { Cookie: cookies } })
  const createText = await create.text()
  const list = await fetch(`${base}/api/admin/backup/list`, { headers: { Cookie: cookies } })
  const listText = await list.text()
  console.log(JSON.stringify({
    loginStatus: login.status,
    createStatus: create.status,
    createBody: createText.slice(0, 500),
    listStatus: list.status,
    listBody: listText.slice(0, 800),
  }))
})().catch((error) => {
  console.log(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
  process.exit(1)
})
NODE'
```

Expected: `createStatus` is `201`; `listStatus` is `200`; list contains the new archive filename.

- [ ] **Step 5: Verify archive contents on production**

Run:

```bash
ssh root@120.53.17.64 'cd /www/wwwroot/synapse/server && docker compose --env-file .env exec -T -w /app/server server node <<'"'"'NODE'"'"'
const COS = require("cos-nodejs-sdk-v5")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const tar = require("tar")
const cos = new COS({ SecretId: process.env.BACKUP_COS_SECRET_ID, SecretKey: process.env.BACKUP_COS_SECRET_KEY })
const bucket = process.env.BACKUP_COS_BUCKET
const region = process.env.BACKUP_COS_REGION
cos.getBucket({ Bucket: bucket, Region: region, Prefix: "backups/" }, async (err, data) => {
  if (err) throw err
  const latest = [...(data.Contents || [])].filter((item) => item.Key.endsWith(".tar")).sort((a, b) => String(b.LastModified).localeCompare(String(a.LastModified)))[0]
  if (!latest) throw new Error("No backup archive found")
  const tmp = path.join(os.tmpdir(), path.basename(latest.Key))
  const extractDir = `${tmp}.extract`
  const stream = cos.getObjectStream({ Bucket: bucket, Region: region, Key: latest.Key })
  await new Promise((resolve, reject) => stream.pipe(fs.createWriteStream(tmp)).on("finish", resolve).on("error", reject))
  fs.mkdirSync(extractDir, { recursive: true })
  await tar.extract({ file: tmp, cwd: extractDir })
  const files = fs.readdirSync(extractDir).sort()
  const manifest = JSON.parse(fs.readFileSync(path.join(extractDir, "backup-manifest.json"), "utf8"))
  console.log(JSON.stringify({ key: latest.Key, files, secretsIncluded: manifest.secretsIncluded, driveObjectsIncluded: manifest.driveObjectsIncluded }))
})
NODE'
```

Expected: `files` contains `backup-manifest.json`, `database.sql.gz`, `drive-cos-manifest.json`, `postgres-globals.sql`, and `restore.md`; `secretsIncluded` is `false`.

- [ ] **Step 6: Verify Chrome dashboard page**

Use Chrome or Browser tooling to open:

```text
https://synapse.d2.pub/dashboard/backup
```

Expected: page loads the backup table without “加载失败”; the new archive appears in the list.

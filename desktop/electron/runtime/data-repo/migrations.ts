/**
 * Phase 0.2 — Migration runner.
 *
 * SPEC §5: "namespace 首次 get 时读 version tag，落后则按顺序执行链。先写临时
 * 文件 → validate 通过 → 原子替换。失败保留原文件 + 写 .migration-error
 * 诊断。迁移函数必须幂等。只向前迁移，不支持回退。"
 *
 * Runner contract:
 *   runMigrations(currentVersion, targetVersion, migrations, data) -> data
 *   - Picks migrations in order; fails with MissingMigrationError if any gap.
 *   - Each migration may be sync or async.
 *   - Wraps each step's exception in MigrationFailedError(from, to, cause).
 *   - Refuses to run if currentVersion > targetVersion (no down-migration).
 */

import { MigrationFailedError, MissingMigrationError } from "./errors"
import type { Migration } from "./types"

export interface RunMigrationsArgs<From = unknown, To = unknown> {
  readonly currentVersion: number
  readonly targetVersion: number
  readonly migrations: readonly Migration[]
  readonly namespace: string
  readonly data: From
}

export async function runMigrations<From = unknown, To = unknown>(
  args: RunMigrationsArgs<From, To>,
): Promise<To> {
  const { currentVersion, targetVersion, migrations, namespace } = args

  if (currentVersion === targetVersion) {
    return args.data as unknown as To
  }
  if (currentVersion > targetVersion) {
    throw new MissingMigrationError(namespace, currentVersion, targetVersion)
  }

  const byFromVersion = new Map<number, Migration>()
  for (const m of migrations) {
    if (byFromVersion.has(m.from)) {
      throw new Error(
        `Duplicate migration from=${m.from} in namespace "${namespace}"`,
      )
    }
    byFromVersion.set(m.from, m)
  }

  let version = currentVersion
  let data: unknown = args.data

  while (version < targetVersion) {
    const step = byFromVersion.get(version)
    if (!step) {
      throw new MissingMigrationError(namespace, version, targetVersion)
    }
    try {
      data = await Promise.resolve(step.migrate(data))
    } catch (err) {
      throw new MigrationFailedError(namespace, step.from, step.to, err)
    }
    version = step.to
    if (version <= step.from) {
      throw new Error(
        `Migration in namespace "${namespace}" did not advance the version (from=${step.from}, to=${step.to})`,
      )
    }
  }

  return data as To
}

/**
 * Helper to construct a Migration whose `migrate` is a synchronous function.
 */
export function migration<From, To>(
  from: number,
  to: number,
  fn: (data: From) => To,
): Migration<From, To> {
  return { from, to, migrate: fn }
}

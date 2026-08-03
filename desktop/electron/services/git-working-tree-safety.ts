import { StringDecoder } from "node:string_decoder"

type GitSafetyCommandResult = {
  readonly stdout: string
}

type GitSafetyCommandOptions = {
  readonly captureStdout: false
  readonly onStdoutChunk: (chunk: Uint8Array) => void
}

type GitSafetyCommand = (args: readonly string[], options?: GitSafetyCommandOptions) => Promise<GitSafetyCommandResult>

const MAX_VISIBLE_COLLISIONS = 20
const PATHSPEC_BATCH_SIZE = 256

async function readNulPaths(
  run: GitSafetyCommand,
  args: readonly string[],
  onPath: (filePath: string) => void,
): Promise<void> {
  const decoder = new StringDecoder("utf8")
  let pending = ""
  let sawChunk = false
  const push = (chunk: Uint8Array) => {
    sawChunk = true
    pending += decoder.write(Buffer.from(chunk))
    const records = pending.split("\0")
    pending = records.pop() ?? ""
    for (const record of records) if (record) onPath(record)
  }
  const result = await run(args, { captureStdout: false, onStdoutChunk: push })
  if (!sawChunk && result.stdout) pending += result.stdout
  pending += decoder.end()
  for (const record of pending.split("\0")) if (record) onPath(record)
}

function formatCollisionMessage(paths: readonly string[], truncated: boolean): string {
  const suffix = truncated ? "；另有更多路径" : ""
  return `以下被忽略的本地文件会被 Git 操作覆盖：${paths.join("、")}${suffix}。请先移动或备份这些文件后重试。`
}

function pathAndAncestors(filePath: string): string[] {
  const values = [filePath]
  let separatorIndex = filePath.lastIndexOf("/")
  while (separatorIndex > 0) {
    values.push(filePath.slice(0, separatorIndex))
    separatorIndex = filePath.lastIndexOf("/", separatorIndex - 1)
  }
  return values
}

async function assertNoIgnoredPathCollisions(input: {
  readonly run: GitSafetyCommand
  readonly target: string
}): Promise<void> {
  const ignoredPaths: string[] = []
  await readNulPaths(
    input.run,
    ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"],
    (filePath) => ignoredPaths.push(filePath),
  )
  if (ignoredPaths.length === 0) return

  const pathspecs = [...new Set(ignoredPaths.flatMap(pathAndAncestors))]
  const ignoredSet = new Set(ignoredPaths)
  const ignoredByAncestor = new Map<string, string[]>()
  for (const ignoredPath of ignoredPaths) {
    for (const ancestor of pathAndAncestors(ignoredPath).slice(1)) {
      const descendants = ignoredByAncestor.get(ancestor) ?? []
      descendants.push(ignoredPath)
      ignoredByAncestor.set(ancestor, descendants)
    }
  }
  const collisions = new Set<string>()
  let truncated = false
  const recordCollision = (ignoredPath: string) => {
    if (collisions.has(ignoredPath)) return
    if (collisions.size < MAX_VISIBLE_COLLISIONS) collisions.add(ignoredPath)
    else truncated = true
  }
  for (let index = 0; index < pathspecs.length; index += PATHSPEC_BATCH_SIZE) {
    const batch = pathspecs.slice(index, index + PATHSPEC_BATCH_SIZE)
    await readNulPaths(
      input.run,
      ["--literal-pathspecs", "ls-tree", "-r", "--name-only", "-z", input.target, "--", ...batch],
      (targetPath) => {
        for (const targetOrAncestor of pathAndAncestors(targetPath)) {
          if (ignoredSet.has(targetOrAncestor)) recordCollision(targetOrAncestor)
        }
        for (const ignoredPath of ignoredByAncestor.get(targetPath) ?? []) recordCollision(ignoredPath)
      },
    )
  }
  const visible = [...collisions].sort((left, right) => left.localeCompare(right))
  if (visible.length > 0) throw new Error(formatCollisionMessage(visible, truncated))
}

export { assertNoIgnoredPathCollisions }

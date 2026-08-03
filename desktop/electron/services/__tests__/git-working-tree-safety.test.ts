import { describe, expect, it, vi } from "vitest"
import { assertNoIgnoredPathCollisions } from "../git-working-tree-safety"

function createRun(ignoredPaths: readonly string[], targetPaths: readonly string[]) {
  return vi.fn(async (args: readonly string[], options?: { readonly onStdoutChunk: (chunk: Uint8Array) => void }) => {
    const paths = args[0] === "ls-files" ? ignoredPaths : targetPaths
    const stdout = `${paths.join("\0")}\0`
    options?.onStdoutChunk(Buffer.from(stdout))
    return { stdout: options ? "" : stdout }
  })
}

describe("Git working-tree safety", () => {
  it.each<[string, string[], string[]]>([
    ["exact", ["private.txt"], ["private.txt"]],
    ["ignored child", ["private/cache.txt"], ["private"]],
    ["ignored parent", ["private"], ["private/config.txt"]],
  ])("blocks %s path collisions", async (_label, ignoredPaths, targetPaths) => {
    await expect(assertNoIgnoredPathCollisions({
      run: createRun(ignoredPaths, targetPaths),
      target: "target-oid",
    })).rejects.toThrow(ignoredPaths[0])
  })

  it("allows sibling paths and checks the requested target tree", async () => {
    const run = createRun(["private/cache.txt"], ["private/config.txt"])

    await expect(assertNoIgnoredPathCollisions({ run, target: "target-oid" })).resolves.toBeUndefined()
    expect(run).toHaveBeenCalledWith(
      ["--literal-pathspecs", "ls-tree", "-r", "--name-only", "-z", "target-oid", "--", "private/cache.txt", "private"],
      expect.objectContaining({ captureStdout: false, onStdoutChunk: expect.any(Function) }),
    )
  })

  it("does not inspect the target tree when there are no ignored paths", async () => {
    const run = createRun([], Array.from({ length: 100_000 }, (_, index) => `large/${index}.txt`))

    await expect(assertNoIgnoredPathCollisions({ run, target: "target-oid" })).resolves.toBeUndefined()
    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenCalledWith(
      ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"],
      expect.objectContaining({ captureStdout: false, onStdoutChunk: expect.any(Function) }),
    )
  })

  it("limits the error to twenty visible paths and reports the remainder", async () => {
    const paths = Array.from({ length: 23 }, (_, index) => `private-${String(index).padStart(2, "0")}.txt`)

    await expect(assertNoIgnoredPathCollisions({
      run: createRun(paths, paths),
      target: "target-oid",
    })).rejects.toThrow("另有更多路径")
  })
})

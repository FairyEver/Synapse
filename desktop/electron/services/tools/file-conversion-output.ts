import { lstat } from "node:fs/promises"
import path from "node:path"

export async function resolveUniqueMarkdownOutputPath(
  outputDirectory: string,
  sourcePath: string,
  reservedOutputPaths: ReadonlySet<string> = new Set(),
): Promise<string> {
  const baseName = path.basename(sourcePath, path.extname(sourcePath))
  let index = 1
  while (true) {
    const candidate = path.join(outputDirectory, `${baseName}${index === 1 ? "" : `-${index}`}.md`)
    if (!reservedOutputPaths.has(candidate) && !(await pathExists(candidate))) {
      return candidate
    }
    index += 1
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  return lstat(filePath).then(() => true, () => false)
}

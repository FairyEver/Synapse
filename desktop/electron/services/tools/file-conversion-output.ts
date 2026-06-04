import { lstat, mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import type { FileConversionAsset } from "../file-conversion"

export interface MarkdownOutputBundle {
  readonly markdownPath: string
  readonly assetDirectoryPath: string
  readonly assetDirectoryName: string
}

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

export async function resolveUniqueMarkdownOutputBundle(
  outputDirectory: string,
  sourcePath: string,
  reservedOutputPaths: ReadonlySet<string> = new Set(),
): Promise<MarkdownOutputBundle> {
  const baseName = path.basename(sourcePath, path.extname(sourcePath))
  let index = 1
  while (true) {
    const candidateBaseName = `${baseName}${index === 1 ? "" : `-${index}`}`
    const markdownPath = path.join(outputDirectory, `${candidateBaseName}.md`)
    const assetDirectoryName = `${candidateBaseName}.assets`
    const assetDirectoryPath = path.join(outputDirectory, assetDirectoryName)
    if (
      !reservedOutputPaths.has(markdownPath)
      && !reservedOutputPaths.has(assetDirectoryPath)
      && !(await pathExists(markdownPath))
      && !(await pathExists(assetDirectoryPath))
    ) {
      return { markdownPath, assetDirectoryPath, assetDirectoryName }
    }
    index += 1
  }
}

export async function writeMarkdownOutputBundle(
  outputBundle: MarkdownOutputBundle,
  markdown: string,
  assets: readonly FileConversionAsset[],
): Promise<void> {
  try {
    if (assets.length > 0) {
      await mkdir(outputBundle.assetDirectoryPath, { recursive: true })
      for (const asset of assets) {
        await writeFile(path.join(outputBundle.assetDirectoryPath, path.basename(asset.fileName)), asset.content)
      }
    }
    await writeFile(outputBundle.markdownPath, ensureTrailingNewline(markdown), "utf8")
  } catch (error) {
    if (assets.length > 0) {
      await rm(outputBundle.assetDirectoryPath, { recursive: true, force: true }).catch(() => undefined)
    }
    throw error
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  return lstat(filePath).then(() => true, () => false)
}

function ensureTrailingNewline(markdown: string): string {
  return markdown.endsWith("\n") ? markdown : `${markdown}\n`
}

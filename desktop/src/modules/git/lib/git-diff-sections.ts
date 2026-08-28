import type { SynapseGitCommitFileChange } from "@/types/git"
import { isBinaryDiff } from "@/lib/diff"

export type GitDiffSection = {
  readonly key: string
  readonly path: string
  readonly originalPath: string | null
  readonly status: SynapseGitCommitFileChange["status"]
  readonly text: string
}

export function splitGitDiffSections(text: string): readonly string[] {
  if (!text.trim()) return []

  const starts = [...text.matchAll(/^diff --git /gm)]
    .map((match) => match.index)
    .filter((index): index is number => index !== undefined)

  if (starts.length === 0) return [text]

  return starts.map((start, index) => {
    const sectionStart = index === 0 ? 0 : start
    const sectionEnd = starts[index + 1] ?? text.length
    return text.slice(sectionStart, sectionEnd)
  })
}

export function mapCommitDiffSections(
  text: string,
  files: readonly SynapseGitCommitFileChange[],
): readonly GitDiffSection[] | null {
  const patches = splitGitDiffSections(text)
  if (patches.length !== files.length) return null

  return files.map((file, index) => ({
    key: `${file.path}:${file.originalPath ?? ""}`,
    path: file.path,
    originalPath: file.originalPath,
    status: file.status,
    text: patches[index] ?? "",
  }))
}

export function isBinaryGitDiff(text: string): boolean {
  return isBinaryDiff(text)
}

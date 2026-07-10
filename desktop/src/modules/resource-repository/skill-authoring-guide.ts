const PROMPT_START = /^:::synapse-prompt id="(upgrade-skill|create-skill)" title="([^"]+)"$/
const PROMPT_DIRECTIVE_PREFIX = ":::synapse-prompt"
const PROMPT_END = ":::"
const FORMAT_ERROR_MESSAGE = "Skill 开发指南格式无效。"

type SkillAuthoringPromptId = "upgrade-skill" | "create-skill"

export type SkillAuthoringGuideSegment =
  | { readonly kind: "markdown"; readonly content: string }
  | {
      readonly kind: "prompt"
      readonly id: SkillAuthoringPromptId
      readonly title: string
      readonly content: string
    }

export type SkillAuthoringGuideLoadResult =
  | { readonly status: "success"; readonly segments: readonly SkillAuthoringGuideSegment[] }
  | {
      readonly status: "error"
      readonly error: {
        readonly errorName: string
        readonly messageLength: number
      }
    }

export function loadSkillAuthoringGuide(markdown: string): SkillAuthoringGuideLoadResult {
  try {
    return { status: "success", segments: parseSkillAuthoringGuide(markdown) }
  } catch (error) {
    return {
      status: "error",
      error: {
        errorName: error instanceof Error ? error.name : typeof error,
        messageLength: error instanceof Error ? error.message.length : 0,
      },
    }
  }
}

export function parseSkillAuthoringGuide(markdown: string): SkillAuthoringGuideSegment[] {
  const segments: SkillAuthoringGuideSegment[] = []
  const promptIds = new Set<SkillAuthoringPromptId>()
  const lines = markdown.split(/\r?\n/)
  let markdownLines: string[] = []

  const pushMarkdown = () => {
    const content = markdownLines.join("\n").trim()
    markdownLines = []
    if (content) segments.push({ kind: "markdown", content })
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    const promptStart = PROMPT_START.exec(line)

    if (!promptStart) {
      if (isDirectiveLike(line)) throwInvalidGuide()
      markdownLines.push(line)
      continue
    }

    pushMarkdown()
    const id = promptStart[1] as SkillAuthoringPromptId
    const title = promptStart[2] ?? ""
    if (promptIds.has(id)) throwInvalidGuide()

    const contentLines: string[] = []
    let closed = false
    for (index += 1; index < lines.length; index += 1) {
      const contentLine = lines[index] ?? ""
      if (contentLine === PROMPT_END) {
        closed = true
        break
      }
      if (isDirectiveLike(contentLine)) throwInvalidGuide()
      contentLines.push(contentLine)
    }

    const content = contentLines.join("\n")
    if (!closed || !content.trim()) throwInvalidGuide()

    promptIds.add(id)
    segments.push({ kind: "prompt", id, title, content })
  }

  pushMarkdown()
  if (promptIds.size !== 2 || !promptIds.has("upgrade-skill") || !promptIds.has("create-skill")) {
    throwInvalidGuide()
  }

  return segments
}

function isDirectiveLike(line: string): boolean {
  const trimmedLine = line.trim()
  return trimmedLine === PROMPT_END || trimmedLine.startsWith(PROMPT_DIRECTIVE_PREFIX)
}

function throwInvalidGuide(): never {
  throw new Error(FORMAT_ERROR_MESSAGE)
}

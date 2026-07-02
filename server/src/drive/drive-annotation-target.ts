import { BadRequestException } from "@nestjs/common"
import {
  DRIVE_ANNOTATION_QUOTE_EXACT_MAX_LENGTH,
  isDriveMarkdownItem,
  type DriveAnnotationAnchorStatus,
  type DriveAnnotationCreateInput,
  type DriveAnnotationTextRangeTargetV1,
} from "@synapse/shared"
import { z } from "zod"

const COMMENT_MAX_LENGTH = 4000

const textRangeTargetSchema = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("textRange"),
  surface: z.literal("markdownRenderedText"),
  range: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }).strict(),
  quote: z.object({
    exact: z.string().max(DRIVE_ANNOTATION_QUOTE_EXACT_MAX_LENGTH),
    prefix: z.string().max(200),
    suffix: z.string().max(200),
  }).strict(),
  source: z.object({
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().nonnegative(),
    lineStart: z.number().int().positive(),
    lineEnd: z.number().int().positive(),
  }).strict().optional(),
  blockHint: z.object({
    path: z.array(z.number().int().nonnegative()).max(32),
    type: z.string().min(1).max(64),
    textHash: z.string().min(1).max(128),
  }).strict().optional(),
}).strict()

const createBodySchema = z.object({
  baseVersionId: z.string().min(1).nullable().optional(),
  targetKind: z.literal("textRange"),
  target: textRangeTargetSchema,
  body: z.string().max(COMMENT_MAX_LENGTH),
}).strict()

export type DriveAnnotationResolvedTarget = {
  readonly anchorStatus: DriveAnnotationAnchorStatus
  readonly range: { readonly start: number; readonly end: number } | null
}

export function isCommentableMarkdownItem(item: {
  readonly name: string
  readonly type: string
  readonly mimeType: string | null
}): boolean {
  return isDriveMarkdownItem(item)
}

export function parseDriveAnnotationCreateBody(value: unknown): DriveAnnotationCreateInput {
  const parsed = createBodySchema.safeParse(value)
  if (!parsed.success) throw new BadRequestException("评论请求无效。")
  const body = parsed.data.body.trim()
  if (!body) throw new BadRequestException("评论内容不能为空。")
  if (parsed.data.target.range.end <= parsed.data.target.range.start || !parsed.data.target.quote.exact) {
    throw new BadRequestException("评论位置无效。")
  }
  return { ...parsed.data, body }
}

export function parseDriveAnnotationReplyBody(value: unknown): { readonly parentCommentId: string | null; readonly body: string } {
  const parsed = z.object({
    parentCommentId: z.string().min(1).nullable().optional(),
    body: z.string().max(COMMENT_MAX_LENGTH),
  }).strict().safeParse(value)
  if (!parsed.success) throw new BadRequestException("回复请求无效。")
  const body = parsed.data.body.trim()
  if (!body) throw new BadRequestException("回复内容不能为空。")
  return { parentCommentId: parsed.data.parentCommentId ?? null, body }
}

export function parseDriveAnnotationCommentUpdateBody(value: unknown): { readonly body: string } {
  const parsed = z.object({ body: z.string().max(COMMENT_MAX_LENGTH) }).strict().safeParse(value)
  if (!parsed.success) throw new BadRequestException("评论更新请求无效。")
  const body = parsed.data.body.trim()
  if (!body) throw new BadRequestException("评论内容不能为空。")
  return { body }
}

export function resolveDriveAnnotationTarget(input: {
  readonly target: DriveAnnotationTextRangeTargetV1
  readonly renderedText: string
}): DriveAnnotationResolvedTarget {
  const { target, renderedText } = input
  const direct = renderedText.slice(target.range.start, target.range.end)
  if (direct === target.quote.exact) return { anchorStatus: "attached", range: target.range }

  const matches = findAllMatches(renderedText, target.quote.exact)
  if (matches.length === 0) return { anchorStatus: "orphaned", range: null }
  if (matches.length > 1 && !target.quote.prefix && !target.quote.suffix) {
    return { anchorStatus: "orphaned", range: null }
  }

  const scored = matches
    .map((range) => ({ range, score: scoreMatch(renderedText, target, range) }))
    .sort((a, b) => b.score - a.score)
  const best = scored[0]
  const second = scored[1]
  if (!best || best.score <= 0) return { anchorStatus: "orphaned", range: null }
  if (second && second.score === best.score) return { anchorStatus: "orphaned", range: null }
  return { anchorStatus: "shifted", range: best.range }
}

function findAllMatches(text: string, exact: string): Array<{ readonly start: number; readonly end: number }> {
  const matches: Array<{ readonly start: number; readonly end: number }> = []
  let cursor = 0
  while (cursor <= text.length) {
    const index = text.indexOf(exact, cursor)
    if (index === -1) break
    matches.push({ start: index, end: index + exact.length })
    cursor = index + Math.max(1, exact.length)
  }
  return matches
}

function scoreMatch(
  renderedText: string,
  target: DriveAnnotationTextRangeTargetV1,
  range: { readonly start: number; readonly end: number },
): number {
  let score = 1
  if (target.quote.prefix) {
    const before = renderedText.slice(Math.max(0, range.start - target.quote.prefix.length), range.start)
    if (before === target.quote.prefix) score += 4
  }
  if (target.quote.suffix) {
    const after = renderedText.slice(range.end, range.end + target.quote.suffix.length)
    if (after === target.quote.suffix) score += 4
  }
  const distance = Math.abs(range.start - target.range.start)
  return score - Math.min(1, distance / Math.max(1, renderedText.length))
}

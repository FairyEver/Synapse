import { BadRequestException } from "@nestjs/common"
import type { z } from "zod"

export function badRequestFromZodError(error: z.ZodError, fallback: string) {
  const details = error.issues.map(formatIssue).filter(Boolean)
  if (details.length === 0) return new BadRequestException(fallback)
  return new BadRequestException(`${trimSentence(fallback)}：${details.join("；")}`)
}

function formatIssue(issue: z.ZodIssue) {
  if (issue.code === "unrecognized_keys") {
    return `包含不支持的字段：${issue.keys.join("、")}`
  }

  const field = issue.path.length > 0 ? issue.path.join(".") : "请求体"

  if (issue.code === "invalid_format" && issue.format === "email") {
    return `${field} 格式无效`
  }

  if (issue.code === "too_small") {
    if (issue.origin === "string") return `${field} 至少 ${issue.minimum} 个字符`
    if (issue.origin === "array") return `${field} 至少选择 ${issue.minimum} 项`
  }

  if (issue.code === "invalid_value" && issue.values.length > 0) {
    return `${field} 必须是 ${issue.values.join(" 或 ")}`
  }

  return `${field} ${issue.message}`
}

function trimSentence(value: string) {
  return value.replace(/[。.]$/, "")
}

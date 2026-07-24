export const PROBLEM_FEEDBACK_MAX_UTF8_BYTES = 256 * 1024

export const PROBLEM_FEEDBACK_PRIVACY_CATEGORIES = [
  "authentication_secret",
  "local_path",
  "identity",
  "user_content",
  "unsafe_url",
  "correlation_identifier",
] as const

export type ProblemFeedbackPrivacyCategory =
  (typeof PROBLEM_FEEDBACK_PRIVACY_CATEGORIES)[number]

export const PROBLEM_FEEDBACK_INPUT_FIELDS = ["request", "content"] as const
export type ProblemFeedbackInputField = (typeof PROBLEM_FEEDBACK_INPUT_FIELDS)[number]

export const PROBLEM_FEEDBACK_INPUT_REASONS = [
  "type",
  "unknown_field",
  "required",
  "leading_or_trailing_whitespace",
  "invalid_unicode",
  "forbidden_character",
  "too_large",
] as const
export type ProblemFeedbackInputReason = (typeof PROBLEM_FEEDBACK_INPUT_REASONS)[number]

const problemFeedbackInputFieldSet = new Set<string>(PROBLEM_FEEDBACK_INPUT_FIELDS)
const problemFeedbackInputReasonSet = new Set<string>(PROBLEM_FEEDBACK_INPUT_REASONS)
const problemFeedbackPrivacyCategorySet =
  new Set<string>(PROBLEM_FEEDBACK_PRIVACY_CATEGORIES)

export function isProblemFeedbackInputField(
  value: unknown,
): value is ProblemFeedbackInputField {
  return typeof value === "string" && problemFeedbackInputFieldSet.has(value)
}

export function isProblemFeedbackInputReason(
  value: unknown,
): value is ProblemFeedbackInputReason {
  return typeof value === "string" && problemFeedbackInputReasonSet.has(value)
}

export function isProblemFeedbackPrivacyCategory(
  value: unknown,
): value is ProblemFeedbackPrivacyCategory {
  return typeof value === "string" && problemFeedbackPrivacyCategorySet.has(value)
}

export const PROBLEM_FEEDBACK_SAFE_PLACEHOLDERS = [
  "<secret>",
  "<token>",
  "<credential>",
  "<home>",
  "<project>",
  "<module>",
  "<file>",
  "<user>",
  "<organization>",
  "<customer>",
  "<device>",
  "<session>",
  "<request-id>",
  "<timestamp>",
  "<url>",
  "<value>",
  "<redacted>",
] as const

export type ProblemFeedbackValidationResult =
  | {
    readonly ok: true
    readonly data: {
      readonly content: string
    }
  }
  | {
    readonly ok: false
    readonly code: "INVALID_INPUT"
    readonly error: "Invalid problem feedback input."
    readonly data: {
      readonly field: ProblemFeedbackInputField
      readonly reason: ProblemFeedbackInputReason
    }
  }
  | {
    readonly ok: false
    readonly code: "PRIVACY_RISK"
    readonly error: "Problem feedback contains prohibited sensitive information."
    readonly data: {
      readonly category: ProblemFeedbackPrivacyCategory
    }
  }

const encoder = new TextEncoder()
const safePlaceholderSet = new Set<string>(PROBLEM_FEEDBACK_SAFE_PLACEHOLDERS)
const privacyCategoryNameSet = problemFeedbackPrivacyCategorySet
const forbiddenCharacterPattern =
  /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u
const privateKeyPattern =
  /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/u
const standaloneSecretPattern =
  /\b(?:AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/u
const credentialUrlPattern =
  /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/iu
const secretDerivativePattern =
  /\b(?:password|token|secret|credential|api[_ -]?key)[_ -]?(?:sha256|hash|fingerprint)\s*[:=]\s*([A-Fa-f0-9]{16,})\b/giu
const secretAssignmentPattern =
  /(?:\b(?:password|passwd|pwd|pin|verification[_ -]?code|recovery[_ -]?(?:code|key)|backup[_ -]?code|seed[_ -]?phrase|mnemonic(?:[_ -]?phrase)?|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|session[_ -]?token|client[_ -]?secret|secret|credential|cookie)\b|验证码|恢复码|恢复代码|助记词)\s*[:=：][^\S\r\n]*([^\r\n]+)/giu
const authorizationPattern =
  /\bauthorization\s*:\s*(?:bearer|basic)[^\S\r\n]+([^\r\n]+)/giu
const rawLocalPathPatterns = [
  /(?:^|[\s("'`])\/(?:Applications|Library|Network|System|Users|Volumes|bin|boot|cores|dev|etc|home|lib(?:64)?|media|mnt|opt|private|proc|root|run|sbin|srv|sys|tmp|usr|var)\/[^\s<>"']+/mu,
  /(?:^|[\s("'`])[A-Za-z]:[\\/][^\s<>"']+/mu,
  /(?:^|[\s("'`])\\\\[^\\\s]+\\[^\\\s]+/mu,
  /\bfile:\/\/[^\s<>"']+/iu,
  /(?:^|[\s("'`])(?:~\/|\$HOME\/|%USERPROFILE%[\\/])[^\s<>"']+/mu,
] as const
const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/iu
const macAddressPattern = /\b(?:[0-9A-F]{2}[:-]){5}[0-9A-F]{2}\b/iu
const fullIpv6Pattern = /\b(?:[0-9A-F]{1,4}:){7}[0-9A-F]{1,4}\b/iu
const compressedIpv6Pattern = /\b[0-9A-F]{0,4}(?::[0-9A-F]{0,4}){1,7}::(?:[0-9A-F]{0,4}:?){0,7}\b/iu
const identityAssignmentPattern =
  /\b(?:user|account|device|team|organization|customer|session)[_ -]?id\b\s*[:=]\s*([^\s,;]+)/giu
const identityValuePattern =
  /\b(?:email|phone|mobile|hostname|device[_ -]?name|organization|customer)\b\s*[:=]\s*([^\n]+)/giu
const internalDomainPattern =
  /\b(?:[a-z0-9-]+\.)+(?:internal|local|lan|corp)\b/iu
const roleLinePattern = /^(?:user|assistant|system|tool)\s*:/imu
const roleJsonPattern =
  /"role"\s*:\s*"(?:user|assistant|system|tool)"[\s\S]{0,300}"content"\s*:/iu
const gitDiffPattern = /^diff --git a\/.+ b\/.+$/mu
const urlPattern = /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/giu
const exactTimestampPattern =
  /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?\b/u
const correlationAssignmentPattern =
  /\b(?:request|trace|correlation|installation|install|crash)[_ -]?(?:id|identifier)\b\s*[:=]\s*([^\s,;]+)/giu
const localeAssignmentPattern =
  /\b(?:timezone|time[_ -]?zone|locale)\b\s*[:=]\s*([^\s,;]+)/giu
const utcOffsetPattern = /\bUTC[+-]\d{1,2}(?::\d{2})?\b/u

export function validateProblemFeedbackInput(input: unknown): ProblemFeedbackValidationResult {
  if (!isPlainRecord(input)) return invalidInput("request", "type")

  const keys = Object.keys(input)
  if (keys.some((key) => key !== "content")) return invalidInput("request", "unknown_field")
  if (!Object.hasOwn(input, "content") || input.content === "") {
    return invalidInput("content", "required")
  }
  if (typeof input.content !== "string") return invalidInput("content", "type")
  if (input.content !== input.content.trim()) {
    return invalidInput("content", "leading_or_trailing_whitespace")
  }
  if (hasUnpairedSurrogate(input.content)) return invalidInput("content", "invalid_unicode")
  if (forbiddenCharacterPattern.test(input.content)) {
    return invalidInput("content", "forbidden_character")
  }
  if (encoder.encode(input.content).byteLength > PROBLEM_FEEDBACK_MAX_UTF8_BYTES) {
    return invalidInput("content", "too_large")
  }

  const privacyCategory = detectProblemFeedbackPrivacyRisk(input.content)
  if (privacyCategory) {
    return {
      ok: false,
      code: "PRIVACY_RISK",
      error: "Problem feedback contains prohibited sensitive information.",
      data: { category: privacyCategory },
    }
  }

  return { ok: true, data: { content: input.content } }
}

export function detectProblemFeedbackPrivacyRisk(
  content: string,
): ProblemFeedbackPrivacyCategory | null {
  if (containsAuthenticationSecret(content)) return "authentication_secret"
  if (rawLocalPathPatterns.some((pattern) => pattern.test(content))) return "local_path"
  if (containsIdentity(content)) return "identity"
  if (containsRawUserContent(content)) return "user_content"
  if (containsUnsafeUrl(content)) return "unsafe_url"
  if (containsCorrelationIdentifier(content)) return "correlation_identifier"
  return null
}

function invalidInput(
  field: ProblemFeedbackInputField,
  reason: ProblemFeedbackInputReason,
): ProblemFeedbackValidationResult {
  return {
    ok: false,
    code: "INVALID_INPUT",
    error: "Invalid problem feedback input.",
    data: { field, reason },
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return true
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return true
      index += 1
      continue
    }
    if (code >= 0xdc00 && code <= 0xdfff) return true
  }
  return false
}

function containsAuthenticationSecret(content: string): boolean {
  if (
    privateKeyPattern.test(content)
    || standaloneSecretPattern.test(content)
    || credentialUrlPattern.test(content)
  ) {
    return true
  }
  if (hasUnsafeCapturedValue(content, secretDerivativePattern)) return true
  if (hasUnsafeCapturedValue(content, authorizationPattern)) return true
  return hasUnsafeCapturedValue(content, secretAssignmentPattern)
}

function hasUnsafeCapturedValue(content: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0
  for (const match of content.matchAll(pattern)) {
    const value = stripTrailingPunctuation(match[1] ?? "")
    if (!isSafeReplacementValue(value)) return true
  }
  return false
}

function isSafeReplacementValue(value: string): boolean {
  return safePlaceholderSet.has(value) || privacyCategoryNameSet.has(value)
}

function stripTrailingPunctuation(value: string): string {
  return value.replace(/[.)\]}]+$/u, "")
}

function containsIdentity(content: string): boolean {
  if (
    emailPattern.test(content)
    || macAddressPattern.test(content)
    || fullIpv6Pattern.test(content)
    || compressedIpv6Pattern.test(content)
    || internalDomainPattern.test(content)
  ) {
    return true
  }
  if (containsIpv4Address(content)) return true
  if (hasUnsafeCapturedValue(content, identityAssignmentPattern)) return true
  return hasUnsafeCapturedValue(content, identityValuePattern)
}

function containsIpv4Address(content: string): boolean {
  for (const match of content.matchAll(/\b(?:\d{1,3}\.){3}\d{1,3}\b/gu)) {
    if (match[0].split(".").every((part) => Number(part) <= 255)) return true
  }
  return false
}

function containsRawUserContent(content: string): boolean {
  if (gitDiffPattern.test(content) || roleJsonPattern.test(content)) return true
  const roleLines = content.split("\n").filter((line) => roleLinePattern.test(line))
  return roleLines.length >= 2
}

function containsUnsafeUrl(content: string): boolean {
  urlPattern.lastIndex = 0
  for (const match of content.matchAll(urlPattern)) {
    const candidate = stripTrailingPunctuation(match[0])
    let url: URL
    try {
      url = new URL(candidate)
    } catch {
      return true
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return true
    if (url.username || url.password || url.search || url.hash) return true
    if (isUnsafeHostname(url.hostname)) return true
  }
  return false
}

function isUnsafeHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/gu, "")
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true
  if (normalized.endsWith(".local") || normalized.endsWith(".internal") || normalized.endsWith(".lan")) {
    return true
  }
  const ipv4Parts = normalized.split(".")
  if (ipv4Parts.length !== 4 || !ipv4Parts.every((part) => /^\d{1,3}$/u.test(part))) {
    return normalized === "::1"
  }
  const values = ipv4Parts.map(Number)
  if (values.some((value) => value > 255)) return false
  return values[0] === 10
    || values[0] === 127
    || (values[0] === 169 && values[1] === 254)
    || (values[0] === 172 && values[1]! >= 16 && values[1]! <= 31)
    || (values[0] === 192 && values[1] === 168)
}

function containsCorrelationIdentifier(content: string): boolean {
  if (exactTimestampPattern.test(content) || utcOffsetPattern.test(content)) return true
  if (hasUnsafeCapturedValue(content, correlationAssignmentPattern)) return true
  return hasUnsafeCapturedValue(content, localeAssignmentPattern)
}

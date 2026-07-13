type SkillPublishSecretFinding = {
  kind: "authorization" | "env-value" | "known-token" | "private-key" | "sensitive-url"
  key?: string
  line: number
}

const SENSITIVE_ENV_KEY_PATTERN = /(?:^|_)(?:access_?key|api_?key|credential|password|private_?key|secret|token|webhook_?url)(?:_|$)/i
const SENSITIVE_URL_PARAM_PATTERN = /^(?:access_?token|api_?key|auth|authorization|credential|key|password|secret|sig|signature|token)$/i
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/
const KNOWN_TOKEN_PATTERN = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,})\b/
const AUTHORIZATION_PATTERN = /\bauthorization\b\s*[:=]\s*["']?bearer\s+([^\s"'`,;]+)/i
const URL_PATTERN = /https?:\/\/[^\s"'<>]+/gi

function isPlaceholderValue(rawValue: string): boolean {
  const value = rawValue.trim().replace(/^(["'])(.*)\1$/, "$2").trim()
  if (!value) return true
  if (/^\$\{[A-Z0-9_]+\}$/i.test(value)) return true
  if (/^<[^>]+>$/.test(value)) return true
  if (/^(?:changeme|demo|example|replace[-_ ]?me|test|x{3,}|your[-_ ].*)$/i.test(value)) return true
  return false
}

function findSensitiveUrl(line: string): SkillPublishSecretFinding | null {
  for (const match of line.matchAll(URL_PATTERN)) {
    try {
      const url = new URL(match[0])
      for (const [key, value] of url.searchParams.entries()) {
        if (SENSITIVE_URL_PARAM_PATTERN.test(key) && !isPlaceholderValue(value)) {
          return { kind: "sensitive-url", key, line: 0 }
        }
      }
    } catch {
      continue
    }
  }
  return null
}

function findSkillPublishSecret(
  text: string,
  options: { envExample?: boolean } = {},
): SkillPublishSecretFinding | null {
  const lines = text.split(/\r?\n/)

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ""
    const lineNumber = index + 1

    if (PRIVATE_KEY_PATTERN.test(line)) {
      return { kind: "private-key", line: lineNumber }
    }

    if (KNOWN_TOKEN_PATTERN.test(line)) {
      return { kind: "known-token", line: lineNumber }
    }

    const authorization = line.match(AUTHORIZATION_PATTERN)
    if (authorization?.[1] && !isPlaceholderValue(authorization[1])) {
      return { kind: "authorization", line: lineNumber }
    }

    const sensitiveUrl = findSensitiveUrl(line)
    if (sensitiveUrl) {
      return { ...sensitiveUrl, line: lineNumber }
    }

    if (options.envExample) {
      const envEntry = line.match(/^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i)
      if (
        envEntry?.[1]
        && SENSITIVE_ENV_KEY_PATTERN.test(envEntry[1])
        && !isPlaceholderValue(envEntry[2] ?? "")
        && (envEntry[2]?.trim().length ?? 0) >= 12
      ) {
        return { kind: "env-value", key: envEntry[1], line: lineNumber }
      }
    }
  }

  return null
}

export {
  findSkillPublishSecret,
  isPlaceholderValue,
  type SkillPublishSecretFinding,
}

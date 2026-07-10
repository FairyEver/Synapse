const SKILL_RUNTIME_ENV_MAX_BYTES = 1024n * 1024n
const SKILL_RUNTIME_ENV_SIZE_LIMIT_MESSAGE = "Skill .env 不能超过 1 MiB。"

class SkillRuntimeEnvSizeError extends Error {
  constructor() {
    super(SKILL_RUNTIME_ENV_SIZE_LIMIT_MESSAGE)
  }
}

function assertSkillRuntimeEnvByteLength(byteLength: number | bigint): void {
  const normalized = typeof byteLength === "bigint" ? byteLength : BigInt(byteLength)
  if (normalized < 0n || normalized > SKILL_RUNTIME_ENV_MAX_BYTES) {
    throw new SkillRuntimeEnvSizeError()
  }
}

function assertSkillRuntimeEnvBytes(content: string | Uint8Array): void {
  assertSkillRuntimeEnvByteLength(
    typeof content === "string" ? Buffer.byteLength(content, "utf8") : content.byteLength,
  )
}

export {
  assertSkillRuntimeEnvByteLength,
  assertSkillRuntimeEnvBytes,
  SKILL_RUNTIME_ENV_MAX_BYTES,
  SKILL_RUNTIME_ENV_SIZE_LIMIT_MESSAGE,
  SkillRuntimeEnvSizeError,
}

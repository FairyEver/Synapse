import type { DriveBatchReadError } from "@synapse/shared" with { "resolution-mode": "import" }

export function driveBatchReadError(error: unknown): DriveBatchReadError {
  const details = error instanceof Error ? error as Error & { status?: number; retryAfterMs?: number } : null
  return {
    status: details?.name === "ZodError" || details?.name === "SyntaxError" ? 502
      : details?.name === "AccountAuthenticationRequiredError" ? 401
        : details?.status === 404 ? 502 : details?.status ?? 503,
    code: "BATCH_READ_FAILED", message: details?.message ?? "云盘批量读取失败。",
    ...(details?.retryAfterMs !== undefined ? { retryAfterMs: details.retryAfterMs } : {}),
  }
}

export async function readDriveBatches<Input, Result>(
  inputs: readonly Input[], limit: number,
  read: (batch: readonly Input[]) => Promise<readonly Result[]>,
  failed: (input: Input, error: DriveBatchReadError) => Result,
): Promise<readonly Result[]> {
  const results: Result[] = []
  for (let offset = 0; offset < inputs.length; offset += limit) {
    const batch = inputs.slice(offset, offset + limit)
    try {
      results.push(...await read(batch))
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error
      const failure = driveBatchReadError(error)
      results.push(...batch.map((input) => failed(input, failure)))
    }
  }
  return results
}

export function throwDriveBatchError(error: DriveBatchReadError): never {
  throw Object.assign(new Error(error.message), { status: error.status, code: error.code, retryAfterMs: error.retryAfterMs })
}

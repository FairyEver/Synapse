/** A pending native hook must not be released by close before interrupt is acknowledged. */
export async function stopQueryAtBoundary(input: {
  readonly query: { interrupt(): Promise<unknown>; close(): void | Promise<void> }
  readonly release: () => void
  readonly settled: Promise<unknown>
  readonly timeoutMs?: number
}): Promise<void> {
  await withinDeadline((async () => {
    await input.query.interrupt()
    await input.query.close()
    input.release()
    await input.settled
  })(), input.timeoutMs ?? 5000)
}

function withinDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([operation, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("SDK 停止未能在期限内确认，已保留恢复状态。")), timeoutMs)
  })]).finally(() => { if (timer) clearTimeout(timer) })
}

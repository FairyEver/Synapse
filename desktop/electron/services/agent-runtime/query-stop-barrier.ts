/** Stop an SDK query and wait briefly for its message pump to settle. */
export async function stopQueryAtBoundary(input: {
  readonly query: { interrupt(): Promise<unknown>; close(): void | Promise<void> }
  readonly settled: Promise<unknown>
  readonly timeoutMs?: number
}): Promise<void> {
  await withinDeadline((async () => {
    await input.query.interrupt()
    await input.query.close()
    await input.settled
  })(), input.timeoutMs ?? 5000)
}

function withinDeadline<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([operation, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("SDK 停止未能在期限内确认。")), timeoutMs)
  })]).finally(() => { if (timer) clearTimeout(timer) })
}

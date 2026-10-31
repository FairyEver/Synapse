export function abortable<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const abort = () => reject(signal.reason)
    signal.addEventListener("abort", abort, { once: true })
    void work().then(resolve, reject).finally(() => signal.removeEventListener("abort", abort))
  })
}

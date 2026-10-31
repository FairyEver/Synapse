const key = 'synapse.user-session.changed'
function sessionChannel(): BroadcastChannel | null {
  try { return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(key) }
  catch { return null }
}
export function broadcastUserSessionChange(): void {
  if (typeof window === 'undefined') return
  const channel = sessionChannel()
  if (channel) {
    channel.postMessage('changed')
    channel.close()
  } else {
    try { localStorage.setItem(key, String(Date.now())) } catch { return }
  }
}
export function subscribeUserSessionChange(listener: () => void): () => void {
  const storage = (event: StorageEvent) => { if (event.key === key) listener() }
  window.addEventListener('storage', storage)
  const channel = sessionChannel()
  if (channel) channel.onmessage = listener
  return () => { window.removeEventListener('storage', storage); channel?.close() }
}

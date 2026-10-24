/** PID is part of the created name so recovery works even before a marker write. */
export function parseInstallStagingName(name: string): { ownerPid: number | null } | null {
  const match = /^\.synapse-install-dir-(?:p([1-9][0-9]*)-)?[A-Za-z0-9]{6}$/.exec(name)
  if (!match) return null
  if (!match[1]) return { ownerPid: null } // Legacy installer format.
  const ownerPid = Number(match[1])
  return Number.isSafeInteger(ownerPid) && ownerPid <= 2_147_483_647 ? { ownerPid } : null
}

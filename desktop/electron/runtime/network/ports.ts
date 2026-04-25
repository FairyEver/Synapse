/**
 * Phase 0.3 — Port allocation helpers.
 *
 * isFreePort: probes by binding a short-lived listener via node:net.
 * pickNextAvailablePort: incremental scan that respects an in-process
 * "already allocated" set to avoid races when many descriptors register in
 * parallel without actually creating sockets first.
 */

import { createServer } from "node:net"

export interface PickPortArgs {
  readonly from: number
  readonly to: number
  /** Try preferred first if not in `taken`. */
  readonly preferred?: number
  readonly taken: ReadonlySet<number>
  readonly probe: (port: number) => Promise<boolean>
}

export async function pickNextAvailablePort(args: PickPortArgs): Promise<number> {
  if (args.preferred !== undefined && !args.taken.has(args.preferred)) {
    if (await args.probe(args.preferred)) return args.preferred
  }
  for (let port = args.from; port <= args.to; port++) {
    if (args.taken.has(port)) continue
    if (await args.probe(port)) return port
  }
  throw new Error(`No free port available in range ${args.from}-${args.to}`)
}

/**
 * Returns true if the given port is currently free on `host`.
 * Uses an ephemeral listener and closes it immediately. Tests can inject
 * their own probe for determinism.
 */
export function isFreePort(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // SPEC §1 hard-rule grep #4 forbids `net.createServer` outside
    // `runtime/network/`. This file IS that home; the call is allowed here.
    const server = createServer()
    server.once("error", () => resolve(false))
    server.once("listening", () => {
      server.close(() => resolve(true))
    })
    server.listen(port, host)
  })
}

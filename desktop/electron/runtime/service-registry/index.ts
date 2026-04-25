/**
 * Phase 0.1 — ServiceRegistry public surface.
 * SPEC §4.
 *
 * Implementation lands incrementally:
 *  - T1.1 (this commit): types + errors + module entrypoint.
 *  - T1.2: topological sort.
 *  - T1.3: register/inspect.
 *  - T1.4: startAll/stopAll with timeout.
 */

export * from "./types"
export * from "./errors"
export { topoSort, reverseTopoSort, descriptorAsNode } from "./topo"
export type { TopoNode } from "./topo"

import { parseStateSyncPath } from "@synapse/shared/state-sync-contracts"

type TrieNode = {
  readonly path: string
  readonly subscribers: Set<string>
  readonly children: Map<string, TrieNode>
}

export type AffectedSubscribers = {
  readonly mutationRecipients: Set<string>
  readonly snapshotRecipients: Map<string, string[]>
}

export class StateSyncSubscriptionTrie {
  private readonly root: TrieNode = {
    path: "/",
    subscribers: new Set(),
    children: new Map(),
  }

  private readonly pathsByConnection = new Map<string, Set<string>>()

  subscribe(connectionId: string, paths: readonly string[]): void {
    if (paths.length === 0) return

    let connPaths = this.pathsByConnection.get(connectionId)
    for (const rawPath of paths) {
      const parsed = parseStateSyncPath(rawPath)
      if (!parsed.ok) {
        throw new Error(parsed.message)
      }

      let node = this.root
      let currentPath = ""
      for (const segment of parsed.segments) {
        currentPath = `${currentPath}/${segment}`
        let child = node.children.get(segment)
        if (!child) {
          child = {
            path: currentPath,
            subscribers: new Set(),
            children: new Map(),
          }
          node.children.set(segment, child)
        }
        node = child
      }

      node.subscribers.add(connectionId)
      if (!connPaths) {
        connPaths = new Set()
        this.pathsByConnection.set(connectionId, connPaths)
      }
      connPaths.add(parsed.normalized)
    }
  }

  unsubscribe(connectionId: string, paths: readonly string[]): void {
    const connPaths = this.pathsByConnection.get(connectionId)
    if (!connPaths || paths.length === 0) return

    for (const rawPath of paths) {
      const parsed = parseStateSyncPath(rawPath)
      if (!parsed.ok) continue
      if (!connPaths.delete(parsed.normalized)) continue
      this.removeFromNode(connectionId, parsed.segments)
    }

    if (connPaths.size === 0) {
      this.pathsByConnection.delete(connectionId)
    }
  }

  removeConnection(connectionId: string): void {
    const connPaths = this.pathsByConnection.get(connectionId)
    if (!connPaths) return

    for (const path of connPaths) {
      const parsed = parseStateSyncPath(path)
      if (parsed.ok) {
        this.removeFromNode(connectionId, parsed.segments)
      }
    }
    this.pathsByConnection.delete(connectionId)
  }

  getSubscribedPaths(connectionId: string): string[] {
    const connPaths = this.pathsByConnection.get(connectionId)
    if (!connPaths) return []
    return [...connPaths].sort()
  }

  resolveAffected(writePath: string): AffectedSubscribers {
    const mutationRecipients = new Set<string>()
    const snapshotRecipients = new Map<string, string[]>()

    const parsed = parseStateSyncPath(writePath)
    if (!parsed.ok) {
      return { mutationRecipients, snapshotRecipients }
    }

    // 1. Walk from root to writePath to collect ancestor-or-equal subscribers (deduped via Set)
    let curr: TrieNode | undefined = this.root
    for (const connId of curr.subscribers) {
      mutationRecipients.add(connId)
    }
    for (const segment of parsed.segments) {
      curr = curr.children.get(segment)
      if (!curr) {
        return { mutationRecipients, snapshotRecipients }
      }
      for (const connId of curr.subscribers) {
        mutationRecipients.add(connId)
      }
    }

    // 2. Walk strict descendants of writePath to collect child subscribers for snapshot recomputation,
    // deduplicating any connection already covered by mutationRecipients or a shallower snapshot path on the same branch.
    const coveredOnBranch = new Set<string>()
    const collectDescendants = (node: TrieNode): void => {
      const newlyCovered: string[] = []
      for (const connId of node.subscribers) {
        if (mutationRecipients.has(connId) || coveredOnBranch.has(connId)) {
          continue
        }
        let targetPaths = snapshotRecipients.get(connId)
        if (!targetPaths) {
          targetPaths = []
          snapshotRecipients.set(connId, targetPaths)
        }
        targetPaths.push(node.path)
        coveredOnBranch.add(connId)
        newlyCovered.push(connId)
      }

      for (const child of node.children.values()) {
        collectDescendants(child)
      }

      for (const connId of newlyCovered) {
        coveredOnBranch.delete(connId)
      }
    }

    for (const child of curr.children.values()) {
      collectDescendants(child)
    }

    return { mutationRecipients, snapshotRecipients }
  }

  private removeFromNode(connectionId: string, segments: readonly string[]): void {
    const trail: Array<{ parent: TrieNode; segment: string; node: TrieNode }> = []
    let curr: TrieNode = this.root

    for (const segment of segments) {
      const next = curr.children.get(segment)
      if (!next) return
      trail.push({ parent: curr, segment, node: next })
      curr = next
    }

    curr.subscribers.delete(connectionId)

    for (let i = trail.length - 1; i >= 0; i--) {
      const { parent, segment, node } = trail[i]!
      if (node.subscribers.size === 0 && node.children.size === 0) {
        parent.children.delete(segment)
      } else {
        break
      }
    }
  }
}

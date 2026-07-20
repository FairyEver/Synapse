import type { NodeManifest, NodeExecutor } from "./types"

export class NodeTypeRegistry {
  private readonly manifests = new Map<string, NodeManifest>()
  private readonly executors = new Map<string, NodeExecutor>()

  register<T>(manifest: NodeManifest<T>, executor: NodeExecutor<T>): void {
    this.manifests.set(manifest.type, manifest as NodeManifest)
    this.executors.set(manifest.type, executor as NodeExecutor)
  }
  registerManifest<T>(manifest: NodeManifest<T>): void {
    this.manifests.set(manifest.type, manifest as NodeManifest)
  }
  getManifest(type: string): NodeManifest {
    const m = this.manifests.get(type)
    if (!m) throw new Error(`Unknown node type: ${type}`)
    return m
  }
  getExecutor(type: string): NodeExecutor {
    const e = this.executors.get(type)
    if (!e) throw new Error(`Unknown node type: ${type}`)
    return e
  }
  listTypes(): string[] { return [...this.manifests.keys()] }
  listManifests(): NodeManifest[] { return [...this.manifests.values()] }
}

export const nodeTypeRegistry = new NodeTypeRegistry()

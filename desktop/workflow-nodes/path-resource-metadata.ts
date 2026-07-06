import { createHash } from "node:crypto"
import path from "node:path"

export type WorkflowExternalPathAccess = "read" | "read_write"
export type WorkflowExternalPathKind = "directory" | "file"

export interface WorkflowExternalPathResourceInput {
  readonly source: string
  readonly path: string | undefined
  readonly cwd: string
  readonly kind: WorkflowExternalPathKind
  readonly access: WorkflowExternalPathAccess
}

export interface WorkflowExternalPathResource {
  readonly source: string
  readonly kind: WorkflowExternalPathKind
  readonly access: WorkflowExternalPathAccess
  readonly resolvedPath: string
  readonly pathFingerprint: string
  readonly relativeToCwd: "inside" | "outside"
}

export function createWorkflowExternalPathResources(
  inputs: readonly WorkflowExternalPathResourceInput[],
): WorkflowExternalPathResource[] {
  return inputs
    .filter((input): input is WorkflowExternalPathResourceInput & { readonly path: string } =>
      typeof input.path === "string" && input.path.length > 0)
    .map((input) => {
      const resolvedPath = path.resolve(input.path)
      return {
        source: input.source,
        kind: input.kind,
        access: input.access,
        resolvedPath,
        pathFingerprint: fingerprintPath(resolvedPath),
        relativeToCwd: isPathInside(resolvedPath, input.cwd) ? "inside" : "outside",
      }
    })
}

function fingerprintPath(value: string): string {
  return createHash("sha256").update(path.normalize(value)).digest("hex").slice(0, 16)
}

function isPathInside(candidate: string, cwd: string): boolean {
  const relative = path.relative(path.resolve(cwd), path.resolve(candidate))
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

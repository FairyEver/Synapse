import { createRequire } from "node:module"
import path from "node:path"

export function resolvePackedBuiltinToolWorkerPath(bootstrapFilePath: string): string {
  const packedBootstrapPath = bootstrapFilePath.replace(/([\\/])app\.asar\.unpacked(?=[\\/])/, "$1app.asar")
  return path.join(path.dirname(packedBootstrapPath), "../workers/builtin-tool-worker.js")
}

const requireFromBootstrap = createRequire(__filename)
requireFromBootstrap(resolvePackedBuiltinToolWorkerPath(__filename))


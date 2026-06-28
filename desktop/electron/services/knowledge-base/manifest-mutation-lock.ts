import path from "node:path"

import { knowledgeBaseErrorMeta, knowledgeBaseLogger as logger } from "./logging"

const manifestMutationChains = new Map<string, Promise<unknown>>()

export async function withKnowledgeBaseManifestMutationLock<T>(
  projectPath: string,
  task: () => Promise<T>,
): Promise<T> {
  const key = path.resolve(projectPath)
  const previous = manifestMutationChains.get(key) ?? Promise.resolve()
  const run = previous.catch((error) => {
    logger.warn("Knowledge Base manifest mutation continued after previous failure.", {
      boundary: "knowledge-base.manifest-mutation-lock",
      projectPath: key,
      ...knowledgeBaseErrorMeta(error),
    })
    return undefined
  }).then(task)
  manifestMutationChains.set(key, run)

  try {
    return await run
  } finally {
    if (manifestMutationChains.get(key) === run) {
      manifestMutationChains.delete(key)
    }
  }
}

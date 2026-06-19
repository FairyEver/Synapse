import path from "node:path"

const manifestMutationChains = new Map<string, Promise<void>>()

export async function withKnowledgeBaseManifestMutationLock<T>(
  projectPath: string,
  task: () => Promise<T>,
): Promise<T> {
  const key = path.resolve(projectPath)
  const previous = manifestMutationChains.get(key) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(task)
  const done = run.then(() => undefined, () => undefined)
  manifestMutationChains.set(key, done)

  try {
    return await run
  } finally {
    if (manifestMutationChains.get(key) === done) {
      manifestMutationChains.delete(key)
    }
  }
}

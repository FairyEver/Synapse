/** Prevent the acceptance debugger's startup pause from reaching node-pty's pipe worker. */
export function guardPtyWorkerInspector(workerThreads, expectedWorkerFile, parentExecArgv, ownedInspectorArgument) {
  if (!Array.isArray(parentExecArgv) || parentExecArgv.some((argument) => argument !== ownedInspectorArgument)) {
    throw new Error("Installed PTY inspector arguments are unexpected")
  }
  const originalWorker = workerThreads.Worker
  workerThreads.Worker = new Proxy(originalWorker, {
    construct(target, args, newTarget) {
      const [filename, options] = args
      if (typeof filename !== "string" || filename !== expectedWorkerFile
        || (options !== undefined && (options === null || typeof options !== "object" || Array.isArray(options) || options.execArgv !== undefined))) {
        return Reflect.construct(target, args, newTarget)
      }
      const forwarded = [...args]
      forwarded[1] = { ...options, execArgv: [] }
      return Reflect.construct(target, forwarded, newTarget)
    },
  })
  return () => { workerThreads.Worker = originalWorker }
}

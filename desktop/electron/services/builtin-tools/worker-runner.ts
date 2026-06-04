export async function executeBuiltinToolInWorker(_payload: { readonly toolId: string; readonly input: unknown }): Promise<unknown> {
  throw new Error("Builtin tool worker is not registered yet.")
}


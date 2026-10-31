import type { MonacoBinding } from 'y-monaco'

type MonacoBindingArguments = ConstructorParameters<typeof MonacoBinding>

export async function createMonacoCollaborationBinding(
  ...args: MonacoBindingArguments
): Promise<Pick<MonacoBinding, 'destroy'>> {
  const { MonacoBinding } = await import('y-monaco')
  return new MonacoBinding(...args)
}

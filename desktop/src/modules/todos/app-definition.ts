import type { SynapseSystemAppDefinition } from "../apps/types"
export const todosAppDefinition = { id: "todos", namespace: "todos", type: "system", name: "待办事项", windowTitle: "待办事项", dock: { pinnedByDefault: false, order: 26, pinnable: true }, window: { openable: true }, removable: false, renameable: false, iconEditable: false } as const satisfies SynapseSystemAppDefinition

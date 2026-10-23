import type { SynapseSystemAppDefinition } from "../apps/types"
export const mailAppDefinition = { id: "mail", namespace: "mail", type: "system", name: "邮箱", windowTitle: "邮箱", dock: { pinnedByDefault: true, order: 56, pinnable: true }, window: { openable: true }, removable: false, renameable: false, iconEditable: false } as const satisfies SynapseSystemAppDefinition

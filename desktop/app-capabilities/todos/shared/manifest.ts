import { z } from "zod"
import { parseTodoReference } from "@synapse/shared/todo-contracts"
import type { MainAppCapabilityManifest } from "../../manifest"
export const TODOS_OPEN_HANDLER = "todos.item.open"
export const todosCapabilityManifest = { id: "todos", deepLinks: [], protocolRoutes: [{ hostname: "todos", action: "open", mainHandlerId: TODOS_OPEN_HANDLER,
  paramsSchema: z.object({ deepLink: z.string().max(230).refine((value) => parseTodoReference(value) !== null) }).strict() }] } as const satisfies MainAppCapabilityManifest

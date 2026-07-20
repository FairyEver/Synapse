import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import { CHEAT_CODE_STATE_SERVICE_ID, type CheatCodeStateService } from "../../services/cheat-code-state-service"
import { createMainLogger } from "../../services/log-store"

const logger = createMainLogger("cheat-code.ipc")

const stateNameSchema = z.string().min(1)
const stateMapSchema = z.record(z.string(), z.boolean())
const stateResultSchema = z.object({
  name: z.string(),
  active: z.boolean(),
})
const getStatesRequestSchema = z.object({
  names: z.array(stateNameSchema).optional(),
}).optional()
const toggleStateRequestSchema = z.object({
  name: stateNameSchema,
})
type GetStatesRequest = z.infer<typeof getStatesRequestSchema>
type StateResult = z.infer<typeof stateResultSchema>
type ToggleStateRequest = z.infer<typeof toggleStateRequestSchema>

export const cheatCodeIpcModule: IpcModule = {
  id: "cheat-code",
  methods: {
    getStates: {
      kind: "invoke",
      operationId: "app.cheat_code.states.get",
      request: getStatesRequestSchema,
      response: stateMapSchema,
      handler: async (ctx, request: GetStatesRequest) => {
        logger.info("Cheat code IPC get states requested.", {
          requestedCount: request?.names?.length ?? 0,
          allStates: !request?.names,
        })
        const service = ctx.resolve<CheatCodeStateService>(CHEAT_CODE_STATE_SERVICE_ID)
        return service.getStates(request?.names)
      },
    },
    setState: {
      kind: "invoke",
      operationId: "app.cheat_code.state.set",
      request: stateResultSchema,
      response: stateResultSchema,
      handler: async (ctx, state: StateResult) => {
        logger.info("Cheat code IPC set state requested.", {
          name: state.name,
          active: state.active,
        })
        const service = ctx.resolve<CheatCodeStateService>(CHEAT_CODE_STATE_SERVICE_ID)
        return service.setState(state)
      },
    },
    toggleState: {
      kind: "invoke",
      operationId: "app.cheat_code.state.toggle",
      request: toggleStateRequestSchema,
      response: stateResultSchema,
      handler: async (ctx, { name }: ToggleStateRequest) => {
        logger.info("Cheat code IPC toggle state requested.", { name })
        const service = ctx.resolve<CheatCodeStateService>(CHEAT_CODE_STATE_SERVICE_ID)
        return service.toggleState(name)
      },
    },
  },
  events: {},
}

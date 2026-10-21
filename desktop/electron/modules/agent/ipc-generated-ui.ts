import type { IpcMethodDescriptor } from "../../runtime/ipc/types"
import {
  generatedUiTargetSchema, generatedUiSnapshotSchema, generatedUiSubmissionSchema,
  saveGeneratedUiStateSchema, submitGeneratedUiActionSchema,
  type GeneratedUiTarget, type SaveGeneratedUiStateInput, type SubmitGeneratedUiActionInput,
} from "../../../src/types/agent-generated-ui"
import { resolveProjectAgent } from "./ipc-shared"

export const generatedUiMethods = {
  getGeneratedUiState: {
    kind: "invoke", operationId: "app.agent.generated_ui.get_state",
    request: generatedUiTargetSchema, response: generatedUiSnapshotSchema, maxResponseBytes: 68 * 1024,
    handler: async (ctx, input: GeneratedUiTarget) => {
      if (!ctx.sender) throw new Error("生成界面仅支持本地对话。")
      const { agent } = await resolveProjectAgent(ctx.resolve, input.projectId)
      return agent.getGeneratedUiState(input)
    },
  },
  saveGeneratedUiState: {
    kind: "invoke", operationId: "app.agent.generated_ui.save_state",
    request: saveGeneratedUiStateSchema, response: generatedUiSnapshotSchema, maxResponseBytes: 68 * 1024,
    handler: async (ctx, input: SaveGeneratedUiStateInput) => {
      if (!ctx.sender) throw new Error("生成界面仅支持本地对话。")
      const { agent } = await resolveProjectAgent(ctx.resolve, input.projectId)
      return agent.saveGeneratedUiState(input)
    },
  },
  submitGeneratedUiAction: {
    kind: "invoke", operationId: "app.agent.generated_ui.submit_action",
    request: submitGeneratedUiActionSchema, response: generatedUiSubmissionSchema, maxResponseBytes: 4096,
    handler: async (ctx, input: SubmitGeneratedUiActionInput) => {
      if (!ctx.sender) throw new Error("生成界面仅支持本地对话。")
      const { agent } = await resolveProjectAgent(ctx.resolve, input.projectId)
      return agent.submitGeneratedUiAction(input, ctx.sender.id)
    },
  },
} satisfies Record<string, IpcMethodDescriptor>

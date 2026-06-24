import type {
  TerminalCreateGroupInput,
  TerminalCreateSessionInput,
  TerminalDeleteSessionInput,
  TerminalGroup,
  TerminalOutputChunk,
  TerminalReadSessionInput,
  TerminalReadSessionResult,
  TerminalRenameSessionInput,
  TerminalResizeSessionInput,
  TerminalSession,
  TerminalStopSessionInput,
  TerminalWriteSessionInput,
} from "../../app-capabilities/terminal/shared/schema"

export type SynapseTerminalGroup = TerminalGroup
export type SynapseTerminalSession = TerminalSession
export type SynapseTerminalOutputChunk = TerminalOutputChunk
export type SynapseTerminalCreateGroupInput = TerminalCreateGroupInput
export type SynapseTerminalCreateSessionInput = TerminalCreateSessionInput
export type SynapseTerminalRenameSessionInput = TerminalRenameSessionInput
export type SynapseTerminalDeleteSessionInput = TerminalDeleteSessionInput
export type SynapseTerminalReadSessionInput = TerminalReadSessionInput
export type SynapseTerminalReadSessionResult = TerminalReadSessionResult
export type SynapseTerminalWriteSessionInput = TerminalWriteSessionInput
export type SynapseTerminalResizeSessionInput = TerminalResizeSessionInput
export type SynapseTerminalStopSessionInput = TerminalStopSessionInput

export type SynapseTerminalDataEvent = {
  readonly sessionId: string
  readonly chunk: SynapseTerminalOutputChunk
}

export type SynapseTerminalSessionDeletedEvent = {
  readonly sessionId: string
}

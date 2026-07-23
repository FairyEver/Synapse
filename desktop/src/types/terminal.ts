import type {
  TerminalAttachSessionInput,
  TerminalAttachSessionResult,
  TerminalCreateGroupCommandInput,
  TerminalCreateGroupInput,
  TerminalCreateSessionInput,
  TerminalDeleteGroupCommandInput,
  TerminalDeleteGroupInput,
  TerminalDeleteSessionInput,
  TerminalGroup,
  TerminalGroupCommand,
  TerminalLaunchGroupCommandInput,
  TerminalOutputChunk,
  TerminalReadSessionInput,
  TerminalReadSessionResult,
  TerminalRenameGroupInput,
  TerminalRenameSessionInput,
  TerminalResizeSessionInput,
  TerminalResizedEvent,
  TerminalRunStartupCommandInput,
  TerminalSession,
  TerminalStopSessionInput,
  TerminalUpdateGroupCommandInput,
  TerminalUpdateGroupSettingsInput,
  TerminalWriteSessionInput,
} from "../../app-capabilities/terminal/shared/schema"

export type SynapseTerminalGroup = TerminalGroup
export type SynapseTerminalGroupCommand = TerminalGroupCommand
export type SynapseTerminalSession = TerminalSession
export type SynapseTerminalOutputChunk = TerminalOutputChunk
export type SynapseTerminalCreateGroupInput = TerminalCreateGroupInput
export type SynapseTerminalRenameGroupInput = TerminalRenameGroupInput
export type SynapseTerminalUpdateGroupSettingsInput = TerminalUpdateGroupSettingsInput
export type SynapseTerminalCreateGroupCommandInput = TerminalCreateGroupCommandInput
export type SynapseTerminalUpdateGroupCommandInput = TerminalUpdateGroupCommandInput
export type SynapseTerminalDeleteGroupCommandInput = TerminalDeleteGroupCommandInput
export type SynapseTerminalLaunchGroupCommandInput = TerminalLaunchGroupCommandInput
export type SynapseTerminalDeleteGroupInput = TerminalDeleteGroupInput
export type SynapseTerminalCreateSessionInput = TerminalCreateSessionInput
export type SynapseTerminalAttachSessionInput = TerminalAttachSessionInput
export type SynapseTerminalAttachSessionResult = TerminalAttachSessionResult
export type SynapseTerminalRenameSessionInput = TerminalRenameSessionInput
export type SynapseTerminalDeleteSessionInput = TerminalDeleteSessionInput
export type SynapseTerminalReadSessionInput = TerminalReadSessionInput
export type SynapseTerminalReadSessionResult = TerminalReadSessionResult
export type SynapseTerminalWriteSessionInput = TerminalWriteSessionInput
export type SynapseTerminalResizeSessionInput = TerminalResizeSessionInput
export type SynapseTerminalResizedEvent = TerminalResizedEvent
export type SynapseTerminalStopSessionInput = TerminalStopSessionInput
export type SynapseTerminalRunStartupCommandInput = TerminalRunStartupCommandInput

export type SynapseTerminalDataEvent = {
  readonly sessionId: string
  readonly chunk: SynapseTerminalOutputChunk
}

export type SynapseTerminalSessionDeletedEvent = {
  readonly sessionId: string
}

export type SynapseTerminalDomainChangedEvent = {
  readonly domainRevision: number
  readonly eventType: string
  readonly objectId: string
  readonly objectRevision: number
  readonly occurredAt: string
  readonly source: string
  readonly operationId?: string
}

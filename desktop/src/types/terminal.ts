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
  TerminalGroupCommandSummary,
  TerminalGroupListItem,
  TerminalGlobalLaunchSettings,
  TerminalEnvironment,
  TerminalEnvironmentValueInput,
  TerminalLaunchLayer,
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
  TerminalUpdateGlobalLaunchSettingsInput,
  TerminalWriteSessionInput,
} from "../../app-capabilities/terminal/shared/schema"

export type SynapseTerminalGroup = TerminalGroup
export type SynapseTerminalGroupSummary = TerminalGroupListItem
export type SynapseTerminalGroupCommand = TerminalGroupCommand
export type SynapseTerminalGroupCommandSummary = TerminalGroupCommandSummary
export type SynapseTerminalEnvironment = TerminalEnvironment
export type SynapseTerminalEnvironmentValueInput = TerminalEnvironmentValueInput
export type SynapseTerminalLaunchLayer = TerminalLaunchLayer
export type SynapseTerminalGlobalLaunchSettings = TerminalGlobalLaunchSettings
export type SynapseTerminalSession = TerminalSession
export type SynapseTerminalOutputChunk = TerminalOutputChunk
export type SynapseTerminalCreateGroupInput = TerminalCreateGroupInput
export type SynapseTerminalRenameGroupInput = TerminalRenameGroupInput
export type SynapseTerminalUpdateGroupSettingsInput = TerminalUpdateGroupSettingsInput
export type SynapseTerminalUpdateGlobalLaunchSettingsInput = TerminalUpdateGlobalLaunchSettingsInput
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

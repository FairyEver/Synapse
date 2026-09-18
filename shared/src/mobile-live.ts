/**
 * Wire protocol for the mobile terminal relay.
 *
 * The desktop owns the terminal; the phone only sees a derived view of it. Three
 * message families flow over the existing live socket:
 *
 * - `mobile.summary` desktop → cloud → phone (fanned out per desktop)
 * - `mobile.frame`   desktop → cloud → one phone (only for the attached session)
 * - `mobile.intent`  phone → cloud → one desktop, answered by `mobile.intentResult`
 * - `mobile.transferProgress` desktop → cloud → one phone, while a relayed file is
 *   being fetched. Additive to `mobile.intentResult`, which still ends the transfer;
 *   the phone uses it only to say how far along the computer is.
 *
 * Producers are self-bounded, and they are bounded separately because they fail
 * differently. A frame that is too large is split; a *summary* cannot be split —
 * a phone treats every summary it receives as the whole list, so a summary that
 * outgrows the socket must never be produced at all. `maxPayloadBytes` bounds one
 * frame, `maxSummaryBytes` bounds one summary, and the sockets' `maxPayload` sits
 * above both (see the comment on `maxSummaryBytes`).
 */

/**
 * The numeric contract the desktop and the phone both encode.
 *
 * Declared here *and* in `mobile-live-constants.cjs`, which exists because the
 * Electron main process is CommonJS and cannot import this module. The two are
 * kept honest by `mobile-live.test.ts` rather than by an import between them:
 * the renderer loads this package through Vite, which cannot extract named
 * exports from a `.cjs` file. `drive.ts` and `drive-sync-constants.cjs` are
 * duplicated for the same reason.
 */
export const MOBILE_PROTOCOL_VERSION = 1

export const MOBILE_FRAME_LIMITS = {
  /** Hard ceiling for one serialized frame. A phone renders far less; the split point is here. */
  maxPayloadBytes: 8 * 1024,
  /** Steady-state uplink budget. Excess frames become a fresh snapshot instead. */
  maxBytesPerSecond: 64 * 1024,
  maxLinesPerFrame: 512,
  /** Upper bound for one history page; the client asks for less in practice. */
  maxHistoryLines: 500,
  /** A single line longer than this is truncated; real terminals wrap far below it. */
  maxLineLength: 8 * 1024,
  maxRunsPerLine: 256,
  maxSummarySessions: 256,
  maxSummaryGroups: 128,
  /**
   * Tab layer. A tab holds at most eight panes — `TERMINAL_WORKSPACE_PANE_LIMIT` in
   * the terminal capability — and there can never be more non-empty tabs than there
   * are sessions, since every pane names one.
   */
  maxSummaryWorkspaces: 256,
  maxSummaryWorkspacePanes: 8,
  /**
   * Summary field bounds. Every one of these is the *producer's* clamp as well as
   * the relay's guard, so a field can never be long enough to fail validation.
   *
   * `cwd` and `lastLine` are display strings — a phone row shows a fraction of
   * them — which is why they are clamped far below what a terminal can hold.
   */
  maxSummaryIdLength: 48,
  maxSummaryCwdLength: 128,
  maxSummaryLastLineLength: 120,
  maxSummaryStartedAtLength: 48,
  /** Group names are capped at 80 by the terminal schema; this only restates it. */
  maxSummaryGroupNameLength: 80,
  /**
   * A grid owner, named by client instance id. That id is a UUID on both sides, so
   * this is generous — and it has to be clamped, because the field rides on every
   * session of the one message that cannot be split.
   */
  maxSummaryGridOwnerIdLength: 48,
  /**
   * The project and Provider directories a phone picks from when it starts a
   * Claude Code conversation.
   *
   * Sized for what a person configures by hand rather than for what the wire could
   * carry: these are repositories and Providers somebody added one at a time, and a
   * desktop past these numbers would have a picker longer than anyone would read
   * through on a phone. The producer drops the tail instead of the whole block, so
   * even such a desktop still gets a usable list.
   *
   * The counts are also what keeps `maxSummaryBytes` provable — see that entry,
   * where the widest admissible summary is added up.
   */
  maxSummaryAgentGroups: 32,
  maxSummaryAgentProviders: 12,
  /** One project or Provider name, which is what a picker row shows. */
  maxSummaryAgentNameLength: 80,
  /** One tier's model name as the Provider resolves it. Real model ids are ~30. */
  maxSummaryModelNameLength: 64,
  /**
   * Byte budget for one serialized summary payload, measured without the envelope.
   *
   * The desktop's producer must never exceed this. It cannot: with every field at
   * the limits above, the largest summary the wire admits — 256 sessions and 128
   * groups — serializes to 234 KiB. The boundary test in `mobile-live.test.ts`
   * pins that arithmetic down, and `live-desktop.gateway.spec.ts` asserts the
   * socket clears it.
   *
   * The constraint that makes this a *correctness* constant rather than a tuning
   * knob is the sockets' `maxPayload`. Both the desktop→cloud hop and the phone hop
   * must carry a summary in one message, because a phone treats each one as the
   * whole list; the `ws` layer answers an oversized message by closing the
   * connection, which a user sees as their computer going offline. The desktop hop
   * is the binding one and is set to 256 KiB in
   * `server/src/live/live-desktop.gateway.ts`; raise that first, and keep this
   * below it.
   *
   * Raised from 224 KiB when sessions grew a grid owner. The owner is the one field
   * a phone needs on every session to know whether its own grid claim still stands,
   * so it could not be moved off the summary — and at 256 sessions naming a 48-byte
   * id apiece the widest summary is 9 KiB past the old budget. The desktop hop's
   * 256 KiB still clears it with room for the envelope.
   *
   * Raised again, 240 → 248 KiB, when the summary took on the project and Provider
   * directories the phone's new-conversation panel is drawn from. Those blocks are
   * small in any real account, but this budget bounds the *widest admissible*
   * summary, not the typical one: at the previous 240 KiB only 6 KiB was left under
   * it, and the two directories cost 11 KiB at their own maxima. The arithmetic the
   * boundary test pins is 256 sessions + 128 terminal groups (239 KiB) plus 32
   * projects and 12 Providers (11 KiB), 250 KiB in all. The desktop hop is still
   * the binding socket and its 256 KiB still clears this with the 4 KiB envelope
   * allowance `live-desktop.gateway.spec.ts` requires.
   */
  maxSummaryBytes: 248 * 1024,
  maxIntentTextLength: 8 * 1024,
  maxKeyActions: 128,
  maxTitleLength: 200,
  /**
   * Grid bounds a phone may ask the desktop to adopt.
   *
   * Restated from `terminalResizeSessionInputSchema`, which is the terminal
   * capability's own ceiling — the gateway validates before the service does, so a
   * request that is rejected here never reaches the layer that would explain why.
   * Keep the two in step.
   */
  maxResizeCols: 500,
  maxResizeRows: 200,
  /**
   * A phone's own name, shown on the desktop badge that says which device set the
   * size. Display-only, so it is clamped well below what a device name can hold.
   */
  maxDeviceLabelLength: 40,
  /**
   * Relay ceilings for the phone → cloud → desktop file hand-off.
   *
   * The bytes travel over HTTP rather than this socket, but both ends still have
   * to agree on the size: the phone refuses a selection over this bound before it
   * uploads, and the desktop refuses again before it writes anything to the user's
   * disk. A drive id is a cuid, so 64 is generous; the file name is clamped at
   * what a real file name holds, well under the drive's own 255.
   */
  maxRelayedFileBytes: 100 * 1024 * 1024,
  maxRelayedFileNameLength: 120,
  maxUploadDriveItemIdLength: 64,
  /**
   * The command buttons a desktop mirrors onto a phone.
   *
   * Every one of these restates a bound the terminal capability's own schema already
   * enforces on the custom actions it stores (`TERMINAL_CUSTOM_TOOLBAR_ACTION_LIMIT`
   * and the two lengths beside it), plus room for the built-ins. They are repeated
   * rather than shared because the cloud validates this payload as it passes through
   * and cannot see the desktop's schema module.
   *
   * `maxToolbarButtons` is the one with real headroom: 50 stored actions plus 4
   * built-ins is 54, and the producer drops the tail rather than truncating a button.
   */
  maxToolbarButtons: 64,
  maxToolbarButtonIdLength: 64,
  maxToolbarLabelLength: 32,
  maxToolbarTextLength: 4096,
  /**
   * Byte budget for one serialized toolbar payload, measured without the envelope.
   *
   * The widest admissible list — 64 buttons of 4096 characters — is about 270 KiB
   * raw, so unlike the summary this one genuinely has to be trimmed: the desktop
   * stops after the last button that fits rather than cutting one in half, because a
   * truncated command is one the phone would run differently from the computer. In
   * practice 50 real commands total a couple of kilobytes.
   *
   * Kept far below the 256 KiB the desktop→cloud socket carries, so an oversized
   * payload can never be the thing that closes the connection.
   */
  maxToolbarBytes: 64 * 1024,
  /**
   * The sentences a desktop mirrors onto a phone from its 快捷输入 app.
   *
   * `maxQuickPhrases` has nothing to restate: unlike a custom command, a stored
   * phrase has no count limit on the desktop at all — the app's schema bounds only
   * `content`, and only from below. This is therefore the *producer's* clamp, and
   * it drops the tail rather than refusing the payload, so a user with an
   * implausibly long table still gets a usable list. 64 is the toolbar's own count,
   * which is the only precedent on this wire for "as many as a person would ever
   * read through on a phone".
   *
   * `maxQuickPhraseLength` is `maxToolbarTextLength`'s value because a phrase and a
   * custom command are the same kind of thing — one sentence the user wrote for
   * themselves — and the phone holds them in the same kind of place. A phrase past
   * it is dropped whole rather than truncated: a shortened sentence is no longer the
   * one the user wrote, and they would send it believing otherwise.
   *
   * `maxQuickPhrasesBytes` is `maxToolbarBytes`'s value for the reason that bound
   * gives: this is the same socket under the same 256 KiB `maxPayload`, and both
   * messages are full snapshots the phone replaces wholesale, so both are trimmed
   * entry-by-entry on their own budget instead of being split.
   */
  maxQuickPhrases: 64,
  maxQuickPhraseLength: 4096,
  maxQuickPhrasesBytes: 64 * 1024,
} as const

/** Style attribute bits packed into the fifth element of a run tuple. */
export const MOBILE_RUN_FLAGS = {
  bold: 1 << 0,
  italic: 1 << 1,
  underline: 1 << 2,
  dim: 1 << 3,
  inverse: 1 << 4,
} as const

/** `-1` for the terminal default, `0..255` for a palette index, `0x1000000 | rgb` for truecolor. */
export const MOBILE_DEFAULT_COLOR = -1
export const MOBILE_TRUECOLOR_BASE = 0x100_0000

/**
 * The only keys the terminal service can encode, and therefore the complete
 * vocabulary of the phone's keyboard panel.
 *
 * Text is the other route onto the wire and it is deliberately narrow: the terminal
 * service refuses every control byte except Tab, so an arrow key or an Escape cannot
 * be smuggled through as "just some characters". Anything that is not a printable
 * character has to be named here.
 *
 * Append-only. A key is identified by this string on both sides of the relay —
 * the phone's own enum, the desktop's `KEY_BYTES` and this list all have to agree —
 * so reordering or removing one quietly changes what an existing client sends.
 *
 * The `Ctrl+` group stops short of the full alphabet on purpose. `Ctrl+I` is `\x09`
 * and `Ctrl+M` is `\x0d` — the bytes `Tab` and `Enter` already own — so naming them
 * here would give `KEY_BYTES` two keys with one sequence, and the toolbar projection
 * reads that table backwards ("sequence → key") and would silently pick whichever
 * came last. A panel that wants those chords sends the key that owns the byte.
 *
 * `Shift+Tab` is here rather than being composed on the phone: Shift lives on the
 * full-keyboard page and Tab on the common one, and switching pages drops a latched
 * modifier, so the two could never meet.
 */
export const MOBILE_KEYS = [
  "Enter",
  "Tab",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Backspace",
  "Ctrl+C",
  "Ctrl+D",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Delete",
  "Ctrl+A",
  "Ctrl+E",
  "Ctrl+U",
  "Ctrl+K",
  "Ctrl+W",
  "Ctrl+L",
  "Ctrl+R",
  "Ctrl+Z",
  "Ctrl+B",
  "Ctrl+F",
  "Ctrl+G",
  "Ctrl+H",
  "Ctrl+J",
  "Ctrl+N",
  "Ctrl+O",
  "Ctrl+P",
  "Ctrl+Q",
  "Ctrl+S",
  "Ctrl+T",
  "Ctrl+V",
  "Ctrl+X",
  "Ctrl+Y",
  "Shift+Tab",
] as const

export const MOBILE_MESSAGE_TYPES = {
  summary: "mobile.summary",
  frame: "mobile.frame",
  intent: "mobile.intent",
  intentResult: "mobile.intentResult",
  transferProgress: "mobile.transferProgress",
  detached: "mobile.detached",
} as const

/* ------------------------------------------------------------------ *
 * Terminal frame
 * ------------------------------------------------------------------ */

/**
 * Compact line encoding. `runs` is omitted entirely for unstyled lines, which is
 * the overwhelming majority of log output and roughly halves the payload.
 */
export type MobileLineWire = readonly [text: string] | readonly [text: string, runs: readonly MobileRunWire[]]

/**
 * `[startOffset, length, foreground, background, flags]`.
 *
 * Colors are `-1` for the terminal default, `0..255` for a palette index, or
 * `0x1000000 | (r << 16) | (g << 8) | b` for a truecolor value.
 */
export type MobileRunWire = readonly [
  start: number,
  length: number,
  foreground: number,
  background: number,
  flags: number,
]

export function encodeMobileTruecolor(red: number, green: number, blue: number): number {
  return MOBILE_TRUECOLOR_BASE | ((red & 0xff) << 16) | ((green & 0xff) << 8) | (blue & 0xff)
}

/**
 * A frame is a *suffix replacement*: "the content from absolute line `from`
 * onwards is exactly this, and anything after it is void".
 *
 * That semantic makes frames idempotent (safe to replay after a flaky send) and
 * self-healing (a client that missed frames converges on the next one that starts
 * at or before its highest known line). Neither acknowledgements nor sequence
 * numbers are needed, which is deliberate — both are liabilities on mobile networks.
 */
export interface MobileTerminalFrame {
  readonly v: typeof MOBILE_PROTOCOL_VERSION
  readonly sessionId: string
  /**
   * - `suffix` replaces everything from `from` onward
   * - `reset` does the same and also discards anything before `from`
   * - `history` replaces exactly `[from, from + lines.length)` and leaves the
   *   rest of the client's buffer untouched, so older lines can be filled in
   *   without the client losing the newer ones it already has.
   */
  readonly kind: "suffix" | "reset" | "history"
  /** Absolute line index of `lines[0]`. Monotonic within a session; scrollback does not shift it. */
  readonly from: number
  readonly lines: readonly MobileLineWire[]
  /** Current total line count; the client truncates anything beyond `from + lines.length`. */
  readonly total: number
  readonly cursor: MobileTerminalCursor
  /** True while the session is on the alternate screen (TUI programs). */
  readonly alt: boolean
  /** True when lines before `from` are unavailable and the client must discard them. */
  readonly truncated: boolean
  /** Output watermark of the underlying session, used by `readSession` to refill gaps. */
  readonly seq: number
  readonly sizeRevision: number
}

export interface MobileTerminalCursor {
  /**
   * Absolute gateway line index of the cursor, in the same space as the frame's
   * `from`/`total` — not an offset into `lines`. A split update therefore carries
   * a cursor that stays valid across every frame it was split into.
   */
  readonly row: number
  readonly col: number
  readonly visible: boolean
}

/* ------------------------------------------------------------------ *
 * Summary
 * ------------------------------------------------------------------ */

export interface MobileSummaryGroup {
  readonly id: string
  readonly name: string
}

/**
 * The four model tiers a Provider can name, in the order the desktop shows them.
 *
 * The desktop has its own `ModelTier` in its provider types; this is the wire's
 * copy, because the cloud and the phone read this module and neither can see the
 * desktop's renderer code.
 */
export const MOBILE_MODEL_TIERS = ["default", "haiku", "sonnet", "opus"] as const

export type MobileModelTier = typeof MOBILE_MODEL_TIERS[number]

/**
 * One thing a phone can start a Claude Code conversation in: the desktop's
 * `app.agent.group.list` row, which is either a configured project or the
 * built-in local workspace.
 *
 * `projectId` is what the phone sends back in `createAgentConversation`, and what
 * the desktop already resolves projects by — the id of the built-in workspace is
 * an id like any other.
 */
export interface MobileSummaryAgentGroup {
  readonly projectId: string
  readonly name: string
  readonly isDefault: boolean
}

/**
 * The model each tier resolves to on this desktop, for one Provider.
 *
 * Present as the *resolved model name* rather than the tier's label because the
 * label alone does not tell a user what they are choosing: two Providers both
 * offering "Sonnet" can point at different models. A tier the Provider does not
 * name is absent, which is what the desktop's picker disables.
 */
export interface MobileSummaryAgentProviderModels {
  readonly default?: string
  readonly opus?: string
  readonly sonnet?: string
  readonly haiku?: string
}

/**
 * One Provider a phone may start a conversation with.
 *
 * Deliberately not the desktop's own `SynapseAgentProviderSummary`: that one
 * carries `baseUrl`, and a Provider's endpoint has no business leaving the
 * computer. The phone picks an id; the desktop never needs to be told where its
 * own Providers live.
 *
 * There is likewise no field here for a credential, and adding one would be a
 * different feature — the desktop reads keys from its own store at launch time.
 */
export interface MobileSummaryAgentProvider {
  readonly id: string
  readonly name: string
  /**
   * The Provider the desktop itself would use if the phone named none.
   *
   * Not "whichever is active": the desktop's own shortcut resolves a *configured*
   * default first and only then falls back to the active Provider, and the two can
   * name different Providers. A phone that showed the active one while the desktop
   * launched with the configured one would be describing a decision that is not the
   * one being made — which is the whole thing this panel exists to avoid.
   */
  readonly isDefault: boolean
  /**
   * The tier this Provider would be used at, so the phone can show a model name
   * without working anything out for itself.
   *
   * Required, because a Provider that names no selectable tier at all cannot be used
   * to start anything and is not sent. The phone's request carries no such field:
   * it names a Provider and a tier, or neither, and the desktop has the last word.
   */
  readonly defaultTier: MobileModelTier
  readonly models: MobileSummaryAgentProviderModels
}

/** One split inside a tab: the pane's own identity, and the conversation it shows. */
export interface MobileSummaryWorkspacePane {
  readonly paneId: string
  readonly sessionId: string
}

/**
 * A tab — the layer between a group and its conversations.
 *
 * Panes come in the order the desktop lays them out, which is the split tree's own
 * left-to-right, top-to-bottom order, so a client that renders them in array order
 * matches the desktop without needing the tree. The geometry (split direction and
 * ratio) is deliberately absent: it describes a screen a phone does not have.
 */
export interface MobileSummaryWorkspace {
  readonly id: string
  readonly groupId: string
  readonly title: string
  readonly panes: readonly MobileSummaryWorkspacePane[]
}

export interface MobileSummaryAttention {
  readonly state: "waiting" | "not_waiting" | "unknown"
  readonly kind: "shell_ready" | "agent_question" | "approval" | "password" | "other_interaction" | "unknown"
}

export interface MobileSummarySession {
  readonly id: string
  readonly groupId: string
  readonly title: string
  readonly status: "running" | "stopping" | "ended" | "failed" | "lost"
  readonly attention: MobileSummaryAttention
  readonly cwd: string
  readonly cols: number
  readonly rows: number
  readonly startedAt: string
  /** Last non-blank rendered line, so the list is useful without opening the session. */
  readonly lastLine: string
  readonly lastOutputSeq: number
  /**
   * The phone deciding this session's grid, when one is, named by its client
   * instance id.
   *
   * Absent in the ordinary case, where the desktop's own layout decides. A phone
   * reads its own id here as "the claim I made still stands"; its own id's absence
   * — or somebody else's id — means the grid is no longer its to size, which is how
   * a desktop that took the grid back says so. Nothing would otherwise tell it: the
   * desktop's release is a local act and reaches the phone only as a summary whose
   * `cols` changed, and a phone cannot tell that apart from a claim it has just
   * made and the desktop has not adopted yet.
   *
   * Optional rather than nullable so the common payload stays byte-for-byte what it
   * was before this field existed.
   */
  readonly gridOwnerId?: string
}

/**
 * Content-driven, not tick-driven: the desktop only sends this when the rendered
 * snapshot actually differs from the previous one, so an idle terminal costs nothing.
 *
 * It is the one message that cannot be split — a phone replaces its whole list with
 * whatever arrives — so its size is bounded by `MOBILE_FRAME_LIMITS.maxSummaryBytes`
 * and the sockets are sized above that.
 */
export interface MobileSummaryPayload {
  readonly desktopClientInstanceId: string
  readonly desktopName: string
  readonly revision: number
  readonly groups: readonly MobileSummaryGroup[]
  /**
   * Present only when some tab actually holds more than one pane.
   *
   * A desktop gives every new conversation its own tab, so with no splits the flat
   * `sessions` list already *is* the hierarchy and restating it would be pure
   * overhead. Omitting it keeps the common payload byte-for-byte what it was before
   * this layer existed, and leaves a client that ignores the field rendering exactly
   * the same list it always did.
   */
  readonly workspaces?: readonly MobileSummaryWorkspace[]
  /**
   * Where a phone may start a Claude Code conversation, and with which Provider.
   *
   * Both are directories rather than state: they change when the user edits their
   * projects or Providers on the computer, which is rare, and the summary is
   * already the message that carries what the desktop has. Riding along costs about
   * a kilobyte in any real account and saves the phone a round trip before it can
   * draw its panel — and a round trip is a loading state, on a screen whose whole
   * point is `＋` → 开始对话 with nothing to decide in between.
   *
   * Optional rather than nullable so the common payload stays byte-for-byte what it
   * was before these fields existed: a desktop that predates them omits both, and a
   * phone that predates them renders exactly the list it always did. A desktop with
   * no projects or no Providers sends `[]` for that block rather than omitting it,
   * because "there are none" and "this computer is too old to say" are different
   * answers and the phone has to tell them apart.
   */
  readonly agentGroups?: readonly MobileSummaryAgentGroup[]
  readonly agentProviders?: readonly MobileSummaryAgentProvider[]
  readonly sessions: readonly MobileSummarySession[]
}

/* ------------------------------------------------------------------ *
 * Toolbar
 * ------------------------------------------------------------------ */

/**
 * One button the phone shows, mirroring one button on the computer.
 *
 * `group` is what the phone draws separators from, and it exists so that drawing
 * them is a pure function of the payload: the desktop's own rule is positional
 * ("the line goes before the first remaining shell command"), which a phone cannot
 * reproduce without re-deriving the desktop's list. Sending the answer instead of
 * the rule is the whole difference.
 */
export interface MobileToolbarButton {
  /** Stable across sends: a built-in's own id, or the stored action's uuid. */
  readonly id: string
  /** Display text, rendered verbatim — it is the user's own label. */
  readonly label: string
  readonly group: "key" | "command" | "custom"
  readonly action: MobileToolbarAction
}

/**
 * What pressing the button makes the computer do.
 *
 * A superset of `MobileKeyAction` with `pressEnter` added to the text arm, and the
 * two arms exist because the computer has two different ways of running a command
 * and they are not interchangeable. `command` writes the text and then a carriage
 * return after a short flush delay, which is the desktop's own click; a bare `text`
 * action writes exactly what it is given and nothing else, which is what a custom
 * button with `pressEnter` off does.
 *
 * Sending a `pressEnter: false` button as a `command` would therefore press Enter
 * on the user's behalf — a different, and potentially destructive, act.
 */
export type MobileToolbarAction =
  | { readonly type: "key"; readonly key: MobileKey }
  | { readonly type: "text"; readonly text: string; readonly pressEnter: boolean }

/**
 * The command buttons on one computer, fanned out to every phone of the account.
 *
 * A family of its own rather than part of `MobileSummaryPayload`, and the reason is
 * arithmetic rather than taste: a summary cannot be split — a phone replaces its
 * whole list with whatever arrives — so its byte budget has to cover every field at
 * once. The summary's own budget is already within 3 KiB of the socket that carries
 * it, and a list of custom commands at the schema's own limits is far larger than
 * that. Carrying them here keeps `maxSummaryBytes` proved and gives this message a
 * ceiling it can be trimmed against on its own.
 *
 * `desktopClientInstanceId` is required for the reason it is on a frame: a phone may
 * be connected to several computers, and only one of them owns the list it is
 * looking at.
 *
 * `revision` is the producer's own counter, bumped per send. It is not compared by
 * the phone — the list is a full snapshot, so there is nothing to order — but it
 * makes a captured payload self-describing.
 */
export interface MobileToolbarPayload {
  readonly desktopClientInstanceId: string
  readonly revision: number
  /**
   * The whole list, in the desktop's own order, built-ins first.
   *
   * Empty is a legitimate value and is *not* the same as absent: an empty list says
   * this computer has no buttons, while a phone that has never received this message
   * falls back to its own built-ins. Those are different answers to "what can I
   * press", and a desktop is allowed to give the first one.
   */
  readonly buttons: readonly MobileToolbarButton[]
}

/* ------------------------------------------------------------------ *
 * Quick phrases
 * ------------------------------------------------------------------ */

/**
 * One sentence the user keeps on their computer's 快捷输入 app, to be tapped into a
 * phone's composer instead of typed.
 *
 * Deliberately not the desktop's own `QuickInputItem`: that entry carries
 * `schemaVersion`, `sortOrder` and two timestamps, and a phone shows none of them —
 * the list is drawn in the order the desktop sends, which is already `sortOrder`.
 * Sending the entry itself would put three fields on the wire that no client reads.
 *
 * `id` is the desktop's own entry id, so a phone can key a row on something stable
 * across sends; the bound is the one this wire already gives a user-item id.
 */
export interface MobileQuickPhrase {
  readonly id: string
  /** The user's own sentence, rendered verbatim. */
  readonly content: string
}

/**
 * The 快捷输入 sentences on one computer, fanned out to every phone of the account.
 *
 * A second message rather than a block on `MobileToolbarPayload`, even though both
 * are "what this computer has for the toolbar": they come from two different apps,
 * are stored in two different namespaces, and change on two different events. Riding
 * along would mean a phrase edit re-sends every command button and vice versa, and —
 * the part that decides it — would leave a desktop that has phrases but no custom
 * actions unable to say so without also claiming something about buttons.
 *
 * Empty is a legitimate value and is *not* the same as absent, which is the whole
 * reason a phone can draw its segments at all: `[]` says this computer has none,
 * while a phone that has never received this message from this computer is looking
 * at one too old to have any. Those are different answers and both are allowed.
 */
export interface MobileQuickPhrasesPayload {
  readonly desktopClientInstanceId: string
  /** The producer's own counter, bumped per send; not compared by the phone. */
  readonly revision: number
  readonly phrases: readonly MobileQuickPhrase[]
}

/* ------------------------------------------------------------------ *
 * Intent
 * ------------------------------------------------------------------ */

export type MobileKey = typeof MOBILE_KEYS[number]

export type MobileKeyAction =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "key"; readonly key: MobileKey }

/**
 * Every intent carries a client-generated `intentId`. The desktop gateway executes
 * the first one it sees and replays the stored result for repeats, so the phone can
 * resend blindly on a flaky link without risking a duplicate keystroke or command.
 */
export type MobileIntent =
  | (MobileIntentEnvelope<"attach"> & { readonly sessionId: string })
  | (MobileIntentEnvelope<"detach"> & { readonly sessionId: string })
  | MobileIntentEnvelope<"sync">
  /**
   * Liveness only. The desktop holds a write lease for as long as a phone keeps a
   * terminal open, so it needs a signal that the phone is still there; without one
   * a crashed client would pin the lease until it expired.
   */
  | MobileIntentEnvelope<"ping">
  /**
   * Takes the write lease back after the desktop's own user typed, which preempts
   * the phone by design. It grants nothing on its own: a phone that opened a
   * terminal can already type into it.
   */
  | (MobileIntentEnvelope<"unlock"> & { readonly sessionId: string })
  | (MobileIntentEnvelope<"command"> & { readonly sessionId: string; readonly text: string })
  | (MobileIntentEnvelope<"keys"> & {
    readonly sessionId: string
    readonly actions: readonly MobileKeyAction[]
  })
  | (MobileIntentEnvelope<"stop"> & { readonly sessionId: string })
  /**
   * Removes a terminal. The service refuses to delete one that is still running,
   * so a live session is stopped first — and a stop is itself what removes it,
   * because the PTY exiting destroys the session on its own.
   */
  | (MobileIntentEnvelope<"delete"> & { readonly sessionId: string })
  /**
   * Asks for `limit` lines immediately before `before` (the client's oldest
   * known gateway index). Only one terminal can be scrolled at a time, so this
   * is deliberately not part of the frame stream.
   */
  | (MobileIntentEnvelope<"history"> & {
    readonly sessionId: string
    readonly before: number
    readonly limit: number
  })
  | MobileIntentEnvelope<"stopAll">
  | (MobileIntentEnvelope<"rename"> & { readonly sessionId: string; readonly title: string })
  /**
   * The phone sets the PTY grid, for the display mode where the phone drives the
   * size so its own rendering is exact rather than wrapped.
   *
   * This is a UI resize, not an automated one: ADR 0063 allows a user or UI resize
   * without a lease because it neither takes input control nor revokes a lease the
   * desktop holds. The desktop tracks who set the size so it can say so and offer
   * to take it back, and any resize from anywhere else clears that ownership.
   *
   * `deviceLabel` is what the desktop badge shows. The id is what makes the owner
   * unambiguous when more than one phone is attached.
   */
  | (MobileIntentEnvelope<"resize"> & {
    readonly sessionId: string
    readonly cols: number
    readonly rows: number
    readonly deviceLabel: string
  })
  /**
   * Hands the grid back to the desktop.
   *
   * Sent when the reader leaves the mode where the phone drives the size. The phone
   * cannot restore the desktop's own grid itself — it only ever heard the size the
   * PTY currently has, which is the phone's — so it releases the claim and lets the
   * desktop's layout decide again.
   */
  | (MobileIntentEnvelope<"releaseGrid"> & { readonly sessionId: string })
  | (MobileIntentEnvelope<"create"> & {
    readonly groupId: string
    readonly title?: string
    /**
     * Initial grid, so the session is born the right shape.
     *
     * Resizing after creation is too late: a shell prints its banner, prompt and
     * first `git status` within the opening milliseconds, laid out for whatever
     * width the PTY had at the time. Those lines stay in scrollback at the old
     * width forever. ADR 0063 requires explicit initial dimensions to be
     * authorized as both a creation and a resize.
     */
    readonly cols?: number
    readonly rows?: number
    /**
     * Only meaningful together with the dimensions, and only for the badge the
     * desktop shows while the phone owns the size.
     */
    readonly deviceLabel?: string
  })
  | (MobileIntentEnvelope<"launchCommand"> & { readonly groupId: string; readonly commandId: string })
  /**
   * Starts the bundled Claude Code in one of the computer's projects, using the
   * desktop's own configuration and credentials.
   *
   * This is the phone-side twin of the desktop's ⌘-click shortcut, and it is the
   * same act: a terminal is opened in a project directory with the bundled Claude
   * Code as its shell. Nothing about a conversation is created on the phone, and
   * nothing about a credential is sent to it — the phone names a project and,
   * optionally, a Provider and tier, and the desktop resolves the rest.
   *
   * `providerId` and `modelTier` are optional *because the desktop resolves them*:
   * absent, it applies the same default selection the desktop's own shortcut uses,
   * so the phone's default and the computer's default can never drift apart.
   * Present, they are taken as an explicit choice. A phone therefore does not have
   * to know which Provider is active to start a conversation — but it is also not
   * allowed to guess half of one, which is why the validator treats them as a pair.
   *
   * `projectId` is required for the opposite reason: the desktop's shortcut gets
   * its project from the sidebar row the `＋` was clicked on, and the phone's `＋`
   * sits in a navigation bar with no such context. The phone therefore always has
   * an answer — the last project used, or one the user just picked — and says so
   * rather than leaving the desktop to guess a directory.
   */
  | (MobileIntentEnvelope<"createAgentConversation"> & {
    readonly projectId: string
    readonly providerId?: string
    readonly modelTier?: MobileModelTier
    /**
     * Initial grid, so the session is born the right shape.
     *
     * Same requirement as `create` and for the same reason: Claude Code paints its
     * banner and prompt in the opening milliseconds, and those lines keep whatever
     * width the PTY had. ADR 0063 authorizes explicit initial dimensions as both a
     * creation and a resize, and says so for this intent too.
     */
    readonly cols?: number
    readonly rows?: number
    readonly deviceLabel?: string
  })
  /**
   * One file the phone has already put in the user's drive, to be brought down to
   * this computer and named in the terminal.
   *
   * The bytes deliberately do not travel over this socket. The phone uploads them
   * to the drive over HTTP and this intent carries only the reference, which is
   * what keeps the relay free of a data plane — a file here would otherwise have
   * to be chunked, checksummed and quota'd against `maxIntentTextLength`.
   *
   * One intent per file rather than one per batch, for two reasons: the per-file
   * result is what the phone needs to report which file failed, and `intentId`
   * replay protection then covers each file on its own, so a retry after a flaky
   * link can never re-type a path that already landed.
   *
   * The desktop deletes the cloud copy once the file is on its disk. A session
   * that has ended in the meantime is not a failure: the file still lands, and the
   * result says the path was not typed.
   */
  | (MobileIntentEnvelope<"fileUpload"> & {
    readonly sessionId: string
    /** The uploaded copy in the user's drive; the desktop deletes it after the file lands. */
    readonly driveItemId: string
    /**
     * Bare file name to write on the computer. The phone sets it, having already
     * converted HEIC to JPEG and fixed the extension; the desktop sanitizes it
     * again before touching the filesystem.
     */
    readonly fileName: string
  })

type MobileIntentEnvelope<TKind extends string> = {
  readonly v: typeof MOBILE_PROTOCOL_VERSION
  readonly intentId: string
  readonly kind: TKind
}

export type MobileIntentKind = MobileIntent["kind"]

/**
 * Three-valued on purpose. The terminal service has genuinely uncertain outcomes
 * (`partial`, `delivery_uncertain`); the gateway resolves those into a definite
 * `accepted` or `rejected` before replying, because a phone cannot make a sound
 * decision about an uncertain side effect.
 */
export interface MobileIntentResult {
  readonly intentId: string
  readonly outcome: "accepted" | "rejected" | "no_op"
  readonly code?: string
  readonly message?: string
  readonly sessionId?: string
  /** Set for `create` and `launchCommand`, so the phone can open the new session immediately. */
  readonly createdSessionId?: string
  /**
   * Set for `fileUpload`, once the file is on the computer's disk.
   *
   * The phone cannot derive this: the directory a file lands in is the computer's
   * fact, not the phone's. It needs the path to offer an undo — which is a
   * backspace per character — and to say truthfully where the file went.
   */
  readonly landedPath?: string
}

/* ------------------------------------------------------------------ *
 * Routing payloads
 * ------------------------------------------------------------------ */

export interface MobileFramePayload {
  readonly desktopClientInstanceId: string
  readonly mobileClientInstanceId: string
  readonly frame: MobileTerminalFrame
}

export interface MobileIntentPayload {
  readonly desktopClientInstanceId: string
  readonly mobileClientInstanceId: string
  readonly intent: MobileIntent
}

export interface MobileIntentResultPayload {
  readonly mobileClientInstanceId: string
  readonly result: MobileIntentResult
}

/**
 * How far along the computer is in fetching a file the phone relayed.
 *
 * Exists because "已上传，等待电脑接收" is a statement about the phone's uplink, and
 * the user watching it cannot tell a computer that has not started from one that is
 * halfway through a large download. Without this the strip can only ever say "still
 * waiting", which is true at exactly one of those moments.
 *
 * `intentId` rather than a file name is what makes this usable: the phone already
 * keys the transfer it is showing on the intent it sent, and the desktop's answer
 * carries the same id, so progress and completion land on the same chip.
 */
export interface MobileTransferProgressPayload {
  readonly mobileClientInstanceId: string
  readonly intentId: string
  readonly completedBytes: number
  /**
   * Zero when the download's length is not known. A fraction cannot be drawn from
   * that, and reporting `completed` as the total instead would draw a full bar for
   * a file with nothing in it yet — so the phone is told plainly that it is not
   * known and shows a moving indicator rather than a proportion.
   */
  readonly totalBytes: number
}

/**
 * Which of the user's computers a phone can reach right now.
 *
 * The phone's socket is to the cloud, not to a computer, so a desktop signing in
 * or dropping out is invisible to it otherwise — it would only ever learn from
 * asking. This is the pushed answer, sent on every change rather than on a
 * schedule.
 *
 * The list is the whole truth, not a delta: a phone replaces what it has, so a
 * dropped message costs nothing beyond waiting for the next change.
 */
export interface MobilePresencePayload {
  readonly desktopClientInstanceIds: readonly string[]
}

/**
 * Sent by the cloud to a desktop when a phone's connection drops.
 *
 * Without it the desktop would keep renewing that phone's write lease until its
 * idle timeout, leaving a window in which nobody can type into the terminal.
 */
export interface MobileDetachedPayload {
  readonly mobileClientInstanceId: string
  readonly reason: string
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ *
 *
 * The cloud relays frames it does not interpret, so validation stays shallow but
 * bounded: enough to route safely and to keep a hostile payload from becoming an
 * amplification or memory vector, without making the relay pay per-line costs.
 */

export function isMobileSummaryPayload(value: unknown): value is MobileSummaryPayload {
  if (!isRecord(value)) return false
  if (!boundedString(value.desktopClientInstanceId, 120)) return false
  if (!boundedString(value.desktopName, 120)) return false
  if (!nonNegativeInteger(value.revision)) return false
  if (!boundedArray(value.groups, MOBILE_FRAME_LIMITS.maxSummaryGroups)) return false
  if (!boundedArray(value.sessions, MOBILE_FRAME_LIMITS.maxSummarySessions)) return false
  // Absent is the normal case and always accepted: it means "no tab has a split".
  if (value.workspaces !== undefined) {
    if (!boundedArray(value.workspaces, MOBILE_FRAME_LIMITS.maxSummaryWorkspaces)) return false
    if (!(value.workspaces as readonly unknown[]).every(isSummaryWorkspace)) return false
  }
  // Absent means the desktop predates these directories, which is a different
  // answer from an empty list and both are accepted — see the field's own comment.
  if (value.agentGroups !== undefined) {
    if (!boundedArray(value.agentGroups, MOBILE_FRAME_LIMITS.maxSummaryAgentGroups)) return false
    if (!(value.agentGroups as readonly unknown[]).every(isSummaryAgentGroup)) return false
  }
  if (value.agentProviders !== undefined) {
    if (!boundedArray(value.agentProviders, MOBILE_FRAME_LIMITS.maxSummaryAgentProviders)) return false
    if (!(value.agentProviders as readonly unknown[]).every(isSummaryAgentProvider)) return false
  }
  return (value.groups as readonly unknown[]).every(isSummaryGroup) &&
    (value.sessions as readonly unknown[]).every(isSummarySession)
}

export function isMobileFramePayload(value: unknown): value is MobileFramePayload {
  if (!isRecord(value)) return false
  return boundedString(value.desktopClientInstanceId, 120) &&
    boundedString(value.mobileClientInstanceId, 120) &&
    isMobileTerminalFrame(value.frame)
}

export function isMobileIntentPayload(value: unknown): value is MobileIntentPayload {
  if (!isRecord(value)) return false
  return boundedString(value.desktopClientInstanceId, 120) &&
    boundedString(value.mobileClientInstanceId, 120) &&
    isMobileIntent(value.intent)
}

export function isMobileIntentResultPayload(value: unknown): value is MobileIntentResultPayload {
  if (!isRecord(value)) return false
  return boundedString(value.mobileClientInstanceId, 120) && isMobileIntentResult(value.result)
}

export function isMobileTransferProgressPayload(value: unknown): value is MobileTransferProgressPayload {
  if (!isRecord(value)) return false
  return boundedString(value.mobileClientInstanceId, 120) &&
    boundedString(value.intentId, 120) &&
    nonNegativeInteger(value.completedBytes) &&
    nonNegativeInteger(value.totalBytes)
}

export function isMobileDetachedPayload(value: unknown): value is MobileDetachedPayload {
  if (!isRecord(value)) return false
  return boundedString(value.mobileClientInstanceId, 120) && boundedString(value.reason, 120)
}

export function isMobileToolbarPayload(value: unknown): value is MobileToolbarPayload {
  if (!isRecord(value)) return false
  if (!boundedString(value.desktopClientInstanceId, 120)) return false
  if (!nonNegativeInteger(value.revision)) return false
  if (!boundedArray(value.buttons, MOBILE_FRAME_LIMITS.maxToolbarButtons)) return false
  return (value.buttons as readonly unknown[]).every(isMobileToolbarButton)
}

export function isMobileQuickPhrasesPayload(value: unknown): value is MobileQuickPhrasesPayload {
  if (!isRecord(value)) return false
  if (!boundedString(value.desktopClientInstanceId, 120)) return false
  if (!nonNegativeInteger(value.revision)) return false
  if (!boundedArray(value.phrases, MOBILE_FRAME_LIMITS.maxQuickPhrases)) return false
  return (value.phrases as readonly unknown[]).every(isMobileQuickPhrase)
}

export function isMobilePresencePayload(value: unknown): value is MobilePresencePayload {
  if (!isRecord(value)) return false
  const ids = value.desktopClientInstanceIds
  // A user cannot realistically exceed this, and the bound keeps a malformed or
  // hostile payload from being fanned out to every phone of the account.
  if (!boundedArray(ids, 64)) return false
  return ids.every((id) => boundedString(id, 120))
}

export function isMobileTerminalFrame(value: unknown): value is MobileTerminalFrame {
  if (!isRecord(value)) return false
  if (value.v !== MOBILE_PROTOCOL_VERSION) return false
  if (!boundedString(value.sessionId, 120)) return false
  if (value.kind !== "suffix" && value.kind !== "reset" && value.kind !== "history") return false
  if (!nonNegativeInteger(value.from)) return false
  if (!nonNegativeInteger(value.total)) return false
  if (!nonNegativeInteger(value.seq)) return false
  if (!positiveNumber(value.sizeRevision)) return false
  if (typeof value.alt !== "boolean" || typeof value.truncated !== "boolean") return false
  if (!isCursor(value.cursor)) return false
  if (!boundedArray(value.lines, MOBILE_FRAME_LIMITS.maxLinesPerFrame)) return false
  return (value.lines as readonly unknown[]).every(isLineWire)
}

export function isMobileIntent(value: unknown): value is MobileIntent {
  if (!isRecord(value)) return false
  if (value.v !== MOBILE_PROTOCOL_VERSION) return false
  if (!boundedString(value.intentId, 120)) return false
  switch (value.kind) {
    case "attach":
    case "detach":
    case "unlock":
    case "stop":
    case "delete":
      return boundedString(value.sessionId, 120)
    case "sync":
    case "ping":
    case "stopAll":
      return true
    case "command":
      return boundedString(value.sessionId, 120) &&
        boundedString(value.text, MOBILE_FRAME_LIMITS.maxIntentTextLength)
    case "keys":
      return boundedString(value.sessionId, 120) &&
        boundedArray(value.actions, MOBILE_FRAME_LIMITS.maxKeyActions) &&
        (value.actions as readonly unknown[]).every(isKeyAction)
    case "history":
      return boundedString(value.sessionId, 120) &&
        nonNegativeInteger(value.before) &&
        positiveNumber(value.limit) &&
        (value.limit as number) <= MOBILE_FRAME_LIMITS.maxHistoryLines
    case "rename":
      return boundedString(value.sessionId, 120) &&
        boundedString(value.title, MOBILE_FRAME_LIMITS.maxTitleLength)
    case "releaseGrid":
      return boundedString(value.sessionId, 120)
    case "resize":
      return boundedString(value.sessionId, 120) &&
        boundedCols(value.cols) && boundedRows(value.rows) &&
        boundedString(value.deviceLabel, MOBILE_FRAME_LIMITS.maxDeviceLabelLength)
    case "create":
      return boundedString(value.groupId, 120) &&
        (value.title === undefined || boundedString(value.title, MOBILE_FRAME_LIMITS.maxTitleLength)) &&
        // 尺寸要么两个都给，要么都不给：只给一半的网格没有意义。
        resizeShape(value.cols, value.rows) &&
        (value.deviceLabel === undefined ||
          boundedString(value.deviceLabel, MOBILE_FRAME_LIMITS.maxDeviceLabelLength))
    case "launchCommand":
      return boundedString(value.groupId, 120) && boundedString(value.commandId, 120)
    case "createAgentConversation": {
      if (!boundedString(value.projectId, 120)) return false
      // A Provider without a tier names no model, and a tier without a Provider
      // names no endpoint, so half a choice is refused rather than half-applied.
      // Both absent is the ordinary case: the desktop resolves the pair itself.
      if ((value.providerId === undefined) !== (value.modelTier === undefined)) return false
      if (value.providerId !== undefined && !boundedString(value.providerId, 120)) return false
      if (value.modelTier !== undefined && !isModelTier(value.modelTier)) return false
      return resizeShape(value.cols, value.rows) &&
        (value.deviceLabel === undefined ||
          boundedString(value.deviceLabel, MOBILE_FRAME_LIMITS.maxDeviceLabelLength))
    }
    case "fileUpload":
      return boundedString(value.sessionId, 120) &&
        boundedString(value.driveItemId, MOBILE_FRAME_LIMITS.maxUploadDriveItemIdLength) &&
        boundedString(value.fileName, MOBILE_FRAME_LIMITS.maxRelayedFileNameLength)
    default:
      return false
  }
}

export function isMobileIntentResult(value: unknown): value is MobileIntentResult {
  if (!isRecord(value)) return false
  if (!boundedString(value.intentId, 120)) return false
  if (value.outcome !== "accepted" && value.outcome !== "rejected" && value.outcome !== "no_op") return false
  if (value.code !== undefined && !boundedString(value.code, 80)) return false
  if (value.message !== undefined && !boundedString(value.message, 500)) return false
  if (value.sessionId !== undefined && !boundedString(value.sessionId, 120)) return false
  if (value.createdSessionId !== undefined && !boundedString(value.createdSessionId, 120)) return false
  if (value.landedPath !== undefined && !boundedString(value.landedPath, 512)) return false
  return true
}

export function isMobileKey(value: unknown): value is MobileKey {
  return typeof value === "string" && (MOBILE_KEYS as readonly string[]).includes(value)
}

function isKeyAction(value: unknown): value is MobileKeyAction {
  if (!isRecord(value)) return false
  if (value.type === "key") return isMobileKey(value.key)
  if (value.type === "text") return boundedString(value.text, MOBILE_FRAME_LIMITS.maxIntentTextLength)
  return false
}

/**
 * A button is bounded the way the desktop's own stored action is, not more loosely
 * because the computer that sent it is the user's own: a payload that reaches the
 * phone is a payload the phone will act on, and "trusted sender" is not a reason to
 * accept a text that could never have been stored.
 *
 * `label` and `text` are non-empty for the same reason — they cannot be blank on the
 * desktop either, since both are created through a schema that trims and requires one
 * character. `id` is checked against the widest id either kind of button has: a uuid.
 */
function isMobileToolbarButton(value: unknown): value is MobileToolbarButton {
  if (!isRecord(value)) return false
  if (!boundedString(value.id, MOBILE_FRAME_LIMITS.maxToolbarButtonIdLength)) return false
  if (!boundedString(value.label, MOBILE_FRAME_LIMITS.maxToolbarLabelLength)) return false
  if (value.group !== "key" && value.group !== "command" && value.group !== "custom") return false
  return isMobileToolbarAction(value.action)
}

function isMobileToolbarAction(value: unknown): value is MobileToolbarAction {
  if (!isRecord(value)) return false
  if (value.type === "key") return isMobileKey(value.key)
  if (value.type === "text") {
    return boundedString(value.text, MOBILE_FRAME_LIMITS.maxToolbarTextLength) &&
      typeof value.pressEnter === "boolean"
  }
  return false
}

/**
 * Bounded the way the desktop's own stored entry is, and by the same constants the
 * toolbar button uses: an id and a body of text a user authored in one of the
 * computer's apps. Both fields are non-empty because neither can be blank where it
 * is stored — the entry's own validator requires a non-blank id and a non-blank
 * body, so a payload that failed here could never have been produced by the
 * computer that sent it.
 */
function isMobileQuickPhrase(value: unknown): value is MobileQuickPhrase {
  if (!isRecord(value)) return false
  if (!boundedString(value.id, MOBILE_FRAME_LIMITS.maxToolbarButtonIdLength)) return false
  return boundedString(value.content, MOBILE_FRAME_LIMITS.maxQuickPhraseLength)
}

function isCursor(value: unknown): value is MobileTerminalCursor {
  if (!isRecord(value)) return false
  return nonNegativeInteger(value.row) &&
    nonNegativeInteger(value.col) &&
    typeof value.visible === "boolean"
}

function isLineWire(value: unknown): value is MobileLineWire {
  if (!Array.isArray(value) || value.length === 0 || value.length > 2) return false
  if (typeof value[0] !== "string" || value[0].length > MOBILE_FRAME_LIMITS.maxLineLength) return false
  if (value.length === 1) return true
  const runs = value[1]
  if (!boundedArray(runs, MOBILE_FRAME_LIMITS.maxRunsPerLine)) return false
  return (runs as readonly unknown[]).every(isRunWire)
}

function isRunWire(value: unknown): value is MobileRunWire {
  if (!Array.isArray(value) || value.length !== 5) return false
  const [start, length, foreground, background, flags] = value as readonly unknown[]
  return nonNegativeInteger(start) &&
    positiveNumber(length) &&
    isFiniteInteger(foreground) &&
    isFiniteInteger(background) &&
    nonNegativeInteger(flags)
}

function isSummaryGroup(value: unknown): value is MobileSummaryGroup {
  return isRecord(value) &&
    boundedString(value.id, MOBILE_FRAME_LIMITS.maxSummaryIdLength) &&
    boundedString(value.name, MOBILE_FRAME_LIMITS.maxSummaryGroupNameLength)
}

function isSummaryWorkspacePane(value: unknown): value is MobileSummaryWorkspacePane {
  if (!isRecord(value)) return false
  return boundedString(value.paneId, MOBILE_FRAME_LIMITS.maxSummaryIdLength) &&
    boundedString(value.sessionId, MOBILE_FRAME_LIMITS.maxSummaryIdLength)
}

function isSummaryWorkspace(value: unknown): value is MobileSummaryWorkspace {
  if (!isRecord(value)) return false
  if (!boundedString(value.id, MOBILE_FRAME_LIMITS.maxSummaryIdLength)) return false
  if (!boundedString(value.groupId, MOBILE_FRAME_LIMITS.maxSummaryIdLength)) return false
  if (!boundedString(value.title, MOBILE_FRAME_LIMITS.maxTitleLength)) return false
  // A tab with no panes would name nothing, so it is not a tab the phone could draw.
  if (!boundedArray(value.panes, MOBILE_FRAME_LIMITS.maxSummaryWorkspacePanes)) return false
  if ((value.panes as readonly unknown[]).length === 0) return false
  return (value.panes as readonly unknown[]).every(isSummaryWorkspacePane)
}

function isSummaryAgentGroup(value: unknown): value is MobileSummaryAgentGroup {
  if (!isRecord(value)) return false
  return boundedString(value.projectId, MOBILE_FRAME_LIMITS.maxSummaryIdLength) &&
    boundedString(value.name, MOBILE_FRAME_LIMITS.maxSummaryAgentNameLength) &&
    typeof value.isDefault === "boolean"
}

function isSummaryAgentProvider(value: unknown): value is MobileSummaryAgentProvider {
  if (!isRecord(value)) return false
  return boundedString(value.id, MOBILE_FRAME_LIMITS.maxSummaryIdLength) &&
    boundedString(value.name, MOBILE_FRAME_LIMITS.maxSummaryAgentNameLength) &&
    typeof value.isDefault === "boolean" &&
    isModelTier(value.defaultTier) &&
    isSummaryAgentProviderModels(value.models)
}

/** A tier a Provider does not name is simply absent; an empty string is not a model name. */
function isSummaryAgentProviderModels(value: unknown): value is MobileSummaryAgentProviderModels {
  if (!isRecord(value)) return false
  return MOBILE_MODEL_TIERS.every((tier) => value[tier] === undefined ||
    boundedString(value[tier], MOBILE_FRAME_LIMITS.maxSummaryModelNameLength))
}

function isSummarySession(value: unknown): value is MobileSummarySession {
  if (!isRecord(value)) return false
  if (!boundedString(value.id, MOBILE_FRAME_LIMITS.maxSummaryIdLength)) return false
  if (!boundedString(value.groupId, MOBILE_FRAME_LIMITS.maxSummaryIdLength)) return false
  if (!boundedString(value.title, MOBILE_FRAME_LIMITS.maxTitleLength)) return false
  if (!isSummaryStatus(value.status)) return false
  if (!isSummaryAttention(value.attention)) return false
  // Unlike the fields above these may legitimately be empty: a session whose
  // directory is unknown, or that has not printed anything yet.
  if (!boundedText(value.cwd, MOBILE_FRAME_LIMITS.maxSummaryCwdLength)) return false
  if (!positiveNumber(value.cols) || !positiveNumber(value.rows)) return false
  if (!boundedString(value.startedAt, MOBILE_FRAME_LIMITS.maxSummaryStartedAtLength)) return false
  if (!boundedText(value.lastLine, MOBILE_FRAME_LIMITS.maxSummaryLastLineLength)) return false
  if (!nonNegativeInteger(value.lastOutputSeq)) return false
  // Absent whenever the desktop's own layout decides, which is the ordinary case,
  // so this is allowed to be missing but not to be empty or oversized when present.
  if (value.gridOwnerId !== undefined &&
    !boundedString(value.gridOwnerId, MOBILE_FRAME_LIMITS.maxSummaryGridOwnerIdLength)) return false
  return true
}

function isSummaryStatus(value: unknown): value is MobileSummarySession["status"] {
  return value === "running" || value === "stopping" || value === "ended" ||
    value === "failed" || value === "lost"
}

function isSummaryAttention(value: unknown): value is MobileSummaryAttention {
  if (!isRecord(value)) return false
  if (value.state !== "waiting" && value.state !== "not_waiting" && value.state !== "unknown") return false
  return value.kind === "shell_ready" || value.kind === "agent_question" || value.kind === "approval" ||
    value.kind === "password" || value.kind === "other_interaction" || value.kind === "unknown"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}

function boundedString(value: unknown, maxLength: number): value is string {
  return nonEmptyString(value) && value.length <= maxLength
}

/** Like `boundedString`, but empty is a legitimate value. */
function boundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length <= maxLength
}

function positiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value)
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function boundedArray(value: unknown, maxLength: number): value is readonly unknown[] {
  return Array.isArray(value) && value.length <= maxLength
}

function boundedCols(value: unknown): value is number {
  return nonNegativeInteger(value) && value > 0 && value <= MOBILE_FRAME_LIMITS.maxResizeCols
}

function boundedRows(value: unknown): value is number {
  return nonNegativeInteger(value) && value > 0 && value <= MOBILE_FRAME_LIMITS.maxResizeRows
}

function isModelTier(value: unknown): value is MobileModelTier {
  return typeof value === "string" && (MOBILE_MODEL_TIERS as readonly string[]).includes(value)
}

/** Dimensions travel as a pair; half a grid is not a grid. */
function resizeShape(cols: unknown, rows: unknown): boolean {
  if (cols === undefined && rows === undefined) return true
  return boundedCols(cols) && boundedRows(rows)
}

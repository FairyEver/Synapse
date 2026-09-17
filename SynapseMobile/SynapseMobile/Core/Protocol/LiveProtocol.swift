import Foundation

/// Mirror of `shared/src/live.ts` and `shared/src/mobile-live.ts`.
///
/// The phone sits on the opposite side of the same envelopes as a desktop: it
/// sends what a desktop receives and receives what a desktop sends. The names
/// here follow the phone's perspective so the call sites read correctly.

enum LiveMessageType {
    static let hello = "live.hello"
    static let welcome = "live.welcome"
    static let ping = "live.ping"
    static let pong = "live.pong"
    static let mobileSummary = "mobile.summary"
    static let mobileFrame = "mobile.frame"
    static let mobileIntent = "mobile.intent"
    static let mobileIntentResult = "mobile.intentResult"
    static let mobileTransferProgress = "mobile.transferProgress"
    static let mobileDetached = "mobile.detached"
    static let mobilePresence = "mobile.presence"
}

/// Which of the user's computers are reachable right now.
///
/// The socket is to the cloud, not to a computer, so a desktop signing in or
/// dropping out is invisible here without this. It carries the whole list rather
/// than a delta, so replacing what we hold is always correct.
struct MobilePresencePayload: Decodable {
    let desktopClientInstanceIds: [String]
}

struct LiveEnvelope: Decodable {
    let type: String
    let id: String
    let sentAt: String
    let payload: AnyPayload
}

/// Keeps the decoder generic: payload shape is decided by `type`, which the
/// callers switch on.
struct AnyPayload: Decodable {
    let value: Any

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if let dict = try? container.decode([String: JSONValue].self) {
            value = dict
        } else {
            value = [String: JSONValue]()
        }
    }

    func decode<T: Decodable>(_ type: T.Type) -> T? {
        guard let dict = value as? [String: JSONValue] else { return nil }
        let encoder = JSONEncoder()
        guard let data = try? encoder.encode(dict) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}

/// A minimal `Codable` JSON tree, used to re-encode a decoded payload into a
/// concrete type without decoding twice.
enum JSONValue: Codable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .null
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .number(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }
}

// MARK: - Summary

struct MobileSummaryGroup: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
}

struct MobileSummaryAttention: Decodable, Hashable {
    let state: String
    let kind: String

    var isWaiting: Bool { state == "waiting" }
}

struct MobileSummarySession: Decodable, Identifiable, Hashable {
    let id: String
    let groupId: String
    let title: String
    let status: String
    let attention: MobileSummaryAttention
    let cwd: String
    let cols: Int
    let rows: Int
    let startedAt: String
    let lastLine: String
    let lastOutputSeq: Int
    /// The phone deciding this session's grid, by its client instance id.
    ///
    /// Absent for a terminal the computer's own layout decides, which is the
    /// ordinary case. Seeing this phone's id means its claim still stands; seeing
    /// somebody else's, or none where this phone's used to be, means the grid is no
    /// longer its to size — which is the only way the desktop's own release reaches
    /// here, since it is a local act there.
    let gridOwnerId: String?

    var isRunning: Bool { status == "running" }
    var startedAtDate: Date? { ISO8601DateFormatter().date(from: startedAt) }
}

/// The four model tiers a Provider can name, in the order the desktop shows them.
///
/// The desktop's own `ModelTier` and this are the same closed set; the wire carries
/// the raw strings, so this is a decode target rather than a mapping.
enum MobileModelTier: String, Codable, CaseIterable, Hashable, Sendable {
    case `default`
    case opus
    case sonnet
    case haiku

    /// The order the desktop's picker lists them in — its own `MODEL_TIER_DISPLAY_ORDER`.
    static let displayOrder: [MobileModelTier] = [.default, .opus, .sonnet, .haiku]

    var label: String {
        switch self {
        case .default: return "主模型"
        case .opus: return "Opus"
        case .sonnet: return "Sonnet"
        case .haiku: return "Haiku"
        }
    }
}

/// One project a conversation may be started in.
///
/// `projectId` is what goes back in `createAgentConversation`; it is the desktop's
/// own project identity, including for the built-in workspace it always offers.
struct MobileSummaryAgentGroup: Decodable, Identifiable, Hashable {
    let projectId: String
    let name: String
    let isDefault: Bool

    var id: String { projectId }
}

/// One Provider a conversation may be started with.
///
/// There is no endpoint here and no credential, deliberately: the computer reads its
/// own key when it launches, and the phone is never in a position to hold one.
struct MobileSummaryAgentProvider: Decodable, Identifiable, Hashable {
    let id: String
    let name: String
    /// The Provider the computer itself would use if this phone named none.
    ///
    /// Not "the active one" — the desktop resolves a configured default first. This is
    /// therefore what the panel preselects, because it is what would actually happen.
    let isDefault: Bool
    /// The tier this Provider would be used at, so no row's model name is a guess.
    let defaultTier: MobileModelTier
    /// Model name by tier. A tier the Provider does not name is absent.
    let models: [String: String]

    func modelName(for tier: MobileModelTier) -> String? { models[tier.rawValue] }

    /// The tiers this Provider offers, in the desktop's own display order.
    var selectableTiers: [MobileModelTier] {
        MobileModelTier.displayOrder.filter { models[$0.rawValue] != nil }
    }
}

struct MobileSummaryPayload: Decodable {
    let desktopClientInstanceId: String
    let desktopName: String
    let revision: Int
    let groups: [MobileSummaryGroup]
    /// Tabs that hold a split, and only those.
    ///
    /// Optional on purpose: a desktop that has no splits omits the field entirely,
    /// and one that predates it never sends it. Both decode to `nil`, which is why
    /// the list falls back to its flat form without needing a branch of its own.
    let workspaces: [MobileSummaryWorkspace]?
    /// Where a Claude Code conversation may be started, and with which Provider.
    ///
    /// Optional for a different reason than `workspaces`: absent means the computer
    /// cannot say — it predates these intents. An empty array is a computer that can
    /// say and has nothing to offer. The new-conversation panel is offered for the
    /// first and unavailable for the second, so the two must not be conflated.
    let agentGroups: [MobileSummaryAgentGroup]?
    let agentProviders: [MobileSummaryAgentProvider]?
    let sessions: [MobileSummarySession]
}

/// One tab of a desktop workspace, once it holds more than one pane.
struct MobileSummaryWorkspace: Decodable, Hashable {
    let id: String
    let groupId: String
    let title: String
    let panes: [MobileSummaryWorkspacePane]
}

struct MobileSummaryWorkspacePane: Decodable, Hashable {
    let paneId: String
    let sessionId: String
}

// MARK: - Terminal frame

struct TerminalCursor: Decodable, Hashable {
    /// Absolute gateway line index, not an offset into `lines`.
    let row: Int
    let col: Int
    let visible: Bool

    static let hidden = TerminalCursor(row: 0, col: 0, visible: false)

    private enum CodingKeys: String, CodingKey { case row, col, visible }

    init(row: Int, col: Int, visible: Bool) {
        self.row = row
        self.col = col
        self.visible = visible
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        row = (try? container.decode(Int.self, forKey: .row)) ?? 0
        col = (try? container.decode(Int.self, forKey: .col)) ?? 0
        visible = (try? container.decode(Bool.self, forKey: .visible)) ?? false
    }
}

/// One run of identically styled text.
struct StyleRun: Hashable, Sendable {
    let start: Int
    let length: Int
    let foreground: Int
    let background: Int
    let flags: Int

    static let defaultColor = -1
    static let truecolorBase = 0x100_0000

    var isBold: Bool { flags & 1 != 0 }
    var isItalic: Bool { flags & 2 != 0 }
    var isUnderline: Bool { flags & 4 != 0 }
    var isDim: Bool { flags & 8 != 0 }
    var isInverse: Bool { flags & 16 != 0 }
}

/// A terminal line on the wire is `[text]` or `[text, runs]`, with runs as
/// `[start, length, fg, bg, flags]`. Compact on purpose: the great majority of
/// lines carry no styling at all and would otherwise pay for empty structures.
struct TerminalLine: Decodable {
    let text: String
    let runs: [StyleRun]

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        text = (try? container.decode(String.self)) ?? ""
        if container.isAtEnd {
            runs = []
            return
        }
        let rawRuns = (try? container.decode([[Int]].self)) ?? []
        runs = rawRuns.compactMap { values in
            guard values.count >= 5 else { return nil }
            return StyleRun(
                start: values[0],
                length: values[1],
                foreground: values[2],
                background: values[3],
                flags: values[4]
            )
        }
    }
}

struct MobileTerminalFrame: Decodable {
    let sessionId: String
    /// `suffix` replaces everything from `from` onward; `reset` also discards
    /// what came before.
    let kind: String
    let from: Int
    let lines: [TerminalLine]
    let total: Int
    let cursor: TerminalCursor
    let alt: Bool
    let truncated: Bool
    let seq: Int
    let sizeRevision: Int

    var isReset: Bool { kind == "reset" }
    /// Replaces exactly `[from, from + lines.count)` and leaves the rest of the
    /// buffer alone, so older lines can be filled in without losing newer ones.
    var isHistory: Bool { kind == "history" }
}

struct MobileFramePayload: Decodable {
    let desktopClientInstanceId: String
    let mobileClientInstanceId: String
    let frame: MobileTerminalFrame
}

// MARK: - Intent

enum MobileKey: String, Codable, CaseIterable {
    case enter = "Enter"
    case tab = "Tab"
    case escape = "Escape"
    case arrowUp = "ArrowUp"
    case arrowDown = "ArrowDown"
    case arrowLeft = "ArrowLeft"
    case arrowRight = "ArrowRight"
    case backspace = "Backspace"
    case controlC = "Ctrl+C"
    case controlD = "Ctrl+D"

    /// Short label for the accessory bar.
    var label: String {
        switch self {
        case .enter: return "return"
        case .tab: return "tab"
        case .escape: return "esc"
        case .arrowUp: return "↑"
        case .arrowDown: return "↓"
        case .arrowLeft: return "←"
        case .arrowRight: return "→"
        case .backspace: return "⌫"
        case .controlC: return "^C"
        case .controlD: return "^D"
        }
    }
}

enum MobileKeyAction: Encodable {
    case text(String)
    case key(MobileKey)

    private enum CodingKeys: String, CodingKey { case type, text, key }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .text(let value):
            try container.encode("text", forKey: .type)
            try container.encode(value, forKey: .text)
        case .key(let value):
            try container.encode("key", forKey: .type)
            try container.encode(value.rawValue, forKey: .key)
        }
    }
}

struct MobileIntentResult: Decodable {
    let intentId: String
    let outcome: String
    let code: String?
    let message: String?
    let sessionId: String?
    let createdSessionId: String?
    /// Set for `fileUpload`: where the file ended up on the computer. The phone
    /// cannot derive it, and needs it to undo the insertion it caused.
    let landedPath: String?

    var isAccepted: Bool { outcome == "accepted" }
    var isNoOp: Bool { outcome == "no_op" }
}

struct MobileIntentResultPayload: Decodable {
    let mobileClientInstanceId: String
    let result: MobileIntentResult
}

/// How far along the computer is in fetching a file this phone relayed.
///
/// Keyed by the intent the phone sent rather than by a file name, because the
/// intent is what the strip is already showing the transfer under — the computer's
/// answer carries the same id, so progress and completion land on the same chip.
struct MobileTransferProgressPayload: Decodable {
    let mobileClientInstanceId: String
    let intentId: String
    let completedBytes: Double
    /// Zero when the download declared no length, which is a different statement
    /// from a total of zero bytes.
    let totalBytes: Double
}

struct MobileIntentPayload: Decodable {
    let desktopClientInstanceId: String
    let mobileClientInstanceId: String
    let intent: MobileIntentEcho
}

/// Only used when a desktop-shape message arrives on the phone channel, which
/// should not happen; decoding it keeps the envelope handling uniform.
struct MobileIntentEcho: Decodable {
    let intentId: String
    let kind: String
}

// MARK: - Outbound

struct MobileIntentRequest: Encodable {
    let v = 1
    /// Mutable because a write that was rejected as preempted is replayed as a
    /// new intent: the gateway dedupes by this id and would answer the replay
    /// with the cached rejection.
    var intentId: String
    let kind: String
    var sessionId: String?
    var text: String?
    var actions: [MobileKeyAction]?
    var title: String?
    var groupId: String?
    var commandId: String?
    /// Starting a Claude Code conversation: which project, and optionally which
    /// Provider and tier.
    ///
    /// The two optional ones travel together and are omitted together. Absent means
    /// "the computer decides", which is the ordinary case — the phone's own default
    /// would be a second answer to a question the desktop already answers for its
    /// ⌘-click shortcut, and the two could disagree. See `shared/src/mobile-live.ts`.
    var projectId: String?
    var providerId: String?
    var modelTier: String?
    /// History paging: the oldest line the client holds, and how many to fetch below it.
    var before: Int?
    var limit: Int?
    /// Grid the phone wants the PTY to adopt, for the display mode where the phone
    /// drives the size. Also the starting grid on `create`, where it has to arrive
    /// with the session: a shell prints its banner and first prompt within
    /// milliseconds, laid out for whatever width the PTY had at the time, and those
    /// lines stay in scrollback at that width forever.
    var cols: Int?
    var rows: Int?
    /// Shown on the desktop badge that names the device deciding the grid.
    var deviceLabel: String?
    /// File hand-off. The bytes never travel on this socket: they are uploaded to
    /// the drive over HTTP first, and these two name what the computer should fetch
    /// and what it should call the result. See `shared/src/mobile-live.ts`.
    var driveItemId: String?
    var fileName: String?
}

struct MobileIntentPayloadOut: Encodable {
    let desktopClientInstanceId: String
    let mobileClientInstanceId: String
    let intent: MobileIntentRequest
}

struct HelloPayload: Encodable {
    let clientInstanceId: String
    let appVersion: String
    let platform: String
    let deviceName: String
}

struct PingPayload: Encodable {
    let sentAt: String
}

struct OutboundEnvelope<Payload: Encodable>: Encodable {
    let type: String
    let id: String
    let sentAt: String
    let payload: Payload

    static func make(_ type: String, _ payload: Payload) -> OutboundEnvelope {
        OutboundEnvelope(
            type: type,
            id: UUID().uuidString,
            sentAt: ISO8601DateFormatter().string(from: Date()),
            payload: payload
        )
    }
}

import Foundation
import UniformTypeIdentifiers

/// One file on its way from this phone to the paired computer.
///
/// The states are ordered by the fact each one records: bytes reserved in the
/// drive, bytes in the drive, the computer told about them, then the computer's
/// answer. Nothing skips a step, which is what lets the strip say something true
/// at every point.
struct TerminalAttachment: Identifiable, Equatable {
    enum State: Equatable {
        /// Picked, not started. In the strip from the moment it is chosen, because
        /// a file that is going to take a while should be visible before it begins
        /// rather than appearing once it is already under way.
        case queued
        /// Going up. The fraction is 0…1, or nil when the server gave no length.
        case uploading(Double?)
        /// In the drive and waiting to be handed to the computer. The reason is
        /// shown to the user, because "waiting" alone does not say what for.
        case waitingForComputer
        /// On the computer. `path` is where, as the computer reported it — nil when
        /// the file landed but the path could not be typed, which is still a
        /// success and is reported as one.
        case delivered(path: String?)
        case failed(String)

        var isFailed: Bool {
            if case .failed = self { return true }
            return false
        }

        var isDelivered: Bool {
            if case .delivered = self { return true }
            return false
        }

        var fraction: Double? {
            if case .uploading(let fraction) = self { return fraction }
            return nil
        }
    }

    let id: String
    /// The name the computer will write. Chosen at pick time so the strip, the
    /// upload and the intent all name the same file.
    ///
    /// Replaced by the computer's own answer once it lands: the desktop sanitizes
    /// the name a second time on its own side, so what it actually wrote is the
    /// truth and this is only a prediction until then.
    var name: String
    let sessionId: String
    /// Reused for every resend of an *undelivered* transfer, because the desktop
    /// dedupes by it and a resend after a lost reply must carry the same one or the
    /// file is delivered twice.
    ///
    /// Replaced only when the desktop has actually answered with a refusal: it
    /// caches a result against the id, so retrying a rejection under the same id
    /// would hand back the same rejection without doing anything.
    var intentId: String
    /// The drive item, once the upload completed. Its presence is what tells the
    /// ledger there is something that may need reclaiming.
    var driveItemId: String?
    var state: State
    /// True while the bytes still have to go up. A transfer that already has a drive
    /// item must never be uploaded again — the second copy would be a second file
    /// on the computer.
    var needsUpload: Bool {
        if case .queued = state { return true }
        return false
    }

    /// Whether the user may take this file off the strip.
    ///
    /// Not while its bytes are still moving — there is nothing to take back yet.
    /// A file waiting on a computer that may never come back is dismissible, and
    /// has to be: the batch limit counts what is waiting, so without this a user
    /// whose computer stayed offline could be left unable to send anything at all.
    var canBeDismissed: Bool {
        switch state {
        case .queued, .uploading:
            return false
        case .waitingForComputer, .delivered, .failed:
            return true
        }
    }

    /// The last path the computer reported for this file, for undo. Only a
    /// delivered file with a typed path can be undone.
    var insertedPath: String? {
        if case .delivered(let path) = state { return path }
        return nil
    }
}

/// A file the user picked, already written to a temporary file on this phone.
struct PickedFile: Equatable {
    let url: URL
    let name: String
    let size: Int64
    let mimeType: String?

    /// The name the computer will see, reduced to what is safe to type.
    static func relayName(for raw: String, fallbackExtension: String) -> String? {
        sanitizedFileName(raw) ?? sanitizedFileName("未命名文件\(fallbackExtension)")
    }
}

/// Uploaded files the computer has not confirmed.
///
/// Nothing on the server reclaims a relayed copy — the drive has no expiry, and
/// its delete routes only move an item along its lifecycle — so a file whose
/// computer never came back would sit in the user's drive forever. The phone is
/// the only party that knows the item exists and that it is still owed a delivery,
/// so the phone holds the list and sweeps it.
struct RelayLedger {
    struct Entry: Codable, Equatable {
        let itemId: String
        let uploadedAt: Date
    }

    private static let key = "SynapseRelayLedger"

    private let defaults: UserDefaults
    private var entries: [Entry]

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.entries = Self.load(from: defaults)
    }

    var all: [Entry] { entries }

    mutating func record(itemId: String, at date: Date = Date()) {
        guard !entries.contains(where: { $0.itemId == itemId }) else { return }
        entries.append(Entry(itemId: itemId, uploadedAt: date))
        save()
    }

    /// The delivery landed, so the item is gone from the drive and owes nothing.
    mutating func resolve(itemId: String) {
        guard let index = entries.firstIndex(where: { $0.itemId == itemId }) else { return }
        entries.remove(at: index)
        save()
    }

    /// Entries old enough to give up on. The caller still has to delete them; this
    /// only says which ones.
    func expired(now: Date = Date(), after: TimeInterval = AppConfiguration.relayPendingExpiry) -> [Entry] {
        entries.filter { now.timeIntervalSince($0.uploadedAt) >= after }
    }

    private mutating func save() {
        guard let data = try? JSONEncoder().encode(entries) else { return }
        defaults.set(data, forKey: Self.key)
    }

    private static func load(from defaults: UserDefaults) -> [Entry] {
        guard let data = defaults.data(forKey: key),
              let decoded = try? JSONDecoder().decode([Entry].self, from: data)
        else { return [] }
        return decoded
    }
}

/// Reduces a name to one that is safe on the computer's disk and safe to type into
/// its terminal.
///
/// Mirrors `sanitizeRelayedFileName` in the desktop's `file-relay.ts`. The desktop
/// applies its own copy regardless — it is the side that owns the filesystem, and
/// it does not trust the wire — but agreeing here is what lets the strip show the
/// name the file will actually get rather than one it is about to be given.
///
/// The rule is deliberately aggressive. The path is typed bare into a shell, so a
/// name holding `&`, `;` or a space would execute as more than a path.
func sanitizedFileName(_ raw: String) -> String? {
    let allowed = CharacterSet.letters
        .union(.decimalDigits)
        .union(CharacterSet(charactersIn: "._-"))

    let lastSegment = raw.components(separatedBy: CharacterSet(charactersIn: "/\\")).last ?? ""
    var collapsed = ""
    // A literal hyphen counts as a separator for collapsing, so `a-/b` becomes
    // `a-b` rather than `a--b` — the same thing the desktop's `-{2,}` pass does.
    var previousWasSeparator = false
    for scalar in lastSegment.unicodeScalars {
        if scalar == "-" || !allowed.contains(scalar) {
            if !previousWasSeparator {
                collapsed.append("-")
                previousWasSeparator = true
            }
        } else {
            collapsed.unicodeScalars.append(scalar)
            previousWasSeparator = false
        }
    }

    let settled = collapsed.trimmingCharacters(in: CharacterSet(charactersIn: ".-"))
    guard !settled.isEmpty else { return nil }

    let (stem, ext) = splitFileName(settled)
    let room = maxRelayedFileNameLength - ext.count
    guard room > 0 else { return nil }
    let keptStem = String(stem.prefix(room))
        .trimmingCharacters(in: CharacterSet(charactersIn: " .-"))
    guard !keptStem.isEmpty else { return nil }
    return keptStem + ext
}

/// Mirrors `MOBILE_FRAME_LIMITS.maxRelayedFileNameLength`.
let maxRelayedFileNameLength = 120

/// Splits `name` into stem and extension, where `ext` includes the dot.
///
/// A dot at either end is part of the name rather than a separator, and a long
/// "extension" is really part of the stem — protecting it from truncation would
/// otherwise sacrifice a real name to a suffix that means nothing.
private func splitFileName(_ name: String) -> (stem: String, ext: String) {
    guard let dot = name.lastIndex(of: "."), dot != name.startIndex, name.index(after: dot) != name.endIndex
    else { return (name, "") }
    let ext = String(name[dot...])
    guard ext.count <= 12 else { return (name, "") }
    return (String(name[..<dot]), ext)
}

/// A name for a picture that arrived with none, matching the design's
/// `粘贴图片-20260916-2013.png`.
func generatedFileName(prefix: String, extension ext: String, at date: Date = Date()) -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyyMMdd-HHmm"
    return "\(prefix)-\(formatter.string(from: date)).\(ext)"
}

/// Why a pick was refused, so the user is told at the moment they pick rather
/// than after an upload that was never going to be accepted.
enum PickRejection: Equatable {
    case tooLarge(name: String, bytes: Int64)
    case tooMany(limit: Int)

    var message: String {
        switch self {
        case .tooLarge(let name, let bytes):
            let limit = ByteCountFormatter.string(fromByteCount: Int64(AppConfiguration.relayMaxFileBytes), countStyle: .file)
            let actual = ByteCountFormatter.string(fromByteCount: bytes, countStyle: .file)
            return "「\(name)」有 \(actual)，超过单个文件 \(limit) 的上限。"
        case .tooMany(let limit):
            return "一次最多 \(limit) 个文件。"
        }
    }
}

/// Applies the two limits the design puts on one selection.
///
/// Both are the same numbers the server and the desktop enforce; checking them
/// here is what turns a refusal the user would only see as a failed upload into
/// one they see while they are still choosing.
func screenPickedFiles(_ files: [PickedFile], alreadyWaiting: Int) -> (accepted: [PickedFile], rejections: [PickRejection]) {
    var accepted: [PickedFile] = []
    var rejections: [PickRejection] = []
    let room = AppConfiguration.relayMaxFileCount - alreadyWaiting
    guard room > 0 else { return ([], [.tooMany(limit: AppConfiguration.relayMaxFileCount)]) }

    for file in files {
        if file.size > Int64(AppConfiguration.relayMaxFileBytes) {
            rejections.append(.tooLarge(name: file.name, bytes: file.size))
            continue
        }
        if accepted.count >= room {
            rejections.append(.tooMany(limit: AppConfiguration.relayMaxFileCount))
            break
        }
        accepted.append(file)
    }
    return (accepted, rejections)
}

/// The MIME type the drive should record for a file, from its name.
func mimeType(forFileNamed name: String) -> String? {
    let ext = (name as NSString).pathExtension
    guard !ext.isEmpty else { return nil }
    return UTType(filenameExtension: ext)?.preferredMIMEType
}

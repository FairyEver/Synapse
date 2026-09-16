import Foundation
import Observation

/// How the reader has asked terminals to be laid out.
///
/// Two settings live here and they are deliberately not the same kind of thing.
/// Density is a preference about reading — how tightly the grid is packed — and
/// holds for every terminal, so it persists. A display mode is a decision about
/// one terminal's grid, so it is remembered per session; a per-session density is
/// a "for now" adjustment while looking at one screen, so it is not written down
/// at all, which is what makes it temporary in practice rather than only in the
/// documentation.
@MainActor
@Observable
final class TerminalDisplaySettings {
    /// The system-wide default, and what every session follows unless overridden.
    var density: TerminalDensity {
        didSet {
            guard density != oldValue else { return }
            defaults.set(density.rawValue, forKey: Self.densityKey)
        }
    }

    private var modes: [String: TerminalDisplayMode] {
        didSet {
            guard modes != oldValue else { return }
            defaults.set(try? JSONEncoder().encode(modes), forKey: Self.modesKey)
        }
    }

    /// Not persisted, on purpose.
    private var sessionDensities: [String: TerminalDensity] = [:]

    private let defaults: UserDefaults

    private static let densityKey = "SynapseTerminalDensity"
    private static let modesKey = "SynapseTerminalSessionModes"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults

        let storedDensity = defaults.string(forKey: Self.densityKey)
        self.density = storedDensity.flatMap { TerminalDensity(rawValue: $0) } ?? .normal

        let storedModes = defaults.data(forKey: Self.modesKey)
        self.modes = storedModes.flatMap {
            try? JSONDecoder().decode([String: TerminalDisplayMode].self, from: $0)
        } ?? [:]
    }

    // MARK: - Density

    /// The density in force for one terminal: its own adjustment if it has one,
    /// otherwise the system setting.
    func density(for sessionId: String) -> TerminalDensity {
        sessionDensities[sessionId] ?? density
    }

    /// Passing `nil` puts the session back on the system setting.
    func setDensity(_ value: TerminalDensity?, for sessionId: String) {
        sessionDensities[sessionId] = value
    }

    func isOverridingDensity(_ sessionId: String) -> Bool {
        sessionDensities[sessionId] != nil
    }

    // MARK: - Display mode

    /// Defaults to the desktop's grid: a terminal the phone did not create is the
    /// computer's shape, and showing it as such is what the reader opened it for.
    func mode(for sessionId: String) -> TerminalDisplayMode {
        modes[sessionId] ?? .desktopDriven
    }

    func setMode(_ value: TerminalDisplayMode, for sessionId: String) {
        modes[sessionId] = value
    }

    /// Forgets choices for terminals that no longer exist.
    ///
    /// Sessions are destroyed when they end, so without this the record would grow
    /// with every terminal the reader ever opened and never shrink.
    func prune(keeping liveSessionIds: Set<String>) {
        let stale = modes.keys.filter { !liveSessionIds.contains($0) }
        guard !stale.isEmpty else { return }
        for id in stale { modes.removeValue(forKey: id) }
    }
}

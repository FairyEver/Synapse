import Foundation
import Observation

/// What this phone last used to start a Claude Code conversation.
///
/// This is the half of the desktop's shortcut the phone cannot inherit. There, the `+`
/// hangs off a project row, so the project is already known and the user decides
/// nothing; the phone's `＋` is in a navigation bar with no such context. Remembering
/// the last project puts that context back, which is what makes `＋` → 开始对话 two
/// taps and no decisions.
///
/// Provider and tier are remembered too, but only once the user has actually picked
/// one: until then the request names neither and the computer resolves them, so the
/// phone's default and the desktop's default are the same answer by construction
/// rather than by agreement.
///
/// Stored locally and never uploaded. The computer is the one that acts, and what it
/// is told on each request is the whole of what it learns.
@MainActor
@Observable
final class AgentConversationPreferences {
    private(set) var projectId: String?
    private(set) var providerId: String?
    private(set) var modelTier: MobileModelTier?

    private let defaults: UserDefaults

    private static let projectKey = "SynapseAgentConversationProject"
    private static let providerKey = "SynapseAgentConversationProvider"
    private static let tierKey = "SynapseAgentConversationModelTier"

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.projectId = defaults.string(forKey: Self.projectKey)
        self.providerId = defaults.string(forKey: Self.providerKey)
        self.modelTier = defaults.string(forKey: Self.tierKey).flatMap { MobileModelTier(rawValue: $0) }
    }

    /// Records a conversation that was started, or that the user set the panel to.
    ///
    /// `providerId` and `modelTier` are a pair — a Provider with no tier names no
    /// model, and the request refuses half a choice — so passing either as `nil` clears
    /// both. That is what "let the computer decide" means here, and it is also what a
    /// choice the summary no longer offers falls back to.
    func remember(projectId: String, providerId: String?, modelTier: MobileModelTier?) {
        self.projectId = projectId
        defaults.set(projectId, forKey: Self.projectKey)

        self.providerId = providerId
        self.modelTier = modelTier
        if let providerId, let modelTier {
            defaults.set(providerId, forKey: Self.providerKey)
            defaults.set(modelTier.rawValue, forKey: Self.tierKey)
        } else {
            defaults.removeObject(forKey: Self.providerKey)
            defaults.removeObject(forKey: Self.tierKey)
        }
    }

    /// Forgets a project the computer no longer offers.
    ///
    /// Called only with a list the computer actually sent. A desktop too old to send
    /// one, or one whose directory could not be read, leaves what is remembered alone —
    /// `prune` there would turn "I cannot say right now" into "you never had a
    /// project", and the user would lose their place for a reason that is not theirs.
    func prune(keepingProjectIds ids: Set<String>) {
        guard let projectId, !ids.contains(projectId) else { return }
        self.projectId = nil
        defaults.removeObject(forKey: Self.projectKey)
    }
}

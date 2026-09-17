import Foundation

/// What the phone remembers, as ids rather than as decoded rows.
///
/// Held this way so the panel follows the summary instead of a snapshot of it: a
/// project renamed on the computer, or a Provider removed, is re-resolved on the next
/// draw rather than leaving a row describing something that is no longer there.
struct AgentConversationChoice: Equatable {
    var projectId: String?
    var providerId: String?
    var modelTier: MobileModelTier?

    static let none = AgentConversationChoice()
}

/// What the new-conversation panel shows, and what the request will say.
struct AgentConversationSelection: Equatable {
    let project: MobileSummaryAgentGroup?
    let provider: MobileSummaryAgentProvider?
    let modelTier: MobileModelTier?
    /// Whether the shown Provider and tier are the reader's own choice.
    ///
    /// False means the panel is showing what the computer would do, and the request
    /// then names neither — the computer applies the same resolution its own shortcut
    /// uses. That is the whole reason the two cannot disagree: there is one answer,
    /// asked for once, rather than two that have to be kept in step.
    let providerIsChosen: Bool
    /// Whether the project shown is the one this phone used last time.
    ///
    /// Drives the 「上次」 tag, which is what tells the reader the row needs no reading.
    let projectIsRemembered: Bool

    /// A conversation can be started once a project is known; Provider and tier always
    /// resolve, because the computer always has an answer for them.
    var canStart: Bool { project != nil && provider != nil && modelTier != nil }
}

/// Resolves the panel's three rows from what the computer offers and what this phone used.
///
/// A pure function so the choices can be pinned without a screen: every one of them is
/// a decision about which of two truths to show, and the ones that matter — a project
/// the computer no longer has, a Provider the reader never chose — are exactly the ones
/// that are awkward to stage by hand.
func resolveAgentConversationSelection(
    groups: [MobileSummaryAgentGroup],
    providers: [MobileSummaryAgentProvider],
    remembered: AgentConversationChoice
) -> AgentConversationSelection {
    /*
     * No fallback when nothing is remembered. The computer does mark one group, but
     * that mark means "this is the built-in workspace" rather than "this is where you
     * were" — and starting someone in a directory they never chose is the failure the
     * phone has no way to undo. That is why the design rejected making `＋` itself
     * create: first use has no last project, so it would necessarily build in the
     * wrong place. Here the reader picks once and the choice is remembered.
     */
    let project = remembered.projectId.flatMap { id in groups.first { $0.projectId == id } }

    let rememberedProvider = remembered.providerId.flatMap { id in providers.first { $0.id == id } }
    // The computer's own answer stands in when the reader has not chosen, so the row
    // shows what would actually happen rather than an empty placeholder.
    let provider = rememberedProvider ?? providers.first { $0.isDefault } ?? providers.first

    let modelTier = resolveAgentConversationTier(provider: provider, remembered: remembered)

    return AgentConversationSelection(
        project: project,
        provider: provider,
        modelTier: modelTier,
        providerIsChosen: rememberedProvider != nil,
        projectIsRemembered: project != nil
    )
}

/// The tier to use with a Provider, which is the remembered one only when it is still
/// one this Provider offers.
///
/// Switching Provider keeps neither half of the old pair: a tier is chosen per
/// Provider, and the old one may name a model the new Provider does not have.
private func resolveAgentConversationTier(
    provider: MobileSummaryAgentProvider?,
    remembered: AgentConversationChoice
) -> MobileModelTier? {
    guard let provider else { return nil }
    if remembered.providerId == provider.id,
       let rememberedTier = remembered.modelTier,
       provider.modelName(for: rememberedTier) != nil {
        return rememberedTier
    }
    // The computer's own answer for this Provider, which it sends so the phone never
    // has to work the order out for itself.
    if provider.modelName(for: provider.defaultTier) != nil { return provider.defaultTier }
    return provider.selectableTiers.first
}

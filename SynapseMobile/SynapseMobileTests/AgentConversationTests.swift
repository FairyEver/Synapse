import Foundation
import Testing

@testable import SynapseMobile

/// Starting a Claude Code conversation from the phone.
///
/// Two things here can go wrong quietly, and both are pinned by these cases. The
/// directories ride on the summary, so a decode that demanded them would black-hole
/// the whole payload — sessions and all — for anyone whose computer predates them.
/// And the request's optional pair is the entire mechanism by which the phone avoids
/// inventing a default: absent means the computer decides, which is the same decision
/// its own shortcut makes.
struct AgentConversationTests {
    private func summaryJSON(directories: String) -> Data {
        Data("""
        {
          "desktopClientInstanceId": "desktop-1",
          "desktopName": "MacBook Pro",
          "revision": 4,
          "groups": [{ "id": "g1", "name": "默认" }],
          \(directories)
          "sessions": [{
            "id": "sess-1", "groupId": "g1", "title": "zsh 1", "status": "running",
            "attention": { "state": "not_waiting", "kind": "unknown" },
            "cwd": "/Users/liy", "cols": 80, "rows": 24,
            "startedAt": "2026-09-17T09:00:00.000Z", "lastLine": "pnpm dev", "lastOutputSeq": 3
          }]
        }
        """.utf8)
    }

    private func decodeSummary(_ json: Data) throws -> MobileSummaryPayload {
        try JSONDecoder().decode(MobileSummaryPayload.self, from: json)
    }

    /// A computer that offers both directories, in the shape the desktop produces.
    @Test func decodesTheProjectsAndProvidersAComputerOffers() throws {
        let summary = try decodeSummary(summaryJSON(directories: """
          "agentGroups": [
            { "projectId": "builtin:default-agent-workspace", "name": "本地对话", "isDefault": true },
            { "projectId": "project-1", "name": "Synapse", "isDefault": false }
          ],
          "agentProviders": [
            {
              "id": "preferred", "name": "Anthropic 官方", "isDefault": true, "defaultTier": "opus",
              "models": { "default": "claude-sonnet-4-5", "opus": "claude-opus-4-5" }
            },
            {
              "id": "local-claude-code", "name": "Claude Code 本地", "isDefault": false, "defaultTier": "default",
              "models": { "default": "Claude Code 默认" }
            }
          ],
        """))

        #expect(summary.agentGroups?.map(\.projectId) == ["builtin:default-agent-workspace", "project-1"])
        #expect(summary.agentGroups?.first?.isDefault == true)

        let preferred = try #require(summary.agentProviders?.first)
        #expect(preferred.isDefault)
        #expect(preferred.defaultTier == .opus)
        #expect(preferred.modelName(for: .opus) == "claude-opus-4-5")
        // A tier the Provider does not name is absent, not empty: that is what the
        // model picker disables.
        #expect(preferred.modelName(for: .haiku) == nil)
        #expect(preferred.selectableTiers == [.default, .opus])

        // The tiers come back in the desktop's own order, not the JSON's.
        let local = try #require(summary.agentProviders?.last)
        #expect(local.selectableTiers == [.default])
    }

    /// A computer that predates both blocks, and an empty one that has nothing to
    /// offer, are different answers and must stay different: absent is what makes the
    /// panel unavailable, empty is a panel with nothing in it.
    @Test func tellsAnOldComputerApartFromOneWithNothingToOffer() throws {
        let old = try decodeSummary(summaryJSON(directories: ""))
        #expect(old.agentGroups == nil)
        #expect(old.agentProviders == nil)
        // And the sessions in the same payload are unaffected, which is the whole
        // reason these are optional rather than required.
        #expect(old.sessions.map(\.id) == ["sess-1"])

        let empty = try decodeSummary(summaryJSON(directories: """
          "agentGroups": [],
          "agentProviders": [],
        """))
        #expect(empty.agentGroups?.isEmpty == true)
        #expect(empty.agentProviders?.isEmpty == true)
    }

    /// The outbound half of the protocol: what the desktop reads off the wire.
    ///
    /// `providerId` and `modelTier` are absent together whenever the user has not
    /// chosen, because that is what makes the computer resolve them with the same
    /// rules its own ⌘-click uses. Sending a tier without a Provider would name a
    /// model with no endpoint, and the desktop refuses the pair as a result.
    @Test func sendsAProjectAndOnlyTheChoiceTheUserActuallyMade() throws {
        let undecided = MobileIntentRequest(
            intentId: "i1",
            kind: "createAgentConversation",
            projectId: "project-1",
            cols: 54,
            rows: 37,
            deviceLabel: "iPhone"
        )
        let encoded = try #require(
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(undecided)) as? [String: Any]
        )
        #expect(encoded["projectId"] as? String == "project-1")
        #expect(encoded["cols"] as? Int == 54)
        #expect(encoded["rows"] as? Int == 37)
        // Omitted rather than null: `isMobileIntent` refuses half a choice, and a
        // present-but-null field is the shape that would produce one.
        #expect(encoded["providerId"] == nil)
        #expect(encoded["modelTier"] == nil)

        let decided = MobileIntentRequest(
            intentId: "i2",
            kind: "createAgentConversation",
            projectId: "project-1",
            providerId: "preferred",
            modelTier: MobileModelTier.opus.rawValue
        )
        let chosen = try #require(
            try JSONSerialization.jsonObject(with: JSONEncoder().encode(decided)) as? [String: Any]
        )
        #expect(chosen["providerId"] as? String == "preferred")
        #expect(chosen["modelTier"] as? String == "opus")
        #expect(chosen["cols"] == nil)
    }
}

/// What the phone remembers between visits, and what it refuses to remember.
///
/// Main-actor isolated like the store itself, which is what lets the panel read it
/// straight from a view.
@MainActor
struct AgentConversationPreferencesTests {
    /// A fresh install: nothing to preselect, so the panel falls back to the
    /// computer's own answer rather than to a value this phone invented.
    @Test func startsWithNothingRemembered() {
        let preferences = AgentConversationPreferences(defaults: scratchDefaults())
        #expect(preferences.projectId == nil)
        #expect(preferences.providerId == nil)
        #expect(preferences.modelTier == nil)
    }

    @Test func remembersWhatWasActuallyUsed() {
        let defaults = scratchDefaults()
        let preferences = AgentConversationPreferences(defaults: defaults)

        preferences.remember(projectId: "project-1", providerId: "preferred", modelTier: .opus)

        // Read back from a second instance, because surviving the launch is the point.
        let reopened = AgentConversationPreferences(defaults: defaults)
        #expect(reopened.projectId == "project-1")
        #expect(reopened.providerId == "preferred")
        #expect(reopened.modelTier == .opus)
    }

    /// "Let the computer decide" has to be expressible, or a choice made once could
    /// never be undone. A Provider without its tier names no model, so half a pair is
    /// cleared rather than half-kept.
    @Test func clearsThePairTogetherWhenTheChoiceIsGivenUp() {
        let defaults = scratchDefaults()
        let preferences = AgentConversationPreferences(defaults: defaults)
        preferences.remember(projectId: "project-1", providerId: "preferred", modelTier: .opus)

        preferences.remember(projectId: "project-1", providerId: nil, modelTier: nil)

        #expect(preferences.projectId == "project-1")
        #expect(preferences.providerId == nil)
        #expect(preferences.modelTier == nil)
        let reopened = AgentConversationPreferences(defaults: defaults)
        #expect(reopened.providerId == nil)
        #expect(reopened.modelTier == nil)
    }

    /// A project the user removed on the computer cannot be started in, so keeping it
    /// would leave the panel preselecting something that will be refused.
    @Test func forgetsAProjectTheComputerNoLongerOffers() {
        let preferences = AgentConversationPreferences(defaults: scratchDefaults())
        preferences.remember(projectId: "project-1", providerId: nil, modelTier: nil)

        preferences.prune(keepingProjectIds: ["project-2"])

        #expect(preferences.projectId == nil)
    }

    @Test func keepsAProjectThatIsStillThere() {
        let preferences = AgentConversationPreferences(defaults: scratchDefaults())
        preferences.remember(projectId: "project-1", providerId: nil, modelTier: nil)

        preferences.prune(keepingProjectIds: ["project-1", "project-2"])

        #expect(preferences.projectId == "project-1")
    }

    /// Each test gets its own suite: `UserDefaults.standard` is shared with the rest
    /// of the app and with whatever the previous case left behind.
    private func scratchDefaults() -> UserDefaults {
        let name = "SynapseMobileTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }
}

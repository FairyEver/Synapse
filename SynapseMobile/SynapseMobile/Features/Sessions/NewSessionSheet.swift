import SwiftUI

/// What the `＋` is going to create.
///
/// This switches what will be *made*, not what is being looked at — a Claude Code
/// conversation lands in the terminal list beside everything else. The two segments
/// offer different things because that is what they are: a conversation has defaults
/// worth not deciding, and a terminal group has none worth inventing.
///
/// The labels name where each one puts what it makes: a conversation goes into a
/// project, a terminal goes into a terminal group.
private enum NewSessionSegment: String, CaseIterable, Identifiable {
    case conversation
    case terminal

    var id: String { rawValue }

    var label: String {
        switch self {
        case .conversation: return "项目"
        case .terminal: return "终端分组"
        }
    }
}

/// The rows in the conversation segment that open a list of their own.
private enum AgentRowRoute: Hashable {
    case project
    case provider
    case model
}

/// Creating a terminal, running a saved command, or starting a Claude Code conversation.
///
/// A saved command is delivered by creating a terminal and typing into it, and a
/// conversation *is* a terminal with a command — so all three end the same way: a
/// session the caller navigates to.
struct NewSessionSheet: View {
    @Environment(SynapseAppModel.self) private var model
    @Environment(AgentConversationPreferences.self) private var preferences
    @Environment(\.dismiss) private var dismiss

    /// A terminal was created in this group. The sheet is already gone by the time it runs.
    let onCreated: (String) -> Void
    /// A Claude Code conversation came up on the computer, with this session id.
    let onConversationStarted: (String) -> Void

    @State private var segment: NewSessionSegment = .conversation
    @State private var path: [AgentRowRoute] = []
    /// Seeded from what the phone remembers, then replaced by whatever the reader picks.
    @State private var choice = AgentConversationChoice.none
    @State private var seeded = false
    /// Why the last attempt did not start anything. Cleared by the next one.
    @State private var failure: String?
    @State private var starting = false
    @State private var projectSearch = ""
    @State private var providerSearch = ""

    private var selection: AgentConversationSelection {
        resolveAgentConversationSelection(
            groups: model.summary?.agentGroups ?? [],
            providers: model.summary?.agentProviders ?? [],
            remembered: choice
        )
    }

    /// The computer can be asked only if it told us what it offers.
    ///
    /// Absent means it predates these intents, which is a different statement from an
    /// empty list, and the panel says so rather than offering a button that cannot work.
    private var conversationAvailable: Bool {
        model.summary?.agentGroups != nil && model.summary?.agentProviders != nil
    }

    var body: some View {
        NavigationStack(path: $path) {
            VStack(spacing: 0) {
                Picker("新建", selection: $segment) {
                    ForEach(NewSessionSegment.allCases) { segment in
                        Text(segment.label).tag(segment)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.horizontal, 16)
                .padding(.bottom, 6)
                .accessibilityIdentifier("new-session-segment")

                List {
                    switch segment {
                    case .conversation: conversationRows
                    case .terminal: terminalRows
                    }
                }
                .listStyle(.insetGrouped)
            }
            .navigationTitle("新建")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: AgentRowRoute.self) { route in
                switch route {
                case .project: projectPicker
                case .provider: providerPicker
                case .model: modelPicker
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                }
            }
        }
        .presentationDetents([.fraction(0.75), .large])
        .presentationDragIndicator(.visible)
        .onAppear {
            // Once: the reader's own picks must not be overwritten by a summary that
            // arrives while the panel is open.
            guard !seeded else { return }
            seeded = true
            choice = AgentConversationChoice(
                projectId: preferences.projectId,
                providerId: preferences.providerId,
                modelTier: preferences.modelTier
            )
        }
    }

    // MARK: - Conversation

    @ViewBuilder
    private var conversationRows: some View {
        if !conversationAvailable {
            Section {
                Text("电脑端版本太旧，请在电脑上升级 Synapse。")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        } else {
            if let failure {
                Section {
                    // Here rather than in the app-wide notice bar: this is about the
                    // three rows directly underneath it, and the reader has to be able
                    // to read both at once to decide what to change.
                    Text(failure)
                        .font(.footnote)
                        .foregroundStyle(Theme.failure)
                }
            }

            Section {
                agentRow(
                    title: "项目",
                    value: selection.project?.name,
                    badge: selection.projectIsRemembered ? "上次" : nil,
                    route: .project
                )
                .accessibilityIdentifier("new-session-project")
                // No badge here, unlike the project: a Provider the reader chose and one
                // the computer would have chosen lead to the same launch, so marking
                // the difference would be a label that changes nothing.
                agentRow(
                    title: "供应商",
                    value: selection.provider?.name,
                    badge: nil,
                    route: .provider
                )
                .accessibilityIdentifier("new-session-provider")
                agentRow(
                    title: "模型",
                    value: modelLabel,
                    badge: nil,
                    route: .model
                )
                .accessibilityIdentifier("new-session-model")
            }

            Section {
                Button {
                    Task { await start() }
                } label: {
                    Group {
                        if starting {
                            ProgressView()
                        } else {
                            Text("开始对话").font(.callout.weight(.semibold))
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                }
                // Ink fill, paper label — the same pair the sign-in button uses, and for
                // the same reason. `.borderedProminent` with `Color.primary` as the tint
                // does not pair them: it painted the fill with the ink and then drew the
                // label in white as well, so in dark appearance this was a blank white
                // pill with nothing written on it.
                //
                // `.circular`, not `.continuous`: the continuous corner is drawn larger
                // than the radius it is given — at 12 pt the curve only meets the flat
                // edge about 15 pt in, which on a bar this short (46 pt) leaves under
                // 10 pt of straight edge on each end. The two ends then read as a pill
                // whose top and bottom have been sliced flat. The prototype's
                // `border-radius: 11px` is an ordinary corner, and this is that.
                .background(
                    Theme.ink.opacity(canStart ? 1 : Theme.disabledInkOpacity),
                    in: RoundedRectangle(cornerRadius: 12, style: .circular)
                )
                .foregroundStyle(Theme.paper)
                .disabled(!canStart)
                .listRowInsets(EdgeInsets())
                .listRowBackground(Color.clear)
                .accessibilityIdentifier("start-conversation")
            }
        }
    }

    /// One place for the two reasons the button cannot be pressed — a request already
    /// in flight, and nothing chosen yet — so the fill and the `disabled` state cannot
    /// disagree about which one it is.
    private var canStart: Bool { !starting && selection.canStart }

    /// The model row shows the resolved model name, not the tier's label: "Opus" alone
    /// does not say which model, and two Providers offering "Opus" may name different ones.
    private var modelLabel: String? {
        guard let provider = selection.provider, let tier = selection.modelTier else { return nil }
        return provider.modelName(for: tier) ?? tier.label
    }

    private func agentRow(
        title: String,
        value: String?,
        badge: String?,
        route: AgentRowRoute
    ) -> some View {
        Button {
            path.append(route)
        } label: {
            HStack {
                Text(title)
                    .foregroundStyle(.primary)
                Spacer(minLength: 8)
                if let badge {
                    Text(badge)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Color(uiColor: .secondarySystemFill), in: Capsule())
                }
                Text(value ?? "未选择")
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
    }

    private func start() async {
        guard let project = selection.project, !starting else { return }
        starting = true
        failure = nil

        // Only a choice the reader made is sent. Left to the computer, the Provider and
        // tier are resolved there with the same rules its own shortcut uses — the one
        // answer, rather than the phone's guess at it.
        let providerId = selection.providerIsChosen ? selection.provider?.id : nil
        let modelTier = selection.providerIsChosen ? selection.modelTier : nil

        let outcome = await model.createAgentConversation(
            projectId: project.projectId,
            providerId: providerId,
            modelTier: modelTier,
            cols: nil,
            rows: nil,
            deviceLabel: nil
        )
        starting = false

        switch outcome {
        case .created(let sessionId):
            // Both halves of this are invisible from inside the sheet: the request can
            // spend the full timeout before answering, and the sheet is where the user
            // is looking either way.
            Haptics.success()
            dismiss()
            onConversationStarted(sessionId)
        case .failed(let message):
            // The sheet stays up and the three rows keep what they show: the reader's
            // choices are the expensive part, and the reason is the thing they need in
            // order to change one of them.
            //
            // The reason lands inline rather than in the notice bar, so nothing else
            // is going to feel it (see `Haptics`).
            Haptics.failure()
            failure = message
        }
    }

    // MARK: - Terminal

    /// Unchanged on purpose. A terminal group has no default worth guessing, so tapping
    /// one creating a terminal immediately is the whole interaction — a confirm button
    /// here would be friction with nothing behind it. The two segments differing is a
    /// decision, not an oversight.
    @ViewBuilder
    private var terminalRows: some View {
        Section {
            ForEach(model.summary?.groups ?? []) { group in
                Button {
                    // This row has no confirm button behind it (see the comment above),
                    // so the tap is the whole decision and is worth the weight of one.
                    Haptics.commit()
                    dismiss()
                    onCreated(group.id)
                } label: {
                    Text(group.name)
                        .font(.subheadline)
                }
            }
        }
        if (model.summary?.groups ?? []).isEmpty {
            // 留在列表里而不是铺满整屏：这一屏还有项目、供应商、模型三段选择器，铺满
            // 会把它们全盖掉。这个分组只是这一张表单里少了一段。
            ContentUnavailableView(
                "电脑上还没有分组",
                systemImage: "folder",
                description: Text("请先在电脑端创建。")
            )
            .listRowBackground(Color.clear)
        }
    }

    // MARK: - Pickers

    private var projectPicker: some View {
        List {
            ForEach(matchingProjects) { group in
                pickerRow(
                    title: group.name,
                    detail: nil,
                    selected: group.projectId == selection.project?.projectId
                ) {
                    choice.projectId = group.projectId
                    // The reason belongs to the attempt that failed. Leaving it up
                    // under a changed row would describe a request nobody is about to
                    // make.
                    failure = nil
                    path.removeAll()
                }
            }
            if !projectSearchQuery.isEmpty, matchingProjects.isEmpty {
                ContentUnavailableView.search(text: projectSearchQuery)
                    .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        // 这一个和下面那个供应商是这台电脑列得最长的两张表（项目随电脑端的仓库数长，
        // 供应商随配了几个 Provider 长），所以有搜索。模型那一页只有四个固定档位，
        // 给它一个搜索框是多余的东西。
        .searchable(text: $projectSearch, prompt: "搜索项目")
        .navigationTitle("项目")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var projectSearchQuery: String {
        projectSearch.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var matchingProjects: [MobileSummaryAgentGroup] {
        let all = model.summary?.agentGroups ?? []
        guard !projectSearchQuery.isEmpty else { return all }
        return all.filter { $0.name.localizedCaseInsensitiveContains(projectSearchQuery) }
    }

    private var providerPicker: some View {
        List {
            ForEach(matchingProviders) { provider in
                pickerRow(
                    title: provider.name,
                    detail: provider.modelName(for: provider.defaultTier),
                    selected: provider.id == selection.provider?.id
                ) {
                    choice.providerId = provider.id
                    // The tier belonged to the Provider being left. Clearing it lets the
                    // new Provider name its own, which it already told us.
                    choice.modelTier = nil
                    failure = nil
                    path.removeAll()
                }
            }
            if !providerSearchQuery.isEmpty, matchingProviders.isEmpty {
                ContentUnavailableView.search(text: providerSearchQuery)
                    .listRowBackground(Color.clear)
            }
        }
        .listStyle(.insetGrouped)
        .searchable(text: $providerSearch, prompt: "搜索供应商")
        .navigationTitle("供应商")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var providerSearchQuery: String {
        providerSearch.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// 名称和模型名都算命中：列表行上写着的就是这两样，读者看得见什么就搜得到什么。
    private var matchingProviders: [MobileSummaryAgentProvider] {
        let all = model.summary?.agentProviders ?? []
        guard !providerSearchQuery.isEmpty else { return all }
        return all.filter { provider in
            provider.name.localizedCaseInsensitiveContains(providerSearchQuery)
                || (provider.modelName(for: provider.defaultTier)?
                        .localizedCaseInsensitiveContains(providerSearchQuery) ?? false)
        }
    }

    private var modelPicker: some View {
        List {
            Section(selection.provider?.name ?? "模型") {
                ForEach(selection.provider?.selectableTiers ?? [], id: \.self) { tier in
                    pickerRow(
                        title: tier.label,
                        detail: selection.provider?.modelName(for: tier),
                        selected: tier == selection.modelTier
                    ) {
                        choice.providerId = selection.provider?.id
                        choice.modelTier = tier
                        failure = nil
                        path.removeAll()
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("模型")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func pickerRow(
        title: String,
        detail: String?,
        selected: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .foregroundStyle(.primary)
                    if let detail {
                        Text(detail)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 8)
                if selected {
                    Image(systemName: "checkmark")
                        .foregroundStyle(Theme.ink)
                }
            }
        }
    }
}

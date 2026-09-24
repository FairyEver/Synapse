import SwiftUI
import WidgetKit

struct TerminalWidgetEntry: TimelineEntry {
    let date: Date
    let snapshot: TerminalWidgetSnapshot?
    let configuration: TerminalWidgetConfiguration
    let isStale: Bool
}

struct TerminalWidgetProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> TerminalWidgetEntry {
        TerminalWidgetEntry(date: .now, snapshot: nil, configuration: TerminalWidgetConfiguration(), isStale: true)
    }

    func snapshot(for configuration: TerminalWidgetConfiguration, in context: Context) async -> TerminalWidgetEntry {
        entry(for: configuration, at: .now)
    }

    func timeline(for configuration: TerminalWidgetConfiguration, in context: Context) async -> Timeline<TerminalWidgetEntry> {
        let now = Date()
        let current = entry(for: configuration, at: now)
        guard let capturedAt = current.snapshot?.capturedAt, !current.isStale else {
            return Timeline(entries: [current], policy: .after(now.addingTimeInterval(TerminalWidgetShared.staleInterval)))
        }
        let staleAt = capturedAt.addingTimeInterval(TerminalWidgetShared.staleInterval)
        let expired = TerminalWidgetEntry(date: staleAt, snapshot: current.snapshot, configuration: configuration, isStale: true)
        return Timeline(entries: [current, expired], policy: .after(staleAt))
    }

    private func entry(for configuration: TerminalWidgetConfiguration, at date: Date) -> TerminalWidgetEntry {
        let snapshot = TerminalWidgetShared.load()
        let stale = snapshot.map { date.timeIntervalSince($0.capturedAt) >= TerminalWidgetShared.staleInterval } ?? true
        return TerminalWidgetEntry(date: date, snapshot: snapshot, configuration: configuration, isStale: stale)
    }
}

struct TerminalHomeWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(
            kind: TerminalWidgetShared.widgetKind,
            intent: TerminalWidgetConfiguration.self,
            provider: TerminalWidgetProvider()
        ) { entry in
            TerminalWidgetView(entry: entry)
        }
        .configurationDisplayName("终端")
        .description("查看待处理会话、固定终端或整机概览")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

private struct TerminalWidgetView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.widgetRenderingMode) private var renderingMode
    let entry: TerminalWidgetEntry

    var body: some View {
        Group {
            if entry.isStale {
                unavailable("状态待更新")
            } else if let snapshot = entry.snapshot, !snapshot.isOnline {
                unavailable("电脑不在线")
            } else if let snapshot = entry.snapshot, snapshot.sessions.isEmpty {
                unavailable("没有正在运行的会话")
            } else if let snapshot = entry.snapshot {
                switch family {
                case .systemSmall: small(snapshot)
                case .systemMedium: medium(snapshot)
                case .systemLarge: large(snapshot)
                default: unavailable("打开终端")
                }
            } else {
                unavailable("打开终端")
            }
        }
        .containerBackground(for: .widget) {
            Color(uiColor: .secondarySystemGroupedBackground)
        }
    }

    private func unavailable(_ title: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title).font(.headline)
            if let snapshot = entry.snapshot {
                Text(snapshot.desktopName).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 0)
                Text(snapshot.capturedAt, style: .time).font(.caption2).foregroundStyle(.secondary)
            } else {
                Spacer(minLength: 0)
            }
        }
        .widgetURL(TerminalWidgetLink.url(desktopId: entry.snapshot?.desktopId, sessionId: nil))
    }

    private func small(_ snapshot: TerminalWidgetSnapshot) -> some View {
        let waiting = snapshot.sessions.first(where: \.needsAttention)
        return VStack(alignment: .leading, spacing: 6) {
            if let waiting {
                status(waiting.attentionKind == "approval" ? "等待确认" : "等待输入", needsAttention: true)
                Spacer(minLength: 0)
                Text(waiting.title).font(.headline).lineLimit(2)
            } else {
                Text("无需处理").font(.headline)
                Spacer(minLength: 0)
                Text("\(snapshot.sessions.filter(\.isRunning).count) 个运行中")
                    .font(.subheadline)
            }
            HStack(spacing: 4) {
                Text(snapshot.desktopName).lineLimit(1)
                Spacer(minLength: 2)
                Text(snapshot.capturedAt, style: .time)
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
        .widgetURL(TerminalWidgetLink.url(desktopId: snapshot.desktopId, sessionId: waiting?.id))
    }

    private func medium(_ snapshot: TerminalWidgetSnapshot) -> some View {
        let session = snapshot.session(for: entry.configuration.session)
            ?? (entry.configuration.session == nil ? snapshot.sessions.first : nil)
        return VStack(alignment: .leading, spacing: 6) {
            if let session {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(session.title).font(.headline).lineLimit(1)
                    Spacer(minLength: 0)
                    status(session.needsAttention ? "等待处理" : statusTitle(session.status), needsAttention: session.needsAttention)
                }
                Text(session.cwd).font(.caption2.monospaced()).foregroundStyle(.secondary).lineLimit(1)
                Spacer(minLength: 0)
                if entry.configuration.showsLastLine, !session.lastLine.isEmpty {
                    Text("最近输出").font(.caption2).foregroundStyle(.secondary)
                    Text(session.lastLine).font(.caption.monospaced()).lineLimit(1)
                }
                HStack {
                    Text(snapshot.capturedAt, style: .time)
                    Spacer()
                    Text("打开会话")
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            } else {
                Text("会话不可用").font(.headline)
                Spacer(minLength: 0)
                Text(snapshot.desktopName).font(.caption).foregroundStyle(.secondary)
            }
        }
        .widgetURL(TerminalWidgetLink.url(desktopId: snapshot.desktopId, sessionId: session?.id))
    }

    private func large(_ snapshot: TerminalWidgetSnapshot) -> some View {
        let waiting = snapshot.sessions.filter(\.needsAttention)
        let running = snapshot.sessions.filter { $0.isRunning && !$0.needsAttention }
        let others = snapshot.sessions.filter { !$0.isRunning && !$0.needsAttention }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(waiting.isEmpty ? "无需处理" : "\(waiting.count) 条需要处理").font(.headline)
                    Text(snapshot.desktopName).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 0)
                status("在线", needsAttention: false)
            }
            if !waiting.isEmpty { group("等待处理", sessions: waiting, limit: 1, snapshot: snapshot) }
            if !running.isEmpty { group("运行中", sessions: running, limit: waiting.isEmpty ? 3 : 2, snapshot: snapshot) }
            if !others.isEmpty { group("已结束 / 异常", sessions: others, limit: 1, snapshot: snapshot) }
            Spacer(minLength: 0)
            HStack {
                Text(snapshot.capturedAt, style: .time)
                Spacer()
                Text("查看全部")
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
        .widgetURL(TerminalWidgetLink.url(desktopId: snapshot.desktopId, sessionId: nil))
    }

    private func group(_ title: String, sessions: [TerminalWidgetSession], limit: Int, snapshot: TerminalWidgetSnapshot) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text(title).font(.caption2.weight(.semibold)).foregroundStyle(.secondary)
                Spacer(minLength: 0)
                Text("\(sessions.count)").font(.caption2).foregroundStyle(.secondary)
            }
            ForEach(sessions.prefix(limit)) { session in
                if let url = TerminalWidgetLink.url(desktopId: snapshot.desktopId, sessionId: session.id) {
                    Link(destination: url) {
                        HStack(spacing: 6) {
                            Text(session.title).lineLimit(1)
                            Spacer(minLength: 4)
                            Text(session.cwd).foregroundStyle(.secondary).lineLimit(1)
                        }
                        .font(.caption)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func status(_ title: String, needsAttention: Bool) -> some View {
        HStack(spacing: 5) {
            Circle()
                .fill(renderingMode == .fullColor ? (needsAttention ? Color.orange : Color.green) : Color.primary)
                .frame(width: 7, height: 7)
            Text(title)
        }
        .font(.caption2.weight(.semibold))
        .foregroundStyle(.primary)
    }

    private func statusTitle(_ status: String) -> String {
        switch status {
        case "running": "运行中"
        case "stopping": "停止中"
        case "ended": "已结束"
        case "failed": "失败"
        case "lost": "已失联"
        default: "状态待更新"
        }
    }
}

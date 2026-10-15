import Foundation

/// 「复制正文」在手机上复制哪一段。
///
/// 与桌面同一条标准：取**详情页显示的那一份**，不是原始 `body`。云盘互动那条通知在详情页上
/// 摊开成三段（评论原文 / 回复对象 / 本次内容），照 `body` 复制给出去的是摘要，和用户读到的
/// 不是同一段话。
enum NotificationDetailText {
    static func value(for item: SynapseNotification) -> String {
        guard item.source == "drive-discussion", let snapshot = item.driveDiscussion?.snapshot else {
            return item.body
        }
        var sections: [String] = []
        if let original = snapshot.original {
            sections.append("\(original.kind == "image" ? "评论图片" : "评论原文")\n\(original.text)")
        }
        if let reply = snapshot.replyTo {
            sections.append("回复对象 · \(reply.authorName)\n\(reply.content.isEmpty ? "无文本内容" : reply.content)")
        }
        sections.append("\(NotificationText.discussionContentLabel(item))\n\(snapshot.content.isEmpty ? "无文本内容" : snapshot.content)")
        return sections.joined(separator: "\n\n")
    }
}

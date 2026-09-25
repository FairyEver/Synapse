import SwiftUI
import UIKit

/// 云盘里一样东西的图标。
///
/// 文件夹是一枚系统蓝的实心文件夹；文件是「一页纸 + 折叠角 + 扩展名角标」，底色取
/// `DriveText.kindColor`（Spec §4.3 那张表）。
///
/// 角标是这个图标存在的理由：`kindColor` 只能分出十来类，`.zip` 与 `.gz`、`.md` 与 `.txt`
/// 在颜色上是一样的，而名字上那一行字是**后缀**——真正区分它们的那几个字母要写在图标上，
/// 一眼扫过去才不用逐个读名字。
struct DriveFileIcon: View {
    /// 这一项的名字。种类与角标都从扩展名判，所以这里要的是名字而不是种类。
    let name: String
    let isFolder: Bool
    /// 图标本体的字号。列表行是 29pt（Spec §4.3）。
    var size: CGFloat = 29

    /// 图标的方框：比字号大一圈，行与行之间那两枚图标才会对齐在与文字同一条竖线上。
    private var box: CGFloat { size * 1.18 }

    var body: some View {
        content
            // 图标是行的一部分：名字由同一行的 `Text` 读出去，角标那几个大写字母再单独念
            // 一遍只是噪声。
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var content: some View {
        if isFolder {
            Image(systemName: "folder.fill")
                .font(.system(size: size))
                .foregroundStyle(Color(uiColor: .systemBlue))
                .frame(width: box, height: box)
        } else {
            page
        }
    }

    /// 一页纸，右下角压着扩展名。
    ///
    /// 没有扩展名时角标是空串（`DriveText.badge(of:)` 的契约），就让它空着——系统「文件」
    /// App 里那枚通用文档图标也不写扩展名，填一个假的「FILE」是凭空多一样东西。
    private var page: some View {
        ZStack(alignment: .bottom) {
            Image(systemName: "doc.fill")
                .font(.system(size: size))
                .foregroundStyle(DriveText.kindColor(DriveText.kind(of: name)))
            if !badge.isEmpty {
                Text(badge)
                    .font(.system(size: size * 0.3, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .frame(width: box * 0.72)
                    .padding(.bottom, size * 0.12)
            }
        }
        .frame(width: box, height: box)
    }

    private var badge: String { DriveText.badge(of: name) }
}

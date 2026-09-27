import SwiftUI
import UIKit

/// 云盘里一样东西的图标。
///
/// 形状照系统「文件」App 里那枚通用文档图标：**一页纸、右上角折起来**，纸上压着这一类的
/// 字形与扩展名。文件夹不受影响，还是一枚系统蓝的实心文件夹。
///
/// **纸是浅灰（`systemGray6`）不是白。** 这一屏的底是容器的白（深色下黑），白纸落在白底上
/// 会没有边；系统「文件」App 里也是这么摆的 —— 白底、比底深一档的纸。颜色只上在字形上
/// （`DriveText.kindColor`）。
///
/// 角标那几个字母是这个图标存在的理由：`kindColor` 与字形都只能分出十来类，`.zip` 与 `.gz`、
/// `.md` 与 `.txt` 在它们眼里是一样的，而名字上那一行字是**后缀**——真正区分它们的那几个字母
/// 要写在图标上，一眼扫过去才不用逐个读名字。
struct DriveFileIcon: View {
    /// 这一项的名字。种类、字形与角标都从扩展名判，所以这里要的是名字而不是种类。
    let name: String
    let isFolder: Bool
    /// 图标本体的字号。列表行是 29pt（Spec §4.3），网格里这一格只有图标与几行字，图标更大。
    var size: CGFloat = 29

    /// 图标的方框：比字号大一圈，行与行之间那两枚图标才会对齐在与文字同一条竖线上。
    private var box: CGFloat { size * 1.18 }
    /// 那一页纸。高占方框的九成六，宽高比照系统那枚通用文档图标。
    private var pageHeight: CGFloat { box * 0.96 }
    private var pageWidth: CGFloat { pageHeight * 0.76 }
    /// 折角那一块。跟着纸宽走，纸放大时折角不会变成一片小三角。
    private var fold: CGFloat { pageWidth * 0.30 }
    /// 纸上那枚字形：中心落在纸高这一点上，字号占纸高的三成。
    ///
    /// **三成 + `.light` 是一起调的，缺一个都不够。** 这些符号默认的笔画比系统文档图标里那枚
    /// 粗一档，而且 `</>`、`tablecells` 这类是「填满方框」的形状（系统那枚通用文档图标里的字形
    /// 四周留白多），所以同一个字号下看着就是更大更重。原先按四成、默认粗细画，真机上是一屏
    /// 又大又厚的图标。
    private var glyphSize: CGFloat { pageHeight * 0.30 }
    private var glyphCenterY: CGFloat { pageHeight * 0.46 }
    /// 角标那几个字母：中心落在纸高的七成八，字号占纸高的一成一。
    ///
    /// **比字形小得多是刻意的**：它是一行小字，不是第二个标题。原先按两成一画，真机上比系统
    /// 「文件」App 那行字大了一倍多（那边占纸高约零点五成），一整屏全是加粗大写字母，很吵。
    /// 下到 6.5pt 就不再缩了——再小只是一团灰，不是字。
    private var badgeSize: CGFloat { max(6.5, pageHeight * 0.11) }
    private var badgeCenterY: CGFloat { pageHeight * 0.78 }

    /// 这一类的字形。`unknown` 没有字形，纸上就只留扩展名那行字。
    private var glyph: String? { DriveText.glyph(of: DriveText.kind(of: name)) }
    private var tint: Color { DriveText.kindColor(DriveText.kind(of: name)) }
    private var badge: String { DriveText.badge(of: name) }

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

    /// 一页纸：折角、字形、扩展名。
    ///
    /// 字形与扩展名的位置照系统那枚图标量出来的比例摆：字形中心在纸高的四成六、扩展名在七成八。
    ///
    /// 两样各自 `position`，不叠成一个 `VStack`：那样两行的高度会互相牵动，字形变小时扩展名
    /// 跟着往上跑。两个中心点钉死了，改哪一样都不会动到另一样。
    ///
    /// 纸比方框窄，所以整页居中摆在方框里 —— 与文件夹那枚方框同宽，两者在同一行里才对得齐。
    private var page: some View {
        ZStack {
            DriveFilePageShape(fold: fold)
                .fill(Color(uiColor: .systemGray6))
            // 折起来的那一小块比纸深一档：不画它的话切掉的那个角只是一道直线，看不出是折角。
            DriveFileFoldShape(fold: fold)
                .fill(Color(uiColor: .systemGray5))
            if let glyph {
                Image(systemName: glyph)
                    // `.light` 是这个图标「精致」的那一半：这些符号默认的笔画比系统文档图标
                    // 里那枚粗一档，缩到同一个大小之后仍然显得重。
                    .font(.system(size: glyphSize, weight: .light))
                    .foregroundStyle(tint)
                    .position(x: pageWidth / 2, y: glyphCenterY)
            }
            if !badge.isEmpty {
                Text(badge)
                    .font(.system(size: badgeSize, weight: .medium))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    // 「MARK」这类四个字母的在后三位数那一档上正好抵到纸边，缩一点比换行好。
                    .minimumScaleFactor(0.7)
                    .frame(width: pageWidth * 0.86)
                    .position(x: pageWidth / 2, y: badgeCenterY)
            }
        }
        .frame(width: pageWidth, height: pageHeight)
        .frame(width: box, height: box)
    }
}

// MARK: - 那一页纸的形状

/// 一页纸：矩形的右上角切掉一块。其余三个角是有圆角的。
private struct DriveFilePageShape: Shape {
    let fold: CGFloat

    func path(in rect: CGRect) -> Path {
        // 圆角比系统那枚再收一点：那边画在 77pt 高的纸上，圆角约占纸高的百分之四点五。
        let radius = min(rect.width, rect.height) * 0.075
        // 折角不能大过纸：极小的图标上那 36% 还是画得出来的，但算式上不能让它越过中线。
        let cut = min(fold, min(rect.width, rect.height) * 0.5)
        var path = Path()

        path.move(to: CGPoint(x: rect.minX + radius, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - cut, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + cut))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - radius))
        path.addArc(
            center: CGPoint(x: rect.maxX - radius, y: rect.maxY - radius),
            radius: radius,
            startAngle: .degrees(0),
            endAngle: .degrees(90),
            clockwise: false
        )
        path.addLine(to: CGPoint(x: rect.minX + radius, y: rect.maxY))
        path.addArc(
            center: CGPoint(x: rect.minX + radius, y: rect.maxY - radius),
            radius: radius,
            startAngle: .degrees(90),
            endAngle: .degrees(180),
            clockwise: false
        )
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + radius))
        path.addArc(
            center: CGPoint(x: rect.minX + radius, y: rect.minY + radius),
            radius: radius,
            startAngle: .degrees(180),
            endAngle: .degrees(270),
            clockwise: false
        )
        path.closeSubpath()
        return path
    }
}

/// 折起来的那一块：斜边就是纸上切掉的那条对角线，直角那个顶点落在纸里面。
private struct DriveFileFoldShape: Shape {
    let fold: CGFloat

    func path(in rect: CGRect) -> Path {
        let cut = min(fold, min(rect.width, rect.height) * 0.5)
        var path = Path()

        path.move(to: CGPoint(x: rect.maxX - cut, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY + cut))
        path.addLine(to: CGPoint(x: rect.maxX - cut, y: rect.minY + cut))
        path.closeSubpath()
        return path
    }
}

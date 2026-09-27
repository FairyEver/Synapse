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
    private var fold: CGFloat { pageWidth * 0.36 }
    /// 角标那几个字母。**下到 7pt 就不再缩**：再小只是一团灰，不是字 —— 列表行的图标比网格
    /// 小一半，按比例算出来只有 4pt 出头。
    private var badgeSize: CGFloat { max(7, pageHeight * 0.21) }

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
    /// 字形与扩展名的位置照系统那枚图标量出来的比例摆（那边字形重心在纸高的四成七、扩展名在
    /// 八成；上下两档留白摆出来是四成四与八成二，差的那一点是行高，看不出来）。纸比方框窄，
    /// 所以整页居中摆在方框里 —— 与文件夹那枚方框同宽，两者在同一行里才对得齐。
    private var page: some View {
        ZStack {
            DriveFilePageShape(fold: fold)
                .fill(Color(uiColor: .systemGray6))
            // 折起来的那一小块比纸深一档：不画它的话切掉的那个角只是一道直线，看不出是折角。
            DriveFileFoldShape(fold: fold)
                .fill(Color(uiColor: .systemGray5))
            VStack(spacing: 0) {
                if let glyph {
                    Image(systemName: glyph)
                        .font(.system(size: pageHeight * 0.40))
                        .foregroundStyle(tint)
                }
                if !badge.isEmpty {
                    Text(badge)
                        .font(.system(size: badgeSize, weight: .semibold))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                        // 「HTML」在最小的那两档上正好抵到纸边，缩一点比换行好。
                        .minimumScaleFactor(0.7)
                        .frame(width: pageWidth * 0.82)
                        .padding(.top, pageHeight * 0.02)
                }
            }
            .padding(.top, pageHeight * 0.20)
            .padding(.bottom, pageHeight * 0.10)
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
        let radius = min(rect.width, rect.height) * 0.12
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

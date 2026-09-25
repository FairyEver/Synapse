import Foundation
import SwiftUI
import Testing
import UIKit
@testable import SynapseMobile

/// 云盘里那些「看起来只是格式化」的东西。
///
/// 它们全是用户判断信息的依据：这个文件多大、什么时候改的、是什么东西、为什么失败了。
/// 算错了不会崩，只会让人读错，所以边界要一个一个钉住——尤其 `bytes` 那几条，原型
/// 在这里踩过坑。
struct DriveTextTests {
    private let calendar = Calendar.current

    private func wire(_ date: Date) -> String {
        ISO8601DateFormatter.wire.string(from: date)
    }

    // MARK: - 字节

    @Test func bytesStaysDecimalBelowOneUnit() {
        #expect(DriveText.bytes("0") == "0 字节")
        #expect(DriveText.bytes("999") == "999 字节")
    }

    @Test func bytesSwitchesToKilobytesAtOneThousand() {
        // 1000 进制，不是 1024：系统存储面板里同一个文件就是这么写的。
        #expect(DriveText.bytes("1000") == "1 KB")
        #expect(DriveText.bytes("10000") == "10 KB")
    }

    @Test func bytesKeepsTwoDecimalsForSmallValues() {
        #expect(DriveText.bytes("1048576") == "1.05 MB")
        #expect(DriveText.bytes("1500000000") == "1.5 GB")
    }

    @Test func bytesDropsDecimalsForThreeDigitsWithoutEatingDigits() {
        // 这两条是原型里踩过的那一脚：三位数取整之后不能无条件剥尾零，否则 220 会
        // 变成 22、100 会变成 1。
        #expect(DriveText.bytes("220200960") == "220 MB")
        #expect(DriveText.bytes("134217728") == "134 MB")
    }

    @Test func bytesTreatsUnreadableSizesAsZero() {
        // 读不出来宁可显示 0 字节，也不该让整行空着或者崩掉。
        #expect(DriveText.bytes("") == "0 字节")
        #expect(DriveText.bytes("unknown") == "0 字节")
        #expect(DriveText.bytes("-5") == "0 字节")
    }

    // MARK: - 时间

    @Test func dateNamesTodayYesterdayAndTheDayBefore() throws {
        // 取今天 09:05 这个具体时刻，往前推一天、两天，这样断言不依赖跑测试的钟点。
        let today = try #require(calendar.date(bySettingHour: 9, minute: 5, second: 0, of: Date()))
        let yesterday = try #require(calendar.date(byAdding: .day, value: -1, to: today))
        let dayBefore = try #require(calendar.date(byAdding: .day, value: -2, to: today))

        #expect(DriveText.date(wire(today)) == "今天 09:05")
        #expect(DriveText.date(wire(yesterday)) == "昨天 09:05")
        #expect(DriveText.date(wire(dayBefore)) == "前天 09:05")
    }

    @Test func dateDropsTheYearWithinTheSameYear() throws {
        let now = Date()
        let year = calendar.component(.year, from: now)
        // 往前十天或往后十天，总有一个还在今年（年初与年末各有一个会跨年）。
        var date = try #require(calendar.date(byAdding: .day, value: 10, to: now))
        if calendar.component(.year, from: date) != year {
            date = try #require(calendar.date(byAdding: .day, value: -10, to: now))
        }
        let parts = calendar.dateComponents([.month, .day], from: date)
        let month = try #require(parts.month)
        let day = try #require(parts.day)

        #expect(calendar.component(.year, from: date) == year)
        #expect(DriveText.date(wire(date)) == "\(month)月\(day)日")
    }

    @Test func dateKeepsTheYearAcrossYears() throws {
        let date = try #require(calendar.date(from: DateComponents(year: 2020, month: 3, day: 5, hour: 12)))
        #expect(DriveText.date(wire(date)) == "2020年3月5日")
    }

    @Test func dateGivesNothingForAnUnreadableTimestamp() {
        #expect(DriveText.date("") == "")
        #expect(DriveText.date("昨天") == "")
    }

    // MARK: - 种类

    @Test func kindCoversEveryRowOfTheTable() {
        // Spec §4.3 那张表逐行来一条，扩展名不分大小写。
        #expect(DriveText.kind(of: "报告.pdf") == .pdf)
        #expect(DriveText.kind(of: "照片.PNG") == .image)
        #expect(DriveText.kind(of: "短片.mov") == .video)
        #expect(DriveText.kind(of: "录音.m4a") == .audio)
        #expect(DriveText.kind(of: "备份.zip") == .archive)
        #expect(DriveText.kind(of: "需求规格.md") == .document)
        #expect(DriveText.kind(of: "报告-2026Q3.xlsx") == .spreadsheet)
        #expect(DriveText.kind(of: "评审.pptx") == .presentation)
        #expect(DriveText.kind(of: "config.json") == .code)
        #expect(DriveText.kind(of: "start.sh") == .code)
    }

    @Test func kindFallsBackToUnknown() {
        #expect(DriveText.kind(of: "data.xyz") == .unknown)
        // 没有扩展名也是未知，不会掉进代码或者文档里去。
        #expect(DriveText.kind(of: "README") == .unknown)
        // 点在开头不算扩展名：`.gitignore` 是一个没有扩展名的配置文件。
        #expect(DriveText.kind(of: ".gitignore") == .unknown)
        // 结尾的点后面没有东西。
        #expect(DriveText.kind(of: "report.") == .unknown)
    }

    // MARK: - 角标

    @Test func badgeIsTheUpperCasedExtension() {
        #expect(DriveText.badge(of: "报告-2026Q3.xlsx") == "XLSX")
        #expect(DriveText.badge(of: "photo.jpeg") == "JPEG")
        #expect(DriveText.badge(of: "README.TXT") == "TXT")
        #expect(DriveText.badge(of: "archive.tar.gz") == "GZ")
    }

    @Test func badgeStopsAtFourCharacters() {
        // 图标上放不下第五个字符。先转大写再截，长度才是硬上限。
        #expect(DriveText.badge(of: "main.swift") == "SWIF")
        #expect(DriveText.badge(of: "index.markdown") == "MARK")
    }

    @Test func badgeIsEmptyWithoutAnExtension() {
        // 没有东西可写时返回空串，由图标那边自己留白（Spec §4.3 表里的「—」）。
        #expect(DriveText.badge(of: "README") == "")
        #expect(DriveText.badge(of: ".gitignore") == "")
    }

    // MARK: - 图标底色

    /// 系统色是动态的，直接比 `Color` 不可靠；两边都解析成同一套 RGBA 再比。
    private func components(_ color: Color) -> String {
        let resolved = UIColor(color).resolvedColor(with: UITraitCollection(userInterfaceStyle: .light))
        var red: CGFloat = 0
        var green: CGFloat = 0
        var blue: CGFloat = 0
        var alpha: CGFloat = 0
        resolved.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
        return String(format: "%.3f %.3f %.3f", red, green, blue)
    }

    @Test func kindColorsFollowTheTable() {
        #expect(components(DriveText.kindColor(.pdf)) == components(Color(uiColor: .systemRed)))
        #expect(components(DriveText.kindColor(.image)) == components(Color(uiColor: .systemPurple)))
        #expect(components(DriveText.kindColor(.video)) == components(Color(uiColor: .systemIndigo)))
        #expect(components(DriveText.kindColor(.audio)) == components(Color(uiColor: .systemPink)))
        #expect(components(DriveText.kindColor(.archive)) == components(Color(uiColor: .systemGray)))
        #expect(components(DriveText.kindColor(.document)) == components(Color(uiColor: .systemBlue)))
        #expect(components(DriveText.kindColor(.spreadsheet)) == components(Color(uiColor: .systemGreen)))
        #expect(components(DriveText.kindColor(.presentation)) == components(Color(uiColor: .systemOrange)))
        #expect(components(DriveText.kindColor(.code)) == components(Color(uiColor: .systemGray)))
        #expect(components(DriveText.kindColor(.unknown)) == components(Color(uiColor: .systemGray)))
    }

    @Test func kindColorsAreActuallyDistinct() {
        // 上面那一串相等断言要有一个反证：如果解析这一步整体失效（都解析成同一个
        // 值），它们会一起成立。这里钉住七类各有各的颜色、三种灰确实是同一个灰。
        let distinct: [DriveFileKind] = [.pdf, .image, .video, .audio, .document, .spreadsheet, .presentation]
        #expect(Set(distinct.map { components(DriveText.kindColor($0)) }).count == distinct.count)
        #expect(components(DriveText.kindColor(.archive)) == components(DriveText.kindColor(.code)))
        #expect(components(DriveText.kindColor(.code)) == components(DriveText.kindColor(.unknown)))
    }

    // MARK: - 文案

    @Test func errorMessageUsesTheServersSentence() {
        // 401 / 403 是服务端的答复，说的是这一项到底怎么了，比任何本地兜底都具体。
        let expired = APIError(status: 401, code: "unauthorized", message: "登录已过期，请重新登录。")
        #expect(DriveText.errorMessage(expired) == "登录已过期，请重新登录。")

        let refusal = APIError(status: 403, code: "forbidden", message: "这一项不在你的云盘里。")
        #expect(DriveText.errorMessage(refusal) == "这一项不在你的云盘里。")
    }

    @Test func errorMessageSaysTheNetworkIsDown() {
        // 传输失败的 message 可能是英文的底层错误，不能原样甩给用户。
        let offline = APIError(status: 0, code: "network", message: "The request timed out.")
        #expect(DriveText.errorMessage(offline) == "网络不可用，请稍后重试。")
    }

    @Test func errorMessageFallsBackForAnythingElse() {
        struct Unexpected: Error {}
        #expect(DriveText.errorMessage(Unexpected()) == "操作失败，请稍后重试。")
    }

    @Test func shareModeLabelsMatchTheForm() {
        #expect(DriveText.shareModeLabel(.linkRead) == "仅阅读")
        #expect(DriveText.shareModeLabel(.linkEdit) == "登录后可编辑")
        #expect(DriveText.shareModeLabel(.specifiedUsersEdit) == "指定邮箱可编辑")
    }

    @Test func expiryLabelsCoverTheFormInOrder() {
        // 顺序就是表单里那五个选项的顺序，表单直接用 `allCases`。
        #expect(DriveExpiry.allCases.map { DriveText.expiryLabel($0) } == ["3 天", "7 天", "30 天", "1 年", "永久"])
    }

    @Test func rootTitleIsThePhonesOwnWording() {
        // 服务端那条合成的根叫「网盘」，那是桌面端的叫法，手机端不跟着叫。
        #expect(DriveText.rootTitle == "云盘")
    }
}

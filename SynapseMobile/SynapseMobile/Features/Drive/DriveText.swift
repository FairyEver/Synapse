import SwiftUI
import UIKit

/// 一项文件属于哪一类。**不是**服务端字段——服务端只分「文件 / 文件夹」，这一层是
/// 手机端为了图标与底色自己判出来的（Spec §4.3）。
///
/// 文件夹不在这里：它有自己那枚系统蓝的实心图标，不靠扩展名。
enum DriveFileKind: Hashable {
    case pdf
    case image
    case video
    case audio
    case archive
    case document
    case spreadsheet
    case presentation
    case code
    case unknown
}

/// 云盘里那些「看起来只是格式化」的东西。
///
/// 全是纯函数：`static`、不存状态、不碰网络、只看传进来的参数。算错了不会崩，
/// 只会让人读错——所以每一条都在 `DriveTextTests` 里钉着。
enum DriveText {
    /// 根这一层的标题。
    ///
    /// 服务端把根合成成一项名叫「网盘」的东西，那是桌面端的叫法。手机端的产品名是
    /// 「云盘」，所以根标题不从 `current.name` 取，用这一条。
    static let rootTitle = "云盘"

    /// 认不出来的错误说什么。
    ///
    /// 兜底的意义在于不把 `URLError` 的英文原文甩到用户脸上；能读到服务端那句话的
    /// 时候（`APIError`）就用服务端那句。
    static let unknownErrorMessage = "操作失败，请稍后重试。"

    /// 网络没通。与 `APIClient` 抛出来的那句话同字。
    static let offlineErrorMessage = "网络不可用，请稍后重试。"

    // MARK: - 字节

    /// 服务端的十进制字节串 → 「220 MB」。
    ///
    /// 用 1000 进制而不是 1024：iOS 与「文件」App 都是这么写的，同一个文件在系统的
    /// 存储面板里和这里读出来要一样。
    static func bytes(_ string: String) -> String {
        // 读不出来按 0 算——列表上那一格宁可显示 0 字节，也不该整行空着。负数同样按 0。
        let value = max(0, Int64(string) ?? 0)
        if value < 1000 { return "\(value) 字节" }

        let units = ["KB", "MB", "GB", "TB"]
        var scaled = Double(value)
        var unit = -1
        while scaled >= 1000, unit < units.count - 1 {
            scaled /= 1000
            unit += 1
        }

        var text = formatted(scaled)
        // 三位数取整到 1000 就进位：「999_500 字节」显示成「1000 KB」是用户看得见的错，
        // 「文件」App 在这个位置给的是「1 MB」。已经到最后一个单位时没得进，保持原样。
        if text == "1000", unit < units.count - 1 {
            unit += 1
            text = formatted(scaled / 1000)
        }
        return "\(text) \(units[unit])"
    }

    /// 一个已经落到某个单位上的数 → 不带单位的文字。
    ///
    /// 三位数不留小数（220 MB 而不是 220.2 MB），两位留一位，一位留两位。
    private static func formatted(_ value: Double) -> String {
        let format = value >= 100 ? "%.0f" : value >= 10 ? "%.1f" : "%.2f"
        var text = String(format: format, value)
        // 只在有小数点时剥尾零。三位数取整之后是无条件剥不得的：那样 220 会变成 22、
        // 100 会变成 1（原型里踩过这条）。
        if text.contains(".") {
            while text.hasSuffix("0") { text.removeLast() }
            if text.hasSuffix(".") { text.removeLast() }
        }
        return text
    }

    // MARK: - 时间

    /// 服务端给的 ISO8601 → 「今天 14:00」。
    ///
    /// 今天 / 昨天 / 前天按当前日历算，不是写死的日期。刚过零点的那几分钟里，这条
    /// 显示的是「今天 00:03」，而不是「昨天 24:03」——`isDateInToday` 就是这么判的。
    static func date(_ iso: String) -> String {
        guard let date = ISO8601DateFormatter.parseWireTimestamp(iso) else { return "" }
        let calendar = Calendar.current
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")

        if calendar.isDateInToday(date) {
            formatter.dateFormat = "今天 HH:mm"
        } else if calendar.isDateInYesterday(date) {
            formatter.dateFormat = "昨天 HH:mm"
        } else if calendar.dateComponents(
            [.day],
            from: calendar.startOfDay(for: date),
            to: calendar.startOfDay(for: Date())
        ).day == 2 {
            formatter.dateFormat = "前天 HH:mm"
        } else if calendar.component(.year, from: date) == calendar.component(.year, from: Date()) {
            // 同一年不必报年份，那一栏要留给名字。`d` 是「这个月第几天」，写成 `D`
            // 会变成「这一年第几天」（278 日）。
            formatter.dateFormat = "M月d日"
        } else {
            formatter.dateFormat = "yyyy年M月d日"
        }
        return formatter.string(from: date)
    }

    // MARK: - 种类与角标

    /// 扩展名 → 种类。没有扩展名与认不出来的扩展名都是 `unknown`。
    static func kind(of name: String) -> DriveFileKind {
        let ext = fileExtension(of: name)
        guard !ext.isEmpty else { return .unknown }
        return kindByExtension[ext] ?? .unknown
    }

    /// 图标上那行角标：扩展名的大写，最长四个字符。
    ///
    /// 没有扩展名时返回空串——没有东西可写，图标那边自己留白（Spec §4.3 表里的「—」）。
    static func badge(of name: String) -> String {
        let ext = fileExtension(of: name)
        guard !ext.isEmpty else { return "" }
        // 先转大写再截。反过来的话，一个会变长的字符（ß → SS）能把结果顶到五个字符。
        return String(ext.uppercased().prefix(4))
    }

    /// 图标底色，取 Spec §4.3 那十行里写的系统色。
    static func kindColor(_ kind: DriveFileKind) -> Color {
        switch kind {
        case .pdf: return Color(uiColor: .systemRed)
        case .image: return Color(uiColor: .systemPurple)
        case .video: return Color(uiColor: .systemIndigo)
        case .audio: return Color(uiColor: .systemPink)
        case .archive: return Color(uiColor: .systemGray)
        case .document: return Color(uiColor: .systemBlue)
        case .spreadsheet: return Color(uiColor: .systemGreen)
        case .presentation: return Color(uiColor: .systemOrange)
        case .code: return Color(uiColor: .systemGray)
        case .unknown: return Color(uiColor: .systemGray)
        }
    }

    /// 扩展名：小写、不含点；没有就是空串。
    ///
    /// 点在开头的不算（`.gitignore` 是一个没有扩展名的配置文件，不是「后缀 gitignore」），
    /// 结尾的点也不算（`report.` 后面没有东西）。
    private static func fileExtension(of name: String) -> String {
        guard let dot = name.lastIndex(of: "."), dot != name.startIndex else { return "" }
        return String(name[name.index(after: dot)...]).lowercased()
    }

    /// 分类表。扩展名取自 Spec §4.3 那张表在原型里的实现，另补了同类里常见的那些，
    /// 免得一个 `.wav` 掉进「未知」那格。
    private static let kindByExtension: [String: DriveFileKind] = [
        "pdf": .pdf,

        "png": .image, "jpg": .image, "jpeg": .image, "heic": .image, "heif": .image,
        "gif": .image, "webp": .image, "tiff": .image, "tif": .image, "bmp": .image,
        "avif": .image, "ico": .image, "dng": .image,

        "mp4": .video, "mov": .video, "m4v": .video, "avi": .video, "mkv": .video,
        "webm": .video, "wmv": .video, "flv": .video, "mpg": .video, "mpeg": .video,
        "3gp": .video,

        "mp3": .audio, "m4a": .audio, "wav": .audio, "aac": .audio, "flac": .audio,
        "ogg": .audio, "oga": .audio, "opus": .audio, "aiff": .audio, "caf": .audio,
        "amr": .audio,

        "zip": .archive, "dmg": .archive, "rar": .archive, "7z": .archive, "tar": .archive,
        "gz": .archive, "tgz": .archive, "bz2": .archive, "xz": .archive, "iso": .archive,

        "doc": .document, "docx": .document, "md": .document, "markdown": .document,
        "txt": .document, "rtf": .document, "odt": .document, "pages": .document,
        "tex": .document,

        "xls": .spreadsheet, "xlsx": .spreadsheet, "csv": .spreadsheet, "tsv": .spreadsheet,
        "numbers": .spreadsheet, "ods": .spreadsheet,

        "ppt": .presentation, "pptx": .presentation, "key": .presentation, "odp": .presentation,

        "json": .code, "yml": .code, "yaml": .code, "toml": .code, "ini": .code,
        "conf": .code, "cfg": .code, "xml": .code, "plist": .code, "sh": .code,
        "bash": .code, "zsh": .code, "ts": .code, "tsx": .code, "js": .code,
        "jsx": .code, "mjs": .code, "cjs": .code, "py": .code, "rb": .code,
        "go": .code, "rs": .code, "java": .code, "kt": .code, "kts": .code,
        "c": .code, "h": .code, "cc": .code, "cpp": .code, "hpp": .code,
        "cs": .code, "php": .code, "swift": .code, "m": .code, "mm": .code,
        "sql": .code, "css": .code, "scss": .code, "less": .code, "html": .code,
        "htm": .code, "vue": .code, "svelte": .code, "gradle": .code, "dart": .code,
        "lua": .code,
    ]

    // MARK: - 文案

    /// 失败说给用户听的那句话。
    ///
    /// `APIError` 说的是服务端的答复，那是这一层唯一能读到的具体原因；传输失败没有
    /// 答复可读，就只能是「网络不可用」。别的错误（本地抛的、UIKit 抛的）一律兜底，
    /// 因为它们的 `localizedDescription` 是英文的，不该出现在这里。
    static func errorMessage(_ error: Error) -> String {
        guard let apiError = error as? APIError else { return unknownErrorMessage }
        return apiError.isTransport ? offlineErrorMessage : apiError.message
    }

    /// 分享的访问权限。与 Spec §4.5 表单里的说法逐字一致。
    static func shareModeLabel(_ mode: DriveAccessMode) -> String {
        switch mode {
        case .linkRead: return "仅阅读"
        case .linkEdit: return "登录后可编辑"
        case .specifiedUsersEdit: return "指定邮箱可编辑"
        }
    }

    /// 分享的有效期。
    ///
    /// 与 `shareModeLabel` 一样是给表单选项用的，所以是「永久」而不是「永久有效」——
    /// 后者是分享结果页上的一句话，由那边的视图自己拼。
    static func expiryLabel(_ expiry: DriveExpiry) -> String {
        switch expiry {
        case .threeDays: return "3 天"
        case .sevenDays: return "7 天"
        case .thirtyDays: return "30 天"
        case .oneYear: return "1 年"
        case .forever: return "永久"
        }
    }
}

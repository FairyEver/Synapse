import Compression
import Foundation

/// 把若干份文件打成一个 ZIP。
///
/// **自己写，因为这里引不了依赖**：仓库 iOS 侧一个第三方包都没有，而这个容器格式足够小、
/// 足够稳定，值得用两百行换掉一个供应链。用的是系统自带的 `Compression` 框架做 deflate ——
/// 它的 `COMPRESSION_ZLIB` 就是 RFC 1951 的 **raw DEFLATE**（没有 zlib 头尾），
/// 正是 ZIP 的 method 8 要的东西；CRC 由 `DiagnosticCRC32` 补上。
///
/// **边界铁律：这一层不 import FileManager、不认识日志、不认识域。** 它只认
/// `Entry(name:data:modified:)` 这样一个数组，返回一段 `Data`。读文件、决定导什么、
/// 目录怎么分，全在调用方。
///
/// 这不是洁癖，是可验证性的前提：正因为这一层只依赖 Foundation 与 Compression，它才能被
/// `swiftc` 单独编译出来，在 macOS 上用真正的 `unzip -t` 与 Python 的 `zipfile` 交叉验一遍
/// （见 `DiagnosticZipTests` 的注释）。一个和 FileManager 缠在一起的文件做不到这件事。
///
/// 不做的事，都是这个体量下没有意义的：不写 ZIP64、不流式、不用 data descriptor
/// （名字全是 ASCII，大小都远小于 4 GiB）。选择留白而不是留一个"以后可能要用"的分支。
nonisolated enum DiagnosticZip {
    struct Entry: Equatable, Sendable {
        /// 归档里的相对路径，**必须全是 ASCII**。
        ///
        /// 带非 ASCII 名字的条目要么置 UTF-8 标志位、要么按本地代码页编码，两条路都会让
        /// 别的解压工具各有各的理解。诊断包的目录名与文件名都是我们自己定的（`net/`、
        /// `synapse-…log`、`manifest.json`），本来就不需要这条路。
        let name: String
        let data: Data
        let modified: Date

        init(name: String, data: Data, modified: Date = Date()) {
            self.name = name
            self.data = data
            self.modified = modified
        }
    }

    /// ZIP 的硬边界。超过了就返回 nil 而不是写一个坏包 —— 调用方按"导不出来"处理。
    private static let maximumArchiveBytes = 4 << 30

    /// 打一个 ZIP。任何一条不合法（空条目数组、非 ASCII 名、路径不安分、总量越界）都返回 nil。
    ///
    /// - Parameter compress: 关掉就全部按 STORED 存。测试用它把输出钉成逐字节确定的 ——
    ///   deflate 的输出**不是规范化的**（同一个输入，不同的库或版本给出不同字节），
    ///   所以 method 8 的条目永远不能拿来做逐字节断言。
    /// - Parameter timeZone: 只影响写进条目里的 DOS 时间戳。默认为本地，与解压的人
    ///   看到的一致；测试传 UTC 好让那段字节跨机器相同。
    static func archive(
        _ entries: [Entry],
        compress: Bool = true,
        timeZone: TimeZone = .current
    ) -> Data? {
        guard !entries.isEmpty else { return nil }
        guard entries.allSatisfy({ isAcceptable($0.name) }) else { return nil }
        guard Set(entries.map(\.name)).count == entries.count else { return nil }

        var local = Data()
        var central = Data()
        var offsets: [Int] = []
        offsets.reserveCapacity(entries.count)

        for entry in entries {
            let raw = entry.data
            let packed = compress ? deflate(raw) : nil
            let method: UInt16 = packed == nil ? 0 : 8
            let payload = packed ?? raw
            let crc = DiagnosticCRC32.checksum(raw)
            let (dosTime, dosDate) = Self.dosStamp(entry.modified, timeZone: timeZone)

            offsets.append(local.count)
            let nameBytes = Array(entry.name.utf8)

            local.append(UInt32(0x0403_4b50))          // local file header
            local.append(UInt16(20))                   // version needed
            local.append(UInt16(0))                    // flags：无 data descriptor
            local.append(method)
            local.append(dosTime)
            local.append(dosDate)
            local.append(crc)
            local.append(UInt32(payload.count))
            local.append(UInt32(raw.count))
            local.append(UInt16(nameBytes.count))
            local.append(UInt16(0))                    // extra field
            local.append(contentsOf: nameBytes)
            local.append(payload)

            if local.count > maximumArchiveBytes { return nil }
        }

        for (offset, entry) in zip(offsets, entries) {
            let raw = entry.data
            let packed = compress ? deflate(raw) : nil
            let method: UInt16 = packed == nil ? 0 : 8
            let payload = packed ?? raw
            let crc = DiagnosticCRC32.checksum(raw)
            let (dosTime, dosDate) = Self.dosStamp(entry.modified, timeZone: timeZone)
            let nameBytes = Array(entry.name.utf8)

            central.append(UInt32(0x0201_4b50))        // central directory header
            central.append(UInt16((3 << 8) | 20))      // made by：UNIX，版本 2.0
            central.append(UInt16(20))                 // version needed
            central.append(UInt16(0))                  // flags
            central.append(method)
            central.append(dosTime)
            central.append(dosDate)
            central.append(crc)
            central.append(UInt32(payload.count))
            central.append(UInt32(raw.count))
            central.append(UInt16(nameBytes.count))
            central.append(UInt16(0))                  // extra
            central.append(UInt16(0))                  // comment
            central.append(UInt16(0))                  // disk number start
            central.append(UInt16(0))                  // internal attributes
            // 解出来的文件是 0600 —— 与日志文件本身 `Darwin.open(…, 0o600)` 同一条纪律。
            central.append(UInt32(0o100600) << 16)
            central.append(UInt32(offset))
            central.append(contentsOf: nameBytes)
        }

        let centralOffset = local.count
        var archive = local
        archive.append(central)
        archive.append(UInt32(0x0605_4b50))            // end of central directory
        archive.append(UInt16(0))                      // this disk
        archive.append(UInt16(0))                      // disk with central directory
        archive.append(UInt16(entries.count))
        archive.append(UInt16(entries.count))
        archive.append(UInt32(central.count))
        archive.append(UInt32(centralOffset))
        archive.append(UInt16(0))                      // comment length

        guard archive.count <= maximumArchiveBytes else { return nil }
        return archive
    }

    // MARK: - 内部

    /// 名字必须是相对路径、全是 ASCII、不含空段与 `..`。
    private static func isAcceptable(_ name: String) -> Bool {
        guard !name.isEmpty, name.utf8.allSatisfy({ $0 < 0x80 }) else { return false }
        guard !name.hasPrefix("/"), !name.hasSuffix("/") else { return false }
        guard !name.contains("\\") else { return false }
        let segments = name.split(separator: "/", omittingEmptySubsequences: false)
        guard !segments.contains(where: { $0.isEmpty || $0 == "." || $0 == ".." }) else {
            return false
        }
        return true
    }

    /// raw DEFLATE。压不小或压不动就返回 nil，调用方退回 STORED。
    private static func deflate(_ data: Data) -> Data? {
        // 空输入不值得过一趟压缩器：deflate 流本身就要两个字节。
        guard !data.isEmpty else { return nil }

        // 不可压的数据 deflate 之后会略微变大（每 16383 字节的块多 5 个字节）。给足余量，
        // 不够就说明这块不划算 —— 返回 nil 走 STORED，而不是在这里算精确上界。
        var output = Data(count: data.count + data.count / 1000 + 128)
        let scratchSize = compression_encode_scratch_buffer_size(COMPRESSION_ZLIB)
        guard scratchSize > 0 else { return nil }
        let scratch = UnsafeMutableRawPointer.allocate(byteCount: scratchSize, alignment: 1)
        defer { scratch.deallocate() }

        let written = output.withUnsafeMutableBytes { destination -> Int in
            data.withUnsafeBytes { source -> Int in
                guard let destinationBase = destination.bindMemory(to: UInt8.self).baseAddress,
                      let sourceBase = source.bindMemory(to: UInt8.self).baseAddress
                else { return 0 }
                return compression_encode_buffer(
                    destinationBase, destination.count,
                    sourceBase, source.count,
                    scratch, COMPRESSION_ZLIB
                )
            }
        }
        guard written > 0, written < data.count else { return nil }
        output.removeSubrange(written...)
        return output
    }

    /// ZIP 用的 DOS 时间戳：秒只有 2 秒精度，年份从 1980 起算。
    ///
    /// 时区可注入只是为了让逐字节的那条测试跨机器确定 —— 生产上按本地时区走，
    /// 因为解压的人看到的应该是他那一刻的墙上时间。
    static func dosStamp(
        _ date: Date,
        timeZone: TimeZone = .current
    ) -> (time: UInt16, date: UInt16) {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        // 1980 之前与 2107 之后都夹住：那些位域只有那么宽，溢出会写出一个别的时间。
        let year = min(max(parts.year ?? 1980, 1980), 2107)
        let month = min(max(parts.month ?? 1, 1), 12)
        let day = min(max(parts.day ?? 1, 1), 31)
        let hour = min(max(parts.hour ?? 0, 0), 23)
        let minute = min(max(parts.minute ?? 0, 0), 59)
        let second = min(max(parts.second ?? 0, 0), 59)
        let dosTime = UInt16((hour << 11) | (minute << 5) | (second / 2))
        let dosDate = UInt16(((year - 1980) << 9) | (month << 5) | day)
        return (dosTime, dosDate)
    }
}

/// ZIP 里所有整数都是小端。
private extension Data {
    mutating func append(_ value: UInt16) {
        append(UInt8(value & 0xFF))
        append(UInt8((value >> 8) & 0xFF))
    }

    mutating func append(_ value: UInt32) {
        append(UInt8(value & 0xFF))
        append(UInt8((value >> 8) & 0xFF))
        append(UInt8((value >> 16) & 0xFF))
        append(UInt8((value >> 24) & 0xFF))
    }
}

import Compression
import Foundation
import Testing

@testable import SynapseMobile

/// ZIP 容器自身的正确性。
///
/// 这一套特别的地方在于**它不能靠"我们自己读得回来"自证**：容器是我们写的、读取器也是
/// 我们写的，一个共同的误解会让两边一致地错下去，全绿而包是坏的。所以分三层：
///
/// 1. **逐字节**钉住 STORED 的输出。下面那段 hex 与那几个 CRC 定值，是先在 macOS 上
///    用真正的外部工具验穿之后才抄进来的 —— 顺序不能反，反了就是把一个错误的实现
///    钉成"标准"。
/// 2. 用本文件自带的最小读取器做往返，覆盖边界（空文件、1 字节、恰好 65535 字节、
///    压后反而更大的不可压数据、CRC 被改坏）。
/// 3. 交叉验证的命令记在这里，改动 `DiagnosticZip.swift` / `DiagnosticCRC32.swift` 之后
///    重跑一遍。这两个文件只依赖 Foundation 与 Compression，所以能脱离模拟器单独编译：
///
///         swiftc -O -swift-version 6 DiagnosticCRC32.swift DiagnosticZip.swift main.swift -o zipgen
///         ./zipgen && unzip -t out.zip
///         python3 -c "import zipfile;z=zipfile.ZipFile('out.zip');print(z.testzip())"
///         ditto -x -k out.zip out-unpacked && ls -lR out-unpacked
///         python3 -c "import zlib;print(hex(zlib.crc32(b'hi')))"    # 核对 CRC 定值
///
///     `testzip()` 比 `unzip -t` 严：它逐条校验 CRC。`ditto` 那一步验的是权限位
///     （解出来应当是 `-rw-------`）。
struct DiagnosticZipTests {
    private static let epoch = Date(timeIntervalSince1970: 1_700_000_000)
    private static let utc = TimeZone(secondsFromGMT: 0)!

    private func entry(_ name: String, _ text: String) -> DiagnosticZip.Entry {
        DiagnosticZip.Entry(name: name, data: Data(text.utf8), modified: Self.epoch)
    }

    /// 真正压不动的一段字节。
    ///
    /// 不能随手写 `UInt8($0 &* 197)` 这种"看着乱"的序列 —— 那是 256 字节一个循环，
    /// deflate 一眼就压掉了。xorshift 取高位，输出没有可利用的结构，同时又是确定的。
    private func incompressible(_ count: Int) -> Data {
        var state: UInt64 = 0x9E37_79B9_7F4A_7C15
        var out = Data(capacity: count)
        for _ in 0..<count {
            state ^= state << 13
            state ^= state >> 7
            state ^= state << 17
            out.append(UInt8(truncatingIfNeeded: state >> 33))
        }
        return out
    }

    // MARK: - 定值

    /// CRC-32 的三个定值。中间那个是 CRC-32/ISO-HDLC 的**标准检验值** ——
    /// 多项式或初值写错，它立刻变。
    @Test func crc32MatchesTheStandardCheckValues() {
        #expect(DiagnosticCRC32.checksum(Data()) == 0x0000_0000)
        #expect(DiagnosticCRC32.checksum(Data("123456789".utf8)) == 0xCBF4_3926)
        #expect(DiagnosticCRC32.checksum(Data("hi".utf8)) == 0xD893_2AAC)
    }

    /// 逐字节钉住 STORED 的产物。
    ///
    /// 只有一个条目、内容是 `hi`、时间戳固定在 `1_700_000_000`（UTC），于是每一段 ——
    /// 本地头、名字、数据、中央目录、EOCD —— 都能被人眼对着规范读一遍。
    ///
    /// **只钉 STORED。** deflate 的输出不是规范化的：同一个输入，不同的库或版本给出
    /// 不同字节，拿它做逐字节断言等于把某一次的实现细节当成契约。
    @Test func storedArchiveIsByteForByteWhatTheSpecSays() {
        let archive = DiagnosticZip.archive(
            [entry("a.txt", "hi")],
            compress: false,
            timeZone: Self.utc
        )
        let expected = "504b0304140000000000aab16e57ac2a93d8020000000200000005000000612e7478746869"
            + "504b01021403140000000000aab16e57ac2a93d802000000020000000500000000000000"
            + "00000000808100000000612e747874"
            + "504b0506000000000100010033000000250000000000"
        #expect(archive.map { $0.map { String(format: "%02x", $0) }.joined() } == expected)
    }

    /// 时间戳是两个字节的日期加两个字节的时间，秒只有 2 秒精度。
    @Test func dosStampIsWhatTheFormatAllows() {
        let stamp = DiagnosticZip.dosStamp(Self.epoch, timeZone: Self.utc)
        // 1_700_000_000 = 2023-11-14 22:13:20 UTC
        #expect(stamp.date == UInt16(((2023 - 1980) << 9) | (11 << 5) | 14))
        #expect(stamp.time == UInt16((22 << 11) | (13 << 5) | (20 / 2)))
        // 1980 之前夹到 1980，2107 之后夹到 2107 —— 那些位域只有那么宽。
        #expect(DiagnosticZip.dosStamp(.distantPast, timeZone: Self.utc).date == UInt16((0 << 9) | (1 << 5) | 1))
        #expect(DiagnosticZip.dosStamp(.distantFuture, timeZone: Self.utc).date == UInt16(((2107 - 1980) << 9) | (1 << 5) | 1))
    }

    // MARK: - 往返

    /// 各类内容都能原样回来 —— 包括那些容易被边界吃掉的尺寸。
    @Test func everyKindOfPayloadSurvivesARoundTrip() throws {
        let entries: [DiagnosticZip.Entry] = [
            entry("empty.log", ""),
            entry("one.log", "x"),
            entry("exactly.log", String(repeating: "y", count: 65_535)),
            entry("over.log", String(repeating: "z", count: 65_536)),
            .init(name: "noise.bin", data: incompressible(4_096), modified: Self.epoch),
            entry("app/app-1.log", String(repeating: "2026-09-20 12:00:00.000 I app.launch #1\n", count: 500)),
            entry("net/net-1.log", "net.frame kind=reset rowCount=44\n"),
        ]
        let archive = try #require(DiagnosticZip.archive(entries, timeZone: Self.utc))
        let read = try ZipReader(archive)

        #expect(read.items.count == entries.count)
        #expect(read.corrupt.isEmpty, "CRC 对不上的条目：\(read.corrupt)")
        for (item, original) in zip(read.items, entries) {
            #expect(item.name == original.name)
            #expect(item.data == original.data, "\(original.name) 的内容没有原样回来")
            #expect(item.externalAttributes >> 16 == 0o100600, "解出来的权限位不是 0600")
        }
    }

    /// 该压的压，不该压的不压。
    ///
    /// 两边都要：一份日志压不下去（说明 deflate 根本没跑）和一段随机字节被"压"大了
    /// （说明没退回 STORED）都不是致命的，但都是错的。
    @Test func compressiblePayloadsAreDeflatedAndNoiseIsStored() throws {
        let log = entry("app.log", String(repeating: "the same line over and over\n", count: 400))
        let noise = DiagnosticZip.Entry(
            name: "noise.bin",
            data: incompressible(4_096),
            modified: Self.epoch
        )
        let archive = try #require(DiagnosticZip.archive([log, noise], timeZone: Self.utc))
        let read = try ZipReader(archive)

        let byName = Dictionary(uniqueKeysWithValues: read.items.map { ($0.name, $0) })
        #expect(byName["app.log"]?.method == 8, "一段高度重复的日志没有被压")
        #expect(byName["noise.bin"]?.method == 0, "压不下去的内容没有退回 STORED")
        // 只看日志那一条的**压缩后**大小 —— 整个包里还躺着那 4096 字节刻意不可压的数据，
        // 拿总大小去比，验的就不是 deflate 有没有起效了。
        let packed = try #require(byName["app.log"]?.compressedSize)
        #expect(packed < log.data.count / 10, "一段高度重复的日志只压掉了这么点，deflate 没起作用")
    }

    /// CRC 真的在算，不是摆设。
    ///
    /// 改坏一个字节就必须被发现 —— 上面那条往返能过，一半靠的是读取器也在验 CRC。
    @Test func aCorruptedByteIsCaughtByTheChecksum() throws {
        let archive = try #require(
            DiagnosticZip.archive([entry("a.txt", "hi")], compress: false, timeZone: Self.utc)
        )
        var corrupted = archive
        // 本地头 30 字节 + 名字 5 字节之后是数据本身，改它。
        corrupted[35] = corrupted[35] ^ 0xFF

        let read = try ZipReader(corrupted)
        #expect(read.corrupt == ["a.txt"], "内容被改了一个字节，CRC 却没发现")
    }

    // MARK: - 拒收

    /// 不合法的输入一律返回 nil，而不是写出一个坏包。
    @Test func badInputIsRefusedRatherThanArchived() {
        #expect(DiagnosticZip.archive([], timeZone: Self.utc) == nil, "空归档应当是 nil")
        #expect(DiagnosticZip.archive([entry("中文.log", "x")], timeZone: Self.utc) == nil, "非 ASCII 名")
        #expect(DiagnosticZip.archive([entry("/absolute.log", "x")], timeZone: Self.utc) == nil, "绝对路径")
        #expect(DiagnosticZip.archive([entry("../escape.log", "x")], timeZone: Self.utc) == nil, "跳出目录")
        #expect(DiagnosticZip.archive([entry("a//b.log", "x")], timeZone: Self.utc) == nil, "空路径段")
        #expect(DiagnosticZip.archive([entry("dir/", "x")], timeZone: Self.utc) == nil, "以斜杠结尾")
        #expect(
            DiagnosticZip.archive([entry("same.log", "a"), entry("same.log", "b")], timeZone: Self.utc) == nil,
            "重名条目会让解压出来少一个文件"
        )
    }
}

// MARK: - 测试用的最小 ZIP 读取器

/// 只够读我们自己写出来的包：扫 EOCD → 读中央目录 → 逐条读本地头 → 取数据并校验 CRC。
///
/// 刻意写得笨：它唯一的工作是**独立于写入端**把字节解回来，所以宁可逐字段搬规范，
/// 也不复用写入端的任何常量或函数。
private struct ZipReader {
    struct Item {
        let name: String
        let data: Data
        /// 存进包里的字节数（压缩后）。
        let compressedSize: Int
        let method: UInt16
        let externalAttributes: UInt32
    }

    enum Failure: Error {
        case tooShort
        case noEndOfCentralDirectory
        case badCentralHeader
        case badLocalHeader
        case unsupportedMethod(UInt16)
        case inflateFailed
    }

    let items: [Item]
    /// CRC 对不上的条目名。**是结果的一部分，不是错误** —— 「改坏一个字节要被发现」
    /// 这条断言需要它。
    let corrupt: Set<String>

    init(_ archive: Data) throws {
        let bytes = [UInt8](archive)
        guard bytes.count >= 22 else { throw Failure.tooShort }

        var eocd = -1
        var cursor = bytes.count - 22
        while cursor >= 0 {
            if readU32(bytes, cursor) == 0x0605_4B50 { eocd = cursor; break }
            cursor -= 1
        }
        guard eocd >= 0 else { throw Failure.noEndOfCentralDirectory }

        let count = Int(readU16(bytes, eocd + 10))
        var central = Int(readU32(bytes, eocd + 16))

        var items: [Item] = []
        var corrupt: Set<String> = []
        for _ in 0..<count {
            guard readU32(bytes, central) == 0x0201_4B50 else { throw Failure.badCentralHeader }
            let method = readU16(bytes, central + 10)
            let expectedCRC = readU32(bytes, central + 16)
            let compressedSize = Int(readU32(bytes, central + 20))
            let uncompressedSize = Int(readU32(bytes, central + 24))
            let nameLength = Int(readU16(bytes, central + 28))
            let extraLength = Int(readU16(bytes, central + 30))
            let commentLength = Int(readU16(bytes, central + 32))
            let external = readU32(bytes, central + 38)
            let localOffset = Int(readU32(bytes, central + 42))
            let name = String(decoding: bytes[(central + 46)..<(central + 46 + nameLength)], as: UTF8.self)
            central += 46 + nameLength + extraLength + commentLength

            guard readU32(bytes, localOffset) == 0x0403_4B50 else { throw Failure.badLocalHeader }
            let localNameLength = Int(readU16(bytes, localOffset + 26))
            let localExtraLength = Int(readU16(bytes, localOffset + 28))
            let start = localOffset + 30 + localNameLength + localExtraLength
            let payload = Data(bytes[start..<(start + compressedSize)])

            let raw: Data
            switch method {
            case 0:
                raw = payload
            case 8:
                raw = try Self.inflate(payload, expectedSize: uncompressedSize)
            default:
                throw Failure.unsupportedMethod(method)
            }
            if DiagnosticCRC32.checksum(raw) != expectedCRC { corrupt.insert(name) }
            items.append(Item(
                name: name,
                data: raw,
                compressedSize: compressedSize,
                method: method,
                externalAttributes: external
            ))
        }
        self.items = items
        self.corrupt = corrupt
    }

    private static func inflate(_ payload: Data, expectedSize: Int) throws -> Data {
        guard !payload.isEmpty else { return Data() }
        var output = Data(count: max(expectedSize, 1))
        let scratchSize = compression_decode_scratch_buffer_size(COMPRESSION_ZLIB)
        let scratch = UnsafeMutableRawPointer.allocate(byteCount: max(scratchSize, 1), alignment: 1)
        defer { scratch.deallocate() }
        let written = output.withUnsafeMutableBytes { destination -> Int in
            payload.withUnsafeBytes { source -> Int in
                guard let destinationBase = destination.bindMemory(to: UInt8.self).baseAddress,
                      let sourceBase = source.bindMemory(to: UInt8.self).baseAddress
                else { return 0 }
                return compression_decode_buffer(
                    destinationBase, destination.count,
                    sourceBase, source.count,
                    scratch, COMPRESSION_ZLIB
                )
            }
        }
        guard written == expectedSize else { throw Failure.inflateFailed }
        output.removeSubrange(written...)
        return output
    }
}

private func readU16(_ bytes: [UInt8], _ offset: Int) -> UInt16 {
    UInt16(bytes[offset]) | (UInt16(bytes[offset + 1]) << 8)
}

private func readU32(_ bytes: [UInt8], _ offset: Int) -> UInt32 {
    UInt32(readU16(bytes, offset)) | (UInt32(readU16(bytes, offset + 2)) << 16)
}

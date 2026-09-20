import Foundation

/// ZIP 每条记录都要带的 CRC-32。
///
/// `Compression` 框架不管这个 —— 它只做 deflate，不做校验和。所以这一段得自己写。
/// 用的是 ZIP 规定的那个变体：**反射**多项式 `0xEDB88320`，初值与末尾都取反。
///
/// 纯函数，不碰文件、不认识日志。表在第一次用时建一次，之后每条记录只走一次查表。
nonisolated enum DiagnosticCRC32 {
    private static let table: [UInt32] = {
        (0..<256).map { index -> UInt32 in
            var value = UInt32(index)
            for _ in 0..<8 {
                value = (value & 1) == 1 ? (value >> 1) ^ 0xEDB8_8320 : value >> 1
            }
            return value
        }
    }()

    static func checksum(_ data: Data) -> UInt32 {
        var crc: UInt32 = 0xFFFF_FFFF
        for byte in data {
            crc = (crc >> 8) ^ table[Int((crc ^ UInt32(byte)) & 0xFF)]
        }
        return crc ^ 0xFFFF_FFFF
    }
}

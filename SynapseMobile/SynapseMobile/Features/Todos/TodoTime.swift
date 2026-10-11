import Foundation

nonisolated enum TodoTime {
    static func minute(_ date: Date) -> Date {
        Date(timeIntervalSince1970: floor(date.timeIntervalSince1970 / 60) * 60)
    }
    static func wire(_ date: Date) -> String { ISO8601DateFormatter.wire.string(from: minute(date)) }
    static func parse(_ value: String?) -> Date? { value.flatMap(ISO8601DateFormatter.parseWireTimestamp) }
    static func display(_ date: Date, timeZone: TimeZone = .current) -> String {
        date.formatted(Date.FormatStyle(date: .abbreviated, time: .shortened,
            locale: Locale(identifier: "zh_CN"), timeZone: timeZone))
    }
    static func display(_ value: String?, timeZone: TimeZone = .current) -> String? {
        parse(value).map { display($0, timeZone: timeZone) }
    }
}

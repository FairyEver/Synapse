import Foundation

nonisolated enum WorkspaceFilesReceiptDecoder {
    static func httpWithinBudget(_ data: Data) -> Bool {
        guard data.count <= 128 * 1024,
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        guard let result = root["result"] as? [String: Any],
              let files = result["workspaceFiles"] as? [String: Any] else { return true }
        return operationDataWithinBudget(files["data"])
    }

    /// Runs off the main actor. Both the final transport envelope and operation
    /// data have independent UTF-8 budgets, matching the shared/server validators.
    static func decode(_ data: Data) -> MobileIntentResultPayload? {
        guard data.count <= 2 * 1024 * 1024,
              let payload = try? JSONDecoder().decode(WorkspaceFilesReceiptEnvelope.self, from: data).payload else { return nil }
        guard payload.result.workspaceFiles != nil else { return payload }
        guard data.count <= 128 * 1024,
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let outer = root["payload"] as? [String: Any],
              let result = outer["result"] as? [String: Any],
              let files = result["workspaceFiles"] as? [String: Any],
              operationDataWithinBudget(files["data"]) else { return nil }
        return payload
    }

    private static func operationDataWithinBudget(_ value: Any?) -> Bool {
        guard let value, let bytes = try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) else { return false }
        return bytes.count <= 64 * 1024
    }
}

private nonisolated struct WorkspaceFilesReceiptEnvelope: Decodable {
    let payload: MobileIntentResultPayload
}

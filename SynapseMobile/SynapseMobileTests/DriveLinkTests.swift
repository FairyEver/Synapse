import Foundation
import Testing
@testable import SynapseMobile

/// 「在浏览器中打开」那条地址。
///
/// 纯判据：只看传进来的那一项与源站，不读 `AppConfiguration`、不碰网络 —— 所以这些断言是
/// 密闭的（与 `DrivePublicAssetLink` 那几条同一条规矩）。
struct DriveLinkTests {
    private func item(id: String) -> DriveBrowserItem {
        DriveBrowserItem(
            id: id,
            name: "\(id).html",
            type: .file,
            size: "1200",
            mimeType: "text/html",
            updatedAt: "2026-09-26T02:11:00.000Z",
            previewKind: .htmlSource,
            browserUrl: "/drive/items/\(id)",
            downloadUrl: "/drive/items/\(id)/download",
            shareUrl: nil
        )
    }

    /// 一项打开的是网页版云盘那条路由：`{源站}/drive/items/{itemId}`。
    ///
    /// 与桌面端逐字相同（`desktop/electron/services/account-service.ts` 的
    /// `currentOwnerDriveBrowserUrl`）—— 两处打开的是同一页，手机端不另有一条。
    @Test func anItemOpensOnTheWebConsoleRoute() {
        #expect(
            DriveItemWebLink.url(for: item(id: "itm_1"), origin: URL(string: "https://synapse.d2.pub")!)
                == URL(string: "https://synapse.d2.pub/drive/items/itm_1")
        )
    }

    /// 源站自己带路径时（自建 / 内网那一档，`AppConfiguration.apiOrigin` 只剥掉尾部的
    /// `/api`）拼上去的那一段不能把它的路径盖掉。
    @Test func theOriginKeepsItsOwnPath() {
        #expect(
            DriveItemWebLink.url(for: item(id: "itm_1"), origin: URL(string: "https://dev.example.cn/synapse")!)
                == URL(string: "https://dev.example.cn/synapse/drive/items/itm_1")
        )
    }

    /// 编号里那些要编码的字符不能把地址弄成一条开不了的链接。
    @Test func anIdThatNeedsEscaping() {
        #expect(
            DriveItemWebLink.url(for: item(id: "itm 1"), origin: URL(string: "https://a.b")!).absoluteString
                == "https://a.b/drive/items/itm%201"
        )
    }

    /// 只管打开、不带任何查询串：带上一串参数会让服务端那一页读到别的意思。
    @Test func theAddressCarriesNoQuery() {
        let url = DriveItemWebLink.url(for: item(id: "itm_1"), origin: URL(string: "https://a.b")!)
        #expect(url.query == nil)
    }
}

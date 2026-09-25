import Foundation
import Testing
@testable import SynapseMobile

/// 云盘 DTO 的解码。
///
/// 这里钉的不是「字段读得对」，而是几条**读错了就整页空白**的边界：`size` 是字符串、
/// 枚举里有带连字符的原始值、分页块可能缺失、服务端多给的键不能把解码搞崩。文件里的
/// JSON 都按服务端真实响应裁过，不是凭印象写的。
struct DriveModelsTests {
    private func decode<T: Decodable>(_ type: T.Type, _ json: String) throws -> T {
        try JSONDecoder().decode(T.self, from: Data(json.utf8))
    }

    @Test func decodesARootSnapshot() throws {
        // 服务端多给 `edit` / `annotation` / `context` 这些手机端不用的键，解码器要
        // 直接忽略；根也是服务端合成的一项，`id == "root"`。
        let json = """
        {
          "context": "owner",
          "surface": "console",
          "current": {
            "id": "root",
            "name": "网盘",
            "type": "folder",
            "size": "0",
            "mimeType": null,
            "updatedAt": "2026-09-25T02:11:00.000Z",
            "previewKind": "download-only",
            "browserUrl": "https://synapse.d2.pub/drive/browser/owner/root",
            "downloadUrl": null,
            "shareUrl": null
          },
          "breadcrumbs": [
            { "id": "root", "name": "网盘", "browserUrl": "https://synapse.d2.pub/drive/browser/owner/root" }
          ],
          "children": [
            {
              "id": "itm_folder",
              "name": "项目文档",
              "type": "folder",
              "size": "0",
              "mimeType": null,
              "updatedAt": "2026-09-24T10:20:00.000Z",
              "previewKind": "download-only",
              "browserUrl": "https://synapse.d2.pub/drive/browser/owner/items/itm_folder",
              "downloadUrl": "https://synapse.d2.pub/drive/items/itm_folder/download",
              "shareUrl": "https://synapse.d2.pub/share/shr_1"
            },
            {
              "id": "itm_file",
              "name": "报告-2026Q3.xlsx",
              "type": "file",
              "size": "220200960",
              "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              "updatedAt": "2026-09-23T08:00:00.000Z",
              "previewKind": "download-only",
              "browserUrl": "https://synapse.d2.pub/drive/browser/owner/items/itm_file",
              "downloadUrl": "https://synapse.d2.pub/drive/items/itm_file/download"
            }
          ],
          "childrenPage": { "offset": 0, "limit": 50, "hasMore": true, "nextOffset": 50 },
          "preview": null,
          "edit": null,
          "annotation": null,
          "canDownload": false,
          "canZip": false
        }
        """
        let snapshot = try decode(DriveBrowserSnapshot.self, json)

        #expect(snapshot.isRoot)
        #expect(snapshot.breadcrumbs.first?.isRoot == true)
        #expect(snapshot.children.count == 2)
        #expect(snapshot.children[0].isFolder)
        #expect(snapshot.children[0].shareUrl == "https://synapse.d2.pub/share/shr_1")
        #expect(snapshot.children[1].sizeBytes == 220_200_960)
        #expect(snapshot.children[1].downloadUrl != nil)
        #expect(snapshot.childrenPage?.hasMore == true)
        #expect(snapshot.childrenPage?.nextOffset == 50)
        // 根不能打包：`downloadUrl` 为 nil，那不是一项能下载的东西。
        #expect(!snapshot.canZip)
    }

    @Test func keepsHugeSizesAsStrings() throws {
        // 服务端的大整数走字符串（Spec §7.3）。这一条同时钉住两件事：能接住超过
        // `Int32` 的数，以及真的读不出来时回落成 nil 而不是 0。
        let json = """
        {
          "context": "owner",
          "surface": "console",
          "current": {
            "id": "root", "name": "网盘", "type": "folder", "size": "0", "mimeType": null,
            "updatedAt": "2026-09-25T02:11:00.000Z", "previewKind": "download-only",
            "browserUrl": "https://synapse.d2.pub/drive/browser/owner/root", "downloadUrl": null
          },
          "breadcrumbs": [],
          "children": [
            {
              "id": "a", "name": "大文件.bin", "type": "file", "size": "9007199254740993",
              "mimeType": null, "updatedAt": "2026-09-25T02:11:00.000Z",
              "previewKind": "download-only", "browserUrl": "https://x", "downloadUrl": "https://y"
            },
            {
              "id": "b", "name": "读不出来.bin", "type": "file", "size": "unknown",
              "mimeType": null, "updatedAt": "2026-09-25T02:11:00.000Z",
              "previewKind": "download-only", "browserUrl": "https://x", "downloadUrl": "https://y"
            },
            {
              "id": "c", "name": "大到超界.bin", "type": "file", "size": "99999999999999999999",
              "mimeType": null, "updatedAt": "2026-09-25T02:11:00.000Z",
              "previewKind": "download-only", "browserUrl": "https://x", "downloadUrl": "https://y"
            }
          ],
          "canDownload": true,
          "canZip": true
        }
        """
        let snapshot = try decode(DriveBrowserSnapshot.self, json)

        #expect(snapshot.children[0].sizeBytes == 9_007_199_254_740_993)
        #expect(snapshot.children[1].sizeBytes == nil)
        #expect(snapshot.children[1].name == "读不出来.bin")
        #expect(snapshot.children[2].sizeBytes == nil)
    }

    @Test func missingChildrenPageMeansNoMorePages() throws {
        // 旧服务端不给分页块。少了它不该让整层读不出来——只是没有下一页。
        let json = """
        {
          "context": "owner",
          "surface": "console",
          "current": {
            "id": "itm_folder", "name": "项目文档", "type": "folder", "size": "0",
            "mimeType": null, "updatedAt": "2026-09-25T02:11:00.000Z",
            "previewKind": "download-only", "browserUrl": "https://x", "downloadUrl": null
          },
          "breadcrumbs": [],
          "children": [],
          "canDownload": true,
          "canZip": true
        }
        """
        let snapshot = try decode(DriveBrowserSnapshot.self, json)

        #expect(snapshot.childrenPage == nil)
        #expect(snapshot.children.isEmpty)
        #expect(!snapshot.isRoot)
    }

    @Test func unknownItemTypeIsTreatedAsAFile() throws {
        // 类型认不出来时当文件：文件夹才需要下钻，猜错成文件夹的代价是点进去一片空白。
        let json = #"{ "id": "a", "name": "怪东西", "type": "symlink", "size": "1" }"#
        struct Row: Decodable {
            let id: String
            let name: String
            let type: DriveItemKind
        }
        let row = try decode(Row.self, json)

        #expect(row.type == .file)
        #expect(row.name == "怪东西")
    }

    @Test func keepsTheHyphenatedPreviewKinds() throws {
        // `html-source` 与 `download-only` 的原始值里有连字符，写错一个字符就会静默
        // 走进「认不出来」那条回落。
        #expect(try decode(PreviewKindBox.self, #"{ "kind": "html-source" }"#).kind == .htmlSource)
        #expect(try decode(PreviewKindBox.self, #"{ "kind": "download-only" }"#).kind == .downloadOnly)
        #expect(try decode(PreviewKindBox.self, #"{ "kind": "markdown" }"#).kind == .markdown)
    }

    @Test func unknownPreviewKindFallsBackToDownloadOnly() throws {
        // 手机端不认识的种类不该被当成文本来读——那就把字节交给 QuickLook，或者
        // 直接说这个格式打不开。
        #expect(try decode(PreviewKindBox.self, #"{ "kind": "spreadsheet-view" }"#).kind == .downloadOnly)
    }

    private struct PreviewKindBox: Decodable {
        let kind: DrivePreviewKind
    }

    @Test func decodesATextPreview() throws {
        let json = """
        {
          "kind": "text",
          "text": "第一行\\n第二行",
          "html": null,
          "outline": null,
          "truncated": true,
          "imageUrl": null,
          "visitUrl": null,
          "relativeImages": [],
          "markdownProjection": null
        }
        """
        let preview = try decode(DrivePreview.self, json)

        #expect(preview.kind == .text)
        #expect(preview.text == "第一行\n第二行")
        #expect(preview.truncated)
        #expect(preview.imageUrl == nil)
    }

    @Test func decodesTheTrashPageWithBothKindsOfEntry() throws {
        let json = """
        {
          "items": [
            {
              "id": "itm_1", "kind": "normal", "name": "旧笔记.txt", "type": "file",
              "size": "4096", "mimeType": "text/plain", "originalPath": "项目文档/旧笔记.txt",
              "trashedAt": "2026-09-20T02:00:00.000Z"
            },
            {
              "id": "ast_1", "kind": "public_asset", "name": "logo.png", "type": "file",
              "size": "1024", "mimeType": "image/png", "originalPath": null,
              "assetId": "asset_1", "trashedAt": "2026-09-19T02:00:00.000Z"
            }
          ],
          "total": 2,
          "page": { "offset": 0, "limit": 50, "hasMore": false, "nextOffset": null }
        }
        """
        let page = try decode(DriveTrashPage.self, json)

        #expect(page.total == 2)
        #expect(!page.items[0].isPublicAsset)
        #expect(page.items[0].assetId == nil)
        #expect(page.items[0].originalPath == "项目文档/旧笔记.txt")
        #expect(page.items[1].isPublicAsset)
        #expect(page.items[1].assetId == "asset_1")
        #expect(page.items[1].sizeBytes == 1024)
    }

    @Test func decodesTheSharePage() throws {
        // 分享列表的响应里**没有** `total`——多声明一个必需字段就会整页解码失败。
        let json = """
        {
          "items": [
            {
              "id": "shr_row_1", "shareId": "shr_1", "itemId": "itm_1",
              "itemName": "报告-2026Q3.xlsx", "itemType": "file", "sourceDeleted": false,
              "url": "https://synapse.d2.pub/share/shr_1",
              "urlWithPassword": "https://synapse.d2.pub/share/shr_1?pw=abcd",
              "passwordEnabled": true, "password": "abcd",
              "expiresAt": "2026-12-24T00:00:00.000Z", "accessMode": "link_edit",
              "editorEmails": ["a@b.com", "c@d.com"], "createdAt": "2026-09-24T00:00:00.000Z"
            },
            {
              "id": "shr_row_2", "shareId": "shr_2", "itemId": "itm_2",
              "itemName": "项目文档", "itemType": "folder", "sourceDeleted": true,
              "url": "https://synapse.d2.pub/share/shr_2",
              "urlWithPassword": "https://synapse.d2.pub/share/shr_2",
              "passwordEnabled": false, "password": null, "expiresAt": null,
              "accessMode": "link_read", "editorEmails": [], "createdAt": "2026-09-20T00:00:00.000Z"
            }
          ],
          "page": { "offset": 0, "limit": 50, "hasMore": false, "nextOffset": null }
        }
        """
        let page = try decode(DriveSharePage.self, json)

        #expect(page.items.count == 2)
        #expect(page.items[0].accessMode == .linkEdit)
        #expect(page.items[0].editorEmails.count == 2)
        #expect(page.items[0].password == "abcd")
        #expect(!page.items[0].sourceDeleted)
        #expect(page.items[1].itemType == .folder)
        #expect(page.items[1].sourceDeleted)
        #expect(page.items[1].expiresAt == nil)
        #expect(page.items[1].accessMode == .linkRead)
    }

    @Test func unknownAccessModeFallsBackToReadOnly() throws {
        // 认不出来时按「仅阅读」显示：不替服务端许下一个它没承诺的权限。
        let json = """
        {
          "id": "shr_row_2", "shareId": "shr_2", "itemId": "itm_2", "itemName": "项目文档",
          "itemType": "folder", "sourceDeleted": false, "url": "https://x",
          "urlWithPassword": "https://x", "passwordEnabled": false, "password": null,
          "expiresAt": null, "accessMode": "link_comment", "editorEmails": [],
          "createdAt": "2026-09-20T00:00:00.000Z"
        }
        """
        #expect(try decode(DriveShareListItem.self, json).accessMode == .linkRead)
    }

    @Test func decodesTheCreateShareResult() throws {
        let json = """
        {
          "id": "shr_row_1", "shareId": "shr_1", "itemId": "itm_1", "enabled": true,
          "url": "https://synapse.d2.pub/share/shr_1",
          "urlWithPassword": "https://synapse.d2.pub/share/shr_1",
          "passwordEnabled": false, "password": null, "expiresAt": null,
          "accessMode": "link_read", "editorEmails": [],
          "createdAt": "2026-09-25T00:00:00.000Z"
        }
        """
        let share = try decode(DriveShare.self, json)

        #expect(share.enabled)
        #expect(!share.passwordEnabled)
        #expect(share.password == nil)
        #expect(share.url == share.urlWithPassword)
        #expect(share.accessMode == .linkRead)
    }

    @Test func decodesUsage() throws {
        let json = #"{ "usedBytes": "1331437568", "reservedBytes": "0", "quotaBytes": "5368709120" }"#
        let usage = try decode(DriveUsage.self, json)

        #expect(usage.used == 1_331_437_568)
        #expect(usage.quota == 5_368_709_120)
    }

    @Test func decodesThePublicAssetPage() throws {
        let json = """
        {
          "items": [
            {
              "assetId": "asset_1", "itemId": "itm_1", "name": "logo.png", "size": "1024",
              "mimeType": "image/png", "url": "https://synapse.d2.pub/files/asset_1",
              "lifecycleStatus": "active", "accessCount": "12", "responseBytes": "12288",
              "lastAccessedAt": "2026-09-24T09:00:00.000Z",
              "createdAt": "2026-09-01T00:00:00.000Z", "updatedAt": "2026-09-01T00:00:00.000Z"
            }
          ],
          "total": 1,
          "page": { "offset": 0, "limit": 50, "hasMore": false, "nextOffset": null }
        }
        """
        let page = try decode(DrivePublicAssetPage.self, json)
        let asset = try #require(page.items.first)

        // 列表按 assetId 认行：itemId 会随删除重建而变。
        #expect(asset.id == "asset_1")
        #expect(asset.sizeBytes == 1024)
        #expect(asset.url == "https://synapse.d2.pub/files/asset_1")
    }

    @Test func decodesContentInspectAndChunk() throws {
        let inspect = try decode(DriveContentInspect.self, """
        {
          "itemId": "itm_1", "name": "README.md", "kind": "markdown",
          "sizeBytes": 2048, "versionId": "ver_1", "editable": true
        }
        """)
        // 检查结果里的 kind 与快照里的 previewKind 用的是同一套取值。
        #expect(inspect.kind == .markdown)
        #expect(inspect.editable)

        let chunk = try decode(DriveContentChunk.self, """
        {
          "itemId": "itm_1", "versionId": "ver_1", "text": "# 标题\\n",
          "startByte": 0, "endByte": 7, "totalBytes": 7,
          "nextCursor": null, "endOfFile": true
        }
        """)
        #expect(chunk.text == "# 标题\n")
        #expect(chunk.nextCursor == nil)
        #expect(chunk.endOfFile)
    }

    @Test func inspectKindKeepsTheHyphenatedValue() throws {
        let inspect = try decode(DriveContentInspect.self, """
        {
          "itemId": "itm_1", "name": "index.html", "kind": "html-source",
          "sizeBytes": 10, "versionId": "ver_1", "editable": false
        }
        """)
        #expect(inspect.kind == .htmlSource)
    }

    @Test func decodesTheOverwriteTarget() throws {
        let json = """
        { "itemId": "itm_1", "name": "需求规格.md", "currentVersionId": null, "documentText": true }
        """
        let target = try decode(DriveUploadOverwriteTarget.self, json)

        #expect(target.currentVersionId == nil)
        #expect(target.documentText)
        #expect(target.name == "需求规格.md")
    }

    @Test func shareSettingsEncodeTheServersValues() throws {
        // 这两个枚举也要当请求值用（创建分享），所以编出来的必须是服务端那几个原始值，
        // 不是 Swift 这边的 case 名。
        let encoder = JSONEncoder()
        func encoded<T: Encodable>(_ value: T) throws -> String {
            String(data: try encoder.encode(value), encoding: .utf8) ?? ""
        }

        #expect(try encoded(DriveAccessMode.specifiedUsersEdit) == #""specified_users_edit""#)
        #expect(try encoded(DriveAccessMode.linkRead) == #""link_read""#)
        #expect(try encoded(DriveExpiry.forever) == #""forever""#)
        #expect(try encoded(DriveExpiry.thirtyDays) == #""30d""#)
    }
}

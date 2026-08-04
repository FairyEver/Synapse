# Synapse Drive MCP

Use Synapse Drive MCP tools when the user wants to upload, open, preview, download, share, publish a static site, organize, delete, restore, or create Drive-backed public asset links in Synapse Drive.

## Scope

Use these tools only for Synapse Drive:

- `app_drive_item_list`
- `app_drive_item_get`
- `app_drive_file_upload`
- `app_drive_folder_upload`
- `app_drive_folder_create`
- `app_drive_item_rename`
- `app_drive_item_move`
- `app_drive_item_delete`
- `app_drive_item_preview_get`
- `app_drive_file_content_read`
- `app_drive_file_download_create`
- `app_drive_file_version_list`
- `app_drive_file_version_download_create`
- `app_drive_file_version_restore`
- `app_drive_file_version_delete`
- `app_drive_file_version_pin_update`
- `app_drive_link_resolve`
- `app_drive_link_list`
- `app_drive_link_read_text`
- `app_drive_link_materialize`
- `app_drive_link_download_file`
- `app_drive_folder_zip_create`
- `app_drive_share_list`
- `app_drive_share_create`
- `app_drive_share_disable`
- `app_drive_site_create`
- `app_drive_site_list`
- `app_drive_site_update_access`
- `app_drive_site_disable`
- `app_drive_site_enable`
- `app_drive_site_delete`
- `app_drive_site_republish`
- `app_drive_usage_get`
- `app_drive_stats_get`
- `app_drive_item_tree_list`
- `app_drive_folder_path_ensure`
- `app_drive_reorganization_preview`
- `app_drive_reorganization_apply`
- `app_drive_direct_link_upload`
- `app_drive_direct_link_list`
- `app_drive_direct_link_get`
- `app_drive_direct_link_update`
- `app_drive_direct_link_rename`
- `app_drive_direct_link_delete`
- `app_drive_direct_link_restore`
- `app_drive_trash_list`
- `app_drive_trash_delete`
- `app_drive_item_restore`

Do not use this skill for database records, Resource Repository resources, Automation schedules/items, workflow definitions, provider settings, or general local file editing unrelated to a Drive operation.

## Drive Link Intake Flow

When the user provides a Synapse `/share/...`, `/sites/...`, or `/files/...` URL, use Drive Link tools instead of owner Drive item tools.

1. Call `app_drive_link_resolve` with `url` and optional `password`.
   - `password` must be the actual password string. MCP parameters do not expand `$ENV_VAR`; read the variable in your own runtime first, or ask the user for the password.
   - If `access.status` is `password_required`, stop and ask for the password. A protected result may use `root.type: "protected"` until access is unlocked.
   - `app_drive_link_list`, `app_drive_link_read_text`, and `app_drive_link_download_file` also report password-required protected links; do not treat that as a missing file.
2. If the result is a folder or site, call `app_drive_link_list` before reading content.
3. For Markdown, HTML source, JSON, or text, call `app_drive_link_read_text`. For `/share` children, prefer the `itemId` returned by `app_drive_link_list`; use `path` mainly for `/sites` assets or as a share fallback.
4. For HTML prototypes, folders, images, or binary attachments that need local inspection, call `app_drive_link_materialize`. The returned `files` and manifest include materialized folders, including empty folders. This writes to the local Drive link intake cache and is subject to local write permission and audit.
5. For one specific linked file or public asset, call `app_drive_link_download_file`. For `/share` children, prefer the listed `itemId`; for `/sites`, pass the site-relative `path`.

Do not use these tools to edit shared files, create comments, import shared content into the user's Drive, or crawl arbitrary websites.
Do not repeat passwords in the final answer.
When using Codex `--json` or raw MCP event logs for debugging, remember tool arguments can include passwords. Do not save, quote, or attach those raw logs unless the password parameters are removed first.

## Upload Destination Selection

Choose one Drive destination before uploading and reuse it for every ordinary Drive item produced by the request.

1. Use an explicitly requested Drive folder or path. Create or reuse it before uploading.
2. For one local file with no requested destination, upload it to the Drive root without creating a wrapper folder.
3. For one local folder with no requested destination, use the local folder basename as the Drive folder name under the Drive root. Reuse a same-name Drive folder and preserve the local relative structure.
4. For multiple explicitly selected files with no requested destination:
   - Use the primary Markdown basename without its extension when the user identifies a primary Markdown or exactly one selected Markdown exists.
   - Otherwise, use the common local parent folder basename.
   - If there are multiple Markdown candidates with no primary one, or no meaningful common parent folder, ask one concise naming question before any remote write.
   - Create or reuse that Drive folder as the layout root. Upload directly contained files to it and recreate required subdirectories instead of flattening relative paths.
5. Keep the Markdown, its referenced local images, standalone HTML files, explicitly included attachments, and HTML dependency source folders inside the selected Drive destination. A site URL or share URL is a public identity for an item in that destination, not a replacement storage location.
6. For `.md` and `.markdown`, keep supported local image references unchanged and preserve the same relative layout between the Markdown and image files in Drive. Use `app_drive_direct_link_upload` only when the user explicitly asks for a public asset/direct link or asks to replace the Markdown references with public URLs.

## Local Markdown Publishing Flow

Use this flow when the user asks to upload or share a local Markdown document. Treat explicitly selected inputs and the Markdown's referenced local assets as one publishing transaction, and apply **Upload Destination Selection** before any remote write.

1. Preflight the source before any remote write.
   - Read the Markdown and inventory local image targets from Markdown image links, image reference definitions, and HTML `<img src>` elements. Inventory local `.html` targets from Markdown links.
   - Resolve local targets relative to the source Markdown directory. Leave `http:`, `https:`, `data:`, and fragment-only targets unchanged.
   - Deduplicate references by resolved local path so each source file is uploaded once.
   - Stop and ask when a referenced file is missing. For local images, accept only PNG, JPG, JPEG, GIF, WebP, AVIF, and ICO; stop and ask how to handle SVG or another unsupported image format.
   - Ignore unrelated neighboring files. If the user explicitly includes an unreferenced HTML file or a whole directory, upload it as requested, but do not share that HTML merely because it is next to the Markdown.
   - Native relative-image rendering applies only to `.md` and `.markdown`, not `.mdx`. It supports relative raster targets in inline images, reference images, and standalone quoted `<img src>` elements; it does not support root-relative paths, SVG, or relative HTML resources.
2. For `.md` and `.markdown`, upload every supported referenced local image as an ordinary Drive file while preserving the same relative path from the Markdown file.
   - Use the closest common local ancestor of the Markdown and its referenced images as the layout root, then mirror their paths below the selected Drive destination. If every image is below the Markdown's directory, that directory can be the layout root.
   - When the user selected the complete source folder, prefer `app_drive_folder_upload` so the directory structure is preserved in one operation. Check `failures` before treating the Markdown upload as complete.
   - Otherwise, use `app_drive_folder_path_ensure` to create or reuse only the required relative directories, then upload each referenced image with `app_drive_file_upload` to its matching parent folder. Upload dependencies before the Markdown when possible.
   - Keep the original relative image targets unchanged. Do not create public assets, replace them with `/files/<assetId>` URLs, or create a `_final.md` copy solely for relative images.
3. Inspect each referenced local HTML file without modifying it.
   - For standalone HTML, call `app_drive_file_upload`, then `app_drive_share_create`; use the returned `/share/...` URL in the Markdown.
   - For HTML with complete local relative dependencies, upload the dependency folder with `app_drive_folder_upload`, publish it with `app_drive_site_create`, and use the returned `/sites/...` URL in the Markdown.
   - If dependencies are missing or the route cannot be determined, ask one concise question before uploading the HTML or rewriting its link.
   - If the user explicitly says to upload the HTML as-is, upload the unchanged HTML file and share that file even when referenced local dependencies are missing. Do not silently bundle, rewrite, or repair the HTML; report that missing dependencies can affect rendering.
   - Never upload HTML as a public asset. A referenced HTML target must receive its own share or site URL even when the top-level request says only to upload the Markdown.
4. If local HTML links need remote URLs, derive a sibling path by inserting `_final` before the source extension, ask before overwriting an existing file, and rewrite only the inventoried HTML targets in that copy. Otherwise upload the original Markdown unchanged.
5. Upload the chosen Markdown with `app_drive_file_upload` while passing the original Markdown basename as `name`, unless the unchanged file was already uploaded by `app_drive_folder_upload`. Within the native preview limits, use `app_drive_item_preview_get` to confirm each supported relative image has a non-null `resolvedUrl`; do not claim the upload is complete while a required image is unresolved.
6. If the user asked to share the Markdown, call `app_drive_share_create` for the uploaded Markdown item itself. A single-file Markdown share can read only the relative images that its current content actually references. Do not create a folder share as a shortcut, and keep every referenced HTML share or site independent.
7. Pass only share settings the user explicitly requested, and apply them to every file share in this transaction unless the user scopes them to one artifact. When the user did not specify password enablement, expiry, access mode, or editor emails, omit `passwordEnabled`, `expiresIn`, `accessMode`, and `editorEmails` so the current Synapse version supplies its defaults. Do not hardcode those defaults in this skill. `app_drive_site_create` requires access settings; ask for its required values when the user did not provide them.
8. Do not upload the Markdown when a required dependency upload, HTML share/site publication, rewrite, or verification fails. A folder upload may have completed some remote writes before reporting failures; do not delete them without explicit authorization, and report the completed writes and the blocking failure.

## HTML Sharing Route

Choose the public route from both the final publishable artifact and the user's explicit intent. A standalone HTML file defaults to a Drive file share and never receives sibling relative-resource access. Casual words such as "page", "website", or "site" do not by themselves request a folder-backed webpage share.

1. Inspect the generated files immediately before uploading.
2. If the user explicitly asks to publish the whole folder or directory as a website or site, upload the local folder with `app_drive_folder_upload` when needed, then call `app_drive_site_create` for the Drive folder.
   - A folder containing only one `index.html` file is a valid site source. File count does not determine whether explicit whole-folder publishing is allowed.
   - Merely naming a Drive destination folder for an uploaded HTML file does not mean the user wants that folder published.
3. Otherwise, if the result is one standalone HTML file, call `app_drive_file_upload`, then `app_drive_share_create`. This is the preferred route even when the user casually calls the file a website or site.
   - Standalone means the HTML does not require sibling local CSS, JavaScript, images, fonts, or other files. Inline content, data URLs, and remote URLs do not make it a multi-file site.
4. If the result contains multiple HTML pages, a build output bundle, or HTML that depends on local relative assets, call `app_drive_folder_upload`, then `app_drive_site_create` for the uploaded folder.
5. If local dependencies are missing or the artifact shape cannot be inspected, ask one concise question instead of guessing the route, unless the user explicitly requested an unchanged as-is file upload.

## Updating Published HTML

Identify the existing public identity before uploading. Resolve a provided `/share/...` or `/sites/...` URL with `app_drive_link_resolve`; otherwise search `app_drive_share_list` or `app_drive_site_list`. If more than one existing target matches, ask the user which one to update instead of creating a new public link.

### Shared HTML

1. Resolve the shared file item id, then call `app_drive_item_get` to obtain its current `parentId` and name.
2. Upload the replacement with `app_drive_file_upload` to the same parent and name. Same-name upload keeps the item id and existing `/share/...` link.
3. Do not call `app_drive_share_create` again for a normal update. Report that the existing link is unchanged and visitors can see the current file after refreshing or reopening it.

### Published Site

1. Find the existing site with `app_drive_site_list` and keep its `siteId` and `sourceFolderItemId`. Update the remembered source folder rather than creating another folder or site.
2. For a complete local build folder, call `app_drive_item_get` for the source folder, then call `app_drive_folder_upload` with the source folder's current parent and name so the upload merges into that folder. For individual files, upload them to their existing source paths and names.
3. Folder upload overwrites and adds files but does not remove Drive files missing from the local build. If the user requests an exact mirror, list the differences and confirm deletions separately before deleting anything.
4. After the source update succeeds:
   - If the user explicitly asked to update the public site, publish the update, redeploy, or synchronize the live website, call `app_drive_site_republish` with the existing `siteId` without asking again.
   - If the user asked only to update or synchronize the Drive source files, finish the upload and ask whether to republish the public site.
5. Never call `app_drive_site_create` for an ordinary update. Republishing preserves the `/sites/<siteId>/` URL and switches deployments only after the new copy succeeds.
6. If source upload fails, do not republish. If republishing fails, report that the Drive source was updated but the previous public deployment remains online.

### Visitor Refresh Behavior

Updating either route does not live-reload pages already open in a visitor's browser. Tell the user that no new link is needed, but visitors must refresh or reopen the page. Public site HTML revalidates on refresh; unchanged CSS, JavaScript, image, or font URLs may remain cached for up to five minutes. Password-protected site assets are not stored in the browser cache.

## Default Flow

1. Apply **Upload Destination Selection**. Only a single local file with no requested destination goes directly to the Drive root; a local folder or multiple selected files use one shared Drive folder.
2. When listing a folder with `app_drive_item_list`, pass `limit` for large folders and continue with `page.nextOffset` until `page.hasMore` is false.
3. For a single local file, call `app_drive_file_upload` with `filePath`, optional `parentId`, optional `name`, and optional `mimeType`.
4. For a local folder, call `app_drive_folder_upload` with `folderPath`, optional `parentId`, and optional `folderName`. Preserve `uploadedFiles[].relativePath` and `createdDirectories[].relativePath` from the result.
   - Uploading a same-name file to the same Drive folder overwrites the existing newest active file while preserving its item id and share links.
   - Uploading a same-name folder merges into the existing folder; same-name files inside it are overwritten and missing files are added.
   - Empty subdirectories inside the local folder are preserved in Drive.
4. To open or preview an item for the owner, call `app_drive_item_preview_get`. It returns the browser snapshot, preview metadata, children, and available download/render URLs without creating a share.
5. To read a small previewable text file, call `app_drive_file_content_read`. Use `app_drive_file_download_create` instead for binary, oversized, or non-previewable files.
6. To save Drive content locally, call `app_drive_file_download_create` for a file, `app_drive_file_version_download_create` for a specific file version, or `app_drive_folder_zip_create` for a folder. These tools write to the local filesystem and require write permission.
7. If the user asks to upload to `公开素材`, upload to a `图床`, generate a `直链`, generate an `外链`, create a `public asset`, or create a `direct link`, call `app_drive_direct_link_upload`. Public assets support PNG/JPG/JPEG/GIF/WebP/AVIF/ICO images and PDF/DOCX/XLSX/PPTX/TXT/MD/CSV documents, do not support SVG, are flat, and allow duplicate names; every upload creates a new asset id and `/files/<assetId>` URL. Images open inline and documents download as attachments.
8. If the user asks to replace an existing public asset, call `app_drive_direct_link_update` with `assetId` and `filePath`. The `/files/<assetId>` URL is preserved. Images can replace images, and documents can replace documents; the two categories cannot replace each other.
9. If the user asks to rename an existing public asset, call `app_drive_direct_link_rename` with `assetId` and `name`. The `/files/<assetId>` URL is preserved.
10. If the user asks to share an existing Drive file or folder, call `app_drive_share_create` for the item and return the `/share/...` public URL.
   - When a share already exists, omit access settings unless the user explicitly asks to change password, expiry, or edit access. Reusing an existing share preserves its current settings.
   - Pass `passwordEnabled: false` only when the user asks for a no-password link. Otherwise omit it and let the current Synapse version apply its default.
   - Pass `expiresIn` when the user asks for a specific duration. Supported values are `3d`, `7d`, `30d`, `1y`, and `forever`; otherwise omit it and let the current Synapse version apply its default.
   - Pass `accessMode: "link_read"` for a new read-only link, `accessMode: "link_edit"` when logged-in link holders may edit supported text files, or `accessMode: "specified_users_edit"` with `editorEmails` when only specific logged-in users may edit.
   - Do not pass `editorEmails` for read-only or link-edit links. For `specified_users_edit`, provide one or more email addresses.
   - Use the `app_drive_share_create` result when the user needs the password for a specific share. `app_drive_share_list` lists existing shares without returning passwords.
11. After applying **HTML Sharing Route**, call `app_drive_site_create` for a Drive folder containing a multi-file static website, build bundle, multi-page HTML prototype, or product prototype site, or when the user explicitly asks to publish the whole folder as a webpage share. A folder containing only `index.html` is valid in the explicit whole-folder case. Webpage shares use `/sites/<siteId>/`, copy the folder at publish time, and do not grant Drive browse or edit access.
   - Use `sourceFolderItemId`, `name`, `accessMode`, and `expiresIn`.
   - Set `entryPath` only when the homepage is not the default `index.html`.
   - Use `accessMode: "public"` for open sites or `accessMode: "password"` when the user asks for a password. Pass `password` only when the user provides a custom site password. Site MCP results never return passwords, so ask for a custom password when the user needs a known value.
   - Use `app_drive_site_list`, `app_drive_site_update_access`, `app_drive_site_disable`, `app_drive_site_enable`, `app_drive_site_delete`, and `app_drive_site_republish` for existing site management.
   - Site tools return `password: null` and `urlWithPassword` equal to `url`; do not infer or reveal site passwords from tool results.
12. If a folder needs to exist first, call `app_drive_folder_create`, then pass the returned folder id as `parentId`.
13. To organize the user's Drive, call `app_drive_stats_get` and `app_drive_item_tree_list` first. Classify primarily from metadata such as name, path, extension, MIME type, size, and timestamps.
14. Only read file content when it is necessary, and only for a small number of text-like candidates. Use `app_drive_file_content_read` one file at a time. Do not attempt bulk content reads; Drive MCP does not provide a batch file-content API.
15. Use `app_drive_folder_path_ensure` to create or reuse target category folders, then call `app_drive_reorganization_preview` with item ids and target folder ids. For moves back to Drive root, set `targetParentId` to `null`. Show the preview summary to the user before applying.
16. Apply organization changes only with `app_drive_reorganization_apply` and the `planId` returned by the preview. Do not submit raw moves to apply.
17. For file history, call `app_drive_file_version_list` first. Use `app_drive_file_version_restore` only when the user wants that version to become current, `app_drive_file_version_delete` only for non-current, unpinned versions the user wants removed, and `app_drive_file_version_pin_update` to keep or unkeep a version during automatic cleanup. Skip versions marked `deletePending` or shown as pending cleanup; they cannot be downloaded, restored, pinned, or deleted again until cleanup retry finishes. If a historical version is pinned/retained, call `app_drive_file_version_pin_update` with `isPinned: false` before deleting it. If delete returns `deletePending: true`, tell the user the version is marked for cleanup instead of fully removed.
18. Use `app_drive_trash_list` to inspect user-visible trash. Restore rows from that list with `app_drive_item_restore`; pass `kind` and `assetId` when the row kind is `public_asset`. Use `app_drive_direct_link_restore` only when the user directly provides a public asset id. Use `app_drive_trash_delete` only when the user clearly asks to remove an item from their visible trash.
19. Report the final item name, item id, share URL, public asset URL, or site URL when one was created.

## Safety

Never reveal COS AK, SK, Authorization headers, local secrets, share or site passwords from list results, or presigned upload URLs. Drive upload tools should return item and share results only; if an error includes a signed query string, summarize the failure without copying the sensitive URL.

Before deleting a file, folder, public asset, trash item, or disabling a share, make sure the user asked for that operation clearly.

`app_drive_item_delete` and `app_drive_direct_link_delete` move items to Drive trash. Deleting a Drive file or folder temporarily disables its `/share/...` links, including shares for files inside a deleted folder. Restoring the item reactivates share links that were disabled by that delete operation; shares manually disabled before the delete stay disabled. A trashed public asset keeps its asset id, but `/files/<assetId>` returns 404 until restored. `app_drive_trash_delete` hides a trashed item from ordinary user views; admins can still see and restore it.

Shares use `/share/...` and let others browse files and folders, render previewable HTML, download content, and, when the owner chooses an editable mode, edit supported text files after login. HTML shares are live links to the current Drive file, not static site snapshots.

Share editors cannot see version history through public share links. Editable shares update the owner's Drive file and create normal file versions owned by the file owner.

Sites use `/sites/<siteId>/` and are read-only static snapshots copied from a Drive folder. Site access settings do not change Drive shares, Drive item permissions, or public asset URLs.

Drive organization changes can move many user files. Always preview first, then apply by `planId` only after the user has confirmed. If apply reports that the Drive changed, refresh the tree and create a new preview.

File versions are full-copy history for owned Drive files. Public share links always point to the current file and do not expose version history. Restoring a version creates a new current version; deleting a historical version cannot be undone. Versions marked `deletePending` are cleanup placeholders and are not actionable. Pinned/retained versions must be unpinned before deletion.

Public asset access logs are admin-only and are not available through MCP. Do not invent or request access-log tools.

## Common Requests

- "用 Synapse Skill 把这个 Markdown 上传到云盘": apply **Local Markdown Publishing Flow**; preserve and upload supported relative images before the Markdown, publish referenced local HTML separately, but do not share the Markdown itself.
- "用 Synapse Skill 把这个 Markdown 上传到云盘并分享": apply **Local Markdown Publishing Flow**, then share the uploaded Markdown item separately.
- "把这几个文件上传到云盘": apply **Upload Destination Selection** and place every ordinary Drive item in the automatically named shared folder.
- "上传这个文件并给我链接": call `app_drive_file_upload`, then `app_drive_share_create`.
- "把这个单文件 HTML 做成网站": call `app_drive_file_upload`, then `app_drive_share_create` when it is standalone and the user did not explicitly ask to publish its whole folder.
- "发布这个包含 assets 的构建目录": call `app_drive_folder_upload`, then `app_drive_site_create`.
- "上传到公开素材": call `app_drive_direct_link_upload`.
- "上传到图床": call `app_drive_direct_link_upload`.
- "生成直链": call `app_drive_direct_link_upload`.
- "生成外链": call `app_drive_direct_link_upload`.
- "分享云盘文件": call `app_drive_share_create`.
- "将这个文件夹创建为网页分享": inspect the folder, then call `app_drive_site_create`; a folder containing only `index.html` is valid.
- "把这个多页 HTML 原型发成网站": call `app_drive_site_create`.
- "更新网页分享": call `app_drive_site_republish`.
- "更新这个分享网页并同步云盘": overwrite the existing Drive item with `app_drive_file_upload`; keep the existing share and do not call `app_drive_share_create`.
- "更新网页分享的源文件并同步线上": update the remembered source folder, then call `app_drive_site_republish` with the existing site id.
- "只更新网页分享的云盘文件": update the remembered source folder, then ask whether to update the webpage share.
- "管理网页分享": call `app_drive_site_list`.
- "停止网页分享": call `app_drive_site_disable`.
- "恢复网页分享": call `app_drive_site_enable`.
- "删除网页分享": call `app_drive_site_delete`.
- "把这个目录传到云盘": apply **Upload Destination Selection**, then call `app_drive_folder_upload` so the Drive folder uses the local folder basename.
- "打开/预览这个文件": call `app_drive_item_preview_get`.
- "读取这个 Markdown": call `app_drive_file_content_read`.
- "下载这个文件到本地": call `app_drive_file_download_create`.
- "下载 v3 历史版本": call `app_drive_file_version_list`, then `app_drive_file_version_download_create` with the selected version id.
- "恢复到上一个版本": call `app_drive_file_version_list`, then `app_drive_file_version_restore` with the selected version id.
- "保留这个历史版本": call `app_drive_file_version_pin_update`.
- "下载整个文件夹": call `app_drive_folder_zip_create`.
- "新建一个资料文件夹": call `app_drive_folder_create`.
- "移动到某个文件夹": call `app_drive_item_move` with the target folder id.
- "重命名": call `app_drive_item_rename`.
- "分享这个 HTML": call `app_drive_share_create`.
- "替换公开素材": call `app_drive_direct_link_update`.
- "重命名公开素材": call `app_drive_direct_link_rename`.
- "恢复公开素材": call `app_drive_direct_link_restore`.
- "查看回收站": call `app_drive_trash_list`.
- "从回收站恢复": call `app_drive_item_restore`; include `kind` and `assetId` for `public_asset` trash rows.
- "公开链接列表": call `app_drive_share_list`.
- "看看云盘空间": call `app_drive_usage_get`.
- "整理我的云盘": call `app_drive_stats_get`, `app_drive_item_tree_list`, optional small per-file `app_drive_file_content_read`, `app_drive_folder_path_ensure`, `app_drive_reorganization_preview`, then `app_drive_reorganization_apply` with the returned `planId`.
- "分析这个云盘分享链接": call `app_drive_link_resolve`, then `app_drive_link_list` or `app_drive_link_read_text`.
- "读取这个需求链接": call `app_drive_link_read_text`.
- "分析这个 HTML 原型站点": call `app_drive_link_resolve`, `app_drive_link_list`, then `app_drive_link_materialize` when local files are useful.
- "下载这个公开素材": call `app_drive_link_download_file`.

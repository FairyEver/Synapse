import Observation
import SwiftUI
import UIKit

struct WorkspaceFilesNativeLocation: Equatable {
    let rowID: String
    let generation: Int
}

enum WorkspaceFilesNativeHeightClass: Hashable {
    case file, searchFile
}

nonisolated private struct WorkspaceFilesNativeGeometry: Equatable, Sendable {
    let rowID: String
    let revision: Int
    let dynamicTypeSize: DynamicTypeSize
    let size: CGSize
}

/// UIKit creates and reuses the hosted cells; the input array contains only row
/// metadata. Stable identifiers also keep actions independent of index paths.
struct WorkspaceFilesNativeTable<Row: Identifiable & Equatable, Content: View>: UIViewRepresentable where Row.ID == String {
    let rows: [Row]
    let ownerContext: String
    let viewContext: String
    let location: WorkspaceFilesNativeLocation?
    let dynamicTypeSize: DynamicTypeSize
    var estimateIntent: Int? = nil
    var resetTokens: [String: String] = [:]
    let heightClass: (Row) -> WorkspaceFilesNativeHeightClass?
    let cellIdentifier: (Row) -> String
    let nativeItem: (Row) -> WorkspaceFilesNativeEntry?
    let onPrimaryAction: (Row) -> Void
    let menuItems: (Row) -> [WorkspaceFilesNativeMenuAction]
    let onMenuAction: (Row, String) -> Void
    let content: (Row) -> Content
    let onLocationVisible: (WorkspaceFilesNativeLocation) -> Void

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> UITableView {
        let table = WorkspaceFilesNativeTableView(frame: .zero, style: .plain)
        table.rowHeight = UITableView.automaticDimension
        table.estimatedRowHeight = UITableView.automaticDimension
        table.allowsSelection = true
        table.accessibilityIdentifier = "files-browser"
        context.coordinator.attach(to: table)
        return table
    }

    func updateUIView(_ table: UITableView, context: Context) {
        context.coordinator.update(self, environment: context.environment)
    }

    static func dismantleUIView(_ table: UITableView, coordinator: Coordinator) {
        coordinator.detach()
    }

    final class Coordinator: NSObject, UITableViewDelegate {
        // Avoid the Swift 6.3 Release optimizer crash on a synthesized
        // deinitializer for this generic class; stored fields still release normally.
        deinit {}

        private weak var table: WorkspaceFilesNativeTableView?
        private var dataSource: UITableViewDiffableDataSource<Int, String>?
        private var hostingSource: WorkspaceFilesNativeHostingSource<Row, Content>?
        private var rowsByID: [String: Row] = [:]
        private var configuredRowsByID: [String: Row] = [:]
        private var rowIDs: [String] = []
        private var ownerContext: String?
        private var viewContext: String?
        private var resetTokens: [String: String] = [:]
        private var readingAnchors: [String: String] = [:]
        private var currentLocation: WorkspaceFilesNativeLocation?
        private var pendingLocation: LocationRequest?
        private var pendingAnchor: String?
        private var ticket = 0
        private var applyingSnapshot = false
        private var snapshotMatchesRows = false
        private var handlingMovement = false
        private var onLocationVisible: ((WorkspaceFilesNativeLocation) -> Void)?
        private var heightLayout: HeightLayout?
        private var measuredHeights: [HeightKey: MeasuredHeight] = [:]
        private var heightOrder: [(key: HeightKey, sequence: Int)?] = Array(repeating: nil, count: 512)
        private var heightOrderIndex = 0
        private var heightSequence = 0
        private var heightSamples: [HeightClassKey: [(key: HeightKey, height: CGFloat)]] = [:]
        private var heightMedians: [HeightClassKey: CGFloat] = [:]
        private var lastEstimateIntent: EstimateIntent?
        private var pendingEstimateIntent: EstimateIntent?
        private var frozenEstimates: FrozenEstimates?
        private var heightClass: ((Row) -> WorkspaceFilesNativeHeightClass?)?
        private var cellIdentifier: ((Row) -> String)?
        private var nativeItems: [String: WorkspaceFilesNativeEntry] = [:]
        private var onPrimaryAction: ((Row) -> Void)?
        private var menuItems: ((Row) -> [WorkspaceFilesNativeMenuAction])?
        private var onMenuAction: ((Row, String) -> Void)?
        private var nativeFittedGeometry: [String: NativeFittedGeometry] = [:]
        private var hostedGeometry: [String: WorkspaceFilesNativeGeometry] = [:]
        private var fittedGeometry: [String: FittedGeometry] = [:]
        private var fontEpoch = 0
        private var fontRestore: FontRestore?
        private struct FittedGeometry {
            let geometry: WorkspaceFilesNativeGeometry
            let width: CGFloat
            let height: CGFloat
        }
        private struct NativeFittedGeometry {
            let entry: WorkspaceFilesNativeEntry
            let revision: Int
            let width: CGFloat
            let category: UIContentSizeCategory
            let height: CGFloat
        }
        private struct FontRestore {
            let rowID: String
            let owner: String
            let view: String
            let ticket: Int
            let epoch: Int
            let category: UIContentSizeCategory
        }

        private struct HeightLayout: Equatable {
            let owner: String
            let width: CGFloat
            let dynamicTypeSize: DynamicTypeSize
            let nativeCategory: UIContentSizeCategory
            let locale: Locale
            let direction: LayoutDirection
            let legibility: UILegibilityWeight
        }
        private struct HeightKey: Hashable { let view: String; let rowID: String }
        private struct HeightClassKey: Hashable { let view: String; let kind: WorkspaceFilesNativeHeightClass }
        private struct EstimateIntent: Equatable {
            let owner: String
            let view: String
            let generation: Int
        }
        private struct FrozenEstimates {
            let intent: EstimateIntent
            let layout: HeightLayout
            let values: [WorkspaceFilesNativeHeightClass: CGFloat]
        }
        private struct MeasuredHeight {
            let row: Row
            let kind: WorkspaceFilesNativeHeightClass
            let height: CGFloat
            let sequence: Int
        }

        private struct LocationRequest {
            let location: WorkspaceFilesNativeLocation
            let ownerContext: String
            let viewContext: String
            let ticket: Int
            var didScroll = false
            var receiptQueued = false
        }

        fileprivate func attach(to table: WorkspaceFilesNativeTableView) {
            self.table = table
            table.delegate = self
            table.register(UITableViewCell.self, forCellReuseIdentifier: "workspace-file")
            table.register(WorkspaceFilesNativeEntryCell.self,
                forCellReuseIdentifier: WorkspaceFilesNativeEntryCell.reuseIdentifier)
            table.onLayout = { [weak self] in
                self?.collectVisibleHeights()
                self?.performPendingMovement()
            }
            table.onWindow = { [weak self] in self?.performPendingMovement() }
            table.registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) {
                [weak self] (_: WorkspaceFilesNativeTableView, _: UITraitCollection) in
                // Invalidate even when two category changes occur before the
                // next native layout; returning to the old key cannot revive it.
                self?.frozenEstimates = nil
                self?.pendingEstimateIntent = nil
            }
            dataSource = UITableViewDiffableDataSource<Int, String>(tableView: table) { [weak self] table, indexPath, rowID in
                guard let self, let row = self.rowsByID[rowID], let source = self.hostingSource else {
                    let cell = table.dequeueReusableCell(withIdentifier: "workspace-file", for: indexPath)
                    cell.contentConfiguration = nil
                    return cell
                }
                if let entry = self.nativeItems[rowID] {
                    let cell = table.dequeueReusableCell(
                        withIdentifier: WorkspaceFilesNativeEntryCell.reuseIdentifier, for: indexPath)
                    if let nativeCell = cell as? WorkspaceFilesNativeEntryCell { nativeCell.configure(entry) }
                    return cell
                }
                let cell = table.dequeueReusableCell(withIdentifier: "workspace-file", for: indexPath)
                cell.accessibilityIdentifier = self.cellIdentifier?(row)
                cell.contentConfiguration = UIHostingConfiguration {
                    WorkspaceFilesNativeHostedRow(row: row, source: source)
                }
                return cell
            }
        }

        fileprivate func update(_ input: WorkspaceFilesNativeTable, environment: EnvironmentValues) {
            snapshotMatchesRows = false
            let ownerChanged = ownerContext != input.ownerContext
            let viewChanged = viewContext != input.viewContext
            let changedResetContexts = input.resetTokens.keys.filter {
                resetTokens[$0] != nil && resetTokens[$0] != input.resetTokens[$0]
            }
            let resetChanged = !ownerChanged && changedResetContexts.contains(input.viewContext)
            let locationChanged = ownerChanged || viewChanged || currentLocation != input.location
            if !ownerChanged, viewChanged { rememberLeadingRow() }
            if ownerChanged { readingAnchors.removeAll() }
            for context in changedResetContexts { readingAnchors.removeValue(forKey: context) }

            let source: WorkspaceFilesNativeHostingSource<Row, Content>
            if let existing = hostingSource {
                source = existing
                source.content = input.content
                source.updateEnvironment(environment, dynamicTypeSize: input.dynamicTypeSize)
                if ownerChanged || viewChanged { source.contextRevision += 1 }
            } else {
                source = WorkspaceFilesNativeHostingSource(content: input.content,
                    environment: environment, dynamicTypeSize: input.dynamicTypeSize)
                hostingSource = source
            }
            source.onGeometry = { [weak self] geometry in self?.receiveGeometry(geometry) }
            if ownerChanged || viewChanged || resetChanged {
                hostedGeometry.removeAll()
                fittedGeometry.removeAll()
                nativeFittedGeometry.removeAll()
                source.geometryRevision &+= 1
            }

            ownerContext = input.ownerContext
            viewContext = input.viewContext
            resetTokens = input.resetTokens
            heightClass = input.heightClass
            cellIdentifier = input.cellIdentifier
            nativeItems = Dictionary(uniqueKeysWithValues: input.rows.compactMap { row in
                input.nativeItem(row).map { (row.id, $0) }
            })
            onPrimaryAction = input.onPrimaryAction
            menuItems = input.menuItems
            onMenuAction = input.onMenuAction
            onLocationVisible = input.onLocationVisible
            rowIDs = input.rows.map(\.id)
            rowsByID = Dictionary(uniqueKeysWithValues: input.rows.map { ($0.id, $0) })
            for (key, cached) in measuredHeights where key.view == input.viewContext {
                guard let row = rowsByID[key.rowID], row == cached.row, heightClass?(row) == cached.kind else {
                    measuredHeights.removeValue(forKey: key)
                    removeHeightSample(key, classKey: HeightClassKey(view: key.view, kind: cached.kind))
                    continue
                }
            }

            if locationChanged {
                ticket += 1
                fontRestore = nil
                currentLocation = input.location
                pendingLocation = input.location.map {
                    LocationRequest(location: $0, ownerContext: input.ownerContext,
                        viewContext: input.viewContext, ticket: ticket)
                }
                pendingAnchor = nil
                if input.location == nil, ownerChanged || viewChanged {
                    pendingAnchor = readingAnchors[input.viewContext] ?? rowIDs.first
                }
            }
            if resetChanged {
                if !locationChanged { ticket += 1 }
                fontRestore = nil
                if input.location == nil {
                    readingAnchors.removeValue(forKey: input.viewContext)
                    pendingAnchor = rowIDs.first
                } else if !locationChanged, let request = pendingLocation {
                    pendingLocation = LocationRequest(location: request.location,
                        ownerContext: request.ownerContext, viewContext: request.viewContext,
                        ticket: ticket, didScroll: request.didScroll)
                }
            }
            if let generation = input.estimateIntent {
                let intent = EstimateIntent(owner: input.ownerContext, view: input.viewContext, generation: generation)
                if lastEstimateIntent != intent {
                    lastEstimateIntent = intent
                    pendingEstimateIntent = intent
                    frozenEstimates = nil
                }
                captureEstimatesIfReady()
            } else {
                pendingEstimateIntent = nil
            }
            applySnapshotIfNeeded()
        }

        private func applySnapshotIfNeeded() {
            guard !applyingSnapshot, let dataSource else { return }
            let existingIDs = dataSource.snapshot().itemIdentifiers
            let existingSet = Set(existingIDs)
            let changedIDs = rowIDs.filter {
                existingSet.contains($0) && configuredRowsByID[$0] != rowsByID[$0]
            }
            guard existingIDs != rowIDs || !changedIDs.isEmpty else {
                snapshotMatchesRows = true
                performPendingMovement()
                return
            }
            var snapshot = NSDiffableDataSourceSnapshot<Int, String>()
            snapshot.appendSections([0])
            snapshot.appendItems(rowIDs, toSection: 0)
            snapshot.reconfigureItems(changedIDs)
            configuredRowsByID = rowsByID
            applyingSnapshot = true
            dataSource.apply(snapshot, animatingDifferences: false) { [weak self] in
                guard let self else { return }
                self.applyingSnapshot = false
                // A newer update may have arrived while UIKit applied the snapshot.
                self.applySnapshotIfNeeded()
            }
        }

        private func currentHeightLayout() -> HeightLayout? {
            guard let table, let ownerContext, let source = hostingSource else { return nil }
            let scale = table.window?.screen.scale ?? table.traitCollection.displayScale
            guard scale > 0, table.bounds.width > 0 else { return nil }
            return HeightLayout(owner: ownerContext,
                width: (table.bounds.width * scale).rounded() / scale,
                dynamicTypeSize: source.dynamicTypeSize,
                nativeCategory: table.traitCollection.preferredContentSizeCategory,
                locale: source.locale, direction: source.layoutDirection,
                legibility: table.traitCollection.legibilityWeight)
        }

        private func refreshHeightLayout() {
            guard let table, let ownerContext, let source = hostingSource,
                  let layout = currentHeightLayout() else { return }
            guard heightLayout != layout else { return }
            // An estimate belongs to one explicit location's original layout.
            // A font/width transition must use UIKit's current automatic estimate,
            // rather than replacing that intent with a succession of new medians.
            if let previous = heightLayout, previous != layout {
                frozenEstimates = nil
                if previous.owner == layout.owner { pendingEstimateIntent = nil }
            }
            if let previous = heightLayout, previous.owner == layout.owner,
               previous.nativeCategory != layout.nativeCategory {
                fontEpoch &+= 1
                // This identifier was recorded by the preceding native layout,
                // before the new category changed row geometry or estimates.
                if pendingLocation == nil, pendingAnchor == nil,
                   !table.isDragging, !table.isDecelerating, let viewContext,
                   let anchor = readingAnchors[viewContext], rowsByID[anchor] != nil {
                    fontRestore = FontRestore(rowID: anchor, owner: ownerContext,
                        view: viewContext, ticket: ticket, epoch: fontEpoch,
                        category: layout.nativeCategory)
                } else { fontRestore = nil }
            }
            heightLayout = layout
            measuredHeights.removeAll()
            heightSamples.removeAll()
            heightMedians.removeAll()
            heightOrder = Array(repeating: nil, count: 512)
            heightOrderIndex = 0
            hostedGeometry.removeAll()
            fittedGeometry.removeAll()
            nativeFittedGeometry.removeAll()
            source.geometryRevision &+= 1
        }

        private func captureEstimatesIfReady() {
            guard let intent = pendingEstimateIntent, intent.owner == ownerContext,
                  intent.view == viewContext, let current = currentHeightLayout(),
                  heightLayout == current,
                  UIContentSizeCategory(current.dynamicTypeSize) == current.nativeCategory else { return }
            var values: [WorkspaceFilesNativeHeightClass: CGFloat] = [:]
            for kind in [WorkspaceFilesNativeHeightClass.file, .searchFile] {
                if let height = heightMedians[HeightClassKey(view: intent.view, kind: kind)] {
                    values[kind] = height
                }
            }
            guard !values.isEmpty else { return }
            frozenEstimates = FrozenEstimates(intent: intent, layout: current, values: values)
            pendingEstimateIntent = nil
        }

        private func receiveGeometry(_ geometry: WorkspaceFilesNativeGeometry) {
            guard let source = hostingSource, rowsByID[geometry.rowID] != nil,
                  geometry.revision == source.geometryRevision,
                  geometry.size.width.isFinite, geometry.size.width > 0,
                  geometry.size.height.isFinite, geometry.size.height > 0,
                  hostedGeometry[geometry.rowID] != geometry else { return }
            if hostedGeometry[geometry.rowID] == nil, hostedGeometry.count == 512,
               let expired = hostedGeometry.keys.first {
                hostedGeometry.removeValue(forKey: expired)
                fittedGeometry.removeValue(forKey: expired)
            }
            hostedGeometry[geometry.rowID] = geometry
            fittedGeometry.removeValue(forKey: geometry.rowID)
            table?.setNeedsLayout()
        }

        /// Only a currently hosted, already visible row is fitted. The result
        /// includes the native cell's layout and is reused until
        /// that row reports a different geometry or the layout epoch changes.
        private func hasCurrentNativeGeometry(_ cell: UITableViewCell, rowID: String) -> Bool {
            if let nativeCell = cell as? WorkspaceFilesNativeEntryCell {
                return hasCurrentEntryGeometry(nativeCell, rowID: rowID)
            }
            guard let table, let source = hostingSource, let geometry = hostedGeometry[rowID],
                  geometry.revision == source.geometryRevision,
                  geometry.dynamicTypeSize == source.dynamicTypeSize,
                  UIContentSizeCategory(geometry.dynamicTypeSize) == table.traitCollection.preferredContentSizeCategory,
                  cell.traitCollection.preferredContentSizeCategory == table.traitCollection.preferredContentSizeCategory,
                  cell.contentView.bounds.width > 0 else { return false }
            let width = cell.contentView.bounds.width
            let fit: FittedGeometry
            if let cached = fittedGeometry[rowID], cached.geometry == geometry, cached.width == width {
                fit = cached
            } else {
                let height = cell.systemLayoutSizeFitting(
                    CGSize(width: cell.bounds.width, height: UIView.layoutFittingCompressedSize.height),
                    withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel).height
                fit = FittedGeometry(geometry: geometry, width: width, height: height)
                fittedGeometry[rowID] = fit
            }
            let scale = table.window?.screen.scale ?? table.traitCollection.displayScale
            return scale > 0 && fit.height.isFinite && fit.height > 0 &&
                (fit.height * scale).rounded() == (cell.bounds.height * scale).rounded()
        }

        /// Native list content owns its Dynamic Type layout. Its evidence is
        /// the configured metadata and current native traits, rather than a
        /// synthetic geometry report from a SwiftUI view that it does not host.
        private func hasCurrentEntryGeometry(_ cell: WorkspaceFilesNativeEntryCell, rowID: String) -> Bool {
            guard let table, let source = hostingSource, let entry = nativeItems[rowID],
                  cell.presentedEntry == entry, rowsByID[rowID] != nil,
                  UIContentSizeCategory(source.dynamicTypeSize) == table.traitCollection.preferredContentSizeCategory,
                  cell.traitCollection.preferredContentSizeCategory == table.traitCollection.preferredContentSizeCategory,
                  cell.bounds.width > 0 else { return false }
            let category = cell.traitCollection.preferredContentSizeCategory
            let fit: NativeFittedGeometry
            if let cached = nativeFittedGeometry[rowID], cached.entry == entry,
               cached.revision == source.geometryRevision, cached.width == cell.bounds.width,
               cached.category == category {
                fit = cached
            } else {
                let height = cell.systemLayoutSizeFitting(
                    CGSize(width: cell.bounds.width, height: UIView.layoutFittingCompressedSize.height),
                    withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel).height
                fit = NativeFittedGeometry(entry: entry, revision: source.geometryRevision,
                    width: cell.bounds.width, category: category, height: height)
                if nativeFittedGeometry[rowID] == nil, nativeFittedGeometry.count == 512,
                   let expired = nativeFittedGeometry.keys.first { nativeFittedGeometry.removeValue(forKey: expired) }
                nativeFittedGeometry[rowID] = fit
            }
            let scale = table.window?.screen.scale ?? table.traitCollection.displayScale
            return scale > 0 && fit.height.isFinite && fit.height > 0 &&
                (fit.height * scale).rounded() == (cell.bounds.height * scale).rounded()
        }

        /// Measure only cells UIKit has already laid out on screen. Dynamic
        /// directory/controls bodies do not provide a stable height class.
        private func collectVisibleHeights() {
            guard !applyingSnapshot, snapshotMatchesRows,
                  let table, let dataSource, let viewContext else { return }
            refreshHeightLayout()
            guard heightLayout != nil else { return }
            var hasCurrentLayout = false
            for cell in table.visibleCells {
                guard let indexPath = table.indexPath(for: cell),
                      let rowID = dataSource.itemIdentifier(for: indexPath),
                      let row = rowsByID[rowID],
                      cell.bounds.height.isFinite, cell.bounds.height > 0,
                      hasCurrentNativeGeometry(cell, rowID: rowID) else { continue }
                hasCurrentLayout = true
                guard let kind = heightClass?(row) else { continue }
                let key = HeightKey(view: viewContext, rowID: rowID)
                let classKey = HeightClassKey(view: viewContext, kind: kind)
                let height = cell.bounds.height
                if let old = measuredHeights[key], old.row == row, old.kind == kind, old.height == height { continue }
                let sequence: Int
                if let old = measuredHeights[key] {
                    sequence = old.sequence
                    if old.kind != kind {
                        removeHeightSample(key, classKey: HeightClassKey(view: viewContext, kind: old.kind))
                    }
                } else {
                    heightSequence &+= 1
                    sequence = heightSequence
                    if let old = heightOrder[heightOrderIndex], measuredHeights[old.key]?.sequence == old.sequence {
                        measuredHeights.removeValue(forKey: old.key)
                    }
                    heightOrder[heightOrderIndex] = (key, sequence)
                    heightOrderIndex = (heightOrderIndex + 1) % heightOrder.count
                }
                measuredHeights[key] = MeasuredHeight(row: row, kind: kind, height: height, sequence: sequence)
                var samples = heightSamples[classKey] ?? []
                samples.removeAll { $0.key == key }
                samples.append((key, height))
                if samples.count > 7 { samples.removeFirst() }
                heightSamples[classKey] = samples
                let values = samples.map(\.height).sorted()
                heightMedians[classKey] = values[values.count / 2]
            }
            captureEstimatesIfReady()
            let restored = hasCurrentLayout && restoreFontAnchorIfReady()
            if fontRestore == nil, pendingLocation == nil, pendingAnchor == nil,
               UIContentSizeCategory(hostingSource?.dynamicTypeSize ?? .large) == table.traitCollection.preferredContentSizeCategory,
               readingAnchors[viewContext] == nil,
               hasCurrentLayout, !restored, !handlingMovement, !table.isDragging, !table.isDecelerating {
                // Initialize a new role's reading position. Later native
                // self-sizing layouts must not turn their transient position
                // into a new reading intent; user scrolling and explicit
                // location receipts update that identity separately.
                rememberLeadingRow()
            }
        }

        private func restoreFontAnchorIfReady() -> Bool {
            guard let request = fontRestore, let table, let dataSource, let source = hostingSource,
                  request.owner == ownerContext, request.view == viewContext,
                  request.ticket == ticket, request.epoch == fontEpoch,
                  request.category == table.traitCollection.preferredContentSizeCategory,
                  UIContentSizeCategory(source.dynamicTypeSize) == request.category,
                  pendingLocation == nil, pendingAnchor == nil, !handlingMovement,
                  !table.isDragging, !table.isDecelerating, isLaidOutInVisibleViewport(table),
                  let indexPath = dataSource.indexPath(for: request.rowID),
                  let row = rowsByID[request.rowID] else { return false }
            // A completed control row alone cannot provide the new epoch's
            // estimate for ordinary file rows that have not been created yet.
            if let kind = heightClass?(row),
               heightMedians[HeightClassKey(view: request.view, kind: kind)] == nil { return false }
            fontRestore = nil
            handlingMovement = true
            table.scrollToRow(at: indexPath, at: .top, animated: false)
            handlingMovement = false
            return true
        }

        private func removeHeightSample(_ key: HeightKey, classKey: HeightClassKey) {
            guard var samples = heightSamples[classKey] else { return }
            samples.removeAll { $0.key == key }
            heightSamples[classKey] = samples
            let values = samples.map(\.height).sorted()
            heightMedians[classKey] = values.isEmpty ? nil : values[values.count / 2]
        }

        func tableView(_ tableView: UITableView, estimatedHeightForRowAt indexPath: IndexPath) -> CGFloat {
            guard let dataSource, let viewContext,
                  let rowID = dataSource.itemIdentifier(for: indexPath), let row = rowsByID[rowID],
                  let kind = heightClass?(row) else { return UITableView.automaticDimension }
            // Native height enumeration only reads measurements from the same
            // completed layout epoch. It never invalidates or measures cells.
            if nativeItems[rowID] != nil {
                guard let current = currentHeightLayout(), let frozen = frozenEstimates,
                      frozen.intent.owner == ownerContext, frozen.intent.view == viewContext,
                      frozen.layout == current,
                      UIContentSizeCategory(current.dynamicTypeSize) == current.nativeCategory else {
                    return UITableView.automaticDimension
                }
                return frozen.values[kind] ?? UITableView.automaticDimension
            }
            refreshHeightLayout()
            let key = HeightKey(view: viewContext, rowID: rowID)
            let exact = measuredHeights[key].flatMap { $0.row == row && $0.kind == kind ? $0.height : nil }
            let estimate = exact ?? heightMedians[HeightClassKey(view: viewContext, kind: kind)] ?? UITableView.automaticDimension
            return estimate
        }

        private func performPendingMovement() {
            guard pendingLocation != nil || pendingAnchor != nil,
                  !applyingSnapshot, !handlingMovement, let table, let dataSource,
                  dataSource.snapshot().itemIdentifiers == rowIDs,
                  isLaidOutInVisibleViewport(table) else { return }
            handlingMovement = true
            defer { handlingMovement = false }
            if var request = pendingLocation {
                guard isCurrent(request), let indexPath = dataSource.indexPath(for: request.location.rowID),
                      dataSource.itemIdentifier(for: indexPath) == request.location.rowID else { return }
                if !request.didScroll {
                    request.didScroll = true
                    pendingLocation = request
                    table.layoutIfNeeded()
                    table.scrollToRow(at: indexPath, at: .top, animated: false)
                    table.layoutIfNeeded()
                }
                queueReceiptIfVisible()
            } else if let anchor = pendingAnchor,
                      let indexPath = dataSource.indexPath(for: anchor),
                      dataSource.itemIdentifier(for: indexPath) == anchor {
                pendingAnchor = nil
                table.layoutIfNeeded()
                table.scrollToRow(at: indexPath, at: .top, animated: false)
                table.layoutIfNeeded()
            }
        }

        private func isCurrent(_ request: LocationRequest) -> Bool {
            request.ticket == ticket && request.ownerContext == ownerContext &&
                request.viewContext == viewContext && request.location == currentLocation
        }

        private func queueReceiptIfVisible() {
            guard var request = pendingLocation, request.didScroll, !request.receiptQueued,
                  isCurrent(request), isRowVisible(request.location.rowID) else { return }
            request.receiptQueued = true
            pendingLocation = request
            let receiptTicket = request.ticket
            // Forward the receipt outside UIViewRepresentable's update transaction.
            // This defers only the callback, never a scroll or a retry command.
            DispatchQueue.main.async { [weak self] in
                guard let self, var current = self.pendingLocation,
                      current.ticket == receiptTicket, self.isCurrent(current) else { return }
                current.receiptQueued = false
                self.pendingLocation = current
                guard self.isRowVisible(current.location.rowID) else { return }
                self.pendingLocation = nil
                self.readingAnchors[current.viewContext] = current.location.rowID
                self.onLocationVisible?(current.location)
            }
        }

        private func isRowVisible(_ rowID: String) -> Bool {
            guard !applyingSnapshot, let table, let dataSource, let indexPath = dataSource.indexPath(for: rowID),
                  dataSource.itemIdentifier(for: indexPath) == rowID,
                  table.indexPathsForVisibleRows?.contains(indexPath) == true,
                  let viewport = visibleViewport(in: table), let window = table.window else { return false }
            let rowRect = table.convert(table.rectForRow(at: indexPath), to: window)
            let intersection = rowRect.intersection(viewport)
            return !intersection.isNull && intersection.width > 0 &&
                rowRect.minY >= viewport.minY - 0.5 &&
                intersection.height >= min(rowRect.height, viewport.height) * 0.5
        }

        /// A collapsed split column can be attached to a window while still
        /// sliding or clipped to a smaller sheet detent. UIKit must receive the
        /// command using its actual visible size, not that intermediate bounds.
        private func isLaidOutInVisibleViewport(_ table: UITableView) -> Bool {
            guard let window = table.window, let visible = visibleViewport(in: table) else { return false }
            let projected = table.convert(table.bounds.inset(by: table.adjustedContentInset), to: window)
            return visible.contains(projected)
        }

        private func visibleViewport(in table: UITableView) -> CGRect? {
            guard let window = table.window, table.bounds.width > 0, table.bounds.height > 0 else { return nil }
            var viewport = table.convert(table.bounds.inset(by: table.adjustedContentInset), to: window)
                .intersection(window.bounds)
            var ancestor: UIView? = table
            while let view = ancestor {
                guard !view.isHidden, view.alpha > 0 else { return nil }
                if view.clipsToBounds {
                    viewport = viewport.intersection(view.convert(view.bounds, to: window))
                }
                ancestor = view.superview
            }
            return viewport.isNull || viewport.isEmpty ? nil : viewport
        }

        private func rememberLeadingRow() {
            guard let table, let dataSource, let viewContext,
                  let viewport = visibleViewport(in: table), let window = table.window else { return }
            let intersecting = (table.indexPathsForVisibleRows ?? []).filter { indexPath in
                let rect = table.convert(table.rectForRow(at: indexPath), to: window)
                return rect.intersects(viewport)
            }.sorted { lhs, rhs in
                lhs.section == rhs.section ? lhs.row < rhs.row : lhs.section < rhs.section
            }
            let leading = intersecting.first { indexPath in
                let rect = table.convert(table.rectForRow(at: indexPath), to: window)
                return rect.minY >= viewport.minY && rect.maxY <= viewport.maxY
            } ?? intersecting.first
            if let leading, let rowID = dataSource.itemIdentifier(for: leading), rowsByID[rowID] != nil {
                readingAnchors[viewContext] = rowID
            } else {
                readingAnchors.removeValue(forKey: viewContext)
            }
        }

        func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
            ticket += 1
            pendingLocation = nil
            pendingAnchor = nil
            fontRestore = nil
            pendingEstimateIntent = nil
        }

        func scrollViewDidScroll(_ scrollView: UIScrollView) {
            if !handlingMovement, scrollView.isDragging || scrollView.isDecelerating {
                rememberLeadingRow()
            }
        }

        func scrollViewDidEndDragging(_ scrollView: UIScrollView, willDecelerate decelerate: Bool) {
            if !decelerate { rememberLeadingRow() }
        }

        func scrollViewDidEndDecelerating(_ scrollView: UIScrollView) { rememberLeadingRow() }

        func tableView(_ tableView: UITableView, willDisplay cell: UITableViewCell, forRowAt indexPath: IndexPath) {
            queueReceiptIfVisible()
        }

        func tableView(_ tableView: UITableView, willSelectRowAt indexPath: IndexPath) -> IndexPath? {
            guard hostingSource?.isEnabled == true,
                  let rowID = dataSource?.itemIdentifier(for: indexPath), nativeItems[rowID] != nil else { return nil }
            return indexPath
        }

        func tableView(_ tableView: UITableView, canPerformPrimaryActionForRowAt indexPath: IndexPath) -> Bool {
            guard let rowID = dataSource?.itemIdentifier(for: indexPath) else { return false }
            return hostingSource?.isEnabled == true && nativeItems[rowID] != nil && rowsByID[rowID] != nil
        }

        func tableView(_ tableView: UITableView, performPrimaryActionForRowAt indexPath: IndexPath) {
            tableView.deselectRow(at: indexPath, animated: false)
            guard hostingSource?.isEnabled == true,
                  let rowID = dataSource?.itemIdentifier(for: indexPath),
                  nativeItems[rowID] != nil, let row = rowsByID[rowID] else { return }
            onPrimaryAction?(row)
        }

        func tableView(_ tableView: UITableView, contextMenuConfigurationForRowAt indexPath: IndexPath,
                       point: CGPoint) -> UIContextMenuConfiguration? {
            guard hostingSource?.isEnabled == true,
                  let rowID = dataSource?.itemIdentifier(for: indexPath), nativeItems[rowID] != nil,
                  let owner = ownerContext, let view = viewContext else { return nil }
            return UIContextMenuConfiguration(identifier: rowID as NSString, previewProvider: nil) { [weak self] _ in
                guard let self, self.hostingSource?.isEnabled == true,
                      self.ownerContext == owner, self.viewContext == view,
                      self.nativeItems[rowID] != nil, let row = self.rowsByID[rowID] else { return nil }
                let actions = (self.menuItems?(row) ?? []).map { item in
                    UIAction(title: item.title, image: UIImage(systemName: item.symbol),
                             attributes: item.isEnabled ? [] : [.disabled]) { [weak self] _ in
                        guard let self, self.hostingSource?.isEnabled == true,
                              self.ownerContext == owner, self.viewContext == view,
                              self.nativeItems[rowID] != nil, let currentRow = self.rowsByID[rowID],
                              self.menuItems?(currentRow).first(where: { $0.id == item.id })?.isEnabled == true else { return }
                        self.onMenuAction?(currentRow, item.id)
                    }
                }
                return UIMenu(children: actions)
            }
        }

        fileprivate func detach() {
            ticket += 1
            pendingLocation = nil
            pendingAnchor = nil
            fontRestore = nil
            lastEstimateIntent = nil
            pendingEstimateIntent = nil
            frozenEstimates = nil
            hostingSource?.onGeometry = nil
            hostedGeometry.removeAll()
            fittedGeometry.removeAll()
            nativeFittedGeometry.removeAll()
            nativeItems.removeAll()
            onPrimaryAction = nil
            menuItems = nil
            onMenuAction = nil
            table?.onLayout = nil
            table?.onWindow = nil
            table?.delegate = nil
            table = nil
            dataSource = nil
            onLocationVisible = nil
        }
    }
}

fileprivate final class WorkspaceFilesNativeTableView: UITableView {
    var onLayout: (() -> Void)?
    var onWindow: (() -> Void)?

    override func layoutSubviews() {
        super.layoutSubviews()
        onLayout?()
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil { onWindow?() }
    }
}

@Observable
private final class WorkspaceFilesNativeHostingSource<Row, Content: View> {
    // Keep this generic class on the same explicit-deinit compiler workaround.
    deinit {}

    @ObservationIgnored var content: (Row) -> Content
    var dynamicTypeSize: DynamicTypeSize
    var locale: Locale
    var layoutDirection: LayoutDirection
    var colorScheme: ColorScheme
    var isEnabled: Bool
    var contextRevision = 0
    var geometryRevision = 0
    @ObservationIgnored var onGeometry: ((WorkspaceFilesNativeGeometry) -> Void)?

    init(content: @escaping (Row) -> Content, environment: EnvironmentValues, dynamicTypeSize: DynamicTypeSize) {
        self.content = content
        self.dynamicTypeSize = dynamicTypeSize
        locale = environment.locale
        layoutDirection = environment.layoutDirection
        colorScheme = environment.colorScheme
        isEnabled = environment.isEnabled
    }

    func updateEnvironment(_ environment: EnvironmentValues, dynamicTypeSize: DynamicTypeSize) {
        if self.dynamicTypeSize != dynamicTypeSize { self.dynamicTypeSize = dynamicTypeSize }
        if locale != environment.locale { locale = environment.locale }
        if layoutDirection != environment.layoutDirection { layoutDirection = environment.layoutDirection }
        if colorScheme != environment.colorScheme { colorScheme = environment.colorScheme }
        if isEnabled != environment.isEnabled { isEnabled = environment.isEnabled }
    }
}

private struct WorkspaceFilesNativeHostedRow<Row: Identifiable, Content: View>: View where Row.ID == String {
    let row: Row
    let source: WorkspaceFilesNativeHostingSource<Row, Content>
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let _ = source.contextRevision
        let rowID = row.id
        let revision = source.geometryRevision
        let category = dynamicTypeSize
        // Execute the escaping content closure inside body so its Flow reads
        // participate in this hosted row's Observation dependency tracking.
        source.content(row)
            .environment(\.locale, source.locale)
            .environment(\.layoutDirection, source.layoutDirection)
            .environment(\.colorScheme, source.colorScheme)
            .environment(\.isEnabled, source.isEnabled)
            .onGeometryChange(for: WorkspaceFilesNativeGeometry.self) { proxy in
                WorkspaceFilesNativeGeometry(rowID: rowID, revision: revision,
                    dynamicTypeSize: category, size: proxy.size)
            } action: { geometry in
                source.onGeometry?(geometry)
            }
    }
}

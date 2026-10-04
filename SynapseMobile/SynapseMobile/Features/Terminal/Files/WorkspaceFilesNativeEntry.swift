import UIKit

nonisolated struct WorkspaceFilesNativeEntry: Equatable {
    let title: String
    let parentPath: String?
    let systemImage: String
    let depth: Int
    let accessibilityIdentifier: String
    let accessibilityLabel: String
    let isDirectory: Bool
    let isExpanded: Bool
    let actionsIdentifier: String?
    let primaryActionHint: String?
    let isEnabled: Bool

    init(title: String, parentPath: String?, systemImage: String, depth: Int,
         accessibilityIdentifier: String, accessibilityLabel: String,
         isDirectory: Bool = false, isExpanded: Bool = false, actionsIdentifier: String? = nil,
         primaryActionHint: String? = nil, isEnabled: Bool = true) {
        self.title = title
        self.parentPath = parentPath
        self.systemImage = systemImage
        self.depth = depth
        self.accessibilityIdentifier = accessibilityIdentifier
        self.accessibilityLabel = accessibilityLabel
        self.isDirectory = isDirectory
        self.isExpanded = isExpanded
        self.actionsIdentifier = actionsIdentifier
        self.primaryActionHint = primaryActionHint
        self.isEnabled = isEnabled
    }
}

nonisolated struct WorkspaceFilesNativeMenuAction: Equatable {
    let id: String
    let title: String
    let symbol: String
    let isEnabled: Bool
}

/// Visual metrics for the directory tree's leading indentation.
///
/// The step matches the system outline rhythm measured on iOS 18.6
/// (children-based `List`, plain and sidebar styles: 59–61px at 3x, i.e.
/// 20pt per level). The level offset is owned here instead of UIKit's
/// `indentationLevel`: that indentation only surfaces through the cell's
/// layout margins, and mixing it with the list content's own default
/// leading collapsed the lowest levels onto one position (0/13/16pt steps
/// instead of a uniform staircase).
nonisolated enum WorkspaceFilesTreeMetrics {
    /// Visual indent added per tree level.
    static let indentStep: CGFloat = 20
    /// Filename width a deep row keeps free before the step shrinks.
    static let readableWidth: CGFloat = 160
    /// Deepest level that still earns its own step.
    static let maximumVisualDepth = 12

    static func visualDepth(_ depth: Int) -> Int {
        min(max(depth, 0), maximumVisualDepth)
    }

    /// The step for one column width and depth. A narrow iPad split column
    /// shrinks the step so a deep row keeps reading room for its filename.
    static func step(forWidth width: CGFloat, depth: Int, traitCollection: UITraitCollection) -> CGFloat {
        let levels = visualDepth(depth)
        guard levels > 0 else { return indentStep }
        let readable = UIFontMetrics(forTextStyle: .body)
            .scaledValue(for: readableWidth, compatibleWith: traitCollection)
        return min(indentStep, max(0, width - readable) / CGFloat(levels))
    }
}

/// Files and directories share UIKit's list typography and image grid. The
/// directory's accessory remains an independent menu and accessibility control.
final class WorkspaceFilesNativeEntryCell: UITableViewCell {
    static let reuseIdentifier = "workspace-native-entry"
    private(set) var presentedEntry: WorkspaceFilesNativeEntry?
    private let disclosureView = UIImageView()
    private let primaryAccessibilityView = WorkspaceFilesNativePrimaryAccessibilityView()
    private let actionsButton = WorkspaceFilesNativeActionsButton(type: .system)
    private weak var mountedContentView: UIView?
    private weak var boundContentView: UIListContentView?
    private weak var boundImageGuide: UILayoutGuide?
    private var primaryAccessibilityConstraints: [NSLayoutConstraint] = []
    private var disclosureConstraints: [NSLayoutConstraint] = []
    private var visualIndentStep = WorkspaceFilesTreeMetrics.indentStep

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        automaticallyUpdatesContentConfiguration = false
        automaticallyUpdatesBackgroundConfiguration = false
        configureSubviews()
        observeColorAppearance()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        automaticallyUpdatesContentConfiguration = false
        automaticallyUpdatesBackgroundConfiguration = false
        configureSubviews()
        observeColorAppearance()
    }

    private func configureSubviews() {
        isAccessibilityElement = false
        disclosureView.isAccessibilityElement = false
        disclosureView.translatesAutoresizingMaskIntoConstraints = false
        // This semantic node follows the real content view's layout and does
        // not intercept touches or supply a synthetic accessibility frame.
        primaryAccessibilityView.isUserInteractionEnabled = false
        primaryAccessibilityView.isAccessibilityElement = true
        primaryAccessibilityView.accessibilityTraits = [.button]
        primaryAccessibilityView.translatesAutoresizingMaskIntoConstraints = false
        actionsButton.showsMenuAsPrimaryAction = true
        actionsButton.isAccessibilityElement = true
    }

    private func observeColorAppearance() {
        registerForTraitChanges(UITraitCollection.systemTraitsAffectingColorAppearance) {
            (cell: WorkspaceFilesNativeEntryCell, _: UITraitCollection) in
            cell.setNeedsUpdateConfiguration()
        }
        registerForTraitChanges([UITraitPreferredContentSizeCategory.self]) {
            (cell: WorkspaceFilesNativeEntryCell, _: UITraitCollection) in
            cell.setNeedsUpdateConfiguration()
        }
    }

    func configure(_ entry: WorkspaceFilesNativeEntry, menu: UIMenu?, isEnabled: Bool,
                   onAccessibilityPrimaryAction: @escaping () -> Bool) {
        presentedEntry = entry
        // The visual indent belongs to the content configuration (see
        // applyConfiguration); UIKit's cell indentation would reroute it
        // through the cell's layout margins and collapse lower levels.
        indentationLevel = 0
        visualIndentStep = WorkspaceFilesTreeMetrics.indentStep
        accessibilityIdentifier = entry.accessibilityIdentifier
        primaryAccessibilityView.accessibilityIdentifier = entry.accessibilityIdentifier
        primaryAccessibilityView.accessibilityLabel = entry.accessibilityLabel
        primaryAccessibilityView.accessibilityValue = entry.isDirectory && entry.primaryActionHint == nil
            ? entry.isExpanded ? "已展开" : "已折叠" : nil
        primaryAccessibilityView.accessibilityHint = entry.primaryActionHint
        primaryAccessibilityView.onActivate = onAccessibilityPrimaryAction
        primaryAccessibilityView.accessibilityTraits = isEnabled && entry.isEnabled
            ? [.button] : [.button, .notEnabled]
        actionsButton.menu = menu
        actionsButton.isEnabled = isEnabled
        actionsButton.accessibilityIdentifier = entry.actionsIdentifier
        actionsButton.accessibilityLabel = "\(entry.accessibilityLabel)，操作"
        accessoryView = entry.isDirectory ? actionsButton : nil
        accessibilityElements = entry.isDirectory
            ? [primaryAccessibilityView, actionsButton] : [primaryAccessibilityView]
        applyConfiguration(using: configurationState)
        setNeedsUpdateConfiguration()
    }

    override func updateConfiguration(using state: UICellConfigurationState) {
        super.updateConfiguration(using: state)
        applyConfiguration(using: state)
    }

    override func layoutSubviews() {
        // A narrow iPad column must leave room for the filename and accessory.
        // Only visible, laid-out cells adjust the step; the tree's actual
        // depth and complete accessibility path remain unchanged. A changed
        // step redisplays the configuration in one extra pass.
        if let entry = presentedEntry {
            let step = WorkspaceFilesTreeMetrics.step(forWidth: bounds.width, depth: entry.depth,
                traitCollection: traitCollection)
            if step != visualIndentStep {
                visualIndentStep = step
                setNeedsUpdateConfiguration()
            }
        }
        super.layoutSubviews()
    }

    private func applyConfiguration(using state: UICellConfigurationState) {
        guard let entry = presentedEntry else { return }
        if state.isSelected { primaryAccessibilityView.accessibilityTraits.insert(.selected) }
        else { primaryAccessibilityView.accessibilityTraits.remove(.selected) }
        var configuration = (entry.parentPath == nil
            ? defaultContentConfiguration() : UIListContentConfiguration.subtitleCell()).updated(for: state)
        let background = defaultBackgroundConfiguration().updated(for: state)
        configuration.text = entry.title
        configuration.secondaryText = entry.parentPath
        configuration.image = UIImage(systemName: entry.systemImage)
        configuration.textProperties.numberOfLines = 0
        configuration.secondaryTextProperties.numberOfLines = 0
        configuration.textProperties.adjustsFontForContentSizeCategory = true
        configuration.secondaryTextProperties.adjustsFontForContentSizeCategory = true
        configuration.textProperties.color = .label
        configuration.secondaryTextProperties.color = .secondaryLabel
        let disclosureFont = UIFont.preferredFont(forTextStyle: .caption1, compatibleWith: traitCollection)
        let disclosureConfiguration = UIImage.SymbolConfiguration(font: disclosureFont, scale: .small)
        let collapsedImage = UIImage(systemName: "chevron.forward", withConfiguration: disclosureConfiguration)
        let expandedImage = UIImage(systemName: "chevron.down", withConfiguration: disclosureConfiguration)
        disclosureView.image = entry.isExpanded && entry.primaryActionHint == nil ? expandedImage : collapsedImage
        disclosureView.tintColor = .secondaryLabel
        disclosureView.isHidden = !entry.isDirectory
        // Reserve the same disclosure column for files and folders; its symbol
        // grows with the current system text style rather than a fixed font.
        // The level offset is one uniform step per depth on top of the list
        // content's own default leading, so every level sits exactly one step
        // right of its parent.
        let disclosureColumn = max(collapsedImage?.size.width ?? 0, expandedImage?.size.width ?? 0) + 8
        let levelOffset = CGFloat(WorkspaceFilesTreeMetrics.visualDepth(entry.depth)) * visualIndentStep
        configuration.directionalLayoutMargins.leading =
            configuration.directionalLayoutMargins.leading + levelOffset + disclosureColumn
        contentConfiguration = configuration
        backgroundConfiguration = background
        bindDisclosureToContent()
        var buttonConfiguration = UIButton.Configuration.plain()
        buttonConfiguration.image = UIImage(systemName: "ellipsis")
        buttonConfiguration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(
            font: UIFont.preferredFont(forTextStyle: .body, compatibleWith: traitCollection), scale: .medium)
        actionsButton.configuration = buttonConfiguration
        actionsButton.sizeToFit()
    }

    private func bindDisclosureToContent() {
        // A list content configuration can replace UITableViewCell.contentView.
        // Attach semantic and disclosure views only after that assignment, and
        // rebuild constraints whenever UIKit creates a different content view.
        let currentContentView = contentView
        if mountedContentView !== currentContentView {
            NSLayoutConstraint.deactivate(primaryAccessibilityConstraints)
            NSLayoutConstraint.deactivate(disclosureConstraints)
            primaryAccessibilityConstraints.removeAll()
            disclosureConstraints.removeAll()
            primaryAccessibilityView.removeFromSuperview()
            disclosureView.removeFromSuperview()
            currentContentView.addSubview(disclosureView)
            currentContentView.addSubview(primaryAccessibilityView)
            primaryAccessibilityConstraints = [
                primaryAccessibilityView.leadingAnchor.constraint(equalTo: currentContentView.leadingAnchor),
                primaryAccessibilityView.trailingAnchor.constraint(equalTo: currentContentView.trailingAnchor),
                primaryAccessibilityView.topAnchor.constraint(equalTo: currentContentView.topAnchor),
                primaryAccessibilityView.bottomAnchor.constraint(equalTo: currentContentView.bottomAnchor),
            ]
            NSLayoutConstraint.activate(primaryAccessibilityConstraints)
            mountedContentView = currentContentView
            boundContentView = nil
            boundImageGuide = nil
        }
        guard let listContent = (currentContentView as? UIListContentView)
                ?? currentContentView.subviews.compactMap({ $0 as? UIListContentView }).first,
              let imageGuide = listContent.imageLayoutGuide,
              boundContentView !== listContent || boundImageGuide !== imageGuide else { return }
        NSLayoutConstraint.deactivate(disclosureConstraints)
        boundContentView = listContent
        boundImageGuide = imageGuide
        disclosureConstraints = [
            disclosureView.trailingAnchor.constraint(equalTo: imageGuide.leadingAnchor, constant: -8),
            disclosureView.centerYAnchor.constraint(equalTo: imageGuide.centerYAnchor),
        ]
        NSLayoutConstraint.activate(disclosureConstraints)
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        presentedEntry = nil
        visualIndentStep = WorkspaceFilesTreeMetrics.indentStep
        contentConfiguration = nil
        backgroundConfiguration = nil
        accessibilityIdentifier = nil
        accessibilityLabel = nil
        accessibilityElements = nil
        accessoryView = nil
        primaryAccessibilityView.accessibilityIdentifier = nil
        primaryAccessibilityView.accessibilityLabel = nil
        primaryAccessibilityView.accessibilityValue = nil
        primaryAccessibilityView.accessibilityHint = nil
        primaryAccessibilityView.onActivate = nil
        actionsButton.menu = nil
        actionsButton.accessibilityIdentifier = nil
        disclosureView.image = nil
        NSLayoutConstraint.deactivate(primaryAccessibilityConstraints)
        NSLayoutConstraint.deactivate(disclosureConstraints)
        primaryAccessibilityConstraints.removeAll()
        disclosureConstraints.removeAll()
        primaryAccessibilityView.removeFromSuperview()
        disclosureView.removeFromSuperview()
        mountedContentView = nil
        boundContentView = nil
        boundImageGuide = nil
    }
}

private final class WorkspaceFilesNativePrimaryAccessibilityView: UIView {
    var onActivate: (() -> Bool)?

    override func accessibilityActivate() -> Bool { onActivate?() ?? false }
}

private final class WorkspaceFilesNativeActionsButton: UIButton {
    override var intrinsicContentSize: CGSize {
        let size = super.intrinsicContentSize
        return CGSize(width: max(44, size.width), height: max(44, size.height))
    }

    override func sizeThatFits(_ size: CGSize) -> CGSize {
        let fitting = super.sizeThatFits(size)
        return CGSize(width: max(44, fitting.width), height: max(44, fitting.height))
    }
}

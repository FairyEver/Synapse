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
        indentationLevel = min(max(entry.depth, 0), 12)
        indentationWidth = 16
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
        // Only visible, laid-out cells adjust indentation; the tree's actual
        // depth and complete accessibility path remain unchanged.
        let readableWidth = UIFontMetrics(forTextStyle: .body).scaledValue(for: 160, compatibleWith: traitCollection)
        let width = min(16, max(0, bounds.width - readableWidth) / CGFloat(max(1, indentationLevel)))
        if indentationWidth != width { indentationWidth = width }
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
        configuration.directionalLayoutMargins.leading = max(configuration.directionalLayoutMargins.leading,
            directionalLayoutMargins.leading) + max(collapsedImage?.size.width ?? 0,
            expandedImage?.size.width ?? 0) + 8
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

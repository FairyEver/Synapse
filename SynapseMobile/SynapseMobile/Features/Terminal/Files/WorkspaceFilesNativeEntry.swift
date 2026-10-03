import UIKit

nonisolated struct WorkspaceFilesNativeEntry: Equatable {
    let title: String
    let parentPath: String?
    let systemImage: String
    let depth: Int
    let accessibilityIdentifier: String
    let accessibilityLabel: String
}

nonisolated struct WorkspaceFilesNativeMenuAction: Equatable {
    let id: String
    let title: String
    let symbol: String
    let isEnabled: Bool
}

/// The table owns primary actions and context menus; this cell only presents
/// an ordinary file using UIKit's native content and accessibility behavior.
final class WorkspaceFilesNativeEntryCell: UITableViewCell {
    static let reuseIdentifier = "workspace-native-entry"
    private(set) var presentedEntry: WorkspaceFilesNativeEntry?

    override init(style: UITableViewCell.CellStyle, reuseIdentifier: String?) {
        super.init(style: style, reuseIdentifier: reuseIdentifier)
        automaticallyUpdatesContentConfiguration = false
        automaticallyUpdatesBackgroundConfiguration = false
        observeColorAppearance()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        automaticallyUpdatesContentConfiguration = false
        automaticallyUpdatesBackgroundConfiguration = false
        observeColorAppearance()
    }

    private func observeColorAppearance() {
        registerForTraitChanges(UITraitCollection.systemTraitsAffectingColorAppearance) {
            (cell: WorkspaceFilesNativeEntryCell, _: UITraitCollection) in
            cell.setNeedsUpdateConfiguration()
        }
    }

    func configure(_ entry: WorkspaceFilesNativeEntry) {
        presentedEntry = entry
        indentationLevel = min(max(entry.depth, 0), 12)
        indentationWidth = 16
        accessibilityIdentifier = entry.accessibilityIdentifier
        accessibilityLabel = entry.accessibilityLabel
        accessibilityTraits.insert(.button)
        applyConfiguration(using: configurationState)
        setNeedsUpdateConfiguration()
    }

    override func updateConfiguration(using state: UICellConfigurationState) {
        super.updateConfiguration(using: state)
        applyConfiguration(using: state)
    }

    private func applyConfiguration(using state: UICellConfigurationState) {
        guard let entry = presentedEntry else { return }
        var configuration = (entry.parentPath == nil
            ? defaultContentConfiguration() : UIListContentConfiguration.subtitleCell()).updated(for: state)
        var background = defaultBackgroundConfiguration().updated(for: state)
        let active = state.isSelected || state.isFocused
        let foreground = (active ? UIColor.systemBackground : UIColor.label).resolvedColor(with: traitCollection)
        configuration.text = entry.title
        configuration.secondaryText = entry.parentPath
        configuration.image = UIImage(systemName: entry.systemImage)
        configuration.textProperties.numberOfLines = 0
        configuration.secondaryTextProperties.numberOfLines = 0
        configuration.textProperties.adjustsFontForContentSizeCategory = true
        configuration.secondaryTextProperties.adjustsFontForContentSizeCategory = true
        configuration.textProperties.color = foreground
        configuration.textProperties.colorTransformer = nil
        configuration.secondaryTextProperties.color = foreground
        configuration.secondaryTextProperties.colorTransformer = nil
        configuration.imageProperties.tintColor = foreground
        configuration.imageProperties.tintColorTransformer = nil
        if active {
            background.backgroundColor = UIColor.label.resolvedColor(with: traitCollection)
            background.backgroundColorTransformer = nil
        }
        contentConfiguration = configuration
        backgroundConfiguration = background
    }

    override func prepareForReuse() {
        super.prepareForReuse()
        presentedEntry = nil
        contentConfiguration = nil
        backgroundConfiguration = nil
        accessibilityIdentifier = nil
        accessibilityLabel = nil
    }
}

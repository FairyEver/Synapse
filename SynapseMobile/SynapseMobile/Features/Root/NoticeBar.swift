import SwiftUI

/// The queue, drawn from the bottom up: the newest message sits nearest the thumb and
/// the older one stacks above it. Notices past the visible window draw nothing at all.
struct NoticeStack: View {
    let notices: [Notice]
    let onDismiss: (String) -> Void
    let onHold: (String) -> Void
    let onRelease: (String) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 8) {
            ForEach(notices) { notice in
                NoticeBar(
                    notice: notice,
                    onDismiss: { onDismiss(notice.id) },
                    onHold: { onHold(notice.id) },
                    onRelease: { onRelease(notice.id) }
                )
                // Identity is the notice's id and nothing else, so a re-post of the same
                // id edits the bar in place — the offset the finger is holding and the
                // accessibility element both survive, and only the text changes.
                .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
            }
        }
        // Keyed on the array rather than on the view: this is what animates an insertion
        // or a removal, and it is also what redraws a bar whose `revision` was bumped
        // without re-laying out its neighbours.
        .animation(reduceMotion ? nil : .snappy(duration: 0.25), value: notices)
    }
}

/// One message, pinned to the bottom of whichever screen mounted it.
///
/// It never covers navigation: it is anchored below the content rather than over it, and
/// it is not shaped like a system notification banner, because a phone's own banner
/// means something arrived while you were away and this one never does.
struct NoticeBar: View {
    let notice: Notice
    let onDismiss: () -> Void
    let onHold: () -> Void
    let onRelease: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dragOffset: CGFloat = 0
    @State private var isDragging = false

    /// A slow drag this far counts as thrown away.
    private static let dismissDistance: CGFloat = 44
    /// Where a flick is projected to land. This is the term that makes a short fast flick
    /// work: on its own it never travels `dismissDistance`.
    private static let dismissProjection: CGFloat = 80
    /// Upward travel is damped, since the bar lives at the bottom and up is not where it
    /// goes — but a flick upward still dismisses, because the decision uses the raw
    /// projection. Both directions close it; that is the gesture the system's own banner
    /// taught everyone.
    private static let upwardResistance: CGFloat = 0.35

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: icon)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(tint)
            Text(notice.text)
                .font(.footnote)
                .foregroundStyle(.primary)
                .lineLimit(3)
                .multilineTextAlignment(.leading)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(border)
        )
        // The whole bar is the target, not just the two glyphs: a drag that starts on the
        // text has to count too.
        .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .offset(y: dragOffset)
        .opacity(opacity)
        // High priority on purpose: three of the screens this floats over are `List`s,
        // whose own pan recogniser would otherwise take the drag.
        .highPriorityGesture(drag)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(notice.text))
        // A double tap and the two-finger scrub both throw it away. The bar carries no
        // other affordance a screen reader could reach, and it is on a clock.
        .accessibilityAction { onDismiss() }
        .accessibilityAction(.escape) { onDismiss() }
    }

    private var icon: String {
        switch notice.tone {
        case .success: "checkmark.circle.fill"
        case .info: "info.circle"
        case .failure: "exclamationmark.triangle.fill"
        }
    }

    /// `Theme.running` and `Theme.failure`, and for `info` the neutral the rest of the app
    /// already uses for "nobody needs anything". `Theme.attention` is absent by
    /// construction: `Theme` says that colour means exactly one thing — a person is
    /// needed — and a copied terminal is not that.
    private var tint: Color {
        switch notice.tone {
        case .success: Theme.running
        case .info: .secondary
        case .failure: Theme.failure
        }
    }

    /// The tone is carried by the ring and the glyph, never by the sentence: all three
    /// theme colours are fixed RGB values that do not adapt to appearance, and body copy
    /// in `Theme.failure` over dark material is a legibility problem, not a taste one.
    private var border: Color {
        switch notice.tone {
        case .success: Theme.running.opacity(0.35)
        case .info: Color.primary.opacity(0.08)
        case .failure: Theme.failure.opacity(0.35)
        }
    }

    private var opacity: Double {
        guard isDragging || dragOffset != 0 else { return 1 }
        return max(0.25, 1 - Double(abs(dragOffset)) / 160)
    }

    private var drag: some Gesture {
        DragGesture(minimumDistance: 10)
            .onChanged { value in
                if !isDragging {
                    isDragging = true
                    onHold()
                }
                let travel = value.translation.height
                dragOffset = travel >= 0 ? travel : travel * Self.upwardResistance
            }
            .onEnded { value in
                isDragging = false
                let travel = value.translation.height
                let projected = value.predictedEndTranslation.height
                let thrown = abs(projected) > Self.dismissProjection || abs(travel) > Self.dismissDistance

                guard thrown else {
                    withAnimation(spring) { dragOffset = 0 }
                    onRelease()
                    return
                }

                // Leaves the way it was thrown, and only then tells the model. Dismissing
                // first would take the offset with it: the bar would snap back into place
                // and the removal would animate from there.
                let direction: CGFloat = projected >= 0 ? 1 : -1
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) {
                    dragOffset = direction * 160
                }
                Task {
                    try? await Task.sleep(for: .milliseconds(170))
                    onDismiss()
                }
            }
    }

    private var spring: Animation? {
        reduceMotion ? nil : .spring(response: 0.3, dampingFraction: 0.82)
    }
}

extension View {
    /// Puts the notice stack at the bottom of this screen.
    ///
    /// Mounted per screen rather than once at the root. Every host's bottom edge is a
    /// different thing — a tab bar, a terminal's input bar, empty space under a login
    /// form — and the tab bar is not a safe area inset at the root, so a single root-level
    /// overlay would sit on top of it. Anchoring each screen to its own bottom needs no
    /// measurement of anyone else's chrome and cannot drift when one of them changes.
    func noticeOverlay(_ model: SynapseAppModel) -> some View {
        overlay(alignment: .bottom) {
            NoticeStack(
                notices: model.notices.armed,
                onDismiss: { model.dismissNotice($0) },
                onHold: { model.holdNotice($0) },
                onRelease: { model.resumeNotice($0) }
            )
            .padding(.horizontal, 16)
            // `safeAreaPadding` rather than `padding`: on a `List` the host's frame runs
            // on underneath the tab bar, so a plain bottom-anchored overlay would draw
            // over it. This lifts the stack clear of whatever the host already reserves
            // at its bottom edge without reserving anything back — which matters on the
            // terminal, where changing the layout would report a new grid size and
            // resize the desktop's PTY.
            .safeAreaPadding(.bottom)
            .padding(.bottom, 8)
        }
    }
}

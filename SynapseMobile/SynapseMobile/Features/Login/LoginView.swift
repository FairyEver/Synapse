import SwiftUI

/// Sign-in against the existing Synapse account.
///
/// Email and password are the only credential the server has — there is no phone
/// number or SMS flow to offer — so this screen is the whole of it.
struct LoginView: View {
    @Environment(SynapseAppModel.self) private var model
    @State private var email = ""
    @State private var password = ""
    @State private var isSubmitting = false
    /// Why the last attempt was refused, shown under the fields it came from.
    @State private var errorMessage: String?
    @FocusState private var focus: Field?

    private enum Field { case email, password }

    private var canSubmit: Bool {
        !email.isEmpty && !password.isEmpty && !isSubmitting
    }

    var body: some View {
        // Landscape with the keyboard up leaves roughly 200pt for a ~310pt form. The
        // two `Spacer`s would collapse to zero and clip both ends off rather than give
        // the content anywhere to go, so it scrolls instead.
        ScrollView {
            ZStack {
                // The filler — and the reason for the `ZStack` rather than putting
                // `containerRelativeFrame` on the form itself. A frame sized *to* the
                // viewport also caps the form at the viewport, which would leave the
                // overflow unreachable and the landscape case just as broken. Taking
                // the larger of the viewport and the form keeps the form filling the
                // screen whenever it fits and lets it grow past the viewport when it
                // does not.
                //
                // The form ends up centred in the viewport rather than at the position
                // its own `Spacer`s used to give it: a scroll view proposes no height,
                // so those spacers resolve to zero and the `ZStack` is what places the
                // form. That is a few points lower than the old 1:2 split, which is the
                // price of the form being reachable with the keyboard up at all.
                Color.clear
                    .containerRelativeFrame(.vertical)

                VStack(spacing: 0) {
                    Spacer()
                    VStack(spacing: 10) {
                        Image(systemName: "terminal")
                            .font(.system(size: 40, weight: .light))
                            .foregroundStyle(Theme.ink)
                        Text("Synapse Remote")
                            .font(.title2.weight(.bold))
                        Text("使用 Synapse 账号登录")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.bottom, 30)

                    VStack(spacing: 10) {
                        TextField("邮箱", text: $email)
                            .textContentType(.username)
                            .keyboardType(.emailAddress)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .focused($focus, equals: .email)
                            .submitLabel(.next)
                            .onSubmit { focus = .password }
                            .padding(12)
                            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 11, style: .continuous))

                        SecureField("密码", text: $password)
                            .textContentType(.password)
                            .focused($focus, equals: .password)
                            .submitLabel(.go)
                            .onSubmit(submit)
                            .padding(12)
                            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                    }
                    .padding(.horizontal, 24)

                    // Between the fields and the button, and left-aligned with them. A rejected
                    // credential is about what was typed above it, and the screen has room to
                    // say so in place — it does not need to be carried to the bottom of the
                    // screen, where the user would have to connect the sentence to this form
                    // themselves.
                    if let errorMessage {
                        Text(errorMessage)
                            .font(.footnote)
                            .foregroundStyle(Theme.failure)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 24)
                            .padding(.top, 10)
                    }

                    Button(action: submit) {
                        Group {
                            if isSubmitting {
                                ProgressView()
                            } else {
                                Text("登录").font(.callout.weight(.semibold))
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                    }
                    // Ink fill, paper label: the pair has to invert together with the
                    // appearance, or the button turns into a blank rectangle in dark mode.
                    // The disabled cue dims the fill only — fading the label too would
                    // leave grey text on a grey rectangle — which is why the dimming is
                    // bounded by what keeps the label readable (see the constant).
                    //
                    // `.circular`: a continuous corner is drawn larger than the radius it
                    // is given, and on a bar this short (46 pt, the same as the sheet's
                    // 开始对话) that swallows both ends — the reason is recorded there in
                    // full. The two filled buttons are one shape.
                    .background(
                        Theme.ink.opacity(canSubmit ? 1 : Theme.disabledInkOpacity),
                        in: RoundedRectangle(cornerRadius: 12, style: .circular)
                    )
                    .foregroundStyle(Theme.paper)
                    .disabled(!canSubmit)
                    .padding(.horizontal, 24)
                    .padding(.top, 16)

                    // `.tertiary` measures 2.11:1 on the light background, under the 4.5:1
                    // WCAG AA floor. `.secondary` costs nothing visually — this line is not
                    // ornament, it is the only place the desktop-side requirement is
                    // stated, so a reader who cannot resolve it loses information.
                    Text("电脑端需保持打开并登录同一账号。")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 40)
                        .padding(.top, 14)

                    Spacer()
                    Spacer()
                }
            }
        }
        // Without this the view rubber-bands on every portrait launch even though there
        // is nothing to scroll to, which reads as a regression from the fixed layout.
        .scrollBounceBehavior(.basedOnSize)
        .onAppear { focus = .email }
        // Nothing here is the form's own yet, so the queue is the only place a failure
        // from this screen can land. It has a home to be given — a rejected credential
        // belongs beside the field it came from — but that is a change to make here
        // rather than to route around.
        .noticeOverlay(model)
    }

    private func submit() {
        guard !email.isEmpty, !password.isEmpty, !isSubmitting else { return }
        // After the guard, on the same rule the send key follows: a submit with
        // nothing to submit does nothing. The verdict is a round trip away and comes
        // back below.
        Haptics.commit()
        isSubmitting = true
        errorMessage = nil
        Task {
            let rejected = await model.signIn(email: email, password: password)
            // A rejected credential is written into the form, which is where the eyes
            // already are only if the user has begun to suspect something. Success
            // needs nothing here: the whole screen is replaced by the app.
            if rejected != nil { Haptics.failure() }
            errorMessage = rejected
            isSubmitting = false
        }
    }
}

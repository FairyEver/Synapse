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
    @FocusState private var focus: Field?

    private enum Field { case email, password }

    private var canSubmit: Bool {
        !email.isEmpty && !password.isEmpty && !isSubmitting
    }

    var body: some View {
        VStack(spacing: 0) {
            Spacer()
            VStack(spacing: 10) {
                Image(systemName: "terminal")
                    .font(.system(size: 40, weight: .light))
                    .foregroundStyle(Theme.ink)
                Text("Synapse Remote")
                    .font(.system(size: 24, weight: .bold))
                Text("使用 Synapse 账号登录")
                    .font(.system(size: 13))
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

            Button(action: submit) {
                Group {
                    if isSubmitting {
                        ProgressView()
                    } else {
                        Text("登录").font(.system(size: 16, weight: .semibold))
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
            }
            // Ink fill, paper label: the pair has to invert together with the
            // appearance, or the button turns into a blank rectangle in dark mode.
            // The disabled cue dims the fill only — fading the label too would
            // leave grey text on a grey rectangle.
            .background(
                Theme.ink.opacity(canSubmit ? 1 : 0.4),
                in: RoundedRectangle(cornerRadius: 12, style: .continuous)
            )
            .foregroundStyle(Theme.paper)
            .disabled(!canSubmit)
            .padding(.horizontal, 24)
            .padding(.top, 16)

            Text("电脑端需保持打开并登录同一账号。")
                .font(.system(size: 11))
                .foregroundStyle(.tertiary)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
                .padding(.top, 14)

            Spacer()
            Spacer()
        }
        .onAppear { focus = .email }
    }

    private func submit() {
        guard !email.isEmpty, !password.isEmpty, !isSubmitting else { return }
        isSubmitting = true
        Task {
            await model.signIn(email: email, password: password)
            isSubmitting = false
        }
    }
}

import AuthenticationServices
import SwiftUI

struct AccountView: View {
    @Environment(\.locale) private var locale
    @Environment(\.scenePhase) private var scenePhase
    @State private var status = ""
    @State private var isWorking = false
    @State private var isSignedIn = false
    @State private var confirmDeletion = false
    let store: AccountStore
    let authenticator: AppleAccountAuthenticator

    var body: some View {
        Form {
            Section {
                if isSignedIn {
                    Text("Signed in with Apple")
                    Button("Sign out") { beginSignOut() }
                        .disabled(isWorking)
                } else {
                    SignInWithAppleButton(.signIn) { request in
                        isWorking = true
                        authenticator.prepare(request)
                    } onCompletion: { result in
                        completeSignIn(result)
                    }
                    .frame(height: 48)
                    .disabled(isWorking)
                    .accessibilityIdentifier("account.apple.signIn")
                }
                if !status.isEmpty { Text(status).accessibilityIdentifier("account.status") }
            } header: { Text("Account") }
            Section {
                Button("Delete account", role: .destructive) { confirmDeletion = true }
                    .disabled(isWorking || !isSignedIn)
                    .accessibilityIdentifier("account.delete")
            } header: { Text("Data") }
            footer: {
                Text("Deletes Wanderful server account data and signs you out. Saved routes and packing lists on this iPhone stay here unless you delete them separately. Deleting your account does not cancel an App Store subscription. Manage subscriptions in your Apple account settings.")
            }
        }
        .navigationTitle("Account")
        .task { await refreshCredentialState() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await refreshCredentialState() } }
        }
        .onReceive(NotificationCenter.default.publisher(
            for: ASAuthorizationAppleIDProvider.credentialRevokedNotification
        )) { _ in
            Task { await refreshCredentialState() }
        }
        .confirmationDialog("Delete your account?", isPresented: $confirmDeletion, titleVisibility: .visible) {
            Button("Delete account", role: .destructive) { beginDeletion() }
        }
    }

    private func completeSignIn(_ result: Result<ASAuthorization, Error>) {
        Task {
            await run {
                let credential = try authenticator.credential(from: result)
                try await store.signIn(with: credential)
                status = "Signed in."
            }
        }
    }

    private func beginSignOut() {
        Task {
            await run {
                try await store.signOut()
                status = "Signed out."
            }
        }
    }

    private func beginDeletion() {
        Task {
            await run {
                let credential = try await authenticator.signIn()
                try await store.deleteAccount(reauthentication: credential)
                status = "Your account was deleted."
            }
        }
    }

    private func run(_ action: () async throws -> Void) async {
        isWorking = true
        defer { isWorking = false }
        do { try await action() }
        catch AppleAccountAuthenticationError.cancelled { status = "Sign in was cancelled." }
        catch let error as AccountStoreError { status = error.message(for: locale) }
        catch {
            // A lost response can follow successful server deletion. Never promise unchanged data.
            status = "We couldn’t confirm that request. Please try again or contact support."
        }
        await updateCredentialState()
    }

    private func refreshCredentialState() async {
        guard !isWorking else { return }
        isWorking = true
        defer { isWorking = false }
        await updateCredentialState()
    }

    private func updateCredentialState() async {
        let hadSession = await store.session != nil
        do {
            isSignedIn = try await store.validateAppleCredential()
            if hadSession && !isSignedIn { status = "Please sign in with Apple again." }
        } catch {
            isSignedIn = false
            status = "Your Apple sign-in could not be verified. Please try again."
        }
    }
}

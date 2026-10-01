import AuthenticationServices
import CryptoKit
import Foundation
import UIKit

nonisolated struct AppleAccountCredential: Sendable {
    let identityToken: String
    let authorizationCode: String
    let nonce: String
    let userIdentifier: String?

    init(identityToken: String, authorizationCode: String, nonce: String, userIdentifier: String? = nil) {
        self.identityToken = identityToken
        self.authorizationCode = authorizationCode
        self.nonce = nonce
        self.userIdentifier = userIdentifier
    }
}

enum AppleAccountAuthenticationError: LocalizedError, Equatable, Sendable {
    case cancelled, unavailable, invalidCredential, failed
    var errorDescription: String? { switch self { case .cancelled: "Sign in was cancelled."; case .unavailable: "Sign in with Apple is unavailable."; case .invalidCredential: "Apple returned an incomplete sign-in credential."; case .failed: "Sign in with Apple could not be completed." } }
}

@MainActor final class AppleAccountAuthenticator: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    private var continuation: CheckedContinuation<AppleAccountCredential, Error>?
    private var activeNonce: String?

    /// The SwiftUI Apple button owns presentation. Only configure its request here.
    func prepare(_ request: ASAuthorizationAppleIDRequest) {
        let nonce = Self.nonce()
        activeNonce = nonce
        request.nonce = nonce
        // Account identity needs no name/email scope; neither is displayed by the app.
        request.requestedScopes = []
    }

    func credential(from result: Result<ASAuthorization, Error>) throws -> AppleAccountCredential {
        defer { activeNonce = nil }
        switch result {
        case let .success(authorization):
            guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
                  let token = credential.identityToken.flatMap({ String(data: $0, encoding: .utf8) }),
                  !token.isEmpty,
                  let code = credential.authorizationCode.flatMap({ String(data: $0, encoding: .utf8) }),
                  !code.isEmpty,
                  !credential.user.isEmpty,
                  let nonce = activeNonce else {
                throw AppleAccountAuthenticationError.invalidCredential
            }
            return AppleAccountCredential(identityToken: token, authorizationCode: code, nonce: nonce, userIdentifier: credential.user)
        case let .failure(error):
            throw (error as? ASAuthorizationError)?.code == .canceled
                ? AppleAccountAuthenticationError.cancelled : .failed
        }
    }
    func signIn() async throws -> AppleAccountCredential {
        guard continuation == nil, activeNonce == nil else { throw AppleAccountAuthenticationError.failed }
        return try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let request = ASAuthorizationAppleIDProvider().createRequest()
            prepare(request)
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self; controller.presentationContextProvider = self; controller.performRequests()
        }
    }
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor { UIApplication.shared.connectedScenes.compactMap { ($0 as? UIWindowScene)?.keyWindow }.first ?? ASPresentationAnchor() }
    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        complete(.success(authorization))
    }
    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        complete(.failure(error))
    }
    private func complete(_ result: Result<ASAuthorization, Error>) {
        defer { continuation = nil }
        do { continuation?.resume(returning: try credential(from: result)) }
        catch { continuation?.resume(throwing: error) }
    }
    private static func nonce() -> String { Data((0..<32).map { _ in UInt8.random(in: .min ... .max) }).base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") }
}

protocol AppleAccountCredentialChecking: Sendable {
    func isAuthorized(userIdentifier: String) async throws -> Bool
}

struct AppleAccountCredentialChecker: AppleAccountCredentialChecking {
    nonisolated func isAuthorized(userIdentifier: String) async throws -> Bool {
        try await withCheckedThrowingContinuation { continuation in
            ASAuthorizationAppleIDProvider().getCredentialState(forUserID: userIdentifier) { state, error in
                if error != nil {
                    continuation.resume(throwing: AppleAccountAuthenticationError.unavailable)
                } else {
                    // Revoked, not found and transferred identities require fresh sign-in.
                    continuation.resume(returning: state == .authorized)
                }
            }
        }
    }
}

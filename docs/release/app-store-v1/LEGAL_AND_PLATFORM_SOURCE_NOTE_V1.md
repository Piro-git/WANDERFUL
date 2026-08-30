# Legal and platform source note V1

Assessment date: 2026-08-30

Status: **primary-source research note; not legal advice and not customer-facing policy copy**

This note records the current sources used to structure Wanderful's engine-enabled privacy/support package. The owner and qualified counsel must apply them to the real legal entity, launch territories, processor contracts, technical retention, and final signed build. Recheck every source immediately before publication because platform and legal requirements can change.

## Apple publication requirements

- Apple requires a privacy-policy link in App Store Connect metadata and easy access to the policy inside the app. The policy must identify collected data, collection, uses, third-party protection, and retention/deletion practices. Apple also requires accurate metadata, data minimization, permission discipline, and an in-app account-deletion path only when the app supports account creation. Sources: [App Review Guidelines, sections 2.1, 2.3, and 5.1.1](https://developer.apple.com/app-store/review/guidelines/) and [Offering account deletion in your app](https://developer.apple.com/support/offering-account-deletion-in-your-app/).
- App Privacy answers must include the practices of third-party partners whose code or services are integrated and must remain accurate. Apple's definition of “collect” generally concerns off-device transmission that the developer or partners can access beyond what is needed to service a request in real time. That definition is why the engine-enabled answer sheet separates transient request processing from retained logs. Sources: [Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy/) and [App privacy details](https://developer.apple.com/app-store/app-privacy-details/).
- The Support URL is required and must lead to actual app-specific contact information. The privacy-policy URL is required for iOS apps; a User Privacy Choices URL is optional. Sources: [Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information), [App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/), and [App Privacy reference](https://developer.apple.com/help/app-store-connect/reference/app-privacy/).
- If no custom End User License Agreement is entered, Apple's Standard EULA applies. A custom agreement requires a separate owner/legal decision and App Store Connect configuration. Sources: [Provide a custom license agreement](https://developer.apple.com/help/app-store-connect/manage-app-information/provide-a-custom-license-agreement) and [Apple Standard EULA](https://www.apple.com/legal/internet-services/itunes/dev/stdeula/).
- Apple requires an App Store Connect declaration of Digital Services Act trader status. Apple does not decide that status for the developer. If the developer is a trader, verified address, phone, and email information is displayed on the EU App Store product page. Source: [EU Digital Services Act trader requirements](https://developer.apple.com/help/app-store-connect/manage-compliance-information/manage-european-union-digital-services-act-trader-requirements/).

## EU data-protection review

The GDPR transparency baseline used for the policy structure is Articles 12–14: identify the controller and contact, purposes and legal bases, recipients, transfers, retention, rights, complaint route, required/optional nature of the data, and automated decision information where applicable. Lawful basis, processor contracts, children's data, data-subject rights, and international transfers also require explicit launch review under Articles 5, 6, 8, 15–22, 28, and 44–49. Primary text: [Regulation (EU) 2016/679 (GDPR)](https://eur-lex.europa.eu/eli/reg/2016/679/oj).

This package does not decide:

- which GDPR legal basis applies to routing, App Attest/security records, and support;
- whether a provider is a processor or independent controller;
- whether a transfer mechanism, adequacy decision, or supplementary safeguard is required;
- the competent supervisory authority, minimum age, or guardian process;
- whether any profiling or automated-decision disclosure beyond route personalization is required.

Those fields fail closed in the owner configuration.

## Germany and EU digital-service review

- Germany's DDG section 5 contains general information duties for certain commercial digital services, including name/address and other applicable legal details. Whether and how those duties apply to the final operator requires owner/legal review. Source: [DDG § 5](https://www.gesetze-im-internet.de/ddg/__5.html).
- Germany's TDDDG section 25 addresses consent for storing information on, or accessing information from, a user's terminal device, subject to exceptions including strictly necessary access. The current static package deliberately uses no cookies, JavaScript, browser storage, analytics, tracking pixels, embeds, forms, or remote fonts. The resulting view that no cookie-consent banner is presently indicated is an implementation-based legal inference—not a permanent legal conclusion. Any hosting feature or site change must trigger a fresh review. Source: [TDDDG § 25](https://www.gesetze-im-internet.de/ttdsg/__25.html).
- Consumer terms, governing law, and liability wording remain legal-review fields. In particular, German standard-terms restrictions can invalidate impermissible liability exclusions. Source: [BGB § 309](https://www.gesetze-im-internet.de/bgb/__309.html).
- The App Store DSA trader declaration is separate from the developer's own DDG and other consumer-law obligations. The operator must make and document both decisions from its actual circumstances.

## Static-hosting research

Cloudflare Pages is the recommended low-complexity candidate for this package because its current Free plan supports static projects and custom domains, and it consumes a checked-in `_headers` file for static responses. A subdomain can be connected with a CNAME without moving the apex domain's nameservers. Sources: [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/), [custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/), and [custom headers](https://developers.cloudflare.com/pages/configuration/headers/).

This is an operational recommendation, not authorization to create an account, deploy, alter DNS, accept processor terms, or select a hosting region. Before using it, the owner must review Cloudflare's current terms, data-processing terms, log behavior, region/transfer posture, and security settings. The public policy's host and access-log fields must describe the actual chosen host.

## Legal-review stop list

Do not publish until a qualified owner or reviewer has approved:

1. legal controller identity, legal form, postal and applicable register/VAT/contact details;
2. DSA trader status and any DDG information duties;
3. exact engine payload, enabled evidence providers, provider roles/regions/contracts, and transfer safeguards;
4. transient request deletion, security-log fields and retention, site access logs, support retention, backups, and incident holds;
5. lawful bases, privacy-rights workflow, supervisory authority, age/children wording, and whether the described “no tracking” boundary is accurate;
6. Apple App Privacy answers for the exact signed archive, including the embedded Superwall manifest while Superwall remains disabled;
7. standard Apple EULA versus custom EULA, liability language, governing law, and consumer-dispute obligations;
8. canonical HTTPS domain, monitored contacts, accessibility/reachability, and consistency with App Store Connect and the in-app links.

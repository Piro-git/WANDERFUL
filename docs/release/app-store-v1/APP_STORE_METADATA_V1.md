# App Store Metadata V1

Status: **draft; local runtime boundaries verified, owner/backend/publication approval still required**
Localization: English draft only
Retrieved Apple requirements: 2026-08-23

Apple currently limits the app name and subtitle to 30 characters each, promotional text to 170 characters, description to 4,000 characters, and keywords to 100 bytes. The Support URL is required. Sources: [App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/), [platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information/).

## Proposed fields

| Field | Draft | Validation |
| --- | --- | --- |
| Name | `Wanderful` | 9 characters; name availability and rights UNKNOWN |
| Subtitle | `Plan real outdoor routes` | 24 characters |
| Promotional text | `Describe a hike, trail run or bike route. Compare mapped options with distance, duration and elevation before you save or export.` | 129 characters |
| Primary category | `Navigation` | Provisional; aligns with `LSApplicationCategoryType`; owner approval required |
| Secondary category | `Health & Fitness` | Provisional; owner must assess discoverability and regulated-device declaration implications |
| Keywords | `hiking,trail running,cycling,route planner,loop routes,GPX,outdoor,walking,elevation` | 84 UTF-8 bytes; no competitor or app-name keyword |
| Copyright | `UNKNOWN` | Must be the real rights owner and year; do not fabricate |
| Support URL | `UNKNOWN` | Required; see `PRIVACY_SUPPORT_URL_REQUIREMENTS_V1.md` |
| Privacy Policy URL | `UNKNOWN` | Required for iOS and in-app under Guideline 5.1.1 |
| Marketing URL | Omit for V1 unless owner publishes a real page | Optional |

Apple permits a primary and secondary category and requires an accurate primary category. Source: [Choosing a category](https://developer.apple.com/app-store/categories/). Health & Fitness as a secondary category may trigger additional regulated-medical-device questions in supported regions; the product is not a medical device and must not make medical claims. Source: [regulated medical device status](https://developer.apple.com/help/app-store-connect/manage-app-information/declare-regulated-medical-device-status).

## Description draft

Plan an outdoor route by describing what you want. Wanderful turns a place, activity, distance or duration into mapped route options you can compare before you go.

PLAN YOUR WAY

• Create hiking, trail-running and biking routes
• Request a point-to-point route or a loop
• Compare route geometry, distance, estimated duration and elevation
• Review route detail before choosing an option
• Save verified routed results on your iPhone
• Export a route as GPX through the system share sheet

BUILT FOR CLEAR DECISIONS

Wanderful keeps requested preferences separate from mapped route facts. Route statistics come from the routing response, and recovered older saves remain labeled when their route evidence cannot be verified.

PLAN RESPONSIBLY

Wanderful is a planning aid, not live navigation. Outdoor conditions and access can change. Review the route before starting, and check weather, trail conditions, closures, local rules and water availability.

## Claim ledger

| Claim | Release evidence | State |
| --- | --- | --- |
| Hiking, trail running and biking | About capability copy, activity models, planner source and deterministic Stage B runtime | Locally proved; production-backend availability remains external |
| Point-to-point and loop routes | Parser/planner/routing source and deterministic Stage B runtime | Locally proved; production-backend availability remains external |
| Mapped distance/duration/elevation | GraphHopper conversion and About copy | Source-backed; production backend proof pending |
| Local saved routes | protected local file store plus save/reopen Stage B runtime | Locally proved |
| GPX export | protected temporary exporter plus system share-sheet Stage B runtime | Locally proved; no external share destination was selected |
| Optional voice transcription | Speech/AVAudio service and permission copy | Omitted from primary metadata until physical/runtime proof |

## Forbidden marketing claims

Do not add any claim for:

- live or turn-by-turn navigation;
- offline maps or offline route calculation;
- live weather, closures, water or trail-condition intelligence;
- guaranteed safety, legality, access, scenery or trail quality;
- AI chat, AI route editing or remote AI planning in Release;
- research-guided/outdoor-evidence features while flags are disabled;
- national or global evidence coverage;
- subscriptions, premium access or purchases while Superwall is unconfigured;
- superiority over Komoot or any other competitor.

## Localization and final checks

- Localize metadata and screenshots only after the English Release path is verified.
- Recalculate all character/byte counts after every edit.
- Ensure screenshots demonstrate the same Release-reachable claims.
- Confirm the primary category in App Store Connect aligns with Xcode/project metadata.
- Owner must approve launch geography before adding regional claims.

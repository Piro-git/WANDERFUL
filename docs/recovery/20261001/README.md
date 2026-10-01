# Release source recovery — 2026-10-01

This branch preserves the latest unpublished Wanderful application, backend, tests and configuration on top of GitHub `main` (`adea2c08540e87f0acd7eebb976c72eab8eb76c3`). It does not declare the application ready for production or App Store submission.

The earlier source-only review commit `9f6db32dc9b5835e8f9ff5777d40ee821389c464` preserves the integrated September 30 baseline. All subsequent text changes from that baseline's source `1f5d268c39a540a2f22b205cbc55bbb3d81c366a` to the iPhone candidate `d40a206945c781619948ca2cedbc74c4543642b3` are preserved here. Before applying route-owner changes, 692 code/test/configuration file blobs were independently compared with the candidate and matched exactly.

The candidate includes verified Commons photo cards, packing persistence, route-stay presentation, disabled weather source code, the Vercel database-admission adapter and the iOS ordered-stop/trust correction. Source provenance is in `CANDIDATE_SOURCE.json`.

The backend route-quality changes are preserved separately from owner branch `codex/route-quality-20260930`, final source `9c88ef325f9e3a043ffddd9386350fac779b4c3f`: ordered spherical segment matching, unreachable-place revision feedback and measured-data-based public route copy. The independent contract tests are preserved from QA source `c3f3dcc5733b8b717a818e155a7b271028b86624`.

Internal screenshot PNGs remain exclusively in preserved local archives. They were not uploaded to this public repository. Their manifests are historical/local evidence, not downloadable artifacts. Existing public application assets are preserved. Ignored credential files, build products, device data and caches are not part of this recovery.

The original temporary integration Git store is damaged: administrative files and at least one historical parent object are missing. This branch deliberately uses an intact GitHub parent and preserves source trees, rather than inventing missing history or force-updating an existing branch. Local original sources, refs and objects remain untouched. A complete tracked-source archive and route/QA patches were preserved separately before reconstruction.

Remaining gates: review and full tests on the combined source; live restricted database admission and provider configuration; `/readyz` success; bounded two-region Gemini → GraphHopper → Commons evidence; signed iPhone acceptance; Apple account deletion correction and login/purchase verification; TestFlight and Store metadata. Weather remains disabled and its migration is prohibited until a separately reviewed role/admission design is implemented.

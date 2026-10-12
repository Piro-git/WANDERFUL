# Backend planning supplement source handoff

- Source checkpoint: `541df9623f69c2d89462de5cf0174ffe198bb751`.
- Publication branch: `codex/github-iphone-candidate-20261012`.
- Goal: preserve the reviewed, opt-in single-plan supplement and cumulative accounting guards.

## Completed and decisions

The source adds a default-off supplement bound to a reviewed backend tree, approval digest, canonical origin, enrolled key and at most 30-minute expiry. The code permits at most one intent and one schema-3 plan, with supplementary provider bounds of eight Google and six GraphHopper attempts. Existing cumulative provider ceilings remain 16 and 10. Authentication, actor-role checks, RLS, replay and concurrency controls remain in force; spent counters cannot be reset.

The backend tree is `ff32ec095e5f662d0575ee3db83f194579d3b6e2`. App and native test source trees are unchanged from the preceding public candidate. Operator SQL/template bytes are preserved; generated activation records and runtime bindings are not part of the publication.

## Checks and limits

The coordinator reported independent completion of 50 offline fixture checks and nine disposable PostgreSQL checks, with zero failures. These checks were not repeated for this source backup. They do not establish genuine provider results, physical-phone route or Commons image acceptance, or Saved/packing acceptance.

## Continuation

Read [the publication handoff](github-iphone-candidate-20261012.md) and its provenance mapping. Publication does not authorize deployment, database execution, allocation activation or phone operations. The coordinator owns later rollout. Private approval, runtime and execution records remain outside Git.

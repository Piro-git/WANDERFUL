# Provider completion status diagnostics

Source checkpoint: `7c2917b707b33d00e74abf18665defdd50c8201b`. Publication continues `codex/github-iphone-candidate-20261012`.

The parser keeps its completion guard and projects non-completed lifecycle values through a closed diagnostic enum. Unrecognized values map to a fixed marker. Raw status values, messages, payloads, continuation tokens, interaction IDs, URLs and prompts are excluded from the closed logger.

This checkpoint adds observability, not a demonstrated functional repair. It adds no polling, background mode, persistent research, automatic retry or acceptance of partial research. Existing grounding/source-read checks remain in force.

Offline fixtures cover closed state handling and suppression of synthetic private markers. Actual provider diagnosis and phone acceptance require separately authorized work. Private execution, approval and accounting records remain outside public Git.

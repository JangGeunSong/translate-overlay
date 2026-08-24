# Repository instructions

- Preserve the core invariant: source-page content nodes are read-only. Extension UI may only be added beneath the single host marked `data-context-reader-root`.
- Keep page analysis, linguistic providers, rendering, and orchestration separate.
- Prefer deterministic logic and unit tests around discovery, identity, context collection, and lifecycle state.
- Update `docs/PROJECT_OVERVIEW.md` and the active packet under `docs/tasks/` when behavior or architecture changes.
- Generated output belongs in `dist/` and must not be treated as source documentation.
- Do not add product scope beyond the current MVP without an explicit task.

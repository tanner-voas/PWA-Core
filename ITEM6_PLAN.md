# Item 6 — Shared architecture and application evolution

## 6A: foundation and pilot

Source audit: AppLauncher/Ciyan updater modules are byte-identical; WorldGen/Ascendant differ only by comments. AppLauncher and Ciyan offline request clients are byte-identical. All four offline service-worker templates differ only by cache namespaces. These are low-risk extraction candidates; storage and cloud behavior differ substantially and must not be unified merely because module names match.

Create PWA-Core v0.1.0 as a separate repo. Start with AppLauncher as a pilot, using the new shared generator and runtime helpers. Preserve the host API, cache prefixes, service worker scope, shell groups, asset URLs, security headers, version tree and atomic release coordination. Retain application-specific asset classification. Test the real strict combined build and lifecycle; manually verify on iPhone before replacing the other standalone workers.

## 6B: migrate consumers independently

Migrate WorldGen and Ascendant first (small standalone packagers and dedicated namespaces), then Ciyan (legacy root distribution, optional reader packs and cloud save-before-exit). Each repo pins its own shared submodule at `shared/pwa-core`. For hosted runtime, avoid collisions: WorldGen/Ascendant assets remain beneath their existing app paths; Ciyan must not overwrite host-owned helper files. Preserve same-origin local data, font caches, reader downloads, URL paths, manifests, CSP and standalone builds. Hosted mode uses AppLauncher's worker only. The version tree must report distinct branch pins; no requirement that all PWA-Core versions equal upstream main. AppLauncher retains exact pinned-source checks and strict failed-app rejection. Keep PWA-GoogleDrive compatibility checks as they are.

After each migration, run the library tests, app suite, standalone packager, strict assembled release and manifest checks; exercise offline startup, failed upgrade, unchanged asset reuse, multiple tabs, navigation, and application Home/Update. Rollback is reverting the individual consumer commit/pin and publishing a validated new release; do not reset or delete local browser databases.

## 6C: additional shared browser primitives, only when contracts match

Extract small independently testable modules for host capability detection, safe downloads/share with fallbacks, bounded async operations, and generic accessible dialog/status behavior where genuinely duplicated. Maintain per-app adapters for save/exit, worker lifecycles and local UI state. Do not rewrite the existing apps into a common UI framework. Consider generic IndexedDB transaction primitives only after examining the respective concurrency and migration contracts; preserve current database identities and app schemas. No automatic migrations for pre-1.0 WorldGen development saves. Move storage/domain helpers only with their tests and a clear dependency direction.

## 6D: cloud adapters and release automation

PWA-GoogleDrive remains the sole owner of OAuth, token/session lifecycle, account profiles, backup manifests, cloud revision conflicts, retention and telemetry. Do not duplicate or relocate those mechanisms in PWA-Core. The library currently has Ciyan-specific assumptions in local-data and sync partitioning; replace those with explicit app-provided adapters only as actual WorldGen/Ascendant cloud backup requirements are defined. Use schema-specific validation, snapshot contracts, conflict rules, and portability tests before onboarding another app. Keep cloud opt-in and avoid coupling local/offline use to connectivity. Network telemetry remains separate from app state and can inform later performance work.

No new release-dispatch workflow in the first shared release. Pin updates explicitly until the migration is proven. Later, if automated shared updates are useful, use one serialized, retrying dependency reconciler per consumer, with full tests and fast-forward-only publication, not overlapping workflows. The existing AppLauncher coordinator stays authoritative for production. A library main update alone is not permission to change deployed app versions. The recursive dependency tree identifies every actual pin.

## Later work, separate from infrastructure extraction

WorldGen and Ascendant usability and stable export contracts come after shared infrastructure; then Chronicle's vertical slice and intentional cross-app interoperability. Do not make those apps depend on each other's engines or internal save schemas. Define versioned, validated export/import boundaries when concrete features need them.

## Acceptance and rollback

No regression in backup/recovery, no changes to existing app storage or identities, no extra browser request for common code, strict release gate remains intact, no stale/partial deployable bundle, real hosted/standalone build and device verification. Keep work in reviewable commits, no force pushes. Publish PWA-Core before applying consumer patches so the pinned gitlink is resolvable remotely.

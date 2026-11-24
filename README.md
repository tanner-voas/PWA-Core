# PWA-Core v0.1.1

Dependency-free, independently pinned shared PWA infrastructure for AppLauncher and its applications. This repository is not a hosted application, a Cloudflare Worker deployment, a data store, or a cloud authentication library. It is consumed as a Git submodule at `shared/pwa-core` and packaged locally. It does not depend on AppLauncher or PWA-GoogleDrive.

## Browser primitives (7C, v0.1.1)

- `browser-host.js`: live callable host detection, receiver-preserving Home, optional hosted updater with lazy local fallback, best-effort standalone worker registration. Apps must still complete their own save policy. The host owns the hosted service worker and navigation; the helper does not register one in hosted mode by itself. Pass `env` only for testing or an explicit browser environment.
- `browser-files.js`: Blob/text delivery using a temporary attached hidden anchor, with caller-selected URL revocation delay and cleanup even on a failed click. `shareFileOrDownload` returns `shared` or `downloaded` to describe the initiated delivery path, never proof of a durable saved file. It only falls back when file sharing is unsupported or not requested; cancellation and share errors propagate. Filename selection, MIME, serialization, schema checks, confirmation and backup state remain app policy.

Both modules are dependency-free. Package each selected file locally at the consumer's runtime path; do not ship source adapters that import a repository-relative submodule. WorldGen and Ascendant use their own app-relative copies; Ciyan's new root filenames are separate from host-owned assets. Existing updater/worker and offline protocol are unchanged. The launcher provider and its controller-change listener remain separate from standalone registration. IndexedDB helpers, app modals, import schemas, async cancellation and app lifecycle policies were audited but not generalized: their transactions, UI and failure contracts differ.

## First release

- `src/pwa-update.js`: bounded update registration, activation, reload and update-button handling; preserves the current URL. The caller must finish its own local save/cloud confirmation before asking to reload.
- `src/offline-request.js`: the existing MessageChannel offline pack protocol (`status`, `download`, `remove`). The application owns pack selection and presentation.
- `build/sw.template.js`: shared release-scoped service-worker implementation extracted from the four existing apps. App cores, optional reader packs, integrity-verified reuse, prior-release routing, and multi-window protection are retained. The current `shell`, `app:*` and `reader:*` group meanings are unchanged.
- `build/offline.py`: fingerprints actual packaged assets, validates and canonically orders the inventory, and generates a standalone classic worker with explicit managed cache prefixes and network bypass paths. The application supplies asset selection and policy; no generic code guesses which files are mandatory.

This release intentionally does not change any app's data format, backup logic, authentication, UI design, or storage keys. No new dependencies, CDN or deployment credentials are required.

## Use

Pin a reviewed release rather than tracking an untested branch at build time:

```sh
git submodule add https://github.com/tanner-voas/PWA-Core.git shared/pwa-core
git -C shared/pwa-core checkout --detach v0.1.1
git add .gitmodules shared/pwa-core
```

Package the selected JS modules into the application's existing distribution paths. They are ordinary ES modules, not a global singleton. Keep a host's and an app's runtime files separate when both are needed, especially Ciyan's legacy root distribution. Do not import a sibling repository at runtime or rely on a network-hosted JS file.

```python
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'shared/pwa-core/build'))
from offline import asset_record, generate_worker

# Run after all essential/optional app assets have been copied; exclude generated
# worker and non-browser deployment metadata from the inventory.
assets = [asset_record(dist, file, groups_for(file)) for file in packaged_files]
cache, worker, inventory = generate_worker(
    assets, cache_prefix='example-shell-', version=app_version,
    excluded_path_prefixes=['/_profiles/'],
)
(dist / 'sw.js').write_text(worker, encoding='utf-8')
(dist / 'offline-inventory.json').write_text(inventory + '\n', encoding='utf-8')
```

AppLauncher and Ciyan explicitly preserve their existing shared legacy cache-prefix policy: `app-launcher-shell-` and `ciyan-shell-`. WorldGen and Ascendant use their own existing prefixes. Never broaden a prefix to include user-imported chapter, font or arbitrary storage caches. Keep `/_profiles/` bypassed where used. Do not change the scope, service-worker registration URL, or PWA manifest identity during migration.

## Testing and releases

`npm test` runs the Node.js lifecycle/updater/message tests and Python inventory/generator tests. Node 22 and Python 3.12+ are the intended CI tools; no npm or pip installation is needed. GitHub Actions tests pushes and pull requests. The package has its own version and tag; consumer releases pin the exact tested commit and expose it in AppLauncher's dependency tree. PWA-Core does not deploy a Worker or dispatch automatic consumer updates in v0.1.0. Each consumer upgrades explicitly, and AppLauncher validates the complete candidate before promoting production. Distinct PWA-Core pins can coexist because each is packaged with its consumer and the hosted service worker remains launcher-owned.

See `ITEM6_PLAN.md` for migration order, release gates, architecture boundaries and later work.

## Shared translation

`src/translation.js` provides temporary device-local cached translation. The private `pwa-common-api` Worker is deployed separately from the apps; see [setup](TRANSLATION_SETUP.md).

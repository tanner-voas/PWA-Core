# Shared private translation Worker

Deploy this repository as `pwa-core-api` (not a Pages site). The Worker has no public route or preview URL. It uses a service binding to the existing `pwa-profiles-api`; the existing Google session cookie is validated through its `/_profiles/v1/status` endpoint. No OAuth changes are needed. The global Durable Object reserves characters before each Google request, including failed attempts (conservative). The 500,000 monthly character cap assumes this Google billing allowance is not used elsewhere. This is a usage guard, not a general Cloud billing cap. Only zh-CN to en Basic v2 is supported initially.

1. Push this repository's new commit, then deploy via Cloudflare Workers Builds (build command blank, deploy command `npx wrangler@4 deploy`) or `npm run deploy:worker` from this directory. The existing profiles Worker must be deployed first.
2. On `pwa-core-api` > Settings > Variables and Secrets, add `GOOGLE_TRANSLATE_API_KEY` as type **Secret** and deploy. Use the key restricted to Cloud Translation API. Never add it to Git. Alternatively `npx wrangler@4 secret put GOOGLE_TRANSLATE_API_KEY`.
3. Deploy Ciyan and AppLauncher only after the common Worker exists. Their service bindings will route same-origin `/_translation/translate` requests. No public route is needed. The API does not accept unauthenticated requests.
4. Test on each origin after connecting Google Drive; cache hits also work offline. Check Google billing after first use. Trial expiry may require upgrading the billing account. No automatic retries or pretranslation.

## Diagnostics (v0.1.3)

Cloudflare Worker observability is enabled. Translation events include request ID, stage, fixed code, HTTP status, optional upstream status, duration and character count only. View pwa-core-api > Observability > Logs. No paragraph, translation, cookie, account identity or API key is logged. The client retains a device-local ring of up to 100 sanitized translation events, exportable in Ciyan independently of the Drive telemetry. The monthly reservation policy is unchanged.

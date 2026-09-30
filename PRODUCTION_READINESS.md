# Production readiness plan (2026-09-30)

## Assessment: 58% complete before this branch
A Next.js dashboard, FastAPI backend, Cloudflare Worker, and deployment notes exist. The tree has no tests or CI workflow. The Worker configuration and local backend contain committed fallback credentials; an admin password is hardcoded. The Worker and local backend diverge, and the frontend uses a fixed production API URL. The estimate is a rough judgment based on repository evidence, not proof of live service health.

## Work completed on this branch
- Remove committed credential values and fail closed when admin authentication is unconfigured.
- Move admin access from URL query parameters to an `X-Admin-Password` header in both backends and the frontend.
- Document secret setup and rotation of exposed credentials.

## Remaining release gates
1. Rotate the exposed WeatherAPI credential and admin password immediately in provider dashboards, then update Cloudflare secrets and any local environments. Git history still contains them; coordinate history cleanup with collaborators if appropriate.
2. Replace password-in-query admin access with authenticated header or session flow, rate limiting, and constant-time credential checks. Review any existing feedback exposure.
3. Add automated tests for Worker and FastAPI parity, scraping failures, stale-cache behavior, AI request validation, and frontend loading/error states; run CI on every PR.
4. Reconcile frontend API URL with environment configuration and verify CORS policy for intended origins.
5. Validate data source terms, freshness, units, error messaging, and agricultural advice with domain experts.
6. Run staged deployment checks, security review, accessibility checks, monitoring/alerting, rollback exercise, and release approval.

## Secret setup for deployment
Set `WEATHER_API_KEY` and `ADMIN_PASSWORD` as Cloudflare Worker secrets with `npx wrangler secret put WEATHER_API_KEY` and `npx wrangler secret put ADMIN_PASSWORD` from `api-worker`. Set the same names as environment variables for local FastAPI. Never put credential values in `wrangler.toml`, source, or an issue. Configure `GEMINI_API_KEY` as a secret only if chat is enabled. Rotate the previously committed credentials before release; removing them from the branch does not revoke them or erase Git history.

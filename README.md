# STELLAR API

Backend for [STELLAR](https://www.stellar-zone.com), a map of K-pop birthday cafe events (生咖) and the venues that host them in Taiwan. Why it exists and how it grew: see the [frontend README](https://github.com/zzuhann/stellar-web#readme).

## What it does

- **Artists and events** — submission, admin review (single and batch), and public listing with search, region, date and birthday-week filters. Approval emails go out through Resend, grouped per submitter.
- **Venues** — listings with capacity ranges and, where confirmed, tags for pricing and decoration conditions (the frontend uses them for related-venue suggestions), public venue submission, and syncing between events and the venue they are held at.
- **Event import assistant** (admin) — Gemini parses a social post caption into an event draft; image URLs are fetched server-side into Cloudflare R2 behind an SSRF guard.
- **Users** — Firebase Auth, favorites, own submissions; only the submitter or an admin can edit a submission.
- **Contact form**, Google Places lookups, and image upload to R2.

API reference: [`openapi.yaml`](openapi.yaml).

## Stack

Express 5 · TypeScript · Node.js 24 · Firestore · Firebase Auth · Cloudflare R2 · Google Places API · Gemini API · Resend · Sentry · Zod · Jest

## Architecture

```text
stellar-zone.com (Next.js / Vercel)
  -> api.stellar-zone.com (Cloudflare Worker)
  -> stellar-backend (GCP Cloud Run, asia-east1)
  -> Firestore / Cloudflare R2 / Google Places API
```

- **Routes → controllers → services.** Routes wire middleware, controllers handle req/res, services hold business logic and Firestore access. A global error handler turns thrown application errors into `{ error, code }`; a few legacy responses still return only `error`.
- **Validation.** Selected request bodies and queries use Zod middleware; validation on other endpoints varies.
- **In-memory cache with request coalescing.** Hot reads (approved events, artists, venues) are cached per instance with TTLs and writes invalidate by key prefix; concurrent misses on the active-event and venue lists share one cache fill per key. The cache is not shared across Cloud Run instances, which is acceptable at current traffic.
- **Rate limiting.** A global limiter, with additional limiters for Places, venue submissions and their uploads, Gemini import, and the contact form.
- **Scheduled cleanup.** A Firebase scheduled function removes expired events from each artist's active list daily.

## Development

Requirements: Node.js 24 and [Bun](https://bun.sh) for local scripts (the Docker image uses npm). Ask the team for the `.env` file and place it in this directory.

```bash
bun install
bun run dev:node     # tsx watch on http://localhost:3001
```

`bun run dev` (Bun runtime) only works for endpoints that read a single document; use `dev:node` for everything else. Production runs on Node.

```bash
bun run typecheck
bun run lint
bun run test         # Jest unit and integration tests
bun run build        # compile to dist/ (used by the Docker image)
```

## Deployment

Pushing to `main` triggers Cloud Build (`cloudbuild.yaml`): build the Docker image, push to Artifact Registry, deploy a new Cloud Run revision. Environment variables live on the Cloud Run service, not in this repo. Details in [`DEPLOYMENT.md`](DEPLOYMENT.md).

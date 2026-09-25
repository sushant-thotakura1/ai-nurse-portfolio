# screening-web

Mobile-first web wizard for the KEMHRC adult vaccination screening pilot. It
walks every step of the questionnaire served by
`GET /v1/api/:tenantId/screening/sessions/:id/state`, posting each answer back as
the user progresses and refetching the session state so conditionally-revealed
questions appear. At the end it calls `complete` and shows the vaccine
recommendation, or shows the stop/defer result if a stop rule fires mid-way.

## Running locally

1. `npm install`
2. Start the backend on `:3000` with a `default-tenant` tenant seeded
   (`node scripts/create-default-tenant.js` in the repo root).
3. `npm run dev` → http://localhost:5180/default-tenant

The dev server proxies `/v1` and `/api` to `http://localhost:3000`, so relative
API calls reach the backend without CORS setup.

## URL shape / multi-tenant

One deployment serves many tenants. The **first path segment is the tenant
slug**:

- `http://localhost:5180/<tenant-slug>` (e.g. `/default-tenant`, `/kemhrc`) →
  API calls go to `/v1/api/<tenant-slug>/screening/...`.
- The root path (`http://localhost:5180/`) has no tenant and shows a "this
  screening link is missing a clinic code" message instead of silently using a
  default tenant.

## Configuration

- `VITE_API_BASE` — override the API base path for a single-tenant baked build
  (e.g. a fixed tenant slug or a remote host). When set it wins over the
  URL-path slug. Unset by default, so the tenant comes from the URL path.

## Scripts

- `npm test` — run the vitest suite
- `npm run build` — type-check (`tsc`) and produce a production build
- `npm run dev` — start the Vite dev server

## Notes

This is an isolated SPA. It has no build-time dependency on the backend `src/`
and communicates with the server only over HTTP.

# Contributing to AI Nurse POC

## Branching

See [`CLAUDE.md`](CLAUDE.md)'s "Branching" section for branch strategy,
branch naming, and commit message format — the single source of truth (Claude
Code reads it directly, so keeping one copy avoids the two drifting apart).

Summary: `develop` is the integration branch; `main` triggers automatic
deployment to non-prod and must never be targeted directly. Every change —
no matter how small — goes through a feature branch and a PR into `develop`,
with at least one review before merging.

## Running Locally

```bash
# Backend + DB
docker compose up -d

# Frontend (dev mode)
cd admin-dashboard
npm install
npm run dev
```

See `.env.example` for required environment variables.

## Tests

```bash
# All backend tests
npx jest --no-coverage

# Specific suite
npx jest tests/unit/messaging/ --no-coverage
```

All tests must pass before opening a PR.

## Secrets

- Never commit `.env` files
- Never hardcode tokens, API keys, or passwords in source code
- Use `requireEnv('VAR_NAME')` for any secret the server needs at startup
- `config/users.json` is in `.gitignore` — do not commit it

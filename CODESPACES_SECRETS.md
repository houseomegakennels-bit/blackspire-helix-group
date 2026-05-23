# Codespaces Secrets

## Source of truth for secrets

The source of truth for runtime secrets is **GitHub Codespaces secrets**, not this repository.

Do not store real API keys in:

- `AGENTS.md`
- `PROJECT_CONTEXT.md`
- `AI_WORKSPACE_SYNC.md`
- `memory/`
- source files
- committed `.env` files

## Required variables

The current required variables are defined in `.env.example`:

- `OPENAI_API_KEY`
- `DATABASE_URL`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`

## Recommended setup

1. In GitHub, open:
   `Settings -> Codespaces -> Secrets`
2. Add each variable from `.env.example` as a Codespaces secret.
3. Give each secret access to `houseomegakennels-bit/blackspire-helix-group`.
4. Rebuild or restart the codespace.

GitHub injects Codespaces secrets as environment variables into the codespace session.

## Useful commands inside the codespace

Check whether all required variables exist:

```bash
bash scripts/check-required-env.sh
```

Create a local `.env` from the currently injected environment variables:

```bash
bash scripts/materialize-env-from-secrets.sh
```

Force-refresh `.env` from the current environment variables:

```bash
bash scripts/materialize-env-from-secrets.sh --force
```

Switch Codex CLI from ChatGPT-plan auth to API-key auth:

```bash
bash scripts/codex-use-api-key.sh
```

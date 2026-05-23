# Codespaces Secrets

## Source of truth for secrets

The source of truth for runtime secrets is **GitHub Codespaces secrets**, not this repository.

For Codex inside Codespaces, this is also the required source of truth for hands-free authentication. Do not depend on ChatGPT OAuth persistence across fresh or rebuilt Codespaces.

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

Ember Halo also needs these secrets for a full backend run:

- `SUPABASE_JWT_SECRET`
- `ANTHROPIC_API_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `FIRST_ADMIN_EMAIL`

## Recommended setup

1. In GitHub, open:
   `Settings -> Codespaces -> Secrets`
2. Add each variable from `.env.example` as a Codespaces secret.
3. Give each secret access to `houseomegakennels-bit/blackspire-helix-group`.
4. Rebuild or restart the codespace.

GitHub injects Codespaces secrets as environment variables into the codespace session.

## Codex authentication policy in Codespaces

Codespaces should authenticate Codex with `OPENAI_API_KEY` from GitHub Codespaces secrets.

- This avoids repeated login prompts on fresh or rebuilt Codespaces.
- This is the required path for hands-free Codex startup in Codespaces.
- Desktop Codex can keep using its normal local ChatGPT login.
- Do not copy or sync local desktop `.codex/auth.json` into a Codespace.

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

Bootstrap the full Codespace setup again:

```bash
bash scripts/bootstrap-codespace.sh
```

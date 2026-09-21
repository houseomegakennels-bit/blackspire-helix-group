# Owned gateway n8n writer credential

Owned source preparation generates a new writer ingress key. Retaining the approved n8n credential ID does not update that key. The intake credential is unrelated and stays unchanged. Neither issuer credentials nor database passwords belong in n8n.

The root command is prepared for independent review; production execution is UNVERIFIED:

```sh
node scripts/zola-sync-owned-n8n-writer.js --synchronize RELEASE_SHA PACKAGE_CONFIGURATION_FILE BACKUP_FILE
```

Use Node 22.23.1 from the exact clean published release branch. Inputs must be protected files beneath the fixed preparation root. Prepare the new package first while the approved original workflow remains active. Then use the existing reviewed release workflow deactivation and drain lane. Run this command only with that workflow inactive, all executions terminal, and all four local services stopped. Never use a trial workflow invocation to test credential scope.

The command holds the global commander guard, binds the protected owned source, profile and exact package/backup, checks original or candidate graph identity, rechecks credential metadata and the live httpHeaderAuth schema, and writes a durable intent before one PATCH to the existing writer credential RzOyDmXYmx58yZHi. The replacement data sets only x-buyer-writer-key and restricts use to jarvis.blackspirehelix.com. It never updates intake 9DiTRFOJnwA6Aw9y, creates credentials, modifies a workflow, activates one, or sends a webhook.

The fixed endpoint follows the official [n8n credential controller](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/public-api/v1/controllers/credentials.public.controller.ts) and [update schema](https://github.com/n8n-io/n8n/blob/master/packages/cli/src/public-api/v1/handlers/credentials/spec/paths/updateCredential.generated.yml): PATCH, credential:update scope, data replacement with isPartialData false. A fresh read-only production GET verified the approved ID/type/name and the header credential schema. Actual update permission and deployed PATCH behavior remain UNVERIFIED; no scope-probing write was made.

Root-only immutable intent/result records live under preparation/owned-n8n-writer. No secret values enter records or output. Exact acknowledged reruns recheck observations without sending another PATCH. Pending intents always refuse automatic retry: metadata timestamps cannot prove secret equality. A lost acknowledgement needs an independently reviewed reconciliation that proves the stored value or explicitly resends the same retained value; this helper neither guesses success nor rotates again. API acknowledgement is configuration evidence only. Positive bounded workflow acceptance is still required before release acceptance.

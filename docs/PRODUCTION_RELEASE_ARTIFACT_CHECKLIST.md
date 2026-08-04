# Production release artifact checklist

Status: source contract only. Running this checklist against `/opt` or changing `current` requires
separate operator authority; this repository change creates no release and activates nothing.

## Build inputs

- Use a full reviewed 40-character commit SHA available in the trusted local repository.
- Run source CI, secret scan, dependency audit, production preflight, and shell validation first.
- Confirm the commit contains the Command allowlist roots and every path declared in
  `RELEASE_REQUIRED_FILES` in `scripts/release-tree-validator.sh`.
- Never add a credential, environment file, database, workspace checkout, backup, generated log,
  `node_modules`, test artifact, or host-specific file to the archive.

## Build and inspect

```sh
bash scripts/release-create.sh <approved-full-sha>
bash scripts/release-preflight.sh <approved-full-sha>
```

Record without exposing secrets:

- the requested SHA, release directory basename, and exact `COMMIT_SHA` agreement;
- successful required-file and `RELEASE_MANIFEST.sha256` verification;
- root/group ownership and normalized `0755` directory/executable and `0644` ordinary-file modes;
- absence of symlinks, special files, excluded repository roots, and writable runtime content;
- artifact byte size and file count for capacity planning.

## Rollback set

Build two independently reviewed SHAs with this same manifest contract. Preflight both immediately
before cutover. An older directory with only `.release-complete` is not a valid rollback target after
this contract lands. Never weaken validation to reuse it; rebuild the exact historical commit with
current approved builder tooling, then verify the resulting bytes and required paths.

## Tamper and recovery rehearsal

In a disposable release root only, prove preflight refuses each of: changed `COMMIT_SHA`, missing
required runtime file, modified application byte, unexpected added file, altered/truncated manifest,
symlink, special file, ownership drift, and mode drift. Confirm every refusal leaves `current`, the
previous release, and `shared/` byte-identical. Do not perform destructive probes in the live release
root.

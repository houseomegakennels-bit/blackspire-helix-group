#!/usr/bin/env bash
set -euo pipefail

export CODESPACES="${CODESPACES:-true}"
exec bash "$(git rev-parse --show-toplevel)/scripts/bootstrap-development.sh" codespace

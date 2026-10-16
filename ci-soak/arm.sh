#!/usr/bin/env bash
# Puts the household plans smoke spec in the state this arm runs.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
spec=src/app/core/services/household-plans.service.smoke.spec.ts
: "${ARM:?}" "${BASE_SHA:?}"
case "$ARM" in
  plain|control) git checkout "$BASE_SHA" -- "$spec" ;;
  candidate) git checkout "$BASE_SHA" -- "$spec"; git apply --index "$here/candidate.patch" ;;
  *)
    copy="$here/specs/$ARM.household-plans.service.smoke.spec.ts"
    [ -f "$copy" ] || { echo "no spec copy for arm $ARM" >&2; exit 1; }
    cp "$copy" "$spec"
    ;;
esac
git status --short

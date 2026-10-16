#!/usr/bin/env bash
# One shard: ROUNDS rounds of the zoned smoke lane, each in a fresh emulator.
# A red round is a result, not an error; the shard fails only when a round
# could not run at all.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
: "${ARM:?}" "${ROUNDS:?}"
export SHARD="${SHARD:-0}"
export OUT="${OUT:-$PWD/ci-soak-out}"
mkdir -p "$OUT"
[ -f "$OUT/rounds.csv" ] || node "$here/summarize.mjs" --header > "$OUT/rounds.csv"
errors=0
for n in $(seq 1 "$ROUNDS"); do
  if ! bash "$here/round.sh" "$n"; then
    errors=$((errors + 1))
  fi
done
cat "$OUT/rounds.csv"
[ "$errors" -eq 0 ] || { echo "$errors round(s) could not run" >&2; exit 1; }

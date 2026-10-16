#!/usr/bin/env bash
# Round N: a fresh emulators:exec running the smoke:dates lane as
# package.json has it, then one table row per zone it reached.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
n="$1"
dir="$OUT/r$n"
rm -rf "$dir" && mkdir -p "$dir"
node -e "console.log(new Date().toISOString())" > "$dir/started"
npx firebase emulators:exec --only auth,storage,firestore --project demo-home-account \
  "bash '$here/inside.sh' '$n'" > "$dir/exec.log" 2>&1
echo "$?" > "$dir/exec.status"
cp firestore-debug.log "$dir/" 2>/dev/null || true
case "$ARM" in
  traced*)
    node "$here/copies.mjs" --json "$dir" > "$dir/copies.json" 2> "$dir/copies.err" || rm -f "$dir/copies.json"
    node "$here/copies.mjs" "$dir" > "$dir/copies.md" 2>> "$dir/copies.err" || true
    ;;
esac
rows="$(node "$here/summarize.mjs" --round "$dir" "$SHARD" "$n" "$ARM")" || { echo "round $n: could not read its logs" >&2; exit 1; }
printf '%s\n' "$rows" >> "$OUT/rounds.csv"
printf '%s\n' "$rows"
# Keep what a later reading needs: every red or triggered round, and the
# first two traced rounds of each shard as references.
if printf '%s\n' "$rows" | grep -q ',harness,'; then exit 1; fi
keep=no
printf '%s\n' "$rows" | grep -q ',fail,' && keep=yes
[ -f "$dir/sidecar.ndjson" ] && grep -q '"trigger"' "$dir/sidecar.ndjson" && keep=yes
case "$ARM" in traced*) [ "$n" -le 2 ] && keep=yes ;; esac
if [ "$keep" = yes ]; then
  # The net logs and the recordings are most of a kept round; they compress well.
  for f in "$dir"/netlog-*.json "$dir"/requests.ndjson "$dir"/ny.log "$dir"/tokyo.log "$dir"/firestore-debug.log "$dir"/gc.log "$dir"/firestore.jfr; do
    [ -f "$f" ] && gzip -6 "$f"
  done
else
  rm -rf "$dir"
fi
exit 0

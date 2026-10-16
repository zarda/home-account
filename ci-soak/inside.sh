#!/usr/bin/env bash
# Runs inside emulators:exec, with the emulators up. The traced arm attaches
# to the Firestore JVM alone (by pid), so the Storage JVM and the CLI's
# java -version check are untouched.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
n="$1"
dir="$OUT/r$n"
info="$(curl -s "http://$FIREBASE_EMULATOR_HUB/emulators")"
printf '%s\n' "$info" > "$dir/emulators.json"
pid="$(printf '%s' "$info" | jq -r '.firestore.pid')"
ws="$(printf '%s' "$info" | jq -r '.firestore.webSocketPort // 9150')"
jcmd_() { env -u JAVA_TOOL_OPTIONS -u JDK_JAVA_OPTIONS jcmd "$@"; }
traced=no
case "$ARM" in traced*) traced=yes ;; esac
bg=()
if [ "$traced" = yes ]; then
  jcmd_ "$pid" JFR.start name=soak settings=profile > "$dir/jfr-start.txt" 2>&1
  jcmd_ "$pid" VM.log output="file=$dir/gc.log" what='gc*=info,safepoint=info' decorators=time,uptime > "$dir/vm-log.txt" 2>&1
  node "$here/requests-recorder.mjs" "ws://127.0.0.1:$ws/requests" "$dir/requests.ndjson" &
  bg+=("$!")
  node "$here/dump-sidecar.mjs" "$pid" "$dir" 18817 &
  bg+=("$!")
  export CHROME_BIN="$here/chrome-netlog.sh"
  sleep 0.5
fi
NETLOG="$dir/netlog-ny.json" TZ=America/New_York npm run test:smoke:dates > "$dir/ny.log" 2>&1 \
  && NETLOG="$dir/netlog-tokyo.json" TZ=Asia/Tokyo npm run test:smoke:dates > "$dir/tokyo.log" 2>&1
status=$?
if [ "$traced" = yes ]; then
  jcmd_ "$pid" JFR.dump name=soak filename="$dir/firestore.jfr" > "$dir/jfr-dump.txt" 2>&1
  # Give a heap dump the sidecar started time to finish before the CLI stops the JVM.
  for _ in $(seq 1 60); do pgrep -f "GC.heap_dump" > /dev/null || break; sleep 1; done
  for p in ${bg[@]+"${bg[@]}"}; do kill "$p" 2> /dev/null; done
  wait 2> /dev/null
fi
exit "$status"

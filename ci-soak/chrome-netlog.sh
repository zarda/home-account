#!/usr/bin/env bash
# CHROME_BIN for the traced arm: the browser Karma would start, plus a net
# log of every request it makes, at the path NETLOG names.
real="${REAL_CHROME:-}"
if [ -z "$real" ]; then
  for c in /usr/bin/google-chrome /usr/bin/google-chrome-stable "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    if [ -x "$c" ]; then real="$c"; break; fi
  done
fi
[ -n "$real" ] || { echo "no Chrome found; set REAL_CHROME" >&2; exit 1; }
if [ -n "${NETLOG:-}" ]; then
  exec "$real" --log-net-log="$NETLOG" --net-log-capture-mode=Default "$@"
fi
exec "$real" "$@"

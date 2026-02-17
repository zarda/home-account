#!/bin/bash
# Patches @capacitor-firebase/authentication to remove Facebook SDK dependency
# Only Google Sign-In is needed for this project
# Uses portable sed (no -i) so it works on both macOS (BSD sed) and Linux (GNU sed).

PACKAGE_SWIFT="node_modules/@capacitor-firebase/authentication/Package.swift"

if [ -f "$PACKAGE_SWIFT" ]; then
  sed -e '/.package(url: "https:\/\/github.com\/facebook\/facebook-ios-sdk.git"/d' \
      -e '/.product(name: "FacebookCore"/d' \
      -e '/.product(name: "FacebookLogin"/d' \
      -e '/.define("RGCFA_INCLUDE_FACEBOOK")/d' \
      "$PACKAGE_SWIFT" > "${PACKAGE_SWIFT}.tmp" && mv "${PACKAGE_SWIFT}.tmp" "$PACKAGE_SWIFT"
  echo "Patched: Removed Facebook SDK from @capacitor-firebase/authentication"
fi

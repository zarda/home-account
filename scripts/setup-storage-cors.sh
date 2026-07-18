#!/usr/bin/env bash
# One-time Cloud Storage CORS setup for in-browser receipt downloads.
#
# Reading a stored receipt image from JavaScript (the "convert image to
# note" feature) requires the bucket to allow cross-origin GET requests.
# Without this, browsers can still DISPLAY receipts in <img> tags, but
# fetch()/the Storage SDK are blocked by CORS.
#
# Usage:
#   ./scripts/setup-storage-cors.sh <bucket>
#   e.g. ./scripts/setup-storage-cors.sh my-project.firebasestorage.app
#
# Requires the Google Cloud CLI (gcloud) or gsutil, authenticated against
# the Firebase project (gcloud auth login / firebase login).
set -euo pipefail

BUCKET="${1:?Usage: $0 <bucket> (e.g. my-project.firebasestorage.app)}"
CORS_FILE="$(dirname "$0")/../storage.cors.json"

if command -v gcloud >/dev/null 2>&1; then
  gcloud storage buckets update "gs://${BUCKET}" --cors-file="${CORS_FILE}"
elif command -v gsutil >/dev/null 2>&1; then
  gsutil cors set "${CORS_FILE}" "gs://${BUCKET}"
else
  echo "Neither gcloud nor gsutil found. Install the Google Cloud CLI:" >&2
  echo "  https://cloud.google.com/sdk/docs/install" >&2
  exit 1
fi

echo "CORS configuration applied to gs://${BUCKET}."

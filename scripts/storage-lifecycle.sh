#!/usr/bin/env bash
# Applies infra/uploads-lifecycle.json to the uploads bucket: files people attach to AI requests (ai/<account>/…)
# are deleted 90 days after upload. Workspace images (logos, QR codes, record photos) are not under ai/ and are kept.
# The bucket's 7-day soft delete still lets a deleted file be restored for a week.
set -euo pipefail

BUCKET="${UPLOAD_BUCKET:-everyops-prod-uploads}"
PROJECT="$(gcloud config get project 2>/dev/null)"
if [[ "$PROJECT" != "everyops-prod" ]]; then
  echo "gcloud project is '$PROJECT', expected everyops-prod" >&2
  exit 1
fi

gcloud storage buckets update "gs://$BUCKET" --lifecycle-file="$(dirname "$0")/../infra/uploads-lifecycle.json"
gcloud storage buckets describe "gs://$BUCKET" --format="json(lifecycle_config)"

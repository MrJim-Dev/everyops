#!/usr/bin/env bash
# Builds the image with Cloud Build and deploys it to Cloud Run (everyops-web, asia-southeast1).
# Runs as everyops-run, reaches Cloud SQL through the /cloudsql socket, and reads secrets from Secret Manager.
#
# Production deploys from main only. GitHub Actions runs this on every push to main
# (.github/workflows/deploy.yml). Run locally, it refuses unless you are on a clean main that matches
# origin/main. EMERGENCY_DEPLOY=1 skips that check; use it only when Actions is down.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ "${GITHUB_ACTIONS:-}" != "true" ] && [ "${EMERGENCY_DEPLOY:-}" != "1" ]; then
  git fetch -q origin main
  branch="$(git rev-parse --abbrev-ref HEAD)"
  if [ "$branch" != "main" ] || [ -n "$(git status --porcelain)" ] || [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
    echo "Refusing to deploy: production deploys come from main through GitHub Actions." >&2
    echo "Push to main instead. (Here: branch=$branch, clean=$([ -z "$(git status --porcelain)" ] && echo yes || echo no), matches origin/main=$([ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && echo yes || echo no))" >&2
    exit 1
  fi
fi

PROJECT="${GCP_PROJECT:-everyops-prod}"
REGION="asia-southeast1"
SERVICE="everyops-web"
INSTANCE="$PROJECT:$REGION:everyops-db"
PROJECT_NUMBER="${PROJECT_NUMBER:-223724593768}"
RUN_URL="https://$SERVICE-$PROJECT_NUMBER.$REGION.run.app"
COMMIT="$(git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"
# The public address. everyops.app is mapped to this service; the run.app URL keeps working as a trusted origin.
URL="${APP_URL:-https://everyops.app}"
MIN_INSTANCES="${MIN_INSTANCES:-0}"

gcloud run deploy "$SERVICE" \
  --project="$PROJECT" --region="$REGION" --source=. \
  --service-account="everyops-run@$PROJECT.iam.gserviceaccount.com" \
  --add-cloudsql-instances="$INSTANCE" \
  --set-secrets="DATABASE_URL=everyops-database-url:latest,BETTER_AUTH_SECRET=everyops-better-auth-secret:latest,SMTP_PASSWORD=everyops-smtp-password:latest,GOOGLE_CLIENT_ID=everyops-google-client-id:latest,GOOGLE_CLIENT_SECRET=everyops-google-client-secret:latest,CRON_SECRET=everyops-cron-secret:latest" \
  --set-env-vars="^|^BETTER_AUTH_URL=$URL|NEXT_PUBLIC_SITE_URL=$URL|BETTER_AUTH_TRUSTED_ORIGINS=$RUN_URL|GOOGLE_CLOUD_PROJECT=$PROJECT|GEMINI_LOCATION=${GEMINI_LOCATION:-global}|GEMINI_MODEL=${GEMINI_MODEL:-gemini-3.7-flash}|SMTP_HOST=smtp.hostinger.com|SMTP_PORT=465|SMTP_USER=notify@everyops.app|MAIL_FROM=EveryOps <notify@everyops.app>|UPLOAD_BUCKET=${UPLOAD_BUCKET:-everyops-prod-uploads}" \
  --allow-unauthenticated \
  --cpu=1 --memory=1Gi --concurrency=80 --timeout=300 \
  --min-instances="$MIN_INSTANCES" --max-instances=3 \
  --labels="app=everyops,commit=$COMMIT"

echo "Deployed: $URL"

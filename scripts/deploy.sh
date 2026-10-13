#!/usr/bin/env bash
# Builds the image with Cloud Build and deploys it to Cloud Run (everyops-web, asia-southeast1).
# Runs as everyops-run, reaches Cloud SQL through the /cloudsql socket, and reads secrets from Secret Manager.
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT="${GCP_PROJECT:-everyops-prod}"
REGION="asia-southeast1"
SERVICE="everyops-web"
INSTANCE="$PROJECT:$REGION:everyops-db"
URL="https://$SERVICE-$(gcloud projects describe "$PROJECT" --format='value(projectNumber)').$REGION.run.app"
MIN_INSTANCES="${MIN_INSTANCES:-0}"

gcloud run deploy "$SERVICE" \
  --project="$PROJECT" --region="$REGION" --source=. \
  --service-account="everyops-run@$PROJECT.iam.gserviceaccount.com" \
  --add-cloudsql-instances="$INSTANCE" \
  --set-secrets="DATABASE_URL=everyops-database-url:latest,BETTER_AUTH_SECRET=everyops-better-auth-secret:latest" \
  --set-env-vars="BETTER_AUTH_URL=$URL,NEXT_PUBLIC_SITE_URL=$URL,GOOGLE_CLOUD_PROJECT=$PROJECT,GOOGLE_CLOUD_LOCATION=$REGION" \
  --allow-unauthenticated \
  --cpu=1 --memory=1Gi --concurrency=80 --timeout=300 \
  --min-instances="$MIN_INSTANCES" --max-instances=3 \
  --labels=app=everyops

echo "Deployed: $URL"

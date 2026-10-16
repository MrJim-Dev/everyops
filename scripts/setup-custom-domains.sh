#!/usr/bin/env bash
# One-time platform setup for custom domains (issue #110): a global external Application Load Balancer with a
# serverless NEG in front of everyops-web, and a Certificate Manager map the app adds an entry to per customer domain.
# Reviewed, not run automatically: it creates billable resources (forwarding rules, an IP) in everyops-prod.
# EveryOps' own everyops.app keeps its Cloud Run domain mapping until you choose to move it behind the load balancer.
#
#   PROJECT=everyops-prod REGION=asia-southeast1 scripts/setup-custom-domains.sh
set -euo pipefail
PROJECT=${PROJECT:-everyops-prod}
REGION=${REGION:-asia-southeast1}
SERVICE=${SERVICE:-everyops-web}
RUN_SA=${RUN_SA:-everyops-run@${PROJECT}.iam.gserviceaccount.com}
g() { gcloud --project "$PROJECT" "$@"; }

g services enable certificatemanager.googleapis.com compute.googleapis.com

# Address, serverless NEG and backend.
g compute addresses create everyops-domains-ip --global --ip-version=IPV4
g compute network-endpoint-groups create everyops-web-neg --region="$REGION" \
  --network-endpoint-type=serverless --cloud-run-service="$SERVICE"
g compute backend-services create everyops-web-backend --global --load-balancing-scheme=EXTERNAL_MANAGED
g compute backend-services add-backend everyops-web-backend --global \
  --network-endpoint-group=everyops-web-neg --network-endpoint-group-region="$REGION"
g compute url-maps create everyops-domains --default-service=everyops-web-backend

# Certificates: a map the app adds one entry per customer hostname to, plus *.everyops.app for free subdomains.
g certificate-manager maps create everyops-domains
g certificate-manager dns-authorizations create everyops-app-wildcard --domain=everyops.app
g certificate-manager dns-authorizations describe everyops-app-wildcard --format='value(dnsResourceRecord.name,dnsResourceRecord.data)'
echo "Add that CNAME at everyops.app's DNS, then press enter."; read -r _
g certificate-manager certificates create everyops-app-wildcard \
  --domains='*.everyops.app' --dns-authorizations=everyops-app-wildcard
g certificate-manager maps entries create everyops-app-wildcard --map=everyops-domains \
  --hostname='*.everyops.app' --certificates=everyops-app-wildcard

# HTTPS front end with the map, and HTTP to HTTPS.
g compute target-https-proxies create everyops-domains-https --url-map=everyops-domains --certificate-map=everyops-domains
g compute forwarding-rules create everyops-domains-https --global --load-balancing-scheme=EXTERNAL_MANAGED \
  --address=everyops-domains-ip --target-https-proxy=everyops-domains-https --ports=443
g compute url-maps import everyops-domains-redirect --global --quiet --source=/dev/stdin <<'YAML'
name: everyops-domains-redirect
defaultUrlRedirect:
  httpsRedirect: true
  redirectResponseCode: MOVED_PERMANENTLY_DEFAULT
YAML
g compute target-http-proxies create everyops-domains-http --url-map=everyops-domains-redirect
g compute forwarding-rules create everyops-domains-http --global --load-balancing-scheme=EXTERNAL_MANAGED \
  --address=everyops-domains-ip --target-http-proxy=everyops-domains-http --ports=80

# The app creates and deletes certificates and map entries as the service account.
g projects add-iam-policy-binding "$PROJECT" --member="serviceAccount:$RUN_SA" --role=roles/certificatemanager.editor

IP=$(g compute addresses describe everyops-domains-ip --global --format='value(address)')
cat <<EOF
Done. Next:
  1. DNS for everyops.app: domains.everyops.app A $IP, and *.everyops.app A $IP.
  2. Cloud Run env for $SERVICE:
       DOMAINS_LB_IPV4=$IP
       DOMAINS_CNAME_TARGET=domains.everyops.app
       DOMAINS_CERT_MAP=projects/$PROJECT/locations/global/certificateMaps/everyops-domains
  3. Optional: restrict $SERVICE ingress to internal-and-cloud-load-balancing once everyops.app is served
     through the load balancer too.
EOF

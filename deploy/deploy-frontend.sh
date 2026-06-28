#!/usr/bin/env bash
#
# Deploys the frontend: builds the SPA pointed at the live API, pushes it to a
# private S3 bucket, and serves it over HTTPS via CloudFront (Origin Access
# Control). HTTPS is required so the in-browser mic (voice mode) works.
# Idempotent for the bucket/build; creates the CloudFront distribution once.
#
# Usage:
#   CRUCIBLE_API_BASE="https://xxxx.lambda-url.us-west-2.on.aws" bash deploy/deploy-frontend.sh
set -euo pipefail

ACCOUNT="557690618983"
REGION="us-west-2"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUCKET="crucible-frontend-${ACCOUNT}"
API_BASE="${CRUCIBLE_API_BASE:?Set CRUCIBLE_API_BASE to the Lambda Function URL}"

echo "==> Building frontend against ${API_BASE}"
cd "$ROOT"
VITE_USE_MOCK=false VITE_API_BASE="$API_BASE" npm run build >/dev/null
echo "    built dist/"

echo "==> Private S3 bucket ${BUCKET}"
aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null || \
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
aws s3 sync "$ROOT/dist" "s3://${BUCKET}" --delete >/dev/null
echo "    synced dist -> s3://${BUCKET}"

# Origin Access Control so only CloudFront can read the bucket.
OAC_ID=$(aws cloudfront list-origin-access-controls \
  --query "OriginAccessControlList.Items[?Name=='crucible-oac'].Id | [0]" --output text 2>/dev/null || echo "None")
if [ "$OAC_ID" = "None" ] || [ -z "$OAC_ID" ]; then
  OAC_ID=$(aws cloudfront create-origin-access-control --origin-access-control-config \
    "Name=crucible-oac,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" \
    --query "OriginAccessControl.Id" --output text)
fi
echo "==> OAC ${OAC_ID}"

CALLER_REF="crucible-$(date +%s)"
DIST_CONFIG=$(cat <<JSON
{
  "CallerReference": "${CALLER_REF}",
  "Comment": "crucible frontend",
  "Enabled": true,
  "DefaultRootObject": "index.html",
  "Origins": {
    "Quantity": 1,
    "Items": [{
      "Id": "s3-crucible",
      "DomainName": "${BUCKET}.s3.${REGION}.amazonaws.com",
      "OriginAccessControlId": "${OAC_ID}",
      "S3OriginConfig": { "OriginAccessIdentity": "" }
    }]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "s3-crucible",
    "ViewerProtocolPolicy": "redirect-to-https",
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
    "Compress": true
  },
  "CustomErrorResponses": {
    "Quantity": 1,
    "Items": [{
      "ErrorCode": 403,
      "ResponseCode": "200",
      "ResponsePagePath": "/index.html",
      "ErrorCachingMinTTL": 10
    }]
  }
}
JSON
)

echo "==> Creating CloudFront distribution"
DIST_JSON=$(aws cloudfront create-distribution --distribution-config "$DIST_CONFIG")
DIST_ID=$(echo "$DIST_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['Distribution']['Id'])")
DOMAIN=$(echo "$DIST_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['Distribution']['DomainName'])")

echo "==> Bucket policy: allow this distribution to read"
aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Sid\": \"AllowCloudFront\",
    \"Effect\": \"Allow\",
    \"Principal\": { \"Service\": \"cloudfront.amazonaws.com\" },
    \"Action\": \"s3:GetObject\",
    \"Resource\": \"arn:aws:s3:::${BUCKET}/*\",
    \"Condition\": { \"StringEquals\": { \"AWS:SourceArn\": \"arn:aws:cloudfront::${ACCOUNT}:distribution/${DIST_ID}\" } }
  }]
}" >/dev/null

echo ""
echo "Frontend deploying (CloudFront takes ~5-10 min to finish propagating):"
echo "  https://${DOMAIN}"
echo ""
echo "IMPORTANT: re-point the backend CORS at this domain:"
echo "  CRUCIBLE_CORS_ORIGINS=\"https://${DOMAIN}\" bash deploy/deploy-backend.sh"

#!/usr/bin/env bash
#
# Deploys the backend: uploads the zip to S3, creates/updates the crucible-api
# Lambda (python3.12, DynamoDB persistence), caps concurrency, and exposes a
# public HTTPS Function URL. Idempotent — safe to re-run.
#
# Prereq: deploy/setup-iam.sh has been run, and deploy/build/crucible-api.zip
# exists (run deploy/build-lambda.sh first).
#
# Prints the Function URL on success.
set -euo pipefail

ACCOUNT="557690618983"
REGION="us-west-2"
FN="crucible-api"
ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/crucible-lambda-role"
BUCKET="crucible-artifacts-${ACCOUNT}"
ZIP="$(cd "$(dirname "$0")/.." && pwd)/deploy/build/crucible-api.zip"
KEY="crucible-api.zip"
CONCURRENCY="${CRUCIBLE_CONCURRENCY:-5}"
CORS_ORIGINS="${CRUCIBLE_CORS_ORIGINS:-*}"

[ -f "$ZIP" ] || { echo "Missing $ZIP — run deploy/build-lambda.sh first"; exit 1; }

echo "==> Artifact bucket"
aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null || \
  aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
aws s3 cp "$ZIP" "s3://${BUCKET}/${KEY}" >/dev/null
echo "    uploaded s3://${BUCKET}/${KEY}"

if aws lambda get-function --function-name "$FN" --region "$REGION" >/dev/null 2>&1; then
  echo "==> Updating existing function code"
  aws lambda update-function-code --function-name "$FN" --region "$REGION" \
    --s3-bucket "$BUCKET" --s3-key "$KEY" >/dev/null
  aws lambda wait function-updated --function-name "$FN" --region "$REGION"
  aws lambda update-function-configuration --function-name "$FN" --region "$REGION" \
    --environment "Variables={INTERVIEWAI_PERSISTENCE=dynamodb,INTERVIEWAI_CORS_ORIGINS=${CORS_ORIGINS}}" >/dev/null
else
  echo "==> Creating function"
  aws lambda create-function --function-name "$FN" --region "$REGION" \
    --runtime python3.12 --handler lambda_handler.handler \
    --role "$ROLE_ARN" --timeout 60 --memory-size 1024 \
    --code "S3Bucket=${BUCKET},S3Key=${KEY}" \
    --environment "Variables={INTERVIEWAI_PERSISTENCE=dynamodb,INTERVIEWAI_CORS_ORIGINS=${CORS_ORIGINS}}" >/dev/null
  aws lambda wait function-active --function-name "$FN" --region "$REGION"
fi

echo "==> Capping concurrency at ${CONCURRENCY} (cost ceiling)"
aws lambda put-function-concurrency --function-name "$FN" --region "$REGION" \
  --reserved-concurrent-executions "$CONCURRENCY" >/dev/null

echo "==> Public Function URL"
if ! aws lambda get-function-url-config --function-name "$FN" --region "$REGION" >/dev/null 2>&1; then
  aws lambda create-function-url-config --function-name "$FN" --region "$REGION" \
    --auth-type NONE \
    --cors "AllowOrigins=${CORS_ORIGINS},AllowMethods=*,AllowHeaders=*" >/dev/null
  aws lambda add-permission --function-name "$FN" --region "$REGION" \
    --statement-id public-url --action lambda:InvokeFunctionUrl \
    --principal "*" --function-url-auth-type NONE >/dev/null 2>&1 || true
fi

URL=$(aws lambda get-function-url-config --function-name "$FN" --region "$REGION" \
  --query FunctionUrl --output text)
echo ""
echo "Backend live: ${URL}"
echo "Health:       ${URL}api/health"

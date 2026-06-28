#!/usr/bin/env bash
#
# One-time IAM setup for deploying Crucible. Run this yourself (the assistant
# is intentionally not allowed to grant permissions to its own user).
#
#   bash deploy/setup-iam.sh
#
# It does exactly three least-privilege things, all scoped to crucible-* names:
#   1. lets user `jam` create/update the crucible-api Lambda + crucible-* S3 buckets
#   2. lets user `jam` create the CloudFront distribution for the frontend
#   3. creates the Lambda execution role (Bedrock invoke + DynamoDB get/put + logs)
#
# Everything is named crucible-* so it is trivial to find and delete later.
set -euo pipefail

ACCOUNT="557690618983"
REGION="us-west-2"
USER="jam"
ROLE="crucible-lambda-role"
TABLE="crucible-memory"

echo "==> 1/3  Deploy permissions for user ${USER} (Lambda + S3)"
aws iam put-user-policy --user-name "$USER" --policy-name crucible-deploy --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    {
      \"Sid\": \"LambdaDeploy\",
      \"Effect\": \"Allow\",
      \"Action\": [
        \"lambda:CreateFunction\", \"lambda:GetFunction\", \"lambda:GetFunctionConfiguration\",
        \"lambda:UpdateFunctionCode\", \"lambda:UpdateFunctionConfiguration\",
        \"lambda:CreateFunctionUrlConfig\", \"lambda:GetFunctionUrlConfig\", \"lambda:UpdateFunctionUrlConfig\",
        \"lambda:AddPermission\", \"lambda:RemovePermission\", \"lambda:PutFunctionConcurrency\",
        \"lambda:DeleteFunction\"
      ],
      \"Resource\": \"arn:aws:lambda:${REGION}:${ACCOUNT}:function:crucible-api\"
    },
    {
      \"Sid\": \"S3Artifacts\",
      \"Effect\": \"Allow\",
      \"Action\": [
        \"s3:CreateBucket\", \"s3:PutObject\", \"s3:GetObject\", \"s3:ListBucket\",
        \"s3:PutBucketPolicy\", \"s3:GetBucketPolicy\", \"s3:PutPublicAccessBlock\",
        \"s3:GetBucketLocation\", \"s3:DeleteObject\", \"s3:PutBucketWebsite\"
      ],
      \"Resource\": [\"arn:aws:s3:::crucible-*\", \"arn:aws:s3:::crucible-*/*\"]
    }
  ]
}"

echo "==> 2/3  CloudFront permissions for user ${USER}"
aws iam put-user-policy --user-name "$USER" --policy-name crucible-cloudfront --policy-document '{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudFront",
      "Effect": "Allow",
      "Action": [
        "cloudfront:CreateDistribution", "cloudfront:GetDistribution",
        "cloudfront:UpdateDistribution", "cloudfront:CreateOriginAccessControl",
        "cloudfront:GetOriginAccessControl", "cloudfront:CreateInvalidation",
        "cloudfront:ListDistributions", "cloudfront:TagResource"
      ],
      "Resource": "*"
    }
  ]
}'

echo "==> 3/3  Lambda execution role ${ROLE}"
if aws iam get-role --role-name "$ROLE" >/dev/null 2>&1; then
  echo "    role already exists, skipping create"
else
  aws iam create-role --role-name "$ROLE" --assume-role-policy-document '{
    "Version": "2012-10-17",
    "Statement": [{
      "Effect": "Allow",
      "Principal": { "Service": "lambda.amazonaws.com" },
      "Action": "sts:AssumeRole"
    }]
  }' >/dev/null
fi

aws iam attach-role-policy --role-name "$ROLE" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

aws iam put-role-policy --role-name "$ROLE" --policy-name crucible-runtime --policy-document "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [
    {
      \"Sid\": \"BedrockInvoke\",
      \"Effect\": \"Allow\",
      \"Action\": [\"bedrock:InvokeModel\", \"bedrock:InvokeModelWithResponseStream\"],
      \"Resource\": \"*\"
    },
    {
      \"Sid\": \"MemoryTable\",
      \"Effect\": \"Allow\",
      \"Action\": [\"dynamodb:GetItem\", \"dynamodb:PutItem\"],
      \"Resource\": \"arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/${TABLE}\"
    }
  ]
}"

echo ""
echo "Done. IAM is ready. Tell the assistant to continue the deploy."

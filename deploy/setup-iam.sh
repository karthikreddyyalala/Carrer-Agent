#!/usr/bin/env bash
#
# One-time IAM setup for deploying Crucible. Run this yourself (the assistant
# is intentionally not allowed to grant permissions to its own user).
#
#   bash deploy/setup-iam.sh
#
# Uses a managed policy (not inline) for the deploy grants so it doesn't hit
# the 2048-byte inline-policy limit on user jam. Everything is named crucible-*
# and least-privilege, so it is trivial to find and delete later.
set -euo pipefail

ACCOUNT="557690618983"
REGION="us-west-2"
USER="jam"
ROLE="crucible-lambda-role"
TABLE="crucible-memory"
POLICY_ARN="arn:aws:iam::${ACCOUNT}:policy/crucible-deploy"
ALERT_EMAIL="${CRUCIBLE_ALERT_EMAIL:-karthikreddyy386@gmail.com}"
TMP="$(mktemp -d)"

cat > "$TMP/deploy-policy.json" <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "LambdaDeploy",
      "Effect": "Allow",
      "Action": [
        "lambda:CreateFunction", "lambda:GetFunction", "lambda:GetFunctionConfiguration",
        "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration",
        "lambda:CreateFunctionUrlConfig", "lambda:GetFunctionUrlConfig", "lambda:UpdateFunctionUrlConfig",
        "lambda:AddPermission", "lambda:RemovePermission", "lambda:PutFunctionConcurrency",
        "lambda:DeleteFunction"
      ],
      "Resource": "arn:aws:lambda:${REGION}:${ACCOUNT}:function:crucible-api"
    },
    {
      "Sid": "S3Artifacts",
      "Effect": "Allow",
      "Action": [
        "s3:CreateBucket", "s3:PutObject", "s3:GetObject", "s3:ListBucket",
        "s3:PutBucketPolicy", "s3:GetBucketPolicy", "s3:PutPublicAccessBlock",
        "s3:GetBucketLocation", "s3:DeleteObject", "s3:PutBucketWebsite"
      ],
      "Resource": ["arn:aws:s3:::crucible-*", "arn:aws:s3:::crucible-*/*"]
    },
    {
      "Sid": "CloudFront",
      "Effect": "Allow",
      "Action": [
        "cloudfront:CreateDistribution", "cloudfront:GetDistribution",
        "cloudfront:UpdateDistribution", "cloudfront:CreateOriginAccessControl",
        "cloudfront:GetOriginAccessControl", "cloudfront:ListOriginAccessControls",
        "cloudfront:CreateInvalidation", "cloudfront:ListDistributions", "cloudfront:TagResource"
      ],
      "Resource": "*"
    },
    {
      "Sid": "BudgetGuard",
      "Effect": "Allow",
      "Action": ["budgets:CreateBudget", "budgets:ViewBudget", "budgets:ModifyBudget"],
      "Resource": "arn:aws:budgets::${ACCOUNT}:budget/crucible-monthly"
    },
    {
      "Sid": "Cognito",
      "Effect": "Allow",
      "Action": [
        "cognito-idp:CreateUserPool", "cognito-idp:DescribeUserPool",
        "cognito-idp:UpdateUserPool", "cognito-idp:CreateUserPoolClient",
        "cognito-idp:DescribeUserPoolClient", "cognito-idp:UpdateUserPoolClient",
        "cognito-idp:ListUserPools", "cognito-idp:ListUserPoolClients",
        "cognito-idp:SetUserPoolMfaConfig"
      ],
      "Resource": "*"
    }
  ]
}
EOF

echo "==> 1/4  Managed deploy policy for user ${USER}"
if aws iam get-policy --policy-arn "$POLICY_ARN" >/dev/null 2>&1; then
  echo "    policy exists — updating to a fresh default version"
  for v in $(aws iam list-policy-versions --policy-arn "$POLICY_ARN" \
      --query "Versions[?IsDefaultVersion==\`false\`].VersionId" --output text); do
    aws iam delete-policy-version --policy-arn "$POLICY_ARN" --version-id "$v" || true
  done
  aws iam create-policy-version --policy-arn "$POLICY_ARN" \
    --policy-document "file://$TMP/deploy-policy.json" --set-as-default >/dev/null
else
  aws iam create-policy --policy-name crucible-deploy \
    --policy-document "file://$TMP/deploy-policy.json" >/dev/null
fi
aws iam attach-user-policy --user-name "$USER" --policy-arn "$POLICY_ARN"
echo "    attached crucible-deploy to ${USER}"

echo "==> 2/4  (Lambda + S3 + CloudFront + Budget all covered by the policy above)"

echo "==> 3/4  Lambda execution role ${ROLE}"
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
echo "    execution role ready"

echo "==> 4/4  Monthly cost alert (\$10 cap, emails ${ALERT_EMAIL} at 80%)"
sleep 10  # let the policy attach propagate before using the budget perm
if aws budgets describe-budget --account-id "$ACCOUNT" --budget-name crucible-monthly >/dev/null 2>&1; then
  echo "    budget already exists, skipping"
else
  aws budgets create-budget --account-id "$ACCOUNT" \
    --budget '{"BudgetName":"crucible-monthly","BudgetLimit":{"Amount":"10","Unit":"USD"},"TimeUnit":"MONTHLY","BudgetType":"COST"}' \
    --notifications-with-subscribers "[{\"Notification\":{\"NotificationType\":\"ACTUAL\",\"ComparisonOperator\":\"GREATER_THAN\",\"Threshold\":80,\"ThresholdType\":\"PERCENTAGE\"},\"Subscribers\":[{\"SubscriptionType\":\"EMAIL\",\"Address\":\"${ALERT_EMAIL}\"}]}]" \
    && echo "    budget alert created" \
    || echo "    NOTE: budget creation failed (non-fatal) — add it later in the Billing console"
fi

rm -rf "$TMP"
echo ""
echo "Done. IAM is ready. Tell the assistant to continue the deploy."

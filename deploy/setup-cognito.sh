#!/usr/bin/env bash
#
# Creates the Cognito User Pool + public app client for Crucible auth.
# Run AFTER re-running deploy/setup-iam.sh (which grants the Cognito perms).
#
#   bash deploy/setup-cognito.sh
#
# Idempotent: reuses an existing crucible-users pool if present. Prints the
# pool id + client id you (and the assistant) need for the deploy.
set -euo pipefail

REGION="us-west-2"
POOL_NAME="crucible-users"
CLIENT_NAME="crucible-web"

echo "==> Finding or creating user pool '${POOL_NAME}'"
POOL_ID=$(aws cognito-idp list-user-pools --max-results 60 --region "$REGION" \
  --query "UserPools[?Name=='${POOL_NAME}'].Id | [0]" --output text 2>/dev/null)

if [ -z "$POOL_ID" ] || [ "$POOL_ID" = "None" ]; then
  POOL_ID=$(aws cognito-idp create-user-pool --pool-name "$POOL_NAME" --region "$REGION" \
    --auto-verified-attributes email \
    --username-attributes email \
    --policies '{"PasswordPolicy":{"MinimumLength":8,"RequireUppercase":true,"RequireLowercase":true,"RequireNumbers":true,"RequireSymbols":false}}' \
    --query "UserPool.Id" --output text)
  echo "    created pool ${POOL_ID}"
else
  echo "    reusing pool ${POOL_ID}"
fi

echo "==> Finding or creating app client '${CLIENT_NAME}'"
CLIENT_ID=$(aws cognito-idp list-user-pool-clients --user-pool-id "$POOL_ID" --region "$REGION" \
  --query "UserPoolClients[?ClientName=='${CLIENT_NAME}'].ClientId | [0]" --output text 2>/dev/null)

if [ -z "$CLIENT_ID" ] || [ "$CLIENT_ID" = "None" ]; then
  # Public SPA client: no secret, username/password + SRP auth enabled.
  CLIENT_ID=$(aws cognito-idp create-user-pool-client --user-pool-id "$POOL_ID" --region "$REGION" \
    --client-name "$CLIENT_NAME" \
    --no-generate-secret \
    --explicit-auth-flows ALLOW_USER_SRP_AUTH ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
    --query "UserPoolClient.ClientId" --output text)
  echo "    created client ${CLIENT_ID}"
else
  echo "    reusing client ${CLIENT_ID}"
fi

ISSUER="https://cognito-idp.${REGION}.amazonaws.com/${POOL_ID}"

echo ""
echo "======================================================"
echo "Cognito ready. Give these to the assistant:"
echo "  REGION      = ${REGION}"
echo "  USER_POOL_ID= ${POOL_ID}"
echo "  CLIENT_ID   = ${CLIENT_ID}"
echo "  ISSUER      = ${ISSUER}"
echo "======================================================"

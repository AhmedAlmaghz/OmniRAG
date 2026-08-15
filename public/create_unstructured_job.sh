#!/bin/bash
# create_unstructured_job.sh
# Creates a data processing job on the Unstructured Transform platform.
# References: https://docs.unstructured.io/api-reference/workflow/

set -e

# Target Platform API endpoint
UNSTRUCTURED_API_URL="${UNSTRUCTURED_API_URL:-https://platform-api.transform.unstructured.io/api/v1}"
UNSTRUCTURED_API_KEY="${UNSTRUCTURED_API_KEY:-}"
WORKFLOW_ID="${WORKFLOW_ID:-}"

if [ -z "$UNSTRUCTURED_API_KEY" ]; then
  echo "Error: UNSTRUCTURED_API_KEY environment variable is not set." >&2
  exit 1
fi

if [ -z "$WORKFLOW_ID" ]; then
  echo "Error: WORKFLOW_ID environment variable is not set." >&2
  exit 1
fi

echo "[Unstructured Transform] Initiating a single parsing job for workflow: $WORKFLOW_ID..."

# Trigger workflow run
RESPONSE=$(curl -s -X POST "$UNSTRUCTURED_API_URL/workflows/$WORKFLOW_ID/run" \
  -H "unstructured-api-key: $UNSTRUCTURED_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{}")

# Parse job_id from JSON response
JOB_ID=$(echo "$RESPONSE" | grep -o '"job_id":"[^"]*' | grep -o '[^"]*$' || echo "")

if [ -z "$JOB_ID" ]; then
  # Fallback to general job creation
  RESPONSE=$(curl -s -X POST "$UNSTRUCTURED_API_URL/jobs" \
    -H "unstructured-api-key: $UNSTRUCTURED_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"workflow_id\": \"$WORKFLOW_ID\"}")
  JOB_ID=$(echo "$RESPONSE" | grep -o '"job_id":"[^"]*' | grep -o '[^"]*$' || echo "")
fi

if [ -z "$JOB_ID" ]; then
  echo "Error: Failed to create/run job. Server response:" >&2
  echo "$RESPONSE" >&2
  exit 1
fi

echo "Job created successfully!"
echo "JOB_ID=$JOB_ID"
echo "$JOB_ID" > .last_job_id

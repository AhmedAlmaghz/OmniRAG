#!/bin/bash
# poll_unstructured_job.sh
# Polls the status of an Unstructured Transform job until completion.
# References: https://docs.unstructured.io/api-reference/workflow/

set -e

UNSTRUCTURED_API_URL="${UNSTRUCTURED_API_URL:-https://platform-api.transform.unstructured.io/api/v1}"
UNSTRUCTURED_API_KEY="${UNSTRUCTURED_API_KEY:-}"
JOB_ID="${JOB_ID:-}"

# Check fallback if JOB_ID not set but stored locally
if [ -z "$JOB_ID" ] && [ -f .last_job_id ]; then
  JOB_ID=$(cat .last_job_id)
fi

if [ -z "$UNSTRUCTURED_API_KEY" ]; then
  echo "Error: UNSTRUCTURED_API_KEY environment variable is not set." >&2
  exit 1
fi

if [ -z "$JOB_ID" ]; then
  echo "Error: JOB_ID environment variable is not set." >&2
  exit 1
fi

echo "[Unstructured Transform] Polling status for Job: $JOB_ID..."

while true; do
  RESPONSE=$(curl -s -X GET "$UNSTRUCTURED_API_URL/jobs/$JOB_ID" \
    -H "unstructured-api-key: $UNSTRUCTURED_API_KEY")
  
  # Parse status field
  STATUS=$(echo "$RESPONSE" | grep -o '"status":"[^"]*' | grep -o '[^"]*$' || echo "unknown")
  
  echo "Current Job Status: $STATUS"
  
  if [ "$STATUS" = "finished" ] || [ "$STATUS" = "completed" ] || [ "$STATUS" = "success" ]; then
    echo "Job completed successfully!"
    break
  elif [ "$STATUS" = "failed" ] || [ "$STATUS" = "cancelled" ] || [ "$STATUS" = "error" ]; then
    echo "Job failed, cancelled or encountered an error." >&2
    exit 1
  fi
  
  # Wait before polling again
  sleep 10
done

#!/bin/bash
# unstructured_pipeline.sh
# End-to-end pipeline: Creates a job, polls until completion, and downloads results.
# References: https://docs.unstructured.io/api-reference/workflow/

set -e

# Determine directory containing the scripts
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Ensure executability
chmod +x "$DIR/create_unstructured_job.sh"
chmod +x "$DIR/poll_unstructured_job.sh"
chmod +x "$DIR/download_unstructured_results.sh"

export UNSTRUCTURED_API_URL="${UNSTRUCTURED_API_URL:-https://platform-api.transform.unstructured.io/api/v1}"
export UNSTRUCTURED_API_KEY="${UNSTRUCTURED_API_KEY:-}"
export WORKFLOW_ID="${WORKFLOW_ID:-}"
export OUTPUT_DIR="${OUTPUT_DIR:-./unstructured_results}"

if [ -z "$UNSTRUCTURED_API_KEY" ]; then
  echo "Error: UNSTRUCTURED_API_KEY environment variable is required." >&2
  exit 1
fi

if [ -z "$WORKFLOW_ID" ]; then
  echo "Error: WORKFLOW_ID environment variable is required." >&2
  exit 1
fi

echo "=========================================================="
echo " Starting Unstructured Transform Pipeline Integration"
echo "=========================================================="
echo "Workflow: $WORKFLOW_ID"
echo "API URL:  $UNSTRUCTURED_API_URL"
echo "=========================================================="

echo "Step 1: Creating/Triggering Job..."
# Run creation script and capture output to extract JOB_ID
CREATION_OUTPUT=$("$DIR/create_unstructured_job.sh")
echo "$CREATION_OUTPUT"

# Extract JOB_ID from output or file
JOB_ID=$(echo "$CREATION_OUTPUT" | grep "JOB_ID=" | cut -d'=' -f2 || echo "")
if [ -z "$JOB_ID" ] && [ -f .last_job_id ]; then
  JOB_ID=$(cat .last_job_id)
fi

if [ -z "$JOB_ID" ]; then
  echo "Error: Could not retrieve JOB_ID from step 1." >&2
  exit 1
fi

export JOB_ID

echo -e "\nStep 2: Polling Job Status (Checking every 10 seconds)..."
"$DIR/poll_unstructured_job.sh"

echo -e "\nStep 3: Downloading Processed Results..."
"$DIR/download_unstructured_results.sh"

echo -e "\n=========================================================="
echo " Unstructured Transform Pipeline Completed Successfully!"
echo " Outputs saved to: $OUTPUT_DIR"
echo "=========================================================="

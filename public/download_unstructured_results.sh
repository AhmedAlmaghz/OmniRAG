#!/bin/bash
# download_unstructured_results.sh
# Downloads the processed results of a completed Unstructured job.
# References: https://docs.unstructured.io/api-reference/workflow/

set -e

UNSTRUCTURED_API_URL="${UNSTRUCTURED_API_URL:-https://platform-api.transform.unstructured.io/api/v1}"
UNSTRUCTURED_API_KEY="${UNSTRUCTURED_API_KEY:-}"
JOB_ID="${JOB_ID:-}"
OUTPUT_DIR="${OUTPUT_DIR:-./unstructured_results}"

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

mkdir -p "$OUTPUT_DIR"

echo "[Unstructured Transform] Fetching results for Job: $JOB_ID to output directory: $OUTPUT_DIR..."

# Fetch job outputs/files
RESPONSE=$(curl -s -X GET "$UNSTRUCTURED_API_URL/jobs/$JOB_ID/outputs" \
  -H "unstructured-api-key: $UNSTRUCTURED_API_KEY")

# Save results manifest
echo "$RESPONSE" > "$OUTPUT_DIR/results_manifest.json"
echo "Results manifest downloaded to $OUTPUT_DIR/results_manifest.json"

# In Unstructured workflows, outputs can contain downloadable file URLs.
# Let's extract any URLs and download them.
URLS=$(echo "$RESPONSE" | grep -o '"download_url":"[^"]*' | grep -o '[^"]*$' || echo "")

if [ -n "$URLS" ]; then
  echo "Found downloadable output file URLs. Downloading..."
  idx=1
  for url in $URLS; do
    echo "Downloading result $idx from $url..."
    curl -s -o "$OUTPUT_DIR/output_$idx.json" "$url"
    idx=$((idx + 1))
  done
else
  # Fallback to direct job detail retrieval if outputs is empty or not supported
  curl -s -X GET "$UNSTRUCTURED_API_URL/jobs/$JOB_ID" \
    -H "unstructured-api-key: $UNSTRUCTURED_API_KEY" \
    -o "$OUTPUT_DIR/job_details.json"
  echo "Job details saved to $OUTPUT_DIR/job_details.json"
fi

echo "All available job results downloaded successfully!"

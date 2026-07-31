#!/bin/bash

SERVICE_NAME=${SERVICE_NAME:-"lyreai"}
REGION=${REGION:-"asia-south1"}
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)

if [ -z "$PROJECT_ID" ]; then
    echo "Error: No GCP project set. Please run 'gcloud config set project YOUR_PROJECT_ID'"
    exit 1
fi

# Construct environment variables string safely
# We use ||| as a unique delimiter since @ is used in MongoDB connection strings
DELIM="|||"
ENV_VARS="NODE_ENV=production"

if [ -f .env ]; then
  echo "Parsing .env file to inject environment variables..."
  while IFS='=' read -r key val; do
    # Skip comments and empty lines
    if [[ -z "$key" ]] || [[ "$key" =~ ^# ]]; then
      continue
    fi

    # Clean up key (remove trailing spaces)
    key=$(echo "$key" | tr -d ' ')

    # NEVER upload local paths for Google Credentials to Cloud Run
    if [[ "$key" == "GOOGLE_APPLICATION_CREDENTIALS" ]]; then
      echo "  -> Skipping GOOGLE_APPLICATION_CREDENTIALS (Cloud Run uses its own Service Account automatically)"
      continue
    fi

    # Cloud Run reserves the PORT environment variable
    if [[ "$key" == "PORT" ]]; then
      echo "  -> Skipping PORT (Cloud Run automatically sets this)"
      continue
    fi

    # Clean up value (remove surrounding quotes and carriage returns)
    val=$(echo "$val" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
    val=$(echo "$val" | tr -d '\r')

    # Append to our string using our safe delimiter
    ENV_VARS="${ENV_VARS}${DELIM}${key}=${val}"
  done < .env
fi

echo "================================================="
echo "Deploying $SERVICE_NAME to Google Cloud Run"
echo "Project: $PROJECT_ID"
echo "Region: $REGION"
echo "================================================="

gcloud run deploy $SERVICE_NAME \
  --source . \
  --region $REGION \
  --allow-unauthenticated \
  --platform managed \
  --set-env-vars="^${DELIM}^${ENV_VARS}"

echo "Deployment finished!"

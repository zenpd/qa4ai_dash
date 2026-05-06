#!/bin/bash
set -e

ACR="zafacr-gqfyc3h8eya2djey.azurecr.io"
ACR_USER="zafacr"
ACR_PASS="FKZSP1v13KwyQk4qPIJSJaIZ1Sx1xkASfp1ZnBwN5YmzAdmtHzskJQQJ99CBACHYHv6Eqg7NAAACAZCRoXHy"
RG="Zenlabs-Agent-Foundry"
ENV="zaf-aca-pvt-env"
PHOENIX_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJBcGlLZXk6MSJ9.PW-Dq35UwThFYSElOJnJuz7tG6Ta709yQpOJOrp0MTA"

echo "==> Deploying unified-dash-app (internal metrics bridge)..."
az containerapp create \
  --name unified-dash-app \
  --resource-group "$RG" \
  --environment "$ENV" \
  --image "$ACR/unified-dash/app:latest" \
  --registry-server "$ACR" \
  --registry-username "$ACR_USER" \
  --registry-password "$ACR_PASS" \
  --target-port 8001 \
  --ingress internal \
  --min-replicas 1 \
  --max-replicas 1 \
  --cpu 0.5 \
  --memory 1.0Gi \
  --secrets "phoenix-api-key=$PHOENIX_KEY" \
  --env-vars \
    "PHOENIX_BASE_URL=https://zaf-phoenix.bravesky-d9f9eeb7.eastus2.azurecontainerapps.io" \
    "PHOENIX_API_KEY=secretref:phoenix-api-key" \
    "TEMPORAL_BASE_URL=https://temporal-ui.bravesky-d9f9eeb7.eastus2.azurecontainerapps.io" \
    "TEMPORAL_NAMESPACE=zenarc" \
    "AZURE_SUBSCRIPTION_ID=bc978289-ba91-4be9-8eee-82dc18f9cde9" \
    "AZURE_RESOURCE_GROUP=Zenlabs-Agent-Foundry" \
    "AZURE_TENANT_ID=207c3e32-7115-4ed3-8a55-22f7edb77dc9" \
    "METRICS_PORT=8001" \
  --output none
echo "  [OK] unified-dash-app deployed"

echo "==> Deploying unified-dash-prometheus (internal Prometheus)..."
az containerapp create \
  --name unified-dash-prometheus \
  --resource-group "$RG" \
  --environment "$ENV" \
  --image "$ACR/unified-dash/prometheus:latest" \
  --registry-server "$ACR" \
  --registry-username "$ACR_USER" \
  --registry-password "$ACR_PASS" \
  --target-port 9090 \
  --ingress internal \
  --min-replicas 1 \
  --max-replicas 1 \
  --cpu 0.25 \
  --memory 0.5Gi \
  --output none
echo "  [OK] unified-dash-prometheus deployed"

echo "==> Deploying unified-dash-grafana (public Grafana)..."
az containerapp create \
  --name unified-dash-grafana \
  --resource-group "$RG" \
  --environment "$ENV" \
  --image "$ACR/unified-dash/grafana:latest" \
  --registry-server "$ACR" \
  --registry-username "$ACR_USER" \
  --registry-password "$ACR_PASS" \
  --target-port 3000 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 1 \
  --cpu 0.5 \
  --memory 1.0Gi \
  --env-vars \
    "GF_SECURITY_ADMIN_USER=admin" \
    "GF_SECURITY_ADMIN_PASSWORD=ZenLabs@2025!" \
    "GF_INSTALL_PLUGINS=yesoreyeram-infinity-datasource" \
    "GF_FEATURE_TOGGLES_ENABLE=publicDashboards" \
  --query "properties.configuration.ingress.fqdn" \
  --output tsv

echo ""
echo "==> All done! Grafana URL is above (append / to open)."

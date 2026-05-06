#!/bin/bash
set -e

ACR="zafacr-gqfyc3h8eya2djey.azurecr.io"
ACR_USER="zafacr"
ACR_PASS="FKZSP1v13KwyQk4qPIJSJaIZ1Sx1xkASfp1ZnBwN5YmzAdmtHzskJQQJ99CBACHYHv6Eqg7NAAACAZCRoXHy"
RG="Zenlabs-Agent-Foundry"
ENV="zaf-aca-pvt-env"

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
echo "==> Done. Grafana URL is above (login: admin / ZenLabs@2025!)"

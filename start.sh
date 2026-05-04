#!/bin/bash
set -e
cd "$(dirname "$0")"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║     Unified Dashboard — Local Dev Start                      ║"
echo "║  Phoenix  → https://zaf-phoenix.bravesky-d9f9eeb7...         ║"
echo "║  Temporal → https://temporal-ui.bravesky-d9f9eeb7...         ║"
echo "║  Azure    → subscription bc978289 / Zenlabs-Agent-Foundry    ║"
echo "╚══════════════════════════════════════════════════════════════╝"

# Check .env exists
if [ ! -f .env ]; then
  echo "ERROR: .env not found. Copy .env.example and fill values."
  exit 1
fi

# Check Docker is running
if ! docker info &>/dev/null; then
  echo "ERROR: Docker is not running. Start Docker Desktop first."
  exit 1
fi

# ── Azure Monitor token (no Service Principal required) ───────────────────────
AZ_TOKEN_FILE="/tmp/az_token_cache"
touch "$AZ_TOKEN_FILE"   # ensure file exists so docker bind-mount works

_refresh_azure_token() {
  if command -v az &>/dev/null; then
    local token
    token=$(az account get-access-token \
              --resource https://management.azure.com/ \
              --query accessToken -o tsv 2>/dev/null) && \
    echo "$token" > "$AZ_TOKEN_FILE" && \
    echo "  ✓ Azure Monitor token refreshed ($(date -u +%H:%M UTC))"
  fi
}

echo ""
echo "▶ Generating Azure Monitor Bearer token..."
_refresh_azure_token || echo "  ⚠  az CLI unavailable or not logged in — Azure Monitor panels may show No Data"

# Background loop: refresh token every 50 minutes (tokens expire in ~60 min)
(
  while true; do
    sleep 3000
    _refresh_azure_token 2>/dev/null || true
  done
) &
AZ_REFRESH_PID=$!

echo ""
echo "▶ Building & starting services..."
docker compose --env-file .env up --build -d

echo ""
echo "▶ Waiting for Grafana to become ready..."
until curl -sf http://localhost:3000/api/health &>/dev/null; do
  printf "."
  sleep 2
done
echo " ✓"

echo ""
echo "✅ All services running!"
echo ""
echo "  Grafana         → http://localhost:3000  (admin / admin)"
echo "  Prometheus      → http://localhost:9090"
echo "  Metrics bridge  → http://localhost:8001/metrics"
echo ""
echo "  Cloud datasources wired:"
echo "  Phoenix  → https://zaf-phoenix.bravesky-d9f9eeb7.eastus2.azurecontainerapps.io"
echo "  Temporal → https://temporal-ui.bravesky-d9f9eeb7.eastus2.azurecontainerapps.io"
echo "  Azure    → management.azure.com  (token: $AZ_TOKEN_FILE)"
echo ""
echo "  Dashboard: Grafana → Dashboards → Platform Overview — Unified"
echo "  Use the 🏛 Application dropdown to filter by app."
echo ""
echo "  Azure token auto-refreshes every 50 min (pid $AZ_REFRESH_PID)"
echo "  To tail logs:  docker compose logs -f"
echo "  To stop:       docker compose down && kill $AZ_REFRESH_PID"


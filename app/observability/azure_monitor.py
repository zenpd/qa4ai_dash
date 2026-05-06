"""Azure Monitor metrics collector.

Polls Azure Monitor REST API for Container App resource metrics and exposes
them as Prometheus gauges with `app_name` and `app` labels.

Auth strategy (no Service Principal required):
  1. Reads a Bearer token from AZURE_TOKEN_FILE (default /tmp/az_token_cache).
     start.sh writes a fresh token there before docker-compose starts and
     refreshes it in the background every 50 minutes.
  2. Falls back to AZURE_ACCESS_TOKEN env var.
  3. If neither is set / token file missing → logs a debug message and skips.
"""
import asyncio
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx
from prometheus_client import Gauge

from app.shared.logger import logger

_COLLECTION_INTERVAL = 60  # seconds

# ── Container App name prefix → normalised app label ─────────────────────────
_ACA_PREFIX_TO_APP: list[tuple[str, str]] = [
    ("zenarc-", "zenarc"),
    ("merchant-onboard-", "merchant-onboard"),
    ("digital-onboarding-", "digital-onboarding"),
    ("capmarkets-onboard-", "capmarkets"),
    ("cccm-", "cccm"),
    ("afi-", "insureflow"),
    ("ca-agentzoo-", "agentzoo"),
    ("agentzoo-", "agentzoo"),
    ("zaf-aria-idp-", "zaf-aria-idp"),
    ("zaf-idp-", "zaf-aria-idp"),
    ("zaf-kyx-", "zaf-kyx"),
    ("zaf-recon-", "platform"),
]

_ACA_EXACT_TO_APP: dict[str, str] = {
    "smartrm": "platform",
    "fraud-intent": "platform",
    "qdrant": "platform",
    "postgresql-internal": "platform",
    "zaf-redis-cache": "platform",
    "zaf-phoenix": "platform",
    "temporal-be": "platform",
    "temporal-ui": "platform",
}


def _classify_app(name: str) -> str:
    exact = _ACA_EXACT_TO_APP.get(name)
    if exact:
        return exact
    for prefix, app in _ACA_PREFIX_TO_APP:
        if name.startswith(prefix):
            return app
    return "platform"


# ── Prometheus metrics ────────────────────────────────────────────────────────
_aca_cpu = Gauge(
    "azure_aca_cpu_millicores",
    "Container App average CPU (millicores, 5-min avg)",
    ["app_name", "app"],
)
_aca_mem = Gauge(
    "azure_aca_memory_mb",
    "Container App average memory (MB, 5-min avg)",
    ["app_name", "app"],
)
_aca_replicas = Gauge(
    "azure_aca_replicas",
    "Container App replica count",
    ["app_name", "app"],
)
_aca_up = Gauge(
    "azure_aca_up",
    "Container App reported by Azure (1=yes 0=no)",
    ["app_name", "app"],
)
_azure_collector_up = Gauge(
    "azure_monitor_collector_up",
    "Azure Monitor collector is authenticated and returning data (1=yes)",
)


@dataclass
class AzureConfig:
    subscription_id: str
    resource_group: str
    token_file: str

    @classmethod
    def from_env(cls) -> "AzureConfig":
        return cls(
            subscription_id=os.environ.get("AZURE_SUBSCRIPTION_ID", ""),
            resource_group=os.environ.get("AZURE_RESOURCE_GROUP", "Zenlabs-Agent-Foundry"),
            token_file=os.environ.get("AZURE_TOKEN_FILE", "/tmp/az_token_cache"),
        )


class AzureMonitorCollector:
    _ARM = "https://management.azure.com"

    def __init__(self, config: AzureConfig) -> None:
        self._sub = config.subscription_id
        self._rg = config.resource_group
        self._token_file = config.token_file

    # ── Token helpers ─────────────────────────────────────────────────────────
    def _get_token(self) -> str | None:
        # 1. Explicit env var (CI / local override)
        token = os.environ.get("AZURE_ACCESS_TOKEN", "").strip()
        if token:
            return token

        # 2. Client-credentials flow (SP: AZURE_CLIENT_ID + AZURE_CLIENT_SECRET)
        client_id = os.environ.get("AZURE_CLIENT_ID", "").strip()
        client_secret = os.environ.get("AZURE_CLIENT_SECRET", "").strip()
        tenant_id = os.environ.get("AZURE_TENANT_ID", "").strip()
        if client_id and client_secret and tenant_id:
            try:
                import urllib.request
                import urllib.parse
                payload = urllib.parse.urlencode({
                    "grant_type": "client_credentials",
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "scope": "https://management.azure.com/.default",
                }).encode()
                req = urllib.request.Request(
                    f"https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
                    data=payload,
                    method="POST",
                )
                with urllib.request.urlopen(req, timeout=10) as resp:
                    import json as _json
                    return _json.loads(resp.read())["access_token"]
            except Exception as exc:
                logger.warning("Azure: client-credentials token fetch failed: %s", exc)

        # 3. Managed Identity (ACA / VM / pod with workload identity)
        try:
            import urllib.request
            imds_url = (
                "http://169.254.169.254/metadata/identity/oauth2/token"
                "?api-version=2018-02-01&resource=https://management.azure.com/"
            )
            req = urllib.request.Request(imds_url)
            req.add_header("Metadata", "true")
            with urllib.request.urlopen(req, timeout=3) as resp:
                import json as _json
                return _json.loads(resp.read())["access_token"]
        except Exception:
            pass  # Not running on Azure with managed identity

        # 4. Token file (local dev)
        try:
            with open(self._token_file) as fobj:
                data = fobj.read().strip()
                return data if data else None
        except OSError:
            return None

    def _auth_headers(self, token: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {token}", "Accept": "application/json"}

    # ── REST helpers ──────────────────────────────────────────────────────────
    async def _list_container_apps(self, client: httpx.AsyncClient, token: str) -> list[str]:
        url = (
            f"{self._ARM}/subscriptions/{self._sub}"
            f"/resourceGroups/{self._rg}"
            f"/providers/Microsoft.App/containerApps"
        )
        try:
            r = await client.get(
                url,
                headers=self._auth_headers(token),
                params={"api-version": "2024-03-01"},
                timeout=20.0,
            )
            if r.status_code == 401:
                logger.warning("Azure: token expired or invalid (401)")
                _azure_collector_up.set(0)
                return []
            if not r.is_success:
                logger.warning("Azure list container apps: HTTP %s", r.status_code)
                return []
            return [item["name"] for item in r.json().get("value", [])]
        except Exception as exc:
            logger.warning("Azure list container apps failed: %s", exc)
            return []

    async def _get_metrics(
        self, client: httpx.AsyncClient, token: str, app_name: str
    ) -> dict[str, float]:
        now = datetime.now(timezone.utc)
        start = (now - timedelta(minutes=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
        end = now.strftime("%Y-%m-%dT%H:%M:%SZ")
        url = (
            f"{self._ARM}/subscriptions/{self._sub}"
            f"/resourceGroups/{self._rg}"
            f"/providers/Microsoft.App/containerApps/{app_name}"
            f"/providers/microsoft.insights/metrics"
        )
        try:
            r = await client.get(
                url,
                headers=self._auth_headers(token),
                params={
                    "api-version": "2023-10-01",
                    "metricnames": "UsageNanoCores,WorkingSetBytes,Replicas",
                    "timespan": f"{start}/{end}",
                    "interval": "PT5M",
                    "aggregation": "Average",
                },
                timeout=20.0,
            )
            if not r.is_success:
                return {}
            result: dict[str, float] = {}
            for metric in r.json().get("value", []):
                metric_name: str = metric.get("name", {}).get("value", "")
                timeseries = metric.get("timeseries", [])
                if not timeseries:
                    continue
                for point in reversed(timeseries[0].get("data", [])):
                    val = point.get("average")
                    if val is not None:
                        result[metric_name] = val
                        break
            return result
        except Exception as exc:
            logger.warning("Azure metrics for %s: %s", app_name, exc)
            return {}

    # ── Main collection ───────────────────────────────────────────────────────
    async def collect(self) -> None:
        if not self._sub:
            return

        token = self._get_token()
        if not token:
            logger.debug(
                "Azure: no token — set AZURE_TOKEN_FILE or AZURE_ACCESS_TOKEN"
            )
            _azure_collector_up.set(0)
            return

        async with httpx.AsyncClient() as client:
            app_names = await self._list_container_apps(client, token)
            if not app_names:
                return

            _azure_collector_up.set(1)
            logger.debug("Azure Monitor: collecting %d container apps", len(app_names))

            tasks = [self._get_metrics(client, token, n) for n in app_names]
            results = await asyncio.gather(*tasks, return_exceptions=True)

            for app_name, metrics in zip(app_names, results):
                if isinstance(metrics, Exception) or not isinstance(metrics, dict):
                    continue
                app_label = _classify_app(app_name)
                _aca_up.labels(app_name=app_name, app=app_label).set(1)
                if "UsageNanoCores" in metrics:
                    # nanocores → millicores  (1 millicore = 1 000 000 nanocores)
                    _aca_cpu.labels(app_name=app_name, app=app_label).set(
                        metrics["UsageNanoCores"] / 1_000_000
                    )
                if "WorkingSetBytes" in metrics:
                    _aca_mem.labels(app_name=app_name, app=app_label).set(
                        metrics["WorkingSetBytes"] / 1_048_576
                    )
                if "Replicas" in metrics:
                    _aca_replicas.labels(app_name=app_name, app=app_label).set(
                        metrics["Replicas"]
                    )


async def _collection_loop(collector: AzureMonitorCollector) -> None:
    while True:
        try:
            await collector.collect()
        except Exception as exc:
            logger.error("Azure Monitor collection error: %s", exc)
        await asyncio.sleep(_COLLECTION_INTERVAL)

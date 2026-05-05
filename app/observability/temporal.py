"""
Temporal metrics collector.

Polls the unauthenticated Temporal UI HTTP API (TEMPORAL_BASE_URL).
Dynamically discovers all registered namespaces (excluding temporal-system) and
exposes workflow execution counts as Prometheus gauges with namespace + app labels.

Endpoint: GET /api/v1/namespaces
          GET /api/v1/namespaces/{namespace}/workflows?query=ExecutionStatus='...'
"""
import asyncio
import os
from dataclasses import dataclass

import httpx
from prometheus_client import Gauge

from app.shared.logger import logger

_COLLECTION_INTERVAL = 30
_PAGE_SIZE = 1000

# Namespaces to skip entirely
_SKIP_NAMESPACES = {"temporal-system"}

# Map Temporal namespace name → app label (same as the Grafana $app variable)
_NAMESPACE_TO_APP: dict[str, str] = {
    "zenarc": "zenarc",
    "retail-onboarding": "digital-onboarding",
    "merchant-onboarding": "merchant-onboard",
    "capmarkets": "capmarkets",
    "cccm": "cccm",
    "insureflow": "insureflow",
    "agentzoo": "agentzoo",
    "zaf-aria-idp": "zaf-aria-idp",
    "zaf-kyx": "zaf-kyx",
}

# Prometheus metrics — namespace + app labels for Grafana $app dropdown filter
_workflow_active = Gauge("temporal_workflow_active", "Running workflows", ["namespace", "app"])
_workflow_completed = Gauge("temporal_workflow_completed_total", "Completed workflows", ["namespace", "app"])
_workflow_failed = Gauge("temporal_workflow_failed_total", "Failed workflows", ["namespace", "app"])
_workflow_timed_out = Gauge("temporal_workflow_timed_out_total", "Timed-out workflows", ["namespace", "app"])
_workflow_canceled = Gauge("temporal_workflow_canceled_total", "Cancelled workflows", ["namespace", "app"])
_temporal_up = Gauge("temporal_up", "Temporal API reachable (1=yes 0=no)")
_temporal_namespace_count = Gauge("temporal_namespace_count", "Number of active Temporal namespaces")


@dataclass
class TemporalConfig:
    base_url: str
    namespace: str  # kept for backward compat but no longer used as the sole target

    @classmethod
    def from_env(cls) -> "TemporalConfig":
        return cls(
            base_url=os.environ.get("TEMPORAL_BASE_URL", "").rstrip("/"),
            namespace=os.environ.get("TEMPORAL_NAMESPACE", "default"),
        )


class TemporalMetricsCollector:
    def __init__(self, config: TemporalConfig) -> None:
        self._base_url = config.base_url

    async def _get(self, client: httpx.AsyncClient, path: str, params: dict | None = None) -> dict | None:
        try:
            response = await client.get(
                f"{self._base_url}{path}",
                params=params,
                timeout=15.0,
            )
            response.raise_for_status()
            return response.json()
        except Exception as exc:
            logger.warning("Temporal API call failed: %s — %s", path, exc)
            return None

    async def _discover_namespaces(self, client: httpx.AsyncClient) -> list[str]:
        """Return all registered namespace names, excluding system namespaces."""
        data = await self._get(client, "/api/v1/namespaces", params={"pageSize": 100})
        if data is None:
            return []
        names = [
            ns["namespaceInfo"]["name"]
            for ns in data.get("namespaces", [])
            if ns.get("namespaceInfo", {}).get("name") not in _SKIP_NAMESPACES
        ]
        return names

    async def _count_status(self, client: httpx.AsyncClient, namespace: str, status: str) -> int:
        data = await self._get(
            client,
            f"/api/v1/namespaces/{namespace}/workflows",
            params={"pageSize": _PAGE_SIZE, "query": f"ExecutionStatus='{status}'"},
        )
        if data is None:
            return 0
        return len(data.get("executions", []))

    async def _collect_namespace(self, client: httpx.AsyncClient, ns: str) -> None:
        app = _NAMESPACE_TO_APP.get(ns, "platform")
        running, completed, failed, timed_out, canceled = await asyncio.gather(
            self._count_status(client, ns, "Running"),
            self._count_status(client, ns, "Completed"),
            self._count_status(client, ns, "Failed"),
            self._count_status(client, ns, "TimedOut"),
            self._count_status(client, ns, "Canceled"),
        )
        _workflow_active.labels(namespace=ns, app=app).set(running)
        _workflow_completed.labels(namespace=ns, app=app).set(completed)
        _workflow_failed.labels(namespace=ns, app=app).set(failed)
        _workflow_timed_out.labels(namespace=ns, app=app).set(timed_out)
        _workflow_canceled.labels(namespace=ns, app=app).set(canceled)
        logger.debug(
            "Temporal [%s/%s] running=%d completed=%d failed=%d timedout=%d canceled=%d",
            ns, app, running, completed, failed, timed_out, canceled,
        )

    async def collect(self) -> None:
        if not self._base_url:
            logger.debug("Temporal: TEMPORAL_BASE_URL not configured, skipping")
            return

        async with httpx.AsyncClient() as client:
            namespaces = await self._discover_namespaces(client)
            if not namespaces:
                _temporal_up.set(0)
                _temporal_namespace_count.set(0)
                return

            _temporal_up.set(1)
            _temporal_namespace_count.set(len(namespaces))
            logger.debug("Temporal: discovered namespaces: %s", namespaces)

            await asyncio.gather(*[self._collect_namespace(client, ns) for ns in namespaces])


async def _collection_loop(collector: TemporalMetricsCollector) -> None:
    while True:
        try:
            await collector.collect()
        except Exception as exc:
            logger.error("Temporal metrics collection error: %s", exc)
        await asyncio.sleep(_COLLECTION_INTERVAL)

"""
Temporal metrics collector.

Polls the unauthenticated Temporal UI HTTP API (TEMPORAL_BASE_URL) for the
configured namespace and exposes workflow execution counts as Prometheus gauges.

Endpoint: GET /api/v1/namespaces/{namespace}/workflows?query=ExecutionStatus='...'
"""
import asyncio
import os
from dataclasses import dataclass

import httpx
from prometheus_client import Gauge

from app.shared.logger import logger

_COLLECTION_INTERVAL = 30
_PAGE_SIZE = 1000

# Map Temporal namespace name → app label (for Grafana dropdowns and dashboards)
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

# Prometheus metric names match what the Grafana dashboards query
_workflow_active = Gauge("temporal_workflow_active", "Running workflows", ["namespace"])
_workflow_completed = Gauge("temporal_workflow_completed_total", "Completed workflows", ["namespace"])
_workflow_failed = Gauge("temporal_workflow_failed_total", "Failed workflows", ["namespace"])
_workflow_timed_out = Gauge("temporal_workflow_timed_out_total", "Timed-out workflows", ["namespace"])
_workflow_canceled = Gauge("temporal_workflow_canceled_total", "Cancelled workflows", ["namespace"])
_activity_task_error = Gauge(
    "temporal_activity_task_error_total",
    "Activity task errors",
    ["namespace", "activity_type"],
)


@dataclass
class TemporalConfig:
    base_url: str
    namespaces: list[str]

    @classmethod
    def from_env(cls) -> "TemporalConfig":
        namespaces_str = os.environ.get("TEMPORAL_NAMESPACES", "default")
        namespaces = [ns.strip() for ns in namespaces_str.split(",") if ns.strip()]
        return cls(
            base_url=os.environ.get("TEMPORAL_BASE_URL", "").rstrip("/"),
            namespaces=namespaces,
        )


class TemporalMetricsCollector:
    def __init__(self, config: TemporalConfig) -> None:
        self._base_url = config.base_url
        self._namespaces = config.namespaces

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

    async def _count_status(self, client: httpx.AsyncClient, namespace: str, status: str) -> int:
        data = await self._get(
            client,
            f"/api/v1/namespaces/{namespace}/workflows",
            params={"pageSize": _PAGE_SIZE, "query": f"ExecutionStatus='{status}'"},
        )
        if data is None:
            return 0
        return len(data.get("executions", []))

    async def _collect_activity_errors(self, client: httpx.AsyncClient, namespace: str) -> dict[str, int]:
        """
        Collect activity task errors by querying failed workflows and extracting
        activity type information from their execution details.
        
        Returns a dict mapping activity_type -> error_count
        """
        activity_errors: dict[str, int] = {}
        
        # Query failed workflows (limit to recent ones for performance)
        data = await self._get(
            client,
            f"/api/v1/namespaces/{namespace}/workflows",
            params={"pageSize": 100, "query": "ExecutionStatus='Failed'"},
        )
        
        if not data or "executions" not in data:
            return activity_errors
        
        # Extract activity errors from workflow details
        for execution in data.get("executions", []):
            try:
                workflow_id = execution.get("execution", {}).get("workflow_id")
                run_id = execution.get("execution", {}).get("run_id")
                
                if not workflow_id or not run_id:
                    continue
                
                # Get workflow history to find activity errors
                history_data = await self._get(
                    client,
                    f"/api/v1/namespaces/{namespace}/workflows/{workflow_id}/runs/{run_id}/history",
                )
                
                if not history_data:
                    continue
                
                # Parse history events for ActivityTaskFailed events
                for event in history_data.get("history", {}).get("events", []):
                    if event.get("eventType") == "ActivityTaskFailed":
                        activity_type = (
                            event.get("activityTaskFailedEventAttributes", {})
                            .get("activityType", {})
                            .get("name", "unknown")
                        )
                        activity_errors[activity_type] = activity_errors.get(activity_type, 0) + 1
            except Exception as exc:
                logger.debug("Error parsing activity errors from workflow %s: %s", 
                            execution.get("execution", {}).get("workflow_id"), exc)
                continue
        
        return activity_errors

    async def collect(self) -> None:
        if not self._base_url:
            logger.debug("Temporal: TEMPORAL_BASE_URL not configured, skipping")
            return

        async with httpx.AsyncClient() as client:
            for ns in self._namespaces:
                running, completed, failed, timed_out, canceled, activity_errors = await asyncio.gather(
                    self._count_status(client, ns, "Running"),
                    self._count_status(client, ns, "Completed"),
                    self._count_status(client, ns, "Failed"),
                    self._count_status(client, ns, "TimedOut"),
                    self._count_status(client, ns, "Canceled"),
                    self._collect_activity_errors(client, ns),
                )

                _workflow_active.labels(namespace=ns).set(running)
                _workflow_completed.labels(namespace=ns).set(completed)
                _workflow_failed.labels(namespace=ns).set(failed)
                _workflow_timed_out.labels(namespace=ns).set(timed_out)
                _workflow_canceled.labels(namespace=ns).set(canceled)

                # Update activity error metrics
                for activity_type, error_count in activity_errors.items():
                    _activity_task_error.labels(namespace=ns, activity_type=activity_type).set(error_count)

                logger.debug(
                    "Temporal [%s] running=%d completed=%d failed=%d timedout=%d canceled=%d activity_errors=%d",
                    ns, running, completed, failed, timed_out, canceled, len(activity_errors),
                )


async def _collection_loop(collector: TemporalMetricsCollector) -> None:
    while True:
        try:
            await collector.collect()
        except Exception as exc:
            logger.error("Temporal metrics collection error: %s", exc)
        await asyncio.sleep(_COLLECTION_INTERVAL)

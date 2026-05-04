import asyncio
import os
from dataclasses import dataclass, field

import httpx
from prometheus_client import Gauge, Info

from app.shared.logger import logger

_COLLECTION_INTERVAL = 60  # seconds between project-list polls

# Map Phoenix project name → normalised app label (used as Prometheus label)
_PROJECT_TO_APP: dict[str, str] = {
    "zenarc-compliance": "zenarc",
    "merchant-onboarding": "merchant-onboard",
    "retail-onboarding": "digital-onboarding",
    "contact-center-compliance-monitoring": "cccm",
    "insureflow-uc001-claims": "insureflow",
    "insureflow-uc005-separate": "insureflow",
    "agentzoo-builder": "agentzoo",
    "zaf-aria-idp": "zaf-aria-idp",
    "agent-builder": "zaf-kyx",
    "evaluators": "platform",
    "default": "platform",
}

# Lightweight project-level metrics — derived from /v1/projects only,
# no spans query (spans query causes OOM on cloud Phoenix at any memory tier).
_project_count = Gauge("phoenix_project_count", "Number of Phoenix projects")
_project_up = Gauge("phoenix_up", "Phoenix API reachable (1=yes 0=no)")

# Per-project presence gauge — includes 'app' label for Grafana dropdown filter
_project_present = Gauge(
    "phoenix_project_present",
    "Project exists in Phoenix",
    ["project_name", "app"],
)


@dataclass
class PhoenixConfig:
    base_url: str
    api_key: str = field(default="")

    @classmethod
    def from_env(cls) -> "PhoenixConfig":
        return cls(
            base_url=os.environ.get("PHOENIX_BASE_URL", "http://localhost:6006"),
            api_key=os.environ.get("PHOENIX_API_KEY", ""),
        )


class PhoenixMetricsCollector:
    def __init__(self, config: PhoenixConfig) -> None:
        self._base_url = config.base_url.rstrip("/")
        self._headers: dict[str, str] = {}
        if config.api_key:
            self._headers["Authorization"] = f"Bearer {config.api_key}"

    async def _get_projects(self, client: httpx.AsyncClient) -> list[dict]:
        try:
            r = await client.get(
                f"{self._base_url}/v1/projects",
                headers=self._headers,
                timeout=15.0,
            )
            if not r.is_success:
                logger.warning("Phoenix /v1/projects returned %s", r.status_code)
                return []
            return r.json().get("data", [])
        except Exception as exc:
            logger.warning("Phoenix /v1/projects failed: %s", exc)
            return []

    async def collect(self) -> None:
        async with httpx.AsyncClient() as client:
            projects = await self._get_projects(client)
            if projects:
                _project_up.set(1)
                _project_count.set(len(projects))
                for p in projects:
                    p_name = p.get("name", "unknown")
                    app_label = _PROJECT_TO_APP.get(p_name, "platform")
                    _project_present.labels(project_name=p_name, app=app_label).set(1)
                logger.debug("Phoenix: %d projects collected", len(projects))
            else:
                _project_up.set(0)
                _project_count.set(0)


async def _collection_loop(collector: PhoenixMetricsCollector) -> None:
    while True:
        try:
            await collector.collect()
        except Exception as exc:
            logger.error("Phoenix metrics collection error: %s", exc)
        await asyncio.sleep(_COLLECTION_INTERVAL)


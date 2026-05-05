import asyncio
import os
from dataclasses import dataclass, field

import httpx
from prometheus_client import Gauge, Info

from app.shared.logger import logger

_COLLECTION_INTERVAL = 60  # seconds between polls

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
    "zenlabs-uc001-claims": "insureflow",
}

# ── Prometheus metrics ─────────────────────────────────────────────────────────
_project_count = Gauge("phoenix_project_count", "Number of Phoenix projects")
_project_up = Gauge("phoenix_up", "Phoenix API reachable (1=yes 0=no)")

_LABELS = ["project_name", "app"]

# Presence
_project_present = Gauge("phoenix_project_present", "Project exists in Phoenix", _LABELS)

# Tracing
_trace_count = Gauge("phoenix_trace_count", "Total traces in project", _LABELS)

# Token usage
_token_total = Gauge("phoenix_token_count_total", "Total tokens (prompt+completion)", _LABELS)
_token_prompt = Gauge("phoenix_token_count_prompt", "Prompt tokens used", _LABELS)
_token_completion = Gauge("phoenix_token_count_completion", "Completion tokens used", _LABELS)

# Latency (ms)
_latency_p50 = Gauge("phoenix_latency_ms_p50", "Trace latency p50 in ms", _LABELS)
_latency_p99 = Gauge("phoenix_latency_ms_p99", "Trace latency p99 in ms", _LABELS)

# GraphQL query — fetches all project-level KPIs in one round trip
_GQL_QUERY = """
{
  projects {
    edges {
      node {
        name
        traceCount
        tokenCountTotal
        tokenCountPrompt
        tokenCountCompletion
        latencyMsP50: latencyMsQuantile(probability: 0.5)
        latencyMsP99: latencyMsQuantile(probability: 0.99)
      }
    }
  }
}
"""


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
        self._headers: dict[str, str] = {"Content-Type": "application/json"}
        if config.api_key:
            self._headers["Authorization"] = f"Bearer {config.api_key}"

    async def _graphql(self, client: httpx.AsyncClient) -> list[dict]:
        """Fetch all project metrics via GraphQL. Returns list of project node dicts."""
        try:
            r = await client.post(
                f"{self._base_url}/graphql",
                headers=self._headers,
                json={"query": _GQL_QUERY},
                timeout=20.0,
            )
            if not r.is_success:
                logger.warning("Phoenix GraphQL returned %s", r.status_code)
                return []
            data = r.json()
            if "errors" in data:
                logger.warning("Phoenix GraphQL errors: %s", data["errors"])
                return []
            return [edge["node"] for edge in data["data"]["projects"]["edges"]]
        except Exception as exc:
            logger.warning("Phoenix GraphQL failed: %s", exc)
            return []

    async def collect(self) -> None:
        async with httpx.AsyncClient() as client:
            projects = await self._graphql(client)
            if not projects:
                _project_up.set(0)
                _project_count.set(0)
                return

            _project_up.set(1)
            _project_count.set(len(projects))

            for p in projects:
                name = p.get("name", "unknown")
                app = _PROJECT_TO_APP.get(name, "platform")
                lbl = {"project_name": name, "app": app}

                _project_present.labels(**lbl).set(1)
                _trace_count.labels(**lbl).set(p.get("traceCount") or 0)
                _token_total.labels(**lbl).set(p.get("tokenCountTotal") or 0)
                _token_prompt.labels(**lbl).set(p.get("tokenCountPrompt") or 0)
                _token_completion.labels(**lbl).set(p.get("tokenCountCompletion") or 0)
                _latency_p50.labels(**lbl).set(p.get("latencyMsP50") or 0)
                _latency_p99.labels(**lbl).set(p.get("latencyMsP99") or 0)

            logger.debug("Phoenix: %d projects collected via GraphQL", len(projects))


async def _collection_loop(collector: PhoenixMetricsCollector) -> None:
    while True:
        try:
            await collector.collect()
        except Exception as exc:
            logger.error("Phoenix metrics collection error: %s", exc)
        await asyncio.sleep(_COLLECTION_INTERVAL)



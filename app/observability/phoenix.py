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

# ────────────────────────────────────────────────────────────────────────────────
# ── CHECKPOINT: Evaluator Metrics (QE Dashboard) ──────────────────────────────
# If evaluators don't work, remove this entire section
_EVALUATOR_LABELS = ["project_name", "app", "evaluator_name"]
_evaluator_score = Gauge(
    "phoenix_evaluator_score",
    "Evaluator score (0-1 scale or 0-100)",
    _EVALUATOR_LABELS,
)

# Span type distribution
_SPAN_LABELS = ["project_name", "app", "span_kind"]
_span_type_count = Gauge("phoenix_span_type_count", "Count of recent spans by kind", _SPAN_LABELS)
_span_type_percent = Gauge("phoenix_span_type_percent", "Percentage of recent spans by kind", _SPAN_LABELS)
# ────────────────────────────────────────────────────────────────────────────────

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

# ────────────────────────────────────────────────────────────────────────────────
# ── CHECKPOINT: GraphQL Query for Evaluators ─────────────────────────────────
# Fetches evaluator scores per project
_GQL_EVALUATORS_QUERY = """
{
  projects {
    edges {
      node {
        name
        evaluators {
          edges {
            node {
              name
              score
            }
          }
        }
      }
    }
  }
}
"""
# ────────────────────────────────────────────────────────────────────────────────

# ── Span type distribution query ──────────────────────────────────────────────
_GQL_SPANS_QUERY = """
{
  projects {
    edges {
      node {
        name
        spans(first: 200, sort: {col: startTime, dir: desc}) {
          edges {
            node {
              spanKind
            }
          }
        }
      }
    }
  }
}
"""
# ──────────────────────────────────────────────────────────────────────────────────


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

    # ────────────────────────────────────────────────────────────────────────────────
    # ── CHECKPOINT: Evaluators GraphQL Method ────────────────────────────────────
    # Remove this method if evaluators feature needs to be disabled
    async def _graphql_evaluators(self, client: httpx.AsyncClient) -> list[dict]:
        """Fetch evaluator scores per project. Returns list of project dicts with evaluator data."""
        try:
            r = await client.post(
                f"{self._base_url}/graphql",
                headers=self._headers,
                json={"query": _GQL_EVALUATORS_QUERY},
                timeout=20.0,
            )
            if not r.is_success:
                logger.warning("Phoenix Evaluators GraphQL returned %s", r.status_code)
                return []
            data = r.json()
            if "errors" in data:
                logger.warning("Phoenix Evaluators GraphQL errors: %s", data["errors"])
                return []
            return [edge["node"] for edge in data["data"]["projects"]["edges"]]
        except Exception as exc:
            logger.warning("Phoenix Evaluators GraphQL failed: %s", exc)
            return []
    # ────────────────────────────────────────────────────────────────────────────────

    async def _graphql_spans(self, client: httpx.AsyncClient) -> list[dict]:
        """Fetch recent spans per project for span-kind distribution."""
        try:
            r = await client.post(
                f"{self._base_url}/graphql",
                headers=self._headers,
                json={"query": _GQL_SPANS_QUERY},
                timeout=30.0,
            )
            if not r.is_success:
                logger.warning("Phoenix Spans GraphQL returned %s", r.status_code)
                return []
            data = r.json()
            if "errors" in data:
                logger.warning("Phoenix Spans GraphQL errors: %s", data["errors"])
                return []
            return [edge["node"] for edge in data["data"]["projects"]["edges"]]
        except Exception as exc:
            logger.warning("Phoenix Spans GraphQL failed: %s", exc)
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

            # ────────────────────────────────────────────────────────────────────────────────
            # ── CHECKPOINT: Collect Evaluator Scores ─────────────────────────────────────
            # Remove this block if evaluators feature needs to be disabled
            evaluator_projects = await self._graphql_evaluators(client)
            for p in evaluator_projects:
                name = p.get("name", "unknown")
                app = _PROJECT_TO_APP.get(name, "platform")
                evaluators = p.get("evaluators", {}).get("edges", [])
                
                for eval_edge in evaluators:
                    eval_node = eval_edge.get("node", {})
                    eval_name = eval_node.get("name", "unknown")
                    eval_score = eval_node.get("score")
                    
                    if eval_score is not None:
                        lbl = {"project_name": name, "app": app, "evaluator_name": eval_name}
                        _evaluator_score.labels(**lbl).set(float(eval_score))
                        logger.debug("Phoenix: Evaluator %s for %s = %.2f", eval_name, name, eval_score)
            
            logger.debug("Phoenix: Evaluator scores collected")
            # ────────────────────────────────────────────────────────────────────────────────

            # ── Span type distribution ────────────────────────────────────────────────────
            try:
                span_projects = await self._graphql_spans(client)
                for p in span_projects:
                    name = p.get("name", "unknown")
                    app = _PROJECT_TO_APP.get(name, "platform")
                    spans = p.get("spans", {}).get("edges", [])
                    kind_counts: dict[str, int] = {}
                    for span_edge in spans:
                        kind = span_edge.get("node", {}).get("spanKind", "UNKNOWN")
                        kind_counts[kind] = kind_counts.get(kind, 0) + 1
                    total = sum(kind_counts.values()) or 1
                    for kind, count in kind_counts.items():
                        lbl = {"project_name": name, "app": app, "span_kind": kind}
                        _span_type_count.labels(**lbl).set(count)
                        _span_type_percent.labels(**lbl).set(round(count / total * 100, 1))
                logger.debug("Phoenix: Span type distribution collected")
            except Exception as exc:
                logger.warning("Phoenix span type collection failed: %s", exc)
            # ──────────────────────────────────────────────────────────────────────────────


async def _collection_loop(collector: PhoenixMetricsCollector) -> None:
    while True:
        try:
            await collector.collect()
        except Exception as exc:
            logger.error("Phoenix metrics collection error: %s", exc)
        await asyncio.sleep(_COLLECTION_INTERVAL)



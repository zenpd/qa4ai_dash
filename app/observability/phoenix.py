import asyncio
import os
from dataclasses import dataclass, field

import httpx
from prometheus_client import Gauge

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

# ── Quality / Correctness metrics derived from span data ──────────────────────
# These are computed from span statusCode and spanKind — no LLM judge needed.
# phoenix_span_success_rate: fraction of recent spans with statusCode=OK (0-1)
_span_success_rate = Gauge(
    "phoenix_span_success_rate",
    "Fraction of recent spans with statusCode=OK (0.0-1.0)",
    _LABELS,
)
# phoenix_llm_success_rate: fraction of LLM-kind spans with statusCode=OK (0-1)
_llm_success_rate = Gauge(
    "phoenix_llm_success_rate",
    "Fraction of recent LLM spans with statusCode=OK (0.0-1.0)",
    _LABELS,
)
# phoenix_error_rate: fraction of spans with statusCode=ERROR (0-1)
_error_rate = Gauge(
    "phoenix_error_rate",
    "Fraction of recent spans with statusCode=ERROR (0.0-1.0)",
    _LABELS,
)
# phoenix_llm_span_count: number of LLM spans in recent sample
_llm_span_count = Gauge(
    "phoenix_llm_span_count",
    "Count of LLM-kind spans in recent 100-span sample",
    _LABELS,
)
# phoenix_token_efficiency: completion_tokens / prompt_tokens ratio (0-1, higher = more efficient)
_token_efficiency = Gauge(
    "phoenix_token_efficiency",
    "Token efficiency: completion_tokens / prompt_tokens (0.0-1.0, higher is better for agentic tasks)",
    _LABELS,
)
# phoenix_traces_per_min: approximate trace throughput (traces / minutes_since_first_trace)
_trace_throughput = Gauge(
    "phoenix_traces_per_min",
    "Approximate trace throughput (traces/min)",
    _LABELS,
)

# ── LLM-as-judge evaluator scores — populated by _collect_annotations ─────────
# These appear when spans have been annotated via the Phoenix UI or API.
_EVALUATOR_LABELS = ["project_name", "app", "evaluator_name"]
_evaluator_score = Gauge(
    "phoenix_evaluator_score",
    "LLM-judge evaluator mean score (0.0-1.0) from Phoenix span annotations",
    _EVALUATOR_LABELS,
)
_evaluator_count = Gauge(
    "phoenix_evaluator_count",
    "Number of annotated spans for this evaluator",
    _EVALUATOR_LABELS,
)

# ── Span type distribution ─────────────────────────────────────────────────────
_SPAN_LABELS = ["project_name", "app", "span_kind"]
_span_type_count = Gauge("phoenix_span_type_count", "Count of recent spans by kind", _SPAN_LABELS)
_span_type_percent = Gauge("phoenix_span_type_percent", "Percentage of recent spans by kind", _SPAN_LABELS)

# ── GraphQL queries ────────────────────────────────────────────────────────────

# Project-level KPIs — one round trip for everything
_GQL_PROJECTS = """
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
        spanAnnotationNames
        traceAnnotationsNames
      }
    }
  }
}
"""

# Span-quality query: fetch statusCode + spanKind for last 100 LLM spans per project.
# Kept at 100 to avoid timeouts on large projects.
_GQL_SPAN_QUALITY = """
{
  projects {
    edges {
      node {
        name
        spans(first: 100, sort: {col: startTime, dir: desc}) {
          edges {
            node {
              spanKind
              statusCode
            }
          }
        }
      }
    }
  }
}
"""

# Annotation summary query — parameterised per annotation name.
# Used once we know which annotation names exist.
_GQL_ANNOTATION_SUMMARY_TMPL = """
{{
  projects {{
    edges {{
      node {{
        name
        {annotation_fields}
      }}
    }}
  }}
}}
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

    async def _gql(self, client: httpx.AsyncClient, query: str, timeout: float = 20.0) -> list[dict]:
        """Execute a GraphQL query and return the list of project nodes."""
        try:
            r = await client.post(
                f"{self._base_url}/graphql",
                headers=self._headers,
                json={"query": query},
                timeout=timeout,
            )
            if not r.is_success:
                logger.warning("Phoenix GraphQL HTTP %s", r.status_code)
                return []
            data = r.json()
            if errors := data.get("errors"):
                logger.warning("Phoenix GraphQL errors: %s", errors)
                return []
            return [edge["node"] for edge in data["data"]["projects"]["edges"]]
        except Exception as exc:
            logger.warning("Phoenix GraphQL failed: %s", exc)
            return []

    async def _collect_span_quality(self, client: httpx.AsyncClient) -> None:
        """Derive quality metrics from span statusCode/spanKind distribution."""
        projects = await self._gql(client, _GQL_SPAN_QUALITY, timeout=30.0)
        for p in projects:
            name = p.get("name", "unknown")
            app = _PROJECT_TO_APP.get(name, "platform")
            lbl = {"project_name": name, "app": app}

            spans = [e["node"] for e in p.get("spans", {}).get("edges", [])]
            if not spans:
                continue

            total = len(spans)
            ok_count = sum(1 for s in spans if s.get("statusCode") == "OK")
            err_count = sum(1 for s in spans if s.get("statusCode") == "ERROR")
            llm_spans = [s for s in spans if s.get("spanKind") == "llm"]
            llm_ok = sum(1 for s in llm_spans if s.get("statusCode") == "OK")

            _span_success_rate.labels(**lbl).set(ok_count / total)
            _error_rate.labels(**lbl).set(err_count / total)
            _llm_span_count.labels(**lbl).set(len(llm_spans))
            if llm_spans:
                _llm_success_rate.labels(**lbl).set(llm_ok / len(llm_spans))

            # Span kind distribution
            kind_counts: dict[str, int] = {}
            for s in spans:
                kind = s.get("spanKind") or "unknown"
                kind_counts[kind] = kind_counts.get(kind, 0) + 1
            for kind, count in kind_counts.items():
                lbl_k = {"project_name": name, "app": app, "span_kind": kind}
                _span_type_count.labels(**lbl_k).set(count)
                _span_type_percent.labels(**lbl_k).set(round(count / total * 100, 1))

    async def _collect_annotations(self, client: httpx.AsyncClient, project_nodes: list[dict]) -> None:
        """Collect LLM-judge scores from Phoenix span/trace annotation summaries.

        Phoenix exposes annotation summaries via spanAnnotationSummary(annotationName: "...").
        We first collect the annotation names per project, then query each summary.
        """
        # Build a union of all annotation names across all projects
        all_annotation_names: set[str] = set()
        for p in project_nodes:
            for n in p.get("spanAnnotationNames") or []:
                all_annotation_names.add(n)
            for n in p.get("traceAnnotationsNames") or []:
                all_annotation_names.add(n)

        if not all_annotation_names:
            logger.debug("Phoenix: no annotation names found — no evaluator scores to collect")
            return

        logger.info("Phoenix: found annotation names: %s", sorted(all_annotation_names))

        # Build a single GQL query that fetches all annotation summaries in one call
        field_fragments = []
        for i, ann_name in enumerate(all_annotation_names):
            # GraphQL alias to avoid name collision: a0, a1, ...
            safe = ann_name.replace(" ", "_").replace("-", "_")
            field_fragments.append(
                f'ann_{i}: spanAnnotationSummary(annotationName: "{ann_name}") {{\n'
                f'  name\n  meanScore\n  count\n  labelFractions {{ fraction label }}\n}}'
            )

        query = _GQL_ANNOTATION_SUMMARY_TMPL.format(
            annotation_fields="\n        ".join(field_fragments)
        )

        result_nodes = await self._gql(client, query, timeout=30.0)
        for p in result_nodes:
            proj_name = p.get("name", "unknown")
            app = _PROJECT_TO_APP.get(proj_name, "platform")

            for i, ann_name in enumerate(all_annotation_names):
                summary = p.get(f"ann_{i}")
                if not summary:
                    continue
                mean_score = summary.get("meanScore")
                count = summary.get("count", 0)
                if mean_score is None:
                    continue

                # Normalise to 0-1 if scores appear to be 0-100
                score_01 = float(mean_score) / 100.0 if float(mean_score) > 1.0 else float(mean_score)
                eval_lbl = {"project_name": proj_name, "app": app, "evaluator_name": ann_name}
                _evaluator_score.labels(**eval_lbl).set(score_01)
                _evaluator_count.labels(**eval_lbl).set(count)
                logger.debug("Phoenix annotation %s/%s: score=%.3f count=%d", proj_name, ann_name, score_01, count)

    async def collect(self) -> None:
        async with httpx.AsyncClient(verify=False) as client:
            # ── 1. Project-level KPIs ──────────────────────────────────────────
            projects = await self._gql(client, _GQL_PROJECTS)
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

                prompt_tok = p.get("tokenCountPrompt") or 0
                compl_tok = p.get("tokenCountCompletion") or 0

                _project_present.labels(**lbl).set(1)
                _trace_count.labels(**lbl).set(p.get("traceCount") or 0)
                _token_total.labels(**lbl).set(p.get("tokenCountTotal") or 0)
                _token_prompt.labels(**lbl).set(prompt_tok)
                _token_completion.labels(**lbl).set(compl_tok)
                _latency_p50.labels(**lbl).set(p.get("latencyMsP50") or 0)
                _latency_p99.labels(**lbl).set(p.get("latencyMsP99") or 0)

                # Token efficiency: how much output per unit of input (capped at 1.0)
                if prompt_tok > 0:
                    eff = min(1.0, compl_tok / prompt_tok)
                    _token_efficiency.labels(**lbl).set(eff)

            logger.debug("Phoenix: %d project KPIs collected", len(projects))

            # ── 2. Span-quality derived metrics ───────────────────────────────
            try:
                await self._collect_span_quality(client)
                logger.debug("Phoenix: span quality metrics collected")
            except Exception as exc:
                logger.warning("Phoenix span quality collection failed: %s", exc)

            # ── 3. Annotation / LLM-judge scores ──────────────────────────────
            try:
                await self._collect_annotations(client, projects)
            except Exception as exc:
                logger.warning("Phoenix annotation collection failed: %s", exc)


async def _collection_loop(collector: "PhoenixMetricsCollector") -> None:
    while True:
        try:
            await collector.collect()
        except Exception as exc:
            logger.error("Phoenix metrics collection error: %s", exc)
        await asyncio.sleep(_COLLECTION_INTERVAL)



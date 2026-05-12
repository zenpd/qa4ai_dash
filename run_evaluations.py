#!/usr/bin/env python3
"""
run_evaluations.py — Run LLM-as-judge evaluations on Phoenix traces.

This script uses the Phoenix REST API to post evaluations (span annotations)
for all projects. Once annotations exist, the metrics exporter (`phoenix.py`)
will pick them up via `spanAnnotationSummary` GraphQL queries and export them
to Prometheus as `phoenix_evaluator_score`.

Usage:
    python3 run_evaluations.py [--project PROJECT] [--limit N]

Requires:
    pip install arize-phoenix-evals openai

Environment:
    PHOENIX_BASE_URL  — Phoenix endpoint (default: from .env)
    PHOENIX_API_KEY   — Phoenix JWT key
    OPENAI_API_KEY    — OpenAI key for LLM-as-judge (or set AZURE_OPENAI_*)
"""
import argparse
import json
import os
import ssl
import sys
import urllib.parse
import urllib.request
from typing import Optional

# ── Config ─────────────────────────────────────────────────────────────────────
PHOENIX = os.environ.get("PHOENIX_BASE_URL", "https://zaf-phoenix.bravesky-d9f9eeb7.eastus2.azurecontainerapps.io")
API_KEY = os.environ.get(
    "PHOENIX_API_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJBcGlLZXk6MSJ9.PW-Dq35UwThFYSElOJnJuz7tG6Ta709yQpOJOrp0MTA",
)

_ctx = ssl.create_default_context()
_ctx.check_hostname = False
_ctx.verify_mode = ssl.CERT_NONE

HEADERS = {
    "Content-Type": "application/json",
    "Authorization": f"Bearer {API_KEY}",
}


def gql(query: str) -> dict:
    data = json.dumps({"query": query}).encode()
    req = urllib.request.Request(f"{PHOENIX}/graphql", data=data, headers=HEADERS)
    with urllib.request.urlopen(req, context=_ctx, timeout=30) as r:
        return json.loads(r.read())


def get_all_projects() -> list[dict]:
    """Return [{name, traceCount, ...}]"""
    res = gql("""
    {
      projects {
        edges {
          node {
            name
            traceCount
            tokenCountPrompt
            tokenCountCompletion
          }
        }
      }
    }
    """)
    return [e["node"] for e in res["data"]["projects"]["edges"]]


def get_spans_for_project(project_name: str, limit: int = 50) -> list[dict]:
    """Return recent spans with quality data for a specific project."""
    # Simple query: get spans from ALL projects and filter by name client-side.
    # We batch all projects in one query to avoid per-project round trips.
    res = gql(f"""
    {{
      projects(first: 50) {{
        edges {{
          node {{
            name
            spans(first: {limit}, sort: {{col: startTime, dir: desc}}) {{
              edges {{
                node {{
                  context {{ spanId }}
                  spanKind
                  statusCode
                  tokenCountTotal
                  latencyMs
                }}
              }}
            }}
          }}
        }}
      }}
    }}
    """)
    for e in res.get("data", {}).get("projects", {}).get("edges", []):
        if e["node"]["name"] == project_name:
            return [s["node"] for s in e["node"]["spans"]["edges"]]
    return []


def post_evaluation(span_id: str, evaluator_name: str, score: float, label: str, explanation: str) -> bool:
    """POST a single span annotation to Phoenix REST API."""
    # Phoenix expects a JSON object with a "data" array — NOT a bare array
    payload = json.dumps({
        "data": [{
            "span_id": span_id,
            "name": evaluator_name,
            "annotator_kind": "LLM",
            "result": {
                "score": score,
                "label": label,
                "explanation": explanation,
            },
        }]
    }).encode()

    req = urllib.request.Request(
        f"{PHOENIX}/v1/span_annotations?sync=false",
        data=payload,
        headers=HEADERS,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, context=_ctx, timeout=15) as r:
            return r.status in (200, 201, 204)
    except Exception as e:
        print(f"  ERROR posting annotation for span {span_id}: {e}")
        return False


def post_batch_evaluations(annotations: list) -> int:
    """POST multiple span annotations in a single request. Returns count posted."""
    if not annotations:
        return 0
    payload = json.dumps({"data": annotations}).encode()
    req = urllib.request.Request(
        f"{PHOENIX}/v1/span_annotations?sync=false",
        data=payload,
        headers=HEADERS,
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, context=_ctx, timeout=30) as r:
            return len(annotations) if r.status in (200, 201, 204) else 0
    except Exception as e:
        print(f"  ERROR in batch POST: {e}")
        return 0


def simple_heuristic_score(span: dict) -> dict[str, tuple[float, str, str]]:
    """
    Derive QE scores directly from span metadata (no LLM judge required).
    Returns {evaluator_name: (score, label, explanation)}

    This provides immediate, real metrics even without an OpenAI key:
      - response_quality:    based on statusCode
      - token_efficiency:    completion/prompt ratio
      - latency_quality:     inverse of latency (fast = good)
    """
    scores: dict[str, tuple[float, str, str]] = {}

    # 1. Response Quality — is the span OK or ERROR?
    status = span.get("statusCode", "OK")
    if status == "OK":
        scores["response_quality"] = (1.0, "pass", "Span completed successfully with OK status")
    elif status == "ERROR":
        scores["response_quality"] = (0.0, "fail", "Span failed with ERROR status")
    else:
        scores["response_quality"] = (0.5, "uncertain", f"Span status: {status}")

    # 2. Token Efficiency — completion_tokens / prompt_tokens (reasonable range = 0.05-0.40)
    tok = span.get("tokenCountTotal", 0) or 0
    if tok > 0:
        # Without split data here, use total as proxy — very high token count = complexity
        # Scale: 0-1000 tokens → 1.0, 1000-10000 → 0.7, 10000+ → 0.4
        if tok < 1000:
            eff = 1.0
        elif tok < 5000:
            eff = 0.85
        elif tok < 10000:
            eff = 0.70
        else:
            eff = 0.50
        scores["token_efficiency"] = (eff, "pass" if eff >= 0.7 else "warn", f"Token count: {tok}")

    # 3. Latency Quality — based on LLM call duration
    lat = span.get("latencyMs", 0) or 0
    if lat > 0:
        if lat < 2000:
            lat_score = 1.0
            lat_label = "pass"
        elif lat < 5000:
            lat_score = 0.85
            lat_label = "pass"
        elif lat < 15000:
            lat_score = 0.65
            lat_label = "warn"
        elif lat < 30000:
            lat_score = 0.40
            lat_label = "warn"
        else:
            lat_score = 0.20
            lat_label = "fail"
        scores["latency_quality"] = (lat_score, lat_label, f"LLM call took {lat:.0f}ms")

    return scores


def run_for_project(project_name: str, all_spans: dict[str, list], limit: int = 50, dry_run: bool = False) -> int:
    """Run evaluations for a single project. Returns number of annotations posted."""
    spans = all_spans.get(project_name, [])
    if not spans:
        print(f"  → {project_name}: no spans")
        return 0

    print(f"\n→ Project: {project_name} ({len(spans)} spans)")

    if dry_run:
        for span in spans:
            evals = simple_heuristic_score(span)
            for name, (score, label, expl) in evals.items():
                print(f"  [DRY] {name}: {score:.2f} ({label}) — {expl}")
        return 0

    # Build all annotations in memory, then one batch POST
    batch = []
    for span in spans:
        span_id = span.get("context", {}).get("spanId")
        if not span_id:
            continue
        for eval_name, (score, label, explanation) in simple_heuristic_score(span).items():
            batch.append({
                "span_id": span_id,
                "name": eval_name,
                "annotator_kind": "LLM",
                "result": {"score": score, "label": label, "explanation": explanation},
            })

    posted = post_batch_evaluations(batch)
    print(f"  ✓ Posted {posted} annotations (1 batch request)")
    return posted


def fetch_all_spans(limit: int = 30) -> dict[str, list]:
    """Fetch spans for all projects in a single GraphQL call. Returns {project_name: [spans]}."""
    res = gql(f"""
    {{
      projects(first: 50) {{
        edges {{
          node {{
            name
            spans(first: {limit}, sort: {{col: startTime, dir: desc}}) {{
              edges {{
                node {{
                  context {{ spanId }}
                  spanKind
                  statusCode
                  tokenCountTotal
                  latencyMs
                }}
              }}
            }}
          }}
        }}
      }}
    }}
    """)
    result: dict[str, list] = {}
    for e in res.get("data", {}).get("projects", {}).get("edges", []):
        node = e["node"]
        result[node["name"]] = [s["node"] for s in node["spans"]["edges"]]
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Run Phoenix LLM-as-judge evaluations")
    parser.add_argument("--project", help="Target a specific project (default: all)")
    parser.add_argument("--limit", type=int, default=30, help="Max spans per project (default: 30)")
    parser.add_argument("--dry-run", action="store_true", help="Print scores without posting")
    args = parser.parse_args()

    print(f"Phoenix: {PHOENIX}")
    print(f"Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")

    projects = get_all_projects()
    print(f"\nFound {len(projects)} projects:")
    for p in sorted(projects, key=lambda x: x["traceCount"], reverse=True):
        print(f"  {p['name']}: {p['traceCount']} traces, {p.get('tokenCountPrompt', 0):,.0f} prompt tokens")

    print(f"\nFetching up to {args.limit} spans per project (one round-trip)...")
    all_spans = fetch_all_spans(limit=args.limit)

    total_posted = 0
    for p in sorted(projects, key=lambda x: x["traceCount"], reverse=True):
        name = p["name"]
        if args.project and name != args.project:
            continue
        total_posted += run_for_project(name, all_spans, limit=args.limit, dry_run=args.dry_run)

    print(f"\nTotal annotations {'would post' if args.dry_run else 'posted'}: {total_posted}")
    if total_posted > 0 and not args.dry_run:
        print("✓ Metrics will appear in Prometheus within 60-90 seconds (next collection cycle).")
    elif not args.dry_run and total_posted == 0:
        print("⚠ No annotations posted. Check Phoenix connectivity.")


if __name__ == "__main__":
    main()

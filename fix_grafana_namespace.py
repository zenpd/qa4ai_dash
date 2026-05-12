#!/usr/bin/env python3
"""
Remove namespace variable and filter from all QE Grafana dashboards.
Rename project/app label to "Agentic App".
"""
import json, re, pathlib, sys

DASH_DIR = pathlib.Path(__file__).parent / "deploy/grafana/provisioning/dashboards"

# Dashboards that have project+namespace vars (the QE pillar ones)
QE_DASHBOARDS = [
    "qe-four-pillars.json",
    "qe-pillar-correctness.json",
    "qe-pillar-governance.json",
    "qe-pillar-observability.json",
    "qe-pillar-reliability.json",
]

# platform overview uses "app" variable with label "Application"
OVERVIEW_DASHBOARD = "platform_overview.json"


def strip_namespace_from_expr(text: str) -> str:
    """Remove namespace=~"$namespace" selector (with optional leading/trailing comma) from PromQL.
    Works on raw JSON file text where quotes are backslash-escaped."""
    # In raw JSON: namespace=~\"$namespace\" or namespace=~"$namespace"
    # Patterns with preceding comma (e.g. ,namespace=~\"$namespace\")
    text = re.sub(r',\s*namespace=~\\?"[^"\\]*\\?"', '', text)
    # Patterns with trailing comma
    text = re.sub(r'namespace=~\\?"[^"\\]*\\?",\s*', '', text)
    # Remaining (standalone)
    text = re.sub(r'namespace=~\\?"[^"\\]*\\?"', '', text)
    return text


def fix_qe_dashboard(path: pathlib.Path) -> None:
    data = json.loads(path.read_text())

    # 1. Remove namespace variable from templating, rename project label
    tmpl_list = data.get("templating", {}).get("list", [])
    new_tmpl = []
    for var in tmpl_list:
        if var.get("name") == "namespace":
            print(f"  [{path.name}] Removed namespace variable")
            continue  # drop it
        if var.get("name") == "project":
            var["label"] = "Agentic App"
            print(f"  [{path.name}] Renamed project label -> 'Agentic App'")
        new_tmpl.append(var)
    if "templating" in data:
        data["templating"]["list"] = new_tmpl

    # 2. Write modified JSON first, then strip namespace from raw text
    raw = json.dumps(data, indent=2, ensure_ascii=False)
    fixed = strip_namespace_from_expr(raw)
    if fixed != raw:
        print(f"  [{path.name}] Stripped namespace=~\"$namespace\" from PromQL expressions")
    else:
        print(f"  [{path.name}] No namespace PromQL filters found")

    path.write_text(fixed)
    print(f"  [{path.name}] Saved ✓")


def fix_overview_dashboard(path: pathlib.Path) -> None:
    data = json.loads(path.read_text())
    tmpl_list = data.get("templating", {}).get("list", [])
    for var in tmpl_list:
        if var.get("name") == "app":
            var["label"] = "Agentic App"
            print(f"  [{path.name}] Renamed 'app' label -> 'Agentic App'")
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    print(f"  [{path.name}] Saved ✓")


print("=== Fixing QE Grafana dashboards ===\n")

for fname in QE_DASHBOARDS:
    p = DASH_DIR / fname
    if p.exists():
        fix_qe_dashboard(p)
    else:
        print(f"  WARNING: {fname} not found at {p}")

overview_path = DASH_DIR / OVERVIEW_DASHBOARD
if overview_path.exists():
    fix_overview_dashboard(overview_path)

print("\nDone.")

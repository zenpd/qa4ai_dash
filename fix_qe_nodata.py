#!/usr/bin/env python3
"""Fix No Data issues in QE dashboard JSON files."""

import json
import copy
import glob
import os
import re

APP_DIR = "app/config/grafana/provisioning/dashboards"
DEPLOY_DIR = "deploy/grafana/provisioning/dashboards"

# Bare numeric expressions that need scalar(vector(N)) wrapper
BARE_NUMERIC_IDS = {3, 10, 14, 52, 160, 14400}

def fix_expr(expr: str) -> str:
    """Wrap bare numeric PromQL in scalar(vector(N))."""
    stripped = expr.strip()
    try:
        float(stripped)
        return f"scalar(vector({stripped}))"
    except ValueError:
        pass
    return expr

def fix_trace_coverage(expr: str) -> str:
    """Fix division-by-zero in LLM Trace Coverage queries."""
    # Pattern: clamp_max(count(X > 0) / count(X), 100)
    if "clamp_max" in expr and "count(" in expr and "/ count(" in expr:
        # Replace: count(X > 0) / count(X)
        # With: (count(X > 0) or vector(0)) / clamp_min(count(X) or vector(1), 1)
        # Use a more targeted regex replacement
        pattern = r'count\(([^)]+) > 0\) / count\(([^)]+)\)'
        def replacer(m):
            inner1 = m.group(1)
            inner2 = m.group(2)
            return f'(count({inner1} > 0) or vector(0)) / clamp_min(count({inner2}),1)'
        new_expr = re.sub(pattern, replacer, expr)
        if new_expr != expr:
            return new_expr
    return expr

def fix_workflow_durability(expr: str) -> str:
    """Fix division-by-zero / NaN in Workflow Durability queries."""
    # Pattern: sum(A) / clamp_min(..., 1) where sum can return empty
    if "temporal_workflow_completed_total" in expr and "clamp_min" in expr:
        # Wrap the numerator sum with or vector(0)
        new_expr = re.sub(
            r'sum\(([^)]+)\)\s*/\s*clamp_min\(',
            r'(sum(\1) or vector(0)) / clamp_min(',
            expr
        )
        if new_expr != expr:
            return new_expr
    return expr

def fix_evaluator_fallback(expr: str) -> str:
    """Add or vector(0) fallback to evaluator score queries."""
    if "phoenix_evaluator_score" in expr and "or vector" not in expr:
        # Wrap the whole expression with or vector(0)
        return f"({expr}) or vector(0)"
    return expr

def set_no_value(field_config: dict, value: str = "0"):
    """Set noValue on fieldConfig.defaults."""
    defaults = field_config.setdefault("defaults", {})
    if "noValue" not in defaults or defaults.get("noValue") in ["", None, "N/A"]:
        defaults["noValue"] = value

def fix_row_title(title: str) -> str:
    """Fix remaining mojibake in row/panel titles."""
    replacements = [
        ("\u00c2\u00b7", "\u00b7"),   # Â· -> ·
        ("\u00e2\u0080\u0094", "\u2014"),  # â€" -> —
        ("\u00c3\u00a9", "\u00e9"),   # Ã© -> é
    ]
    for bad, good in replacements:
        title = title.replace(bad, good)
    return title

def fix_panel(panel: dict) -> dict:
    p = copy.deepcopy(panel)

    # Fix title mojibake
    if "title" in p:
        p["title"] = fix_row_title(p["title"])

    # Fix targets (PromQL expressions)
    for target in p.get("targets", []):
        expr = target.get("expr", "")
        if not expr:
            continue

        # 1. Bare numeric
        new_expr = fix_expr(expr)
        if new_expr != expr:
            target["expr"] = new_expr
            continue

        # 2. LLM Trace Coverage
        new_expr = fix_trace_coverage(expr)
        if new_expr != expr:
            target["expr"] = new_expr
            continue

        # 3. Workflow Durability
        new_expr = fix_workflow_durability(expr)
        if new_expr != expr:
            target["expr"] = new_expr
            continue

        # 4. Evaluator score fallback
        new_expr = fix_evaluator_fallback(expr)
        if new_expr != expr:
            target["expr"] = new_expr

    # Fix noValue on stat panels and gauge panels
    if p.get("type") in ("stat", "gauge", "bargauge"):
        fc = p.setdefault("fieldConfig", {})
        set_no_value(fc)

    # Fix nested panels (rows with sub-panels)
    if "panels" in p:
        p["panels"] = [fix_panel(sub) for sub in p["panels"]]

    return p

def fix_dashboard(data: dict) -> dict:
    d = copy.deepcopy(data)
    if "title" in d:
        d["title"] = fix_row_title(d["title"])
    d["panels"] = [fix_panel(p) for p in d.get("panels", [])]
    return d

def process_file(src_path: str, dst_path: str):
    with open(src_path, "r", encoding="utf-8-sig") as f:
        data = json.load(f)

    fixed = fix_dashboard(data)

    os.makedirs(os.path.dirname(dst_path), exist_ok=True)
    with open(dst_path, "w", encoding="utf-8") as f:
        json.dump(fixed, f, indent=2, ensure_ascii=False)
        f.write("\n")

    print(f"Fixed: {src_path} -> {dst_path}")

def main():
    files = sorted(glob.glob(os.path.join(APP_DIR, "qe-*.json")))
    if not files:
        print(f"No QE dashboard files found in {APP_DIR}")
        return

    for src in files:
        basename = os.path.basename(src)
        # Fix app/ copy in-place
        process_file(src, src)
        # Fix deploy/ copy
        dst = os.path.join(DEPLOY_DIR, basename)
        process_file(src, dst)

    print("\nAll QE dashboard files fixed.")

if __name__ == "__main__":
    main()

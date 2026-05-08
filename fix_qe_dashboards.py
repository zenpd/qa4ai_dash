#!/usr/bin/env python3
"""Fix QE pillar dashboard JSON files — comprehensive fix:
1. Strip UTF-8 BOM (already done but idempotent)
2. Fix mojibake em-dashes AND middle-dot (Â· -> ·) in all strings
3. Static-value panels: convert bare numeric PromQL expr -> vector(N) so they render
4. Add noValue "0" to ALL stat/barchart/piechart panels missing it
5. Wrap division queries with or vector(0) to prevent No Data when series absent
6. Copy clean files to deploy/
"""
import json
import os

APP_BASE = '/Users/sysadm/Documents/agent_foundry/unified_dashboard/app/config/grafana/provisioning/dashboards/'
DEPLOY_BASE = '/Users/sysadm/Documents/agent_foundry/unified_dashboard/deploy/grafana/provisioning/dashboards/'

FILES = [
    'qe-four-pillars.json',
    'qe-pillar-correctness.json',
    'qe-pillar-governance.json',
    'qe-pillar-observability.json',
    'qe-pillar-reliability.json',
]

# Mojibake: UTF-8 bytes decoded as latin-1/cp1252 then re-encoded as UTF-8
MOJIBAKE_MAP = [
    ('\u00e2\u20ac\u201d', '\u2014'),  # -> em dash
    ('\u00e2\u20ac\u2013', '\u2013'),  # -> en dash
    ('\u00e2\u20ac\u2122', '\u2019'),  # -> right single quote
    ('\u00e2\u20ac\u02dc', '\u2018'),  # -> left single quote
    ('\u00e2\u20ac\u0153', '\u201c'),  # -> left double quote
    ('\u00e2\u20ac\x9d',   '\u201d'),  # -> right double quote
    ('\u00c2\u00b7', '\u00b7'),         # Â· -> · (middle dot / interpunct)
    ('\u00c2\u00a0', '\u00a0'),         # Â  -> non-breaking space
    ('\u00c3\u00a2\u20ac\u201d', '\u2014'),  # triple-encoded em-dash
]

# Panels with bare numeric expr that should be vector(N) static values
# Format: (filename, panel_id, static_value_float)
STATIC_VALUE_PANELS = [
    ('qe-pillar-governance.json',    522,  160.0),    # V1 Cost Baseline
    ('qe-pillar-governance.json',    525,  14400.0),  # V1 Time Baseline
    ('qe-pillar-observability.json', 401,  14.0),     # Hallucination Rate V1 Baseline
    ('qe-pillar-reliability.json',   23,   3.0),      # Retry Policy
    ('qe-pillar-reliability.json',   24,   10.0),     # Schedule-to-Close Timeout
    ('qe-pillar-reliability.json',   261,  52.0),     # V1 Baseline Pre-QE Quality
]

# Build lookup set for fast panel identification
STATIC_LOOKUP = {(f, pid): val for (f, pid, val) in STATIC_VALUE_PANELS}

# PromQL expressions that divide and need "or vector(0)" fallback
# We wrap: expr -> (expr) or vector(0)
# Only when the root expression contains "/" and clamp_min/clamp_max
DIV_PATTERNS = [
    # clamp_max(count(X > 0) / count(X) * 100) - trace coverage
    ('clamp_max(count(phoenix_trace_count', 'trace_coverage'),
]


def fix_mojibake(s):
    for bad, good in MOJIBAKE_MAP:
        s = s.replace(bad, good)
    return s


def fix_strings(obj):
    if isinstance(obj, str):
        return fix_mojibake(obj)
    elif isinstance(obj, dict):
        return {k: fix_strings(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [fix_strings(v) for v in obj]
    return obj


def fix_noval_and_queries(obj, fname, changes):
    """Recursively walk panels dict:
    1. Add noValue '0' to all stat/gauge/barchart/piechart/bargauge panels missing it
    2. Convert bare numeric PromQL -> vector(N)
    3. Wrap division queries with or vector(0) fallback
    """
    if not isinstance(obj, dict):
        if isinstance(obj, list):
            return [fix_noval_and_queries(v, fname, changes) for v in obj]
        return obj

    # Is this a panel object?
    if 'type' in obj and 'fieldConfig' in obj:
        ptype = obj.get('type', '')
        pid = obj.get('id', -1)
        title = obj.get('title', '')

        # Fix noValue on data panels
        if ptype in ('stat', 'gauge', 'barchart', 'piechart', 'bargauge', 'timeseries', 'table'):
            fcd = obj.setdefault('fieldConfig', {}).setdefault('defaults', {})
            if fcd.get('noValue', '') not in ('0', ''):
                old = fcd.get('noValue', 'MISSING')
                fcd['noValue'] = '0'
                changes.append(f'  [{pid}] {title}: noValue {repr(old)} -> "0"')
            elif 'noValue' not in fcd and ptype in ('stat', 'gauge', 'bargauge'):
                fcd['noValue'] = '0'
                changes.append(f'  [{pid}] {title}: added noValue "0"')

    # Fix target expressions
    if 'targets' in obj and isinstance(obj['targets'], list):
        pid = obj.get('id', -1)
        title = obj.get('title', '')
        new_targets = []
        for t in obj['targets']:
            if not isinstance(t, dict):
                new_targets.append(t)
                continue

            expr = t.get('expr', '')
            key = (fname, pid)

            # 1. Bare numeric scalar -> vector()
            if key in STATIC_LOOKUP:
                val = STATIC_LOOKUP[key]
                new_expr = 'vector({v})'.format(v=int(val) if val == int(val) else val)
                if expr != new_expr:
                    changes.append(f'  [{pid}] {title}: static expr {repr(expr)} -> {repr(new_expr)}')
                    t = dict(t, expr=new_expr)

            # 2. Division with no fallback -> wrap in (expr) or vector(0)
            elif expr and '/' in expr and 'clamp_min' in expr and 'or vector' not in expr:
                new_expr = '(' + expr + ') or vector(0)'
                changes.append(f'  [{pid}] {title}: added or vector(0) fallback')
                t = dict(t, expr=new_expr)

            # 3. clamp_max coverage query - add or vector(0)
            elif expr and 'clamp_max(count' in expr and 'or vector' not in expr:
                new_expr = '(' + expr + ') or vector(0)'
                changes.append(f'  [{pid}] {title}: added or vector(0) to coverage clamp_max')
                t = dict(t, expr=new_expr)

            new_targets.append(t)
        obj = dict(obj, targets=new_targets)

    # Recurse
    out = {}
    for k, v in obj.items():
        if isinstance(v, dict):
            out[k] = fix_noval_and_queries(v, fname, changes)
        elif isinstance(v, list):
            out[k] = [fix_noval_and_queries(item, fname, changes) for item in v]
        else:
            out[k] = v
    return out


os.makedirs(DEPLOY_BASE, exist_ok=True)

for fname in FILES:
    src = APP_BASE + fname
    with open(src, 'rb') as fh:
        raw = fh.read()

    text = raw.decode('utf-8-sig')
    d = json.loads(text)

    # Step 1: fix mojibake strings
    d = fix_strings(d)

    # Step 2: fix noValue + query issues
    changes = []
    d = fix_noval_and_queries(d, fname, changes)

    out = json.dumps(d, indent=2, ensure_ascii=False) + '\n'

    with open(src, 'w', encoding='utf-8') as fh:
        fh.write(out)

    dst = DEPLOY_BASE + fname
    with open(dst, 'w', encoding='utf-8') as fh:
        fh.write(out)

    title = d.get('title', fname)
    print('OK  ' + fname + ' -> ' + repr(title))
    for c in changes:
        print(c)

print('\nDone.')


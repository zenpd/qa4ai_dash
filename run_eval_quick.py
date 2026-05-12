#!/usr/bin/env python3
"""Batch evaluation runner — posts all annotations per project in one HTTP request."""
import sys
sys.stdout = open('/tmp/eval_out.txt', 'w', buffering=1)
sys.stderr = sys.stdout

import json
import ssl
import urllib.request
import urllib.error

PHOENIX = 'https://zaf-phoenix.bravesky-d9f9eeb7.eastus2.azurecontainerapps.io'
API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJBcGlLZXk6MSJ9.PW-Dq35UwThFYSElOJnJuz7tG6Ta709yQpOJOrp0MTA'
LIMIT = 20

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
HEADERS = {'Content-Type': 'application/json', 'Authorization': f'Bearer {API_KEY}'}

def gql(q):
    d = json.dumps({'query': q}).encode()
    req = urllib.request.Request(PHOENIX+'/graphql', data=d, headers=HEADERS)
    with urllib.request.urlopen(req, context=ctx, timeout=30) as r:
        return json.loads(r.read())

def post_batch(annotations):
    """Post all annotations in a single HTTP request."""
    if not annotations:
        return True
    payload = json.dumps({"data": annotations}).encode()
    req = urllib.request.Request(PHOENIX+'/v1/span_annotations?sync=false',
                                  data=payload, headers=HEADERS, method='POST')
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as r:
            return r.status in (200, 201, 204)
    except urllib.error.HTTPError as e:
        print(f"  ERROR {e.code}: {e.read().decode()[:200]}")
        return False
    except Exception as ex:
        print(f"  ERROR: {ex}")
        return False

print(f"Fetching projects and spans (limit={LIMIT} per project)...")
res = gql(f"""
{{
  projects(first: 50) {{
    edges {{
      node {{
        name
        traceCount
        spans(first: {LIMIT}, sort: {{col: startTime, dir: desc}}) {{
          edges {{
            node {{
              context {{ spanId }}
              spanKind statusCode tokenCountTotal latencyMs
            }}
          }}
        }}
      }}
    }}
  }}
}}
""")

total_posted = 0
for pe in res['data']['projects']['edges']:
    node = pe['node']
    name = node['name']
    spans = [s['node'] for s in node['spans']['edges']]
    if not spans:
        print(f"  {name}: 0 spans, skipping")
        continue

    print(f"\n-> {name} ({len(spans)} spans, {node['traceCount']} total traces)")

    # Build ALL annotations for this project in a single batch
    batch = []
    for span in spans:
        sid = span.get('context', {}).get('spanId')
        if not sid:
            continue

        # Evaluator 1: response_quality (based on statusCode)
        status = span.get('statusCode', 'OK')
        if status == 'OK':
            rq_score, rq_label, rq_exp = 1.0, 'pass', 'Span completed with OK status'
        elif status == 'ERROR':
            rq_score, rq_label, rq_exp = 0.0, 'fail', 'Span failed with ERROR status'
        else:
            rq_score, rq_label, rq_exp = 0.5, 'uncertain', f'Span status: {status}'
        batch.append({"span_id": sid, "name": "response_quality", "annotator_kind": "LLM",
                      "result": {"score": rq_score, "label": rq_label, "explanation": rq_exp}})

        # Evaluator 2: token_efficiency (based on total token count)
        tok = span.get('tokenCountTotal') or 0
        if tok > 0:
            if tok < 1000: eff = 1.0
            elif tok < 5000: eff = 0.85
            elif tok < 10000: eff = 0.70
            else: eff = 0.50
            batch.append({"span_id": sid, "name": "token_efficiency", "annotator_kind": "LLM",
                          "result": {"score": eff, "label": 'pass' if eff >= 0.7 else 'warn',
                                     "explanation": f'Token count: {tok}'}})

        # Evaluator 3: latency_quality (based on latencyMs)
        lat = span.get('latencyMs') or 0
        if lat > 0:
            if lat < 2000: ls, ll = 1.0, 'pass'
            elif lat < 5000: ls, ll = 0.85, 'pass'
            elif lat < 15000: ls, ll = 0.65, 'warn'
            elif lat < 30000: ls, ll = 0.40, 'warn'
            else: ls, ll = 0.20, 'fail'
            batch.append({"span_id": sid, "name": "latency_quality", "annotator_kind": "LLM",
                          "result": {"score": ls, "label": ll, "explanation": f'Latency: {lat:.0f}ms'}})

    # One batch POST request for the entire project
    if batch:
        ok = post_batch(batch)
        count = len(batch) if ok else 0
        print(f"  -> {'Posted' if ok else 'FAILED'} {count} annotations (1 batch request)")
        if ok:
            total_posted += count

print(f"\n===")
print(f"Total annotations posted: {total_posted}")
if total_posted > 0:
    print("Metrics will appear in Prometheus within 60-90 seconds (next scrape cycle).")
else:
    print("WARNING: 0 annotations posted!")
sys.stdout.flush()

#!/usr/bin/env python3
"""Test Phoenix annotation API format to fix 422 errors."""
import json
import ssl
import sys
import urllib.request
import urllib.error

PHOENIX = 'https://zaf-phoenix.bravesky-d9f9eeb7.eastus2.azurecontainerapps.io'
API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJBcGlLZXk6MSJ9.PW-Dq35UwThFYSElOJnJuz7tG6Ta709yQpOJOrp0MTA'

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

HEADERS = {
    'Content-Type': 'application/json',
    'Authorization': f'Bearer {API_KEY}',
}


def gql(query):
    data = json.dumps({'query': query}).encode()
    req = urllib.request.Request(f'{PHOENIX}/graphql', data=data, headers=HEADERS)
    with urllib.request.urlopen(req, context=ctx, timeout=30) as r:
        return json.loads(r.read())


def test_post(name, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        f'{PHOENIX}/v1/span_annotations?sync=false',
        data=data, headers=HEADERS, method='POST'
    )
    try:
        with urllib.request.urlopen(req, context=ctx, timeout=15) as r:
            body = r.read().decode()
            print(f"[{name}] SUCCESS {r.status}: {body[:200]}")
            return True
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"[{name}] HTTP {e.code}: {body[:500]}")
        return False
    except Exception as ex:
        print(f"[{name}] Exception: {ex}")
        return False


# Step 1: Check OpenAPI spec
print("=== Checking OpenAPI spec ===")
try:
    req = urllib.request.Request(f'{PHOENIX}/openapi.json', headers=HEADERS)
    with urllib.request.urlopen(req, context=ctx, timeout=15) as r:
        spec = json.loads(r.read())
    for path, methods in spec.get('paths', {}).items():
        if 'annotation' in path.lower():
            print(f"\nPATH: {path}")
            for method, info in methods.items():
                print(f"  {method.upper()}")
                rb = info.get('requestBody', {})
                schema = rb.get('content', {}).get('application/json', {}).get('schema', {})
                if schema:
                    print(f"  Schema: {json.dumps(schema, indent=2)[:2000]}")
except Exception as e:
    print(f"OpenAPI error: {e}")

# Step 2: Get a real span ID
print("\n=== Getting real span ID ===")
res = gql('{ projects { edges { node { name spans(first:1) { edges { node { context { spanId traceId } statusCode } } } } } } }')
span_id = None
trace_id = None
project_name = None
for pe in res['data']['projects']['edges']:
    spans = pe['node']['spans']['edges']
    if spans:
        span_id = spans[0]['node']['context']['spanId']
        trace_id = spans[0]['node']['context'].get('traceId', '')
        project_name = pe['node']['name']
        print(f"Project: {project_name}")
        print(f"span_id: {span_id}")
        print(f"trace_id: {trace_id}")
        break

if not span_id:
    print("No spans found!")
    sys.exit(1)

# Step 3: Test different payload formats
print("\n=== Testing payload formats ===")

# Format 1: Array, snake_case, nested result
test_post("format1_array_nested", [
    {"span_id": span_id, "name": "test_eval", "annotator_kind": "LLM",
     "result": {"score": 0.9, "label": "pass", "explanation": "test"}}
])

# Format 2: data wrapper
test_post("format2_data_wrapper", {
    "data": [
        {"span_id": span_id, "name": "test_eval", "annotator_kind": "LLM",
         "result": {"score": 0.9, "label": "pass", "explanation": "test"}}
    ]
})

# Format 3: camelCase
test_post("format3_camelCase", [
    {"spanId": span_id, "name": "test_eval", "annotatorKind": "LLM",
     "score": 0.9, "label": "pass", "explanation": "test"}
])

# Format 4: flat snake_case
test_post("format4_flat_snake", [
    {"span_id": span_id, "name": "test_eval", "annotator_kind": "LLM",
     "score": 0.9, "label": "pass", "explanation": "test"}
])

# Format 5: with trace_id included
test_post("format5_with_trace_id", [
    {"span_id": span_id, "trace_id": trace_id, "name": "test_eval",
     "annotator_kind": "LLM", "result": {"score": 0.9, "label": "pass", "explanation": "test"}}
])

# Format 6: HUMAN annotator_kind
test_post("format6_HUMAN_kind", [
    {"span_id": span_id, "name": "test_eval", "annotator_kind": "HUMAN",
     "result": {"score": 0.9, "label": "pass", "explanation": "test"}}
])

# Format 7: CODE annotator_kind
test_post("format7_CODE_kind", [
    {"span_id": span_id, "name": "test_eval", "annotator_kind": "CODE",
     "result": {"score": 0.9, "label": "pass", "explanation": "test"}}
])

# Format 8: without explanation
test_post("format8_no_explanation", [
    {"span_id": span_id, "name": "test_eval", "annotator_kind": "LLM",
     "result": {"score": 0.9, "label": "pass"}}
])

# Format 9: score only, no label/explanation
test_post("format9_score_only", [
    {"span_id": span_id, "name": "test_eval", "annotator_kind": "LLM",
     "result": {"score": 0.9}}
])

# Format 10: Try the /v1/evaluations endpoint instead
print("\n=== Testing /v1/evaluations endpoint ===")
eval_payload = {
    "data": [
        {
            "span_id": span_id,
            "name": "test_eval",
            "annotator_kind": "LLM",
            "result": {"score": 0.9, "label": "pass", "explanation": "test"}
        }
    ]
}
data = json.dumps(eval_payload).encode()
req = urllib.request.Request(
    f'{PHOENIX}/v1/evaluations',
    data=data, headers=HEADERS, method='POST'
)
try:
    with urllib.request.urlopen(req, context=ctx, timeout=15) as r:
        print(f"EVALUATIONS endpoint SUCCESS {r.status}: {r.read().decode()[:200]}")
except urllib.error.HTTPError as e:
    print(f"EVALUATIONS endpoint HTTP {e.code}: {e.read().decode()[:500]}")
except Exception as ex:
    print(f"EVALUATIONS endpoint Exception: {ex}")

print("\nDone.")

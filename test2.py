#!/usr/bin/env python3
import json, ssl, sys, urllib.request, urllib.error

PHOENIX = 'https://zaf-phoenix.bravesky-d9f9eeb7.eastus2.azurecontainerapps.io'
API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJBcGlLZXk6MSJ9.PW-Dq35UwThFYSElOJnJuz7tG6Ta709yQpOJOrp0MTA'
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
HEADERS = {'Content-Type': 'application/json', 'Authorization': f'Bearer {API_KEY}'}

def gql(q):
    d = json.dumps({'query': q}).encode()
    req = urllib.request.Request(PHOENIX+'/graphql', data=d, headers=HEADERS)
    with urllib.request.urlopen(req, context=ctx, timeout=30) as r: return json.loads(r.read())

res = gql('{ projects { edges { node { name spans(first:1) { edges { node { context { spanId } } } } } } } }')
span_id = None
for pe in res['data']['projects']['edges']:
    sp = pe['node']['spans']['edges']
    if sp: span_id = sp[0]['node']['context']['spanId']; print(f"span_id={span_id}"); break

if not span_id: print("no span"); sys.exit(1)

# Test format 2: {"data": [...]}
payload2 = {"data": [{"span_id": span_id, "name": "test_eval2", "annotator_kind": "LLM",
                       "result": {"score": 0.9, "label": "pass", "explanation": "test"}}]}
d = json.dumps(payload2).encode()
req = urllib.request.Request(PHOENIX+'/v1/span_annotations?sync=false', data=d, headers=HEADERS, method='POST')
try:
    with urllib.request.urlopen(req, context=ctx, timeout=15) as r:
        print(f"format2 SUCCESS {r.status}: {r.read().decode()}")
except urllib.error.HTTPError as e:
    print(f"format2 ERROR {e.code}: {e.read().decode()}")
except Exception as ex:
    print(f"format2 Exception: {ex}")

#!/usr/bin/env python3
import sys, json, ssl, urllib.request
sys.stdout = open('/tmp/verify_ann.txt', 'w', buffering=1)
ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
PHOENIX = 'https://zaf-phoenix.bravesky-d9f9eeb7.eastus2.azurecontainerapps.io'
API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiJBcGlLZXk6MSJ9.PW-Dq35UwThFYSElOJnJuz7tG6Ta709yQpOJOrp0MTA'
HEADERS = {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY}
q = """
{
  projects {
    edges {
      node {
        name
        spanAnnotationNames
        spanAnnotationSummary(annotationName: "response_quality") {
          name
          meanScore
          count
        }
      }
    }
  }
}
"""
res = json.loads(urllib.request.urlopen(urllib.request.Request(PHOENIX+'/graphql', json.dumps({'query':q}).encode(), HEADERS), context=ctx, timeout=30).read())
for e in res['data']['projects']['edges']:
    n = e['node']
    ann = n.get('spanAnnotationSummary') or {}
    print(f"{n['name']}")
    print(f"  spanAnnotationNames: {n['spanAnnotationNames']}")
    print(f"  response_quality summary: count={ann.get('count', 0)}, meanScore={ann.get('meanScore', 'N/A')}")
sys.stdout.flush()

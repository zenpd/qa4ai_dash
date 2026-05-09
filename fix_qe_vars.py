import json, os

DASH_DIR_APP    = "/Users/sysadm/Documents/agent_foundry/unified_dashboard/app/config/grafana/provisioning/dashboards"
DASH_DIR_DEPLOY = "/Users/sysadm/Documents/agent_foundry/unified_dashboard/deploy/grafana/provisioning/dashboards"

FILES = [
    "qe-four-pillars.json",
    "qe-pillar-correctness.json",
    "qe-pillar-governance.json",
    "qe-pillar-observability.json",
    "qe-pillar-reliability.json",
]

# Grafana 10-compatible variable definitions
VARIABLES = [
    {
        "name": "project",
        "label": "Project / App",
        "type": "query",
        "datasource": {"type": "prometheus", "uid": "prometheus-ds"},
        "query": {
            "query": "label_values(phoenix_project_present, project_name)",
            "refId": "StandardVariableQuery"
        },
        "refresh": 2,
        "includeAll": True,
        "allValue": ".*",
        "multi": False,
        "sort": 1,
        "hide": 0,
        "skipUrlSync": False,
        "current": {}
    },
    {
        "name": "namespace",
        "label": "Namespace",
        "type": "query",
        "datasource": {"type": "prometheus", "uid": "prometheus-ds"},
        "query": {
            "query": "label_values(temporal_workflow_active, namespace)",
            "refId": "StandardVariableQuery"
        },
        "refresh": 2,
        "includeAll": True,
        "allValue": ".*",
        "multi": False,
        "sort": 1,
        "hide": 0,
        "skipUrlSync": False,
        "current": {}
    }
]

def fix_file(path):
    if not os.path.exists(path):
        print(f"  SKIP (not found): {path}")
        return
    with open(path, encoding="utf-8") as f:
        raw = f.read()
    d = json.loads(raw)
    dash = d.get("dashboard", d)
    dash.setdefault("templating", {})["list"] = VARIABLES
    dash["schemaVersion"] = max(dash.get("schemaVersion", 36), 36)
    if "dashboard" in d:
        d["dashboard"] = dash
    else:
        d = dash
    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, indent=2)
    print(f"  Fixed: {path}")

for fname in FILES:
    print(fname)
    fix_file(os.path.join(DASH_DIR_APP, fname))
    fix_file(os.path.join(DASH_DIR_DEPLOY, fname))

print("Done.")

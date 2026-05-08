#!/usr/bin/env python3
import json

BASE = '/Users/sysadm/Documents/agent_foundry/unified_dashboard/app/config/grafana/provisioning/dashboards/'
FILES = [
    'qe-four-pillars.json',
    'qe-pillar-correctness.json',
    'qe-pillar-governance.json',
    'qe-pillar-observability.json',
    'qe-pillar-reliability.json',
]

for fname in FILES:
    with open(BASE + fname) as fh:
        d = json.load(fh)
    print('\n=== ' + d.get('title', fname) + ' ===')
    for p in d.get('panels', []):
        pid = p.get('id')
        title = p.get('title', '?')
        ptype = p.get('type', '?')
        ds = p.get('datasource', {})
        ds_uid = ds.get('uid', '?') if isinstance(ds, dict) else str(ds)
        targets = p.get('targets', [])
        fcd = p.get('fieldConfig', {}).get('defaults', {})
        noval = fcd.get('noValue', '-')
        if not targets:
            print('  [{pid}] {title} ({ptype}) ds={ds_uid} STATIC/NO-TARGET noValue={noval}'.format(
                pid=pid, title=title, ptype=ptype, ds_uid=ds_uid, noval=noval))
            continue
        for t in targets:
            expr = t.get('expr', t.get('query', t.get('rawSql', '')))
            refid = t.get('refId', '?')
            hide = t.get('hide', False)
            print('  [{pid}] {title} ({ptype}) ds={ds_uid} ref={refid} hide={hide}: {expr}'.format(
                pid=pid, title=title, ptype=ptype, ds_uid=ds_uid, refid=refid, hide=hide,
                expr=str(expr)[:110]))

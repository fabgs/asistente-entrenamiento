"""State of the latest iOS workflow runs of the public repo, and the annotations of a finished job
(the errors, and what «Comprobar el .ipa» found).

Unauthenticated GitHub API (60 requests an hour). Usage: python scripts/ios_runs.py [run_id]
"""
import json
import ssl
import sys
import urllib.request

REPO = 'fabgs/asistente-entrenamiento'
CTX = ssl.create_default_context()


def get(path):
    req = urllib.request.Request(f'https://api.github.com{path}', headers={'User-Agent': 'generic-client', 'Accept': 'application/vnd.github+json'})
    with urllib.request.urlopen(req, context=CTX, timeout=30) as r:
        return json.load(r)


if len(sys.argv) > 1:
    run_id = sys.argv[1]
else:
    runs = get(f'/repos/{REPO}/actions/workflows/ios.yml/runs?per_page=3')['workflow_runs']
    for r in runs:
        print(r['id'], r['head_branch'], r['status'], r['conclusion'], r['created_at'], r['updated_at'])
    if not runs:
        sys.exit()
    run_id = runs[0]['id']

jobs = get(f'/repos/{REPO}/actions/runs/{run_id}/jobs')['jobs']
for job in jobs:
    print('job', job['id'], job['status'], job['conclusion'])
    for step in job['steps']:
        print('  ', step['number'], step['name'], step['status'], step['conclusion'])
    if job['status'] == 'completed':
        for a in get(f'/repos/{REPO}/check-runs/{job["id"]}/annotations'):
            print('  !', a.get('annotation_level'), a.get('title'), '|', a['message'][:900])

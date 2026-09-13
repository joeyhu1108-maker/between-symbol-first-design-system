"""Run the checked-in visual algorithm in a disposable process and workspace."""
from datetime import datetime
import importlib
import json
from pathlib import Path
import shutil
import sys

from app import SOURCE_FILES


def render(source, workspace):
    source, workspace = Path(source), Path(workspace)
    data = json.loads((workspace / 'request.json').read_text())
    # server.py creates an empty SQLite DB on import. Import a private source copy,
    # never the original checkout or its jobs directory, then use a memory job map.
    modules = workspace / 'modules'
    modules.mkdir()
    for name in SOURCE_FILES:
        shutil.copyfile(source / name, modules / name)
    sys.path.insert(0, str(modules))
    sessions = importlib.import_module('entry_sessions')
    sessions.lan_address = lambda: None
    original = importlib.import_module('server')
    original.ROOT = workspace
    (workspace / 'jobs').mkdir()
    params = original.params({'cards': data['cards'], 'seed': data['seed']})
    job = {'id': data['id'], 'params': params, 'rarity': original.rarity_for(params['m'], params['n']),
           'story': original.story_for(params), 'created_at': datetime.now().isoformat(),
           'started_at': datetime.now().isoformat(), 'status': 'generating', 'revises': '',
           'generator': 'local_garden', 'style_version': original.STYLE['version'],
           'style_scale': original.STYLE['scale'], 'print_status': 'not_submitted',
           'request_id': data['request_id']}
    jobs = {data['id']: job}
    original.get_job = lambda jid: dict(jobs[jid])
    original.save = lambda value: jobs.update({value['id']: dict(value)})

    def never_print(*args, **kwargs):
        raise RuntimeError('Printing is unavailable in the artwork renderer.')

    original.print_job = never_print
    original.generate(data['id'])
    result = jobs[data['id']]
    if result['status'] != 'ready':
        raise RuntimeError('Original generator failed')
    (workspace / 'result.json').write_text(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    render(sys.argv[1], sys.argv[2])

#!/usr/bin/env python3
"""Receive authorized BETWEEN PDF jobs and submit them to a local CUPS queue."""
import argparse, json, os, re, shutil, subprocess, sys, tempfile, time
from pathlib import Path
from urllib.parse import urljoin, urlparse
from urllib.request import Request, HTTPRedirectHandler, build_opener

MAX_PDF = 20 * 1024 * 1024
# Cloudflare on the production domain rejects urllib's default "Python-urllib/x.y" with error 1010 (HTTP 403).
USER_AGENT = 'BETWEEN-print-agent/1.0'

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('Server redirects are not allowed.')

def save_state(path, state):
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(mode='w', dir=path.parent, delete=False) as out:
        os.chmod(out.name, 0o600)
        json.dump(state, out)
        out.flush()
        os.fsync(out.fileno())
    os.replace(out.name, path)

def cups(args):
    return subprocess.run(args, capture_output=True, text=True, timeout=8,
                          env={**os.environ, 'LC_ALL': 'C'})

def printer_status(selected):
    # lpstat text is localized (Chinese on zh-Hans Macs) and LC_ALL=C does not override it,
    # so take bare names from `lpstat -e` and key=value state from `lpoptions -p`.
    queues = cups(['lpstat', '-e']).stdout.split()
    if not selected:
        default = cups(['lpstat', '-d'])
        found = re.search(r'[:：]\s*(\S+)\s*$', default.stdout.strip())
        selected = found.group(1) if found else ''
    ready = False
    if selected in queues:
        options = dict(item.split('=', 1) for item in cups(['lpoptions', '-p', selected]).stdout.split() if '=' in item)
        ready = options.get('printer-state') != '5' and options.get('printer-is-accepting-jobs') != 'false'
    return selected or '', ready

class Agent:
    def __init__(self, server, token, printer, state_path):
        parsed = urlparse(server)
        if parsed.scheme not in ('https', 'http') or not parsed.netloc or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
            raise ValueError('--server must be an HTTP(S) origin, without a path or credentials.')
        self.server, self.token = server.rstrip('/'), token
        self.printer, self.path = printer, state_path
        self.opener = build_opener(NoRedirect())
        self.state = json.loads(state_path.read_text()) if state_path.exists() else {'runs': {}}
        if not isinstance(self.state.get('runs'), dict):
            raise ValueError('Invalid state file. Keep it for recovery; do not delete it to retry printing.')
        for record in self.state['runs'].values():
            if record['status'] == 'submitting':
                record.update(status='uncertain', error='Agent stopped during submission; inspect the system queue before retrying.', reported=False)
        save_state(self.path, self.state)

    def post(self, path, data):
        request = Request(self.server + path, data=json.dumps(data).encode(),
                          headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + self.token, 'User-Agent': USER_AGENT})
        with self.opener.open(request, timeout=15) as response:
            return json.loads(response.read(1024 * 1024))

    def report(self, record):
        payload = {key: value for key, value in record.items() if key in ('run_id', 'status', 'cups_job_id', 'error')}
        self.post('/api/print-agent/result', payload)
        record['reported'] = True
        save_state(self.path, self.state)

    def download(self, job):
        url = urljoin(self.server + '/', job['pdf_url'])
        parsed, origin = urlparse(url), urlparse(self.server)
        if (parsed.scheme, parsed.netloc) != (origin.scheme, origin.netloc) or parsed.query or parsed.fragment or parsed.path != '/printer/jobs/' + job['job_id'] + '/artwork.pdf':
            raise ValueError('PDF must use the same server and the assigned printer/jobs artifact path.')
        request = Request(url, headers={'Authorization': 'Bearer ' + self.token, 'User-Agent': USER_AGENT})
        with self.opener.open(request, timeout=20) as response:
            raw = response.read(MAX_PDF + 1)
        if len(raw) > MAX_PDF or not raw.startswith(b'%PDF-'):
            raise ValueError('Artifact is not a valid PDF header or exceeds 20 MiB.')
        return raw

    def process(self, job, printer):
        run_id, job_id = job['run_id'], job['job_id']
        if not isinstance(run_id, str) or not 1 <= len(run_id) <= 256 or not isinstance(job_id, str) or not re.fullmatch(r'[A-Za-z0-9-]{1,128}', job_id):
            raise ValueError('Invalid job identity.')
        if run_id in self.state['runs']:
            self.report(self.state['runs'][run_id])
            return
        record = {'run_id': run_id, 'job_id': job_id, 'status': 'failed', 'reported': False}
        try:
            raw = self.download(job)
            with tempfile.TemporaryDirectory(prefix='between-print-') as folder:
                pdf = Path(folder) / 'artwork.pdf'
                pdf.write_bytes(raw)
                record['status'] = 'submitting'
                self.state['runs'][run_id] = record
                save_state(self.path, self.state)
                try:
                    result = subprocess.run(['lp', '-d', printer, '-t', job_id, str(pdf)], capture_output=True,
                                            text=True, timeout=20, env={**os.environ, 'LC_ALL': 'C'})
                    if result.returncode:
                        record.update(status='failed', error=(result.stderr or result.stdout or 'CUPS rejected submission.').strip()[:1000])
                    else:
                        match = re.search(re.escape(printer) + r'-\d+', result.stdout)
                        record.update(status='submitted', cups_job_id=match.group(0) if match else result.stdout.strip()[:200])
                except subprocess.TimeoutExpired:
                    record.update(status='uncertain', error='CUPS submission timed out; inspect the queue before retrying.')
                except OSError as error:
                    record.update(status='failed', error=str(error)[:1000])
        except Exception as error:
            if record['status'] == 'submitting':
                record.update(status='uncertain', error='Submission was interrupted; inspect the system queue.')
            else:
                record.update(status='failed', error=str(error)[:1000])
        self.state['runs'][run_id] = record
        save_state(self.path, self.state)
        self.report(record)
        print(f"{run_id}: {record['status']} (submission status, not proof of paper output)", flush=True)

    def cycle(self):
        try:
            printer, ready = printer_status(self.printer)
        except (OSError, subprocess.TimeoutExpired):
            printer, ready = self.printer or '', False
        self.post('/api/print-agent/heartbeat', {'printer': printer, 'ready': ready})
        for record in self.state['runs'].values():
            if not record.get('reported'):
                self.report(record)
        if not ready:
            print('Waiting: no selected/default enabled CUPS queue; no job claimed.', flush=True)
            return
        claimed = self.post('/api/print-agent/claim', {}).get('job')
        if claimed:
            self.process(claimed, printer)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, help='Private JSON containing server and token')
    parser.add_argument('--server', help='Test server origin, e.g. https://example.test')
    parser.add_argument('--token', help='Prefer BETWEEN_PRINT_TOKEN or a private --config file')
    parser.add_argument('--printer', help='CUPS queue name; otherwise use the system default')
    parser.add_argument('--state', type=Path, default=Path.home() / '.between-nfc-print-agent.json')
    parser.add_argument('--list', action='store_true', help='List local CUPS queues and exit')
    parser.add_argument('--once', action='store_true', help='One polling cycle; MAY submit a real print job')
    args = parser.parse_args()
    if sys.platform not in ('darwin', 'linux'):
        parser.error('This receiver supports macOS/Linux CUPS only. Windows silent printing is not implemented.')
    if not all(shutil.which(command) for command in ('lpstat', 'lp')):
        parser.error('CUPS lp/lpstat commands are unavailable; configure a supported local print system first.')
    if args.list:
        result = cups(['lpstat', '-p', '-d'])
        print(result.stdout or result.stderr, end='')
        return 0
    config = json.loads(args.config.read_text()) if args.config else {}
    server = args.server or config.get('server')
    token = args.token or os.getenv('BETWEEN_PRINT_TOKEN') or config.get('token')
    if not server or not token:
        parser.error('Provide --config or --server and BETWEEN_PRINT_TOKEN.')
    import fcntl
    args.state = args.state.expanduser()
    args.state.parent.mkdir(parents=True, exist_ok=True)
    with open(str(args.state) + '.lock', 'a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            parser.error('Another receiver is already using this state file.')
        agent = Agent(server, token, args.printer, args.state)
        while True:
            try:
                agent.cycle()
            except Exception as error:
                print(f'Receiver waiting: {error}', file=sys.stderr, flush=True)
                if args.once:
                    return 1
            if args.once:
                return 0
            time.sleep(3)

if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        print('\nReceiver stopped. Keep its state file for safe recovery.', file=sys.stderr)

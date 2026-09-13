"""Internal container API. Artwork only: no printer, session, or CUPS endpoints."""
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

SOURCE_FILES = ('server.py', 'garden_style.py', 'garden_style.json', 'rarity.py',
                'story.py', 'entry_sessions.py')
JOB_ID = r'SG-[0-9]{8}-[0-9]+-[A-F0-9]{8}'
FILES = {'artwork.png': 'image/png', 'artwork.webp': 'image/webp',
         'artwork.pdf': 'application/pdf', 'particles.json': 'application/json'}
MAX_BODY = 4096


class APIError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code = status, code


def validate(data):
    if not isinstance(data, dict) or set(data) != {'id', 'cards', 'seed', 'request_id'}:
        raise APIError(400, 'invalid_input', 'Expected id, cards, seed and request_id.')
    if not isinstance(data['id'], str) or len(data['id']) > 96 or not re.fullmatch(JOB_ID, data['id']):
        raise APIError(400, 'invalid_id', 'Invalid artwork id.')
    cards = data['cards']
    if (not isinstance(cards, list) or len(cards) != 2
            or any(type(card) is not int or not 1 <= card <= 12 for card in cards)
            or cards[0] == cards[1]):
        raise APIError(400, 'invalid_cards', 'Provide two different cards from 1 to 12.')
    if type(data['seed']) is not int or not 0 <= data['seed'] <= 0xffffffff:
        raise APIError(400, 'invalid_seed', 'Seed must be an unsigned 32-bit integer.')
    if (not isinstance(data['request_id'], str) or not 1 <= len(data['request_id']) <= 128
            or any(ord(char) < 32 for char in data['request_id'])):
        raise APIError(400, 'invalid_request_id', 'Invalid request id.')
    return data


class Renderer:
    def __init__(self, source, data_root, timeout=120, runner=None):
        self.source = Path(source).resolve()
        self.root = Path(data_root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.timeout = timeout
        self.runner = Path(runner or Path(__file__).with_name('runner.py')).resolve()
        self.lock = threading.Lock()
        self.ready = (all((self.source / name).is_file() for name in SOURCE_FILES)
                      and self.runner.is_file()
                      and all(importlib.util.find_spec(name) for name in ('numpy', 'PIL', 'reportlab')))

    def health(self):
        return {'ok': self.ready, 'busy': self.lock.locked(), 'generator': 'local_garden',
                'max_concurrent_renders': 1, 'render_timeout_seconds': self.timeout}

    def render(self, data):
        data = validate(data)
        if not self.ready:
            raise APIError(503, 'not_ready', 'Renderer dependencies are unavailable.')
        if not self.lock.acquire(blocking=False):
            raise APIError(429, 'busy', 'This renderer is already creating an artwork.')
        folder = self.root / data['id']
        try:
            result_path = folder / 'result.json'
            if result_path.is_file():
                previous = json.loads((folder / 'request.json').read_text())
                if previous != data:
                    raise APIError(409, 'id_conflict', 'Artwork id already belongs to different inputs.')
                return json.loads(result_path.read_text())
            if folder.exists():
                shutil.rmtree(folder)
            folder.mkdir()
            (folder / 'request.json').write_text(json.dumps(data))
            try:
                subprocess.run([sys.executable, str(self.runner), str(self.source), str(folder)],
                               timeout=self.timeout, check=True, capture_output=True)
            except subprocess.TimeoutExpired:
                shutil.rmtree(folder, ignore_errors=True)
                raise APIError(504, 'render_timeout', 'Artwork generation exceeded its time limit.')
            except (subprocess.CalledProcessError, OSError):
                shutil.rmtree(folder, ignore_errors=True)
                raise APIError(500, 'render_failed', 'Artwork generation failed.')
            try:
                result = json.loads(result_path.read_text())
                if result['id'] != data['id'] or result['status'] != 'ready':
                    raise ValueError('Invalid renderer result')
                if any(not (folder / 'jobs' / data['id'] / name).is_file() for name in FILES):
                    raise ValueError('Missing generated artifact')
            except (ValueError, OSError, KeyError):
                shutil.rmtree(folder, ignore_errors=True)
                raise APIError(500, 'render_failed', 'Artwork generation produced an incomplete result.')
            return result
        finally:
            self.lock.release()

    def artifact(self, jid, name):
        if not re.fullmatch(JOB_ID, jid) or name not in FILES:
            raise APIError(404, 'not_found', 'Artifact not found.')
        folder = self.root / jid
        path = folder / 'jobs' / jid / name
        if not (folder / 'result.json').is_file() or not path.is_file():
            raise APIError(404, 'not_found', 'Artifact not found.')
        return path

    def delete(self, jid):
        if not re.fullmatch(JOB_ID, jid):
            raise APIError(404, 'not_found', 'Artwork not found.')
        # Render/cleanup are serialized so cleanup cannot remove an active process's files.
        if not self.lock.acquire(blocking=False):
            raise APIError(409, 'busy', 'A render is still in progress.')
        try:
            shutil.rmtree(self.root / jid, ignore_errors=True)
            return {'ok': True, 'id': jid}
        finally:
            self.lock.release()


class Server(ThreadingHTTPServer):
    request_queue_size = 128
    daemon_threads = True

    def __init__(self, address, renderer):
        self.renderer = renderer
        super().__init__(address, Handler)


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def log_message(self, format, *args):
        # Log method/status only; input bodies and request ids are not logged.
        if len(args) >= 2:
            print(f'{self.command} {args[1]}', flush=True)

    def send_json(self, value, status=200, retry_after=None):
        raw = json.dumps(value, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(raw)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        if retry_after:
            self.send_header('Retry-After', str(retry_after))
        self.end_headers()
        self.wfile.write(raw)

    def error(self, error):
        data = {'error': str(error), 'code': error.code}
        if error.status == 429:
            data['retry_after'] = 3
        self.send_json(data, error.status, 3 if error.status == 429 else None)

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/health':
            value = self.server.renderer.health()
            return self.send_json(value, 200 if value['ok'] else 503)
        match = re.fullmatch(r'/files/(' + JOB_ID + r')/([^/]+)', path)
        if not match:
            return self.error(APIError(404, 'not_found', 'Route not found.'))
        try:
            source = self.server.renderer.artifact(*match.groups())
            with source.open('rb') as stream:
                self.send_response(200)
                self.send_header('Content-Type', FILES[source.name])
                self.send_header('Content-Length', str(os.fstat(stream.fileno()).st_size))
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.end_headers()
                shutil.copyfileobj(stream, self.wfile, 64 * 1024)
        except APIError as error:
            self.error(error)
        except FileNotFoundError:
            self.error(APIError(404, 'not_found', 'Artifact not found.'))

    def do_POST(self):
        if urlsplit(self.path).path != '/render':
            return self.error(APIError(404, 'not_found', 'Route not found.'))
        try:
            if self.headers.get('Transfer-Encoding'):
                raise APIError(400, 'invalid_body', 'Send a JSON body with Content-Length.')
            try:
                length = int(self.headers.get('Content-Length', '-1'))
            except ValueError:
                raise APIError(400, 'invalid_body', 'Invalid content length.')
            if length < 0:
                raise APIError(400, 'invalid_body', 'Content-Length is required.')
            if length > MAX_BODY:
                raise APIError(413, 'body_too_large', 'Request body is too large.')
            try:
                body = self.rfile.read(length)
                if len(body) != length:
                    raise ValueError('Incomplete body')
                data = json.loads(body)
            except (ValueError, UnicodeDecodeError):
                raise APIError(400, 'invalid_json', 'Invalid JSON body.')
            self.send_json(self.server.renderer.render(data))
        except APIError as error:
            self.error(error)

    def do_DELETE(self):
        match = re.fullmatch(r'/files/(' + JOB_ID + r')', urlsplit(self.path).path)
        if not match:
            return self.error(APIError(404, 'not_found', 'Route not found.'))
        try:
            self.send_json(self.server.renderer.delete(match.group(1)))
        except APIError as error:
            self.error(error)


if __name__ == '__main__':
    timeout = float(os.getenv('RENDER_TIMEOUT_SECONDS', '120'))
    if not 1 <= timeout <= 120:
        raise SystemExit('RENDER_TIMEOUT_SECONDS must be between 1 and 120.')
    renderer = Renderer(os.getenv('PRINTER_SOURCE', '/app/printer'),
                        os.getenv('RENDER_DATA', '/tmp/between-artworks'), timeout)
    Server(('0.0.0.0', int(os.getenv('PORT', '8080'))), renderer).serve_forever()

import copy
import hashlib
import http.client
import json
from pathlib import Path
import shutil
import tempfile
import threading
import time
import unittest

from app import Renderer, Server, SOURCE_FILES


class ContainerAPITest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='between-container-test-')
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.mkdir()
        original = Path(__file__).resolve().parents[2] / 'printer'
        for name in SOURCE_FILES:
            shutil.copyfile(original / name, self.source / name)
        # Deliberately invalid: importing this source directly would fail and touch it.
        (self.source / 'jobs').mkdir()
        self.sentinel = self.source / 'jobs' / 'archive.sqlite3'
        self.sentinel.write_bytes(b'NEVER_OPEN_OR_COPY_THIS_DATABASE')
        self.renderer = Renderer(self.source, self.root / 'data')
        self.httpd = Server(('127.0.0.1', 0), self.renderer)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.payload = {'id': 'SG-20260913-0001-00002328', 'cards': [1, 2],
                        'seed': 9000, 'request_id': 'isolated-container-test'}

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join()
        self.assertEqual(self.sentinel.read_bytes(), b'NEVER_OPEN_OR_COPY_THIS_DATABASE')
        self.assertEqual(list((self.source / 'jobs').iterdir()), [self.sentinel])
        self.temp.cleanup()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.httpd.server_port, timeout=125)
        try:
            raw = json.dumps(body).encode() if body is not None else None
            connection.request(method, path, raw, headers or {})
            response = connection.getresponse()
            content = response.read()
            if response.getheader('Content-Type', '').startswith('application/json'):
                content = json.loads(content)
            return response.status, content, dict(response.getheaders())
        finally:
            connection.close()

    def test_health_and_readiness(self):
        status, value, _ = self.request('GET', '/health')
        self.assertEqual(status, 200)
        self.assertTrue(value['ok'])
        self.assertFalse(value['busy'])
        self.assertEqual(value['max_concurrent_renders'], 1)
        self.httpd.renderer = Renderer(self.root / 'missing', self.root / 'unready-data')
        self.assertEqual(self.request('GET', '/health')[0], 503)
        self.assertEqual(self.request('POST', '/render', self.payload)[0], 503)

    def test_invalid_input_and_no_legacy_routes(self):
        cases = [None, [], {}, {**self.payload, 'id': '../escape'},
                 {**self.payload, 'cards': [1, 1]}, {**self.payload, 'cards': [True, 2]},
                 {**self.payload, 'cards': [0, 13]}, {**self.payload, 'cards': [1]},
                 {**self.payload, 'seed': True}, {**self.payload, 'seed': -1},
                 {**self.payload, 'seed': 2**32}, {**self.payload, 'request_id': ''},
                 {**self.payload, 'extra': 'rejected'}]
        for body in cases:
            with self.subTest(body=body):
                self.assertEqual(self.request('POST', '/render', body)[0], 400)
        self.assertEqual(self.request('POST', '/render', {'large': 'x'*5000})[0], 413)
        for path in ('/api/health', '/api/printers', '/api/jobs', '/printer/server.py',
                     '/files/../server.py', '/files/'+self.payload['id']+'/manifest.json'):
            self.assertEqual(self.request('GET', path)[0], 404)
        self.assertEqual(self.request('POST', '/api/jobs/'+self.payload['id']+'/print', {})[0], 404)
        self.assertFalse(any((self.root / 'data').iterdir()))

    def test_busy_rejects_second_render_and_cleanup(self):
        with self.renderer.lock:
            status, value, headers = self.request('POST', '/render', self.payload)
            self.assertEqual(status, 429)
            self.assertEqual(value['code'], 'busy')
            self.assertEqual(headers['Retry-After'], '3')
            self.assertTrue(self.request('GET', '/health')[1]['busy'])
            self.assertEqual(self.request('DELETE', '/files/'+self.payload['id'])[0], 409)

    def test_hard_timeout_releases_capacity_and_removes_partial_files(self):
        sleeper = self.root / 'sleep.py'
        sleeper.write_text('import time\ntime.sleep(30)\n')
        self.renderer.runner = sleeper
        self.renderer.timeout = .15
        started = time.monotonic()
        status, result, _ = self.request('POST', '/render', self.payload)
        self.assertEqual((status, result['code']), (504, 'render_timeout'))
        self.assertLess(time.monotonic()-started, 3)
        self.assertFalse(self.renderer.lock.locked())
        self.assertFalse((self.root / 'data' / self.payload['id']).exists())

    def test_original_generator_artifacts_idempotency_and_cleanup(self):
        before = {name: hashlib.sha256((self.source / name).read_bytes()).hexdigest() for name in SOURCE_FILES}
        status, result, _ = self.request('POST', '/render', self.payload)
        self.assertEqual(status, 200, result)
        self.assertEqual(result['id'], self.payload['id'])
        self.assertEqual(result['status'], 'ready')
        self.assertEqual(result['params']['cards'], self.payload['cards'])
        self.assertEqual(result['params']['seed'], self.payload['seed'])
        self.assertEqual(result['request_id'], self.payload['request_id'])
        self.assertEqual(result['generator'], 'local_garden')
        self.assertEqual(result['print_status'], 'not_submitted')
        prefix = '/files/'+self.payload['id']+'/'
        for name, magic in (('artwork.png', b'\x89PNG'), ('artwork.webp', b'RIFF'), ('artwork.pdf', b'%PDF')):
            status, contents, _ = self.request('GET', prefix+name)
            self.assertEqual(status, 200)
            self.assertTrue(contents.startswith(magic))
            self.assertGreater(len(contents), 1000)
        status, particles, _ = self.request('GET', prefix+'particles.json')
        self.assertEqual(status, 200)
        self.assertEqual(len(particles['initial']), len(particles['final']))
        self.assertGreater(len(particles['initial']), 0)
        second_status, second, _ = self.request('POST', '/render', self.payload)
        self.assertEqual(second_status, 200)
        self.assertEqual(second, result)
        conflicting = copy.deepcopy(self.payload)
        conflicting['cards'] = [2, 3]
        self.assertEqual(self.request('POST', '/render', conflicting)[0], 409)
        self.assertEqual(self.request('DELETE', '/files/'+self.payload['id'])[0], 200)
        self.assertEqual(self.request('GET', prefix+'artwork.png')[0], 404)
        self.assertEqual(self.request('DELETE', '/files/'+self.payload['id'])[0], 200)
        self.assertEqual(before, {name: hashlib.sha256((self.source / name).read_bytes()).hexdigest() for name in SOURCE_FILES})


if __name__ == '__main__':
    unittest.main()

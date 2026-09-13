"""Isolated queue tests: stub generation, temporary database, no live server or printing."""
import concurrent.futures
import http.client
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest


class GenerationQueueTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        # A copied module gives ROOT and the import-time database an isolated location.
        source = Path(__file__).with_name('server.py')
        module_path = Path(self.temp.name) / 'server.py'
        module_path.write_bytes(source.read_bytes())
        spec = importlib.util.spec_from_file_location('isolated_queue_server', module_path)
        self.server = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.server)
        self.release = threading.Event()
        self.changed = threading.Condition()
        self.active = self.peak = 0
        self.started = []
        self.finished = []
        self.server.generate = self.generate

    def tearDown(self):
        self.release.set()
        with self.server.GENERATION_READY:
            self.server.GENERATION_QUEUE.extend([None] * len(self.server.GENERATION_WORKERS))
            self.server.GENERATION_READY.notify_all()
        for worker in self.server.GENERATION_WORKERS:
            worker.join(10)
            self.assertFalse(worker.is_alive(), 'generation worker did not stop')
        self.temp.cleanup()

    def generate(self, jid):
        with self.changed:
            self.active += 1
            self.peak = max(self.peak, self.active)
            self.started.append(jid)
            self.changed.notify_all()
        try:
            if not self.release.wait(10):
                raise AssertionError('test generation was not released')
            job = self.server.get_job(jid)
            self.assertEqual(job['status'], 'generating')
            job.update(status='ready', image=f'/printer/jobs/{jid}/artwork.png')
            self.server.save(job)
        finally:
            with self.changed:
                self.active -= 1
                self.finished.append(jid)
                self.changed.notify_all()

    def wait_for(self, predicate):
        with self.changed:
            self.assertTrue(self.changed.wait_for(predicate, timeout=10), 'queue did not make progress')

    def create(self, key):
        return self.server.create({'cards': [1, 2], 'seed': 42, 'request_id': key})

    def row_count(self):
        with self.server.connect() as db:
            return db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0]

    def test_concurrent_duplicate_is_one_job_and_one_generation(self):
        barrier = threading.Barrier(24)
        def request(_):
            barrier.wait(timeout=10)
            return self.create('same-user-same-request')
        with concurrent.futures.ThreadPoolExecutor(max_workers=24) as pool:
            jobs = list(pool.map(request, range(24)))
        self.assertEqual(len({job['id'] for job in jobs}), 1)
        self.assertEqual(self.row_count(), 1)
        self.wait_for(lambda: len(self.started) == 1)
        self.assertEqual(self.peak, 1)
        self.release.set()
        self.wait_for(lambda: len(self.finished) == 1)
        self.assertEqual(self.create('same-user-same-request')['status'], 'ready')
        self.assertEqual(len(self.started), 1)

    def test_two_workers_thirty_waiting_and_http_429_without_insertion(self):
        active = [self.create(f'active-user-{i}') for i in range(2)]
        self.wait_for(lambda: len(self.started) == 2)
        def request(i):
            try:
                return self.create(f'online-user-{i}')
            except self.server.GenerationQueueFull:
                return None
        with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
            results = list(pool.map(request, range(60)))
        queued = [job for job in results if job is not None]
        self.assertEqual(len(queued), 30)
        self.assertEqual(sum(job is None for job in results), 30)
        self.assertEqual(self.row_count(), 32)
        self.assertEqual(len({job['id'] for job in active + queued}), 32)
        self.assertEqual(sorted(self.server.get_job(job['id'])['queue_position'] for job in queued), list(range(1, 31)))
        retry = self.create(queued[0]['request_id'])
        self.assertEqual(retry['id'], queued[0]['id'])
        self.assertEqual(self.row_count(), 32)

        httpd = self.server.ThreadingHTTPServer(('127.0.0.1', 0), self.server.Handler)
        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        connection = http.client.HTTPConnection('127.0.0.1', httpd.server_port, timeout=5)
        try:
            connection.request('POST', '/api/jobs', json.dumps({'cards': [1], 'request_id': 'full-retry'}), {'Content-Type': 'application/json'})
            response = connection.getresponse()
            body = json.loads(response.read())
            self.assertEqual(response.status, 429)
            self.assertIn('队列已满', body['error'])
            self.assertEqual(body['retry_after'], 5)
            self.assertEqual(self.row_count(), 32)
            with self.server.connect() as db:
                self.assertIsNone(db.execute('SELECT id FROM jobs WHERE request_id=?', ('full-retry',)).fetchone())
        finally:
            connection.close()
            httpd.shutdown()
            httpd.server_close()
            thread.join(5)

        self.release.set()
        self.wait_for(lambda: len(self.finished) == 32)
        retried = self.create('full-retry')
        self.wait_for(lambda: len(self.finished) == 33)
        self.assertEqual(self.peak, 2)
        self.assertEqual(len(set(self.started)), 33)
        self.assertEqual(self.server.get_job(retried['id'])['status'], 'ready')
        for job in active + queued:
            actual = self.server.get_job(job['id'])
            self.assertEqual(actual['status'], 'ready')
            self.assertEqual(actual['request_id'], job['request_id'])
            self.assertEqual(actual['image'], f'/printer/jobs/{job["id"]}/artwork.png')
            self.assertNotIn('queue_position', actual)

    def test_restart_fails_queued_and_generating_without_restarting_prints(self):
        fixtures = [
            {'id': 'old-queued', 'request_id': 'queued-key', 'status': 'queued', 'print_status': 'not_submitted'},
            {'id': 'old-generating', 'request_id': 'generating-key', 'status': 'generating', 'print_status': 'not_submitted'},
            {'id': 'old-ready', 'request_id': 'ready-key', 'status': 'ready', 'print_status': 'submitting'},
        ]
        with self.server.connect() as db:
            for job in fixtures:
                db.execute('INSERT INTO jobs (id,request_id,data) VALUES (?,?,?)', (job['id'], job['request_id'], json.dumps(job)))
        self.server.recover_interrupted_jobs()
        for job in fixtures[:2]:
            actual = self.server.get_job(job['id'])
            self.assertEqual(actual['status'], 'failed')
            self.assertTrue(actual['retryable'])
            self.assertIn('重启', actual['error'])
            self.assertEqual(self.create(job['request_id'])['id'], job['id'])
        actual = self.server.get_job('old-ready')
        self.assertEqual(actual['status'], 'ready')
        self.assertEqual(actual['print_status'], 'uncertain')
        self.assertEqual(self.started, [])
        self.release.set()
        retried = self.create('new-request-after-restart')
        self.wait_for(lambda: len(self.finished) == 1)
        self.assertEqual(self.server.get_job(retried['id'])['status'], 'ready')

    def test_unexpected_generator_error_does_not_kill_worker(self):
        def generate(jid):
            if self.server.get_job(jid)['request_id'] == 'fail-once':
                raise RuntimeError('stub generation failure')
            self.generate(jid)
        self.server.generate = generate
        failed = self.create('fail-once')
        deadline = time.monotonic() + 5
        while self.server.get_job(failed['id'])['status'] != 'failed' and time.monotonic() < deadline:
            time.sleep(.01)
        self.assertEqual(self.server.get_job(failed['id'])['status'], 'failed')
        self.assertTrue(self.server.get_job(failed['id'])['retryable'])
        jobs = [self.create(f'after-failure-{i}') for i in range(2)]
        self.wait_for(lambda: len(self.started) == 2)
        self.assertEqual(self.peak, 2)
        self.release.set()
        self.wait_for(lambda: len(self.finished) == 2)
        self.assertTrue(all(self.server.get_job(job['id'])['status'] == 'ready' for job in jobs))


if __name__ == '__main__':
    unittest.main()

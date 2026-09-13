"""Run with: python3 -m unittest discover -s printer -p test_entry_sessions.py"""
import concurrent.futures
import http.client
import json
import threading
import unittest
from unittest.mock import patch
from xml.etree import ElementTree
from entry_sessions import EntrySessions, SessionError, TTL
import server


class SessionTests(unittest.TestCase):
    def setUp(self):
        self.now = 1000
        self.sessions = EntrySessions(clock=lambda: self.now)
        self.created = self.sessions.create('192.168.1.8', 8765)
        self.sid = self.created['id']
        self.owner = self.created['owner_token']
        self.phone = 'phone-one-123'

    def assert_error(self, status, operation, *args):
        with self.assertRaises(SessionError) as caught:
            operation(*args)
        self.assertEqual(caught.exception.status, status)

    def test_one_card_complete_and_retries(self):
        self.assertEqual(self.created['request_id'], 'entry-' + self.sid)
        self.assertFalse(self.created['handoff_ready'])
        self.assertIn(self.sid, self.created['phone_url'])
        joined = self.sessions.join(self.sid, self.phone)
        self.assertEqual(joined, self.sessions.join(self.sid, self.phone))
        submitted = self.sessions.cards(self.sid, self.phone, [12])
        self.assertEqual(submitted['status'], 'submitted')
        self.assertEqual(submitted['cards'], [12])
        self.assertTrue(submitted['handoff_ready'])
        self.assertIn(submitted['ai_card'], range(1, 12))
        self.assertEqual(submitted, self.sessions.cards(self.sid, self.phone, [12]))
        accepted = self.sessions.ack(self.sid, self.owner)
        self.assertEqual(accepted['status'], 'accepted')
        self.assertEqual(accepted, self.sessions.ack(self.sid, self.owner))
        self.assertEqual(accepted, self.sessions.cards(self.sid, self.phone, [12]))
        self.assertNotIn('owner_token', self.sessions.get(self.sid))
        self.assertNotIn('participant_id', self.sessions.get(self.sid))
        closed = self.sessions.close(self.sid, self.owner)
        self.assertEqual(closed['status'], 'closed')
        self.assertEqual(closed, self.sessions.close(self.sid, self.owner))
        self.assert_error(410, self.sessions.join, self.sid, self.phone)

    def test_screen_focus_rejects_wrong_tag_without_claiming_round(self):
        focused = self.sessions.focus(self.sid, self.owner, 12)
        self.assertIsNone(focused['ai_card'])
        self.assert_error(409, self.sessions.join, self.sid, 'wrong-phone-123', 11)
        joined = self.sessions.join(self.sid, self.phone, 12)
        self.assertEqual((joined['status'], joined['selected_card']), ('selected', 12))
        self.assert_error(409, self.sessions.select, self.sid, self.phone, 11)
        self.assert_error(409, self.sessions.select, self.sid, self.phone, None)
        self.assert_error(409, self.sessions.cards, self.sid, self.phone, [11])

    def test_phone_and_screen_confirm_race_draws_ai_once(self):
        self.sessions.focus(self.sid, self.owner, 12)
        self.sessions.join(self.sid, self.phone, 12)
        with patch('entry_sessions.secrets.choice', return_value=7) as choose:
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                phone = pool.submit(self.sessions.cards, self.sid, self.phone, [12], True)
                screen = pool.submit(self.sessions.confirm, self.sid, self.owner)
                self.assertEqual(phone.result()['ai_card'], screen.result()['ai_card'])
            snapshot = self.sessions.confirm(self.sid, self.owner)
            self.assertTrue(snapshot['handoff_ready'])
            self.sessions.ack(self.sid, self.owner)
            self.assertEqual(self.sessions.cards(self.sid, self.phone, [12])['status'], 'accepted')
        choose.assert_called_once()
        self.assertEqual(snapshot['cards'], [12])
        self.assertEqual(snapshot['request_id'], self.created['request_id'])

    def test_screen_confirmation_requires_owner_and_focused_card(self):
        self.assert_error(403, self.sessions.focus, self.sid, 'wrong-owner', 12)
        self.assert_error(409, self.sessions.confirm, self.sid, self.owner)
        self.sessions.focus(self.sid, self.owner, 12)
        self.assert_error(403, self.sessions.confirm, self.sid, 'wrong-owner')
        self.sessions.confirm(self.sid, self.owner)
        self.assert_error(409, self.sessions.focus, self.sid, self.owner, 11)
        joined = self.sessions.join(self.sid, self.phone, 12)
        self.assertEqual(joined['status'], 'submitted')

    def test_ai_draw_excludes_human_and_never_repeats_on_retry(self):
        self.sessions.join(self.sid, self.phone)
        with patch('entry_sessions.secrets.choice', return_value=12) as choose:
            first = self.sessions.cards(self.sid, self.phone, [11])
            again = self.sessions.cards(self.sid, self.phone, [11])
            self.sessions.ack(self.sid, self.owner)
            accepted = self.sessions.cards(self.sid, self.phone, [11])
        choose.assert_called_once_with([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12])
        self.assertEqual(first['ai_card'], 12)
        self.assertEqual(again['ai_card'], 12)
        self.assertEqual(accepted['ai_card'], 12)

    def test_delayed_handoff_blocks_ack_without_redrawing_ai(self):
        self.sessions.join(self.sid, self.phone)
        with patch('entry_sessions.secrets.choice', return_value=12) as choose:
            submitted = self.sessions.cards(self.sid, self.phone, [11], True)
            self.assertFalse(submitted['handoff_ready'])
            self.now += 10
            self.assert_error(409, self.sessions.ack, self.sid, self.owner)
            self.assertEqual(self.sessions.get(self.sid), submitted)
            ready = self.sessions.handoff(self.sid, self.phone)
            self.assertTrue(ready['handoff_ready'])
            self.assertEqual(ready['status'], 'submitted')
            self.assertEqual(ready, self.sessions.handoff(self.sid, self.phone))
            accepted = self.sessions.ack(self.sid, self.owner)
            self.assertEqual(accepted, self.sessions.handoff(self.sid, self.phone))
            self.assertEqual(accepted['ai_card'], 12)
            choose.assert_called_once()

    def test_card_retries_cannot_bypass_or_reset_handoff(self):
        self.sessions.join(self.sid, self.phone)
        submitted = self.sessions.cards(self.sid, self.phone, [11], True)
        self.assertEqual(submitted, self.sessions.cards(self.sid, self.phone, [11]))
        self.assertEqual(submitted, self.sessions.cards(self.sid, self.phone, [11], False))
        self.assert_error(409, self.sessions.ack, self.sid, self.owner)
        ready = self.sessions.handoff(self.sid, self.phone)
        self.assertEqual(ready, self.sessions.cards(self.sid, self.phone, [11], True))
        legacy = self.sessions.create('192.168.1.8', 8765)
        self.sessions.join(legacy['id'], self.phone)
        self.sessions.cards(legacy['id'], self.phone, [11])
        self.assertTrue(self.sessions.cards(legacy['id'], self.phone, [11], True)['handoff_ready'])

    def test_handoff_requires_original_participant_and_confirmed_active_session(self):
        self.assert_error(409, self.sessions.handoff, self.sid, self.phone)
        self.sessions.join(self.sid, self.phone)
        self.assert_error(409, self.sessions.handoff, self.sid, self.phone)
        self.sessions.select(self.sid, self.phone, 11)
        self.assert_error(409, self.sessions.handoff, self.sid, self.phone)
        self.sessions.cards(self.sid, self.phone, [11], True)
        self.assert_error(409, self.sessions.handoff, self.sid, 'another-phone')
        self.assert_error(400, self.sessions.handoff, self.sid, None)
        self.assertFalse(self.sessions.get(self.sid)['handoff_ready'])
        self.now += TTL
        self.assert_error(410, self.sessions.handoff, self.sid, self.phone)
        self.sessions.close(self.sid, self.owner)
        self.assert_error(410, self.sessions.handoff, self.sid, self.phone)

    def test_handoff_required_is_strict_boolean(self):
        self.sessions.join(self.sid, self.phone)
        with patch('entry_sessions.secrets.choice') as choose:
            for value in (None, 0, 1, 'true', 'false', 0.0, [], {}):
                self.assert_error(400, self.sessions.cards, self.sid, self.phone, [11], value)
            choose.assert_not_called()
        self.assertEqual(self.sessions.get(self.sid)['status'], 'joined')

    def test_preview_reselect_and_clear_do_not_draw_ai(self):
        self.assertIsNone(self.created['selected_card'])
        self.assert_error(409, self.sessions.select, self.sid, self.phone, 11)
        self.sessions.join(self.sid, self.phone)
        with patch('entry_sessions.secrets.choice') as choose:
            first = self.sessions.select(self.sid, self.phone, 11)
            self.assertEqual((first['status'], first['selected_card']), ('selected', 11))
            self.assertEqual(first, self.sessions.select(self.sid, self.phone, 11))
            self.assertEqual(self.sessions.select(self.sid, self.phone, 12)['selected_card'], 12)
            cleared = self.sessions.select(self.sid, self.phone, None)
        choose.assert_not_called()
        self.assertEqual((cleared['status'], cleared['selected_card']), ('joined', None))
        self.assertEqual(cleared['cards'], [])
        self.assertIsNone(cleared['ai_card'])

    def test_preview_identity_validation_and_submission_lock(self):
        self.sessions.join(self.sid, self.phone)
        self.assert_error(409, self.sessions.select, self.sid, 'other-phone', 11)
        for card in (0, 13, True, '11', 11.0, [11], {}):
            self.assert_error(400, self.sessions.select, self.sid, self.phone, card)
        self.sessions.select(self.sid, self.phone, 11)
        with patch('entry_sessions.secrets.choice') as choose:
            self.assert_error(409, self.sessions.cards, self.sid, self.phone, [12])
        choose.assert_not_called()
        submitted = self.sessions.cards(self.sid, self.phone, [11])
        self.assertEqual(submitted['selected_card'], 11)
        for card in (11, 12, None):
            self.assert_error(409, self.sessions.select, self.sid, self.phone, card)
        self.sessions.ack(self.sid, self.owner)
        self.assert_error(409, self.sessions.select, self.sid, self.phone, 11)
        self.assertEqual(self.sessions.get(self.sid)['ai_card'], submitted['ai_card'])

    def test_claim_and_card_are_locked(self):
        self.assert_error(409, self.sessions.cards, self.sid, self.phone, [1])
        self.assert_error(409, self.sessions.ack, self.sid, self.owner)
        self.sessions.join(self.sid, self.phone)
        self.assert_error(409, self.sessions.join, self.sid, 'other-phone')
        self.assert_error(409, self.sessions.cards, self.sid, 'other-phone', [1])
        self.sessions.cards(self.sid, self.phone, [1])
        self.assert_error(409, self.sessions.cards, self.sid, self.phone, [2])
        self.assert_error(403, self.sessions.ack, self.sid, 'wrong-owner')
        self.assert_error(403, self.sessions.close, self.sid, None)
        self.assertEqual(self.sessions.get(self.sid)['cards'], [1])

    def test_current_requires_explicit_authorized_publish(self):
        self.assert_error(404, self.sessions.current)
        for token in (None, '', 'wrong-owner', 123):
            self.assert_error(403, self.sessions.publish, self.sid, token)
        self.assert_error(404, self.sessions.current)
        published = self.sessions.publish(self.sid, self.owner)
        self.assertEqual(published, self.sessions.current())
        self.assertEqual(published, self.sessions.publish(self.sid, self.owner))
        self.assertNotIn('owner_token', published)
        self.assertNotIn('participant_id', published)
        unrelated = self.sessions.create('192.168.1.8', 8765)
        self.assert_error(403, self.sessions.publish, unrelated['id'], self.owner)
        self.assertEqual(self.sessions.current()['id'], self.sid)

    def test_republishing_does_not_rebind_existing_phone_or_draw_ai(self):
        self.sessions.publish(self.sid, self.owner)
        self.sessions.join(self.sid, self.phone)
        self.sessions.select(self.sid, self.phone, 11)
        replacement = self.sessions.create('192.168.1.8', 8765)
        with patch('entry_sessions.secrets.choice') as choose:
            self.sessions.publish(replacement['id'], replacement['owner_token'])
            self.assertEqual(self.sessions.current()['id'], replacement['id'])
            self.assertEqual(self.sessions.get(self.sid)['selected_card'], 11)
            choose.assert_not_called()
        submitted = self.sessions.cards(self.sid, self.phone, [11])
        self.assertEqual(submitted['id'], self.sid)
        self.assertEqual(self.sessions.current()['status'], 'waiting')
        self.assertEqual(self.sessions.current()['cards'], [])
        self.assertIsNone(self.sessions.current()['ai_card'])
        self.sessions.close(self.sid, self.owner)
        self.assertEqual(self.sessions.current()['id'], replacement['id'])

    def test_closed_current_does_not_fall_back_to_other_session(self):
        self.sessions.publish(self.sid, self.owner)
        replacement = self.sessions.create('192.168.1.8', 8765)
        self.sessions.publish(replacement['id'], replacement['owner_token'])
        self.sessions.close(replacement['id'], replacement['owner_token'])
        self.assert_error(410, self.sessions.current)
        self.assert_error(410, self.sessions.publish, replacement['id'], replacement['owner_token'])
        self.assertEqual(self.sessions.get(self.sid)['status'], 'waiting')

    def test_publish_does_not_extend_ttl_or_revive_expired_current(self):
        self.sessions.publish(self.sid, self.owner)
        self.now += TTL - 1
        self.sessions.publish(self.sid, self.owner)
        self.now += 1
        self.assert_error(410, self.sessions.current)
        self.assert_error(410, self.sessions.publish, self.sid, self.owner)
        self.sessions.create('192.168.1.8', 8765)
        self.assert_error(410, self.sessions.current)
        self.now += TTL
        self.assert_error(404, self.sessions.current)

    def test_late_participant_gets_full_ttl_for_join_submit_and_ack(self):
        self.sessions.publish(self.sid, self.owner)
        self.now = self.created['expires_at'] - 1
        joined = self.sessions.join(self.sid, self.phone)
        self.assertEqual(joined['expires_at'], self.now + TTL)
        self.now = self.created['expires_at']
        self.assertEqual(self.sessions.current()['status'], 'joined')
        self.now = joined['expires_at'] - 1
        submitted = self.sessions.cards(self.sid, self.phone, [5])
        self.assertEqual(submitted['expires_at'], self.now + TTL)
        self.now = submitted['expires_at'] - 1
        accepted = self.sessions.ack(self.sid, self.owner)
        self.assertEqual(accepted['expires_at'], self.now + TTL)
        self.assertEqual(accepted['request_id'], self.created['request_id'])
        self.assertEqual(accepted['ai_card'], submitted['ai_card'])
        self.now = accepted['expires_at'] - 1
        self.assertEqual(self.sessions.current()['status'], 'accepted')
        self.now += 1
        self.assert_error(410, self.sessions.current)
        self.now += TTL
        self.assert_error(404, self.sessions.get, self.sid)

    def test_first_screen_confirmation_renews_submission_lease(self):
        self.sessions.focus(self.sid, self.owner, 5)
        self.now = self.created['expires_at'] - 1
        submitted = self.sessions.confirm(self.sid, self.owner)
        self.assertEqual(submitted['expires_at'], self.now + TTL)
        self.now += 1
        self.assertEqual(self.sessions.confirm(self.sid, self.owner), submitted)
        # A phone joining an already submitted screen round cannot prolong it.
        self.assertEqual(self.sessions.join(self.sid, self.phone, 5), submitted)
        self.now = submitted['expires_at'] - 1
        accepted = self.sessions.ack(self.sid, self.owner)
        self.assertEqual(accepted['expires_at'], self.now + TTL)

    def test_retries_and_reads_do_not_extend_active_leases(self):
        self.sessions.publish(self.sid, self.owner)
        self.now += 10
        joined = self.sessions.join(self.sid, self.phone)
        self.now += 10
        self.assertEqual(self.sessions.join(self.sid, self.phone), joined)
        self.assertEqual(self.sessions.publish(self.sid, self.owner), joined)
        self.assertEqual(self.sessions.get(self.sid), joined)
        self.assertEqual(self.sessions.current(), joined)
        submitted = self.sessions.cards(self.sid, self.phone, [5])
        self.now += 10
        self.assertEqual(self.sessions.cards(self.sid, self.phone, [5]), submitted)
        self.assertEqual(self.sessions.join(self.sid, self.phone), submitted)
        self.assertEqual(self.sessions.publish(self.sid, self.owner), submitted)
        accepted = self.sessions.ack(self.sid, self.owner)
        self.now += 10
        self.assertEqual(self.sessions.ack(self.sid, self.owner), accepted)
        self.assertEqual(self.sessions.cards(self.sid, self.phone, [5]), accepted)
        self.assertEqual(self.sessions.join(self.sid, self.phone), accepted)

    def test_rejected_participants_and_cards_do_not_renew_lease(self):
        joined = self.sessions.join(self.sid, self.phone)
        self.now += 10
        self.assert_error(409, self.sessions.join, self.sid, 'other-phone')
        self.assert_error(409, self.sessions.cards, self.sid, 'other-phone', [5])
        self.assert_error(403, self.sessions.ack, self.sid, 'wrong-owner')
        self.sessions.select(self.sid, self.phone, 5)
        self.assert_error(409, self.sessions.cards, self.sid, self.phone, [6])
        self.assertEqual(self.sessions.get(self.sid)['expires_at'], joined['expires_at'])

    def test_stage_transitions_cannot_revive_closed_or_expired_leases(self):
        for operation in ('join', 'cards', 'confirm', 'ack'):
            for terminal in ('closed', 'expired'):
                with self.subTest(operation=operation, terminal=terminal):
                    created = self.sessions.create('192.168.1.8', 8765)
                    sid, owner = created['id'], created['owner_token']
                    if operation in ('cards', 'ack'):
                        self.sessions.join(sid, self.phone)
                    if operation == 'confirm':
                        self.sessions.focus(sid, owner, 5)
                    if operation == 'ack':
                        self.sessions.cards(sid, self.phone, [5])
                    deadline = self.sessions.get(sid)['expires_at']
                    if terminal == 'closed':
                        self.sessions.close(sid, owner)
                    else:
                        self.now = deadline
                    args = {'join': (self.phone,), 'cards': (self.phone, [5]),
                            'confirm': (owner,), 'ack': (owner,)}[operation]
                    self.assert_error(410, getattr(self.sessions, operation), sid, *args)
                    snapshot = self.sessions.get(sid)
                    self.assertEqual(snapshot['expires_at'], deadline)
                    self.assertEqual(snapshot['status'], terminal)

    def test_invalid_cards_and_participant(self):
        self.sessions.join(self.sid, self.phone)
        for cards in (None, [], [0], [13], [True], ['1'], [1.0], [1, 2], [1, 1], '1', {'card': 1}):
            with self.subTest(cards=cards):
                self.assert_error(400, self.sessions.cards, self.sid, self.phone, cards)
        for participant in (None, '', 'short', 'invalid spaces', 123):
            self.assert_error(400, self.sessions.join, self.sid, participant)
        self.assertEqual(self.sessions.get(self.sid)['status'], 'joined')

    def test_expiry_and_cleanup(self):
        self.sessions.join(self.sid, self.phone)
        self.now += TTL
        self.assertEqual(self.sessions.get(self.sid)['status'], 'expired')
        self.assert_error(410, self.sessions.select, self.sid, self.phone, 1)
        self.assert_error(410, self.sessions.cards, self.sid, self.phone, [1])
        self.assert_error(410, self.sessions.qr, self.sid)
        self.now += TTL
        self.sessions.create('192.168.1.8', 8765)
        self.assertNotIn(self.sid, self.sessions.sessions)
        self.assert_error(404, self.sessions.get, self.sid)

    def test_no_lan_does_not_make_loopback_qr(self):
        unavailable = self.sessions.create(None, 8765)
        self.assertIsNone(unavailable['phone_url'])
        self.assertIsNone(unavailable['qr_url'])
        self.assertTrue(unavailable['error'])
        self.assert_error(503, self.sessions.qr, unavailable['id'])

    def test_actual_qr_matrix_and_quiet_zone(self):
        svg = ElementTree.fromstring(self.sessions.qr(self.sid))
        size = int(svg.attrib['viewBox'].split()[-1])
        self.assertGreater(size, 29)
        path = svg.find('{http://www.w3.org/2000/svg}path').attrib['d']
        self.assertTrue(path.startswith('M4,4'))
        self.assertGreater(path.count('M'), 200)

    def test_simultaneous_phones_have_one_winner(self):
        def join(participant):
            try:
                return self.sessions.join(self.sid, participant)['status']
            except SessionError as error:
                return error.status
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(join, ['phone-first', 'phone-second']))
        self.assertCountEqual(results, ['joined', 409])

    def test_simultaneous_distinct_submissions_do_not_overwrite(self):
        self.sessions.join(self.sid, self.phone)
        def submit(card):
            try:
                return self.sessions.cards(self.sid, self.phone, [card])['cards'][0]
            except SessionError as error:
                return error.status
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(submit, [1, 12]))
        self.assertEqual(results.count(409), 1)
        self.assertEqual(self.sessions.get(self.sid)['cards'], [next(value for value in results if value != 409)])


class HttpBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.local = True
        test = self
        class Handler(server.Handler):
            def is_local(self): return test.local
            def log_message(self, *args): pass
        self.patches = [patch.object(server, 'SESSIONS', EntrySessions()),
                        patch.object(server, 'LAN_ADDRESS', '192.168.1.8'),
                        patch.object(server, 'lan_address', return_value='192.168.1.8')]
        for patched in self.patches: patched.start()
        self.http = server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.http.server_port
        self.created = self.request('POST', '/api/sessions', {})[1]
        self.base = '/api/sessions/' + self.created['id']

    def tearDown(self):
        self.http.shutdown()
        self.http.server_close()
        self.thread.join()
        for patched in reversed(self.patches): patched.stop()

    def request(self, method, path, data=None, host=None, origin=None):
        conn = http.client.HTTPConnection('127.0.0.1', self.port)
        host = host or f'127.0.0.1:{self.port}'
        headers = {'Host': host}
        if origin is not None: headers['Origin'] = origin
        if data is not None: headers['Content-Type'] = 'application/json'
        conn.request(method, path, body=json.dumps(data) if data is not None else None, headers=headers)
        response = conn.getresponse()
        body = response.read()
        result = json.loads(body) if response.getheader('Content-Type', '').startswith('application/json') else body
        status = response.status
        conn.close()
        return status, result

    def test_phone_can_join_and_submit_one_card(self):
        self.local = False
        host = f'192.168.1.8:{self.port}'
        status, joined = self.request('POST', self.base + '/join', {'participant_id': 'phone-1234'}, host, 'http://' + host)
        self.assertEqual((status, joined['status']), (200, 'joined'))
        status, selected = self.request('POST', self.base + '/select', {'participant_id': 'phone-1234', 'card': 11}, host, 'http://' + host)
        self.assertEqual((status, selected['status'], selected['selected_card']), (200, 'selected', 11))
        self.assertIsNone(selected['ai_card'])
        self.assertEqual(selected['cards'], [])
        status, submitted = self.request('POST', self.base + '/cards', {'participant_id': 'phone-1234', 'cards': [11]}, host, 'http://' + host)
        self.assertEqual((status, submitted['cards']), (200, [11]))
        self.assertNotIn('owner_token', submitted)
        self.assertEqual(self.request('GET', self.base)[0], 200)
        status, svg = self.request('GET', self.base + '/qr.svg')
        self.assertEqual(status, 200)
        self.assertTrue(svg.startswith(b'<svg'))

    def test_screen_focus_and_confirm_http_authorization(self):
        owner = {'owner_token': self.created['owner_token']}
        self.assertEqual(self.request('POST', self.base + '/focus', {**owner, 'card': 12})[0], 200)
        self.assertEqual(self.request('POST', self.base + '/confirm', {})[0], 403)
        self.local = False
        host = f'192.168.1.8:{self.port}'
        self.assertEqual(self.request('POST', self.base + '/confirm', owner, host, 'http://' + host)[0], 403)
        self.assertEqual(self.request('POST', self.base + '/join', {'participant_id': 'wrong-phone-123', 'card': 11}, host, 'http://' + host)[0], 409)
        self.local = True
        status, confirmed = self.request('POST', self.base + '/confirm', owner)
        self.assertEqual((status, confirmed['cards'], confirmed['handoff_ready']), (200, [12], True))

    def test_remote_write_and_file_boundaries(self):
        self.local = False
        for path in ('/api/sessions', self.base + '/publish', self.base + '/ack', self.base + '/close', '/api/jobs', '/api/dice', '/api/recording', '/api/jobs/example/print'):
            with self.subTest(path=path):
                self.assertEqual(self.request('POST', path, {})[0], 403)
        for path in ('/', '/prototype-3d.js', '/printer/server.py', '/printer/jobs/example/artwork.png', '/api/health', '/api/printers', '/api/jobs/example', '/phone.html/../printer/server.py'):
            self.assertEqual(self.request('GET', path)[0], 403)
            self.assertEqual(self.request('HEAD', path)[0], 403)
        self.assertEqual(self.request('GET', '/game-cards.js')[0], 200)
        self.assertEqual(self.request('GET', '/nfc-tap.html')[0], 200)
        self.assertEqual(self.request('HEAD', '/nfc-tap.html')[0], 200)
        self.assertEqual(self.request('GET', '/assets/print-cards/12-seed.webp')[0], 200)

    def test_publish_is_owner_authorized_and_local_only(self):
        owner = {'owner_token': self.created['owner_token']}
        self.assertEqual(self.request('POST', self.base + '/publish', {})[0], 403)
        self.assertEqual(self.request('GET', '/api/entry/current')[0], 404)
        self.local = False
        self.assertEqual(self.request('POST', self.base + '/publish', owner)[0], 403)
        self.local = True
        status, published = self.request('POST', self.base + '/publish', owner)
        self.assertEqual((status, published['id']), (200, self.created['id']))
        self.assertNotIn('owner_token', published)
        self.assertNotIn('participant_id', published)

    def test_current_is_phone_readable_but_closed_or_expired_is_gone(self):
        self.local = False
        self.assertEqual(self.request('GET', '/api/entry/current')[0], 404)
        self.local = True
        self.request('POST', self.base + '/publish', {'owner_token': self.created['owner_token']})
        self.local = False
        status, current = self.request('GET', '/api/entry/current')
        self.assertEqual((status, current['id']), (200, self.created['id']))
        self.assertNotIn('owner_token', current)
        self.assertNotIn('participant_id', current)
        self.local = True
        self.request('POST', self.base + '/close', {'owner_token': self.created['owner_token']})
        self.local = False
        self.assertEqual(self.request('GET', '/api/entry/current')[0], 410)
        self.local = True
        next_session = self.request('POST', '/api/sessions', {})[1]
        self.request('POST', '/api/sessions/' + next_session['id'] + '/publish', {'owner_token': next_session['owner_token']})
        with patch.object(server.SESSIONS, 'clock', return_value=next_session['expires_at']):
            self.local = False
            self.assertEqual(self.request('GET', '/api/entry/current')[0], 410)

    def test_nfc_join_only_draws_ai_on_confirm_and_never_prints(self):
        self.request('POST', self.base + '/publish', {'owner_token': self.created['owner_token']})
        self.local = False
        with patch.object(server, 'create') as artwork, patch.object(server, 'print_job') as printing, patch('entry_sessions.secrets.choice', return_value=12) as choose:
            current = self.request('GET', '/api/entry/current')[1]
            bound = '/api/sessions/' + current['id']
            self.assertEqual(self.request('POST', bound + '/join', {'participant_id': 'nfc-phone-123'})[0], 200)
            status, joined = self.request('GET', bound)
            self.assertEqual((status, joined['status']), (200, 'joined'))
            self.assertIsNone(joined['selected_card'])
            self.assertIsNone(joined['ai_card'])
            choose.assert_not_called()
            status, submitted = self.request('POST', bound + '/cards', {'participant_id': 'nfc-phone-123', 'cards': [11]})
            self.assertEqual((status, submitted['ai_card']), (200, 12))
            self.assertEqual(self.request('POST', bound + '/cards', {'participant_id': 'nfc-phone-123', 'cards': [11]})[1], submitted)
            choose.assert_called_once()
            artwork.assert_not_called()
            printing.assert_not_called()

    def test_phone_handoff_must_arrive_before_owner_ack(self):
        participant = {'participant_id': 'nfc-phone-123'}
        owner = {'owner_token': self.created['owner_token']}
        self.local = False
        self.request('POST', self.base + '/join', participant)
        self.assertEqual(self.request('POST', self.base + '/handoff', participant)[0], 409)
        body = {**participant, 'cards': [11], 'handoff_required': 'true'}
        self.assertEqual(self.request('POST', self.base + '/cards', body)[0], 400)
        body['handoff_required'] = True
        status, submitted = self.request('POST', self.base + '/cards', body)
        self.assertEqual(status, 200)
        self.assertFalse(submitted['handoff_ready'])
        self.assertEqual(self.request('POST', self.base + '/cards', {**participant, 'cards': [11]})[1], submitted)
        self.assertEqual(self.request('POST', self.base + '/handoff', {'participant_id': 'wrong-phone'})[0], 409)
        self.local = True
        self.assertEqual(self.request('POST', self.base + '/ack', owner)[0], 409)
        self.local = False
        status, ready = self.request('POST', self.base + '/handoff', participant)
        self.assertEqual(status, 200)
        self.assertTrue(ready['handoff_ready'])
        self.assertEqual(ready['ai_card'], submitted['ai_card'])
        self.assertEqual(self.request('POST', self.base + '/handoff', participant)[1], ready)
        self.assertEqual(self.request('POST', self.base + '/ack', owner)[0], 403)
        self.local = True
        self.assertEqual(self.request('POST', self.base + '/ack', owner)[1]['status'], 'accepted')

    def test_origin_host_and_local_private_file_checks(self):
        self.assertEqual(self.request('POST', '/api/sessions', {}, origin='https://unrelated.example')[0], 403)
        self.assertEqual(self.request('POST', '/api/sessions', {}, host=f'evil.example:{self.port}', origin=f'http://evil.example:{self.port}')[0], 403)
        self.assertEqual(self.request('GET', self.base, host=f'192.168.2.9:{self.port}')[0], 403)
        for method in ('GET', 'HEAD'):
            self.assertEqual(self.request(method, '/printer/server.py')[0], 403)
            self.assertEqual(self.request(method, '/.git/config')[0], 403)
        self.assertEqual(self.request('GET', '/api/health')[0], 200)
        self.assertTrue(server.Handler.is_local(type('Peer', (), {'client_address': ('127.0.0.1', 1000)})()))
        self.assertFalse(server.Handler.is_local(type('Peer', (), {'client_address': ('192.168.1.9', 1000)})()))


if __name__ == '__main__':
    unittest.main()

"""Short-lived, one-participant card draws shared by the phone and exhibition screen."""
import ipaddress
import re
import secrets
import socket
import subprocess
import sys
import threading
import time
from reportlab.graphics.barcode.qr import QrCodeWidget

TTL = 15 * 60
LAN_NETWORKS = tuple(ipaddress.ip_network(value) for value in ('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'))


def lan_address():
    def usable(address):
        try:
            return address if any(ipaddress.ip_address(address) in network for network in LAN_NETWORKS) else None
        except ValueError:
            return None
    # A VPN can intercept the UDP probe. On the exhibition Mac, prefer the actual default-route interface.
    if sys.platform == 'darwin':
        try:
            route = subprocess.run(['/sbin/route', '-n', 'get', 'default'], capture_output=True, text=True, timeout=2)
            interface = re.search(r'^\s*interface:\s*([A-Za-z0-9_.-]+)\s*$', route.stdout, re.M)
            if interface:
                result = subprocess.run(['/usr/sbin/ipconfig', 'getifaddr', interface.group(1)], capture_output=True, text=True, timeout=2)
                address = usable(result.stdout.strip())
                if address:
                    return address
        except (OSError, subprocess.TimeoutExpired):
            pass
    # UDP connect selects the default route without sending a packet.
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(('8.8.8.8', 80))
            address = sock.getsockname()[0]
        return usable(address)
    except OSError:
        return None


class SessionError(ValueError):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


class EntrySessions:
    def __init__(self, clock=time.time):
        self.clock = clock
        self.sessions = {}
        self.current_id = None
        self.lock = threading.RLock()

    def _cleanup(self):
        now = self.clock()
        for sid, session in list(self.sessions.items()):
            # Keep a short expired snapshot so clients can explain why the QR stopped working.
            if now >= session['expires_at'] + TTL:
                del self.sessions[sid]

    def _get(self, sid):
        self._cleanup()
        session = self.sessions.get(sid)
        if session is None:
            raise SessionError('这次抽卡已失效，请重新扫描大屏二维码。', 404)
        if self.clock() >= session['expires_at'] and session['status'] != 'closed':
            session['status'] = 'expired'
        return session

    @staticmethod
    def _snapshot(session):
        return {key: list(value) if isinstance(value, list) else value for key, value in session.items()
                if key not in ('owner_token', 'participant_id')}

    @staticmethod
    def _active(session):
        if session['status'] in ('closed', 'expired'):
            raise SessionError('这次抽卡已结束，请重新扫描大屏二维码。', 410)

    @staticmethod
    def _participant(value):
        if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_-]{8,128}', value):
            raise SessionError('手机参与编号无效，请刷新后重试。')
        return value

    @staticmethod
    def _owner(session, token):
        if not isinstance(token, str) or not secrets.compare_digest(token, session['owner_token']):
            raise SessionError('主控身份无效。', 403)

    def create(self, address, port):
        with self.lock:
            self._cleanup()
            sid = secrets.token_urlsafe(18)
            session = {'id': sid, 'owner_token': secrets.token_urlsafe(24), 'participant_id': None,
                       'phone_url': f'http://{address}:{port}/phone.html?session={sid}' if address else None,
                       'qr_url': f'/api/sessions/{sid}/qr.svg' if address else None,
                       'expires_at': self.clock() + TTL, 'status': 'waiting', 'cards': [], 'selected_card': None, 'ai_card': None,
                       'request_id': f'entry-{sid}', 'handoff_ready': False}
            if not address:
                session['error'] = '未找到可供手机访问的局域网地址，请连接 Wi-Fi 后重试。'
            self.sessions[sid] = session
            return {**self._snapshot(session), 'owner_token': session['owner_token']}

    def get(self, sid):
        with self.lock:
            return self._snapshot(self._get(sid))

    def publish(self, sid, owner_token):
        with self.lock:
            session = self._get(sid)
            self._owner(session, owner_token)
            self._active(session)
            self.current_id = sid
            return self._snapshot(session)

    def current(self):
        with self.lock:
            if self.current_id is None:
                raise SessionError('电脑还未准备好接收卡片，请稍候再试。', 404)
            try:
                session = self._get(self.current_id)
                self._active(session)
            except SessionError as error:
                raise SessionError('电脑上的本轮抽卡已结束，请等待下一轮准备好后重新碰卡。', error.status) from error
            return self._snapshot(session)

    def join(self, sid, participant_id):
        participant_id = self._participant(participant_id)
        with self.lock:
            session = self._get(sid)
            self._active(session)
            if session['participant_id'] not in (None, participant_id):
                raise SessionError('已有另一位参与者开始抽卡，请等待下一次二维码。', 409)
            if session['participant_id'] is None:
                session.update(participant_id=participant_id, status='joined')
            return self._snapshot(session)

    def select(self, sid, participant_id, card):
        participant_id = self._participant(participant_id)
        if card is not None and (type(card) is not int or not 1 <= card <= 12):
            raise SessionError('请选择一张 01–12 号卡，或清空选择。')
        with self.lock:
            session = self._get(sid)
            self._active(session)
            if session['participant_id'] != participant_id:
                raise SessionError('请先用当前手机加入这次抽卡。', 409)
            if session['status'] in ('submitted', 'accepted'):
                raise SessionError('卡片已确认，不能重复更换。', 409)
            session.update(selected_card=card, status='selected' if card is not None else 'joined')
            return self._snapshot(session)

    def cards(self, sid, participant_id, cards, handoff_required=False):
        participant_id = self._participant(participant_id)
        if type(handoff_required) is not bool:
            raise SessionError('卡片交接标记必须是布尔值。')
        if (not isinstance(cards, list) or len(cards) != 1 or
                any(type(card) is not int or not 1 <= card <= 12 for card in cards)):
            raise SessionError('请选择一张 01–12 号卡。')
        with self.lock:
            session = self._get(sid)
            self._active(session)
            if session['participant_id'] != participant_id:
                raise SessionError('请先用当前手机加入这次抽卡。', 409)
            if session['status'] in ('submitted', 'accepted'):
                if session['cards'] != cards:
                    raise SessionError('卡片已确认，不能重复更换。', 409)
                return self._snapshot(session)
            if session['selected_card'] is not None and session['selected_card'] != cards[0]:
                raise SessionError('确认的卡片与当前选择不一致，请重新确认。', 409)
            # Draw the AI's card once, under the same lock as the participant's confirmed card.
            ai_card = secrets.choice([card for card in range(1, 13) if card != cards[0]])
            session.update(cards=list(cards), selected_card=cards[0], ai_card=ai_card,
                           status='submitted', handoff_ready=not handoff_required)
            return self._snapshot(session)

    def handoff(self, sid, participant_id):
        participant_id = self._participant(participant_id)
        with self.lock:
            session = self._get(sid)
            self._active(session)
            if session['participant_id'] != participant_id:
                raise SessionError('请先用当前手机加入这次抽卡。', 409)
            if session['status'] not in ('submitted', 'accepted'):
                raise SessionError('请先确认要送到电脑的卡片。', 409)
            session['handoff_ready'] = True
            return self._snapshot(session)

    def ack(self, sid, owner_token):
        with self.lock:
            session = self._get(sid)
            self._owner(session, owner_token)
            self._active(session)
            if session['status'] not in ('submitted', 'accepted'):
                raise SessionError('手机还未完成抽卡。', 409)
            if not session['handoff_ready']:
                raise SessionError('手机卡片还未完成交接，请稍候。', 409)
            session['status'] = 'accepted'
            return self._snapshot(session)

    def close(self, sid, owner_token):
        with self.lock:
            session = self._get(sid)
            self._owner(session, owner_token)
            session['status'] = 'closed'
            return self._snapshot(session)

    def qr(self, sid):
        with self.lock:
            session = self._get(sid)
            self._active(session)
            url = session['phone_url']
            if not url:
                raise SessionError(session['error'], 503)
        qr = QrCodeWidget(url)
        qr.qr.make()
        count = qr.qr.getModuleCount()
        path = ''.join(f'M{x + 4},{y + 4}h1v1h-1z' for y in range(count) for x in range(count) if qr.qr.isDark(y, x))
        return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {count + 8} {count + 8}" '
                f'shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/>'
                f'<path d="{path}" fill="#211f1b"/></svg>').encode()


SESSIONS = EntrySessions()

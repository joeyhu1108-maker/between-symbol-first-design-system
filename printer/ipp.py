#!/usr/bin/env python3
"""Minimal IPP/1.1 client for the driverless paper printer. Standard library only.

The print page goes to the printer's own IPP endpoint as a JPEG (on macOS: the IPP-over-USB
proxy that CUPS itself uses). CUPS no longer rasterizes the PDF into a 7.5 MB URF stream, and the
job state comes from the printer, so "printed" means the page is out rather than merely queued.

    python3 printer/ipp.py [QUEUE]             printer state, ink and loaded paper
    python3 printer/ipp.py [QUEUE] --dry-run   also Validate-Job and Create-Job + Cancel-Job (no paper)
"""
import http.client, itertools, os, re, select, struct, subprocess, sys, time
from urllib.parse import unquote, urlparse

OPERATION_GROUP, JOB_GROUP, END = 0x01, 0x02, 0x03
INTEGER, BOOLEAN, ENUM = 0x21, 0x22, 0x23
NAME, KEYWORD, URI, CHARSET, LANGUAGE, MIME = 0x42, 0x44, 0x45, 0x47, 0x48, 0x49
PRINT_JOB, VALIDATE_JOB, CREATE_JOB, CANCEL_JOB, GET_JOB_ATTRIBUTES, GET_PRINTER_ATTRIBUTES = 0x02, 0x04, 0x05, 0x08, 0x09, 0x0B
JOB_STATES = {3: 'pending', 4: 'pending-held', 5: 'processing', 6: 'processing-stopped', 7: 'canceled', 8: 'aborted', 9: 'completed'}
PRINTER_STATES = {3: 'idle', 4: 'processing', 5: 'stopped'}
USER = (NAME, 'requesting-user-name', 'between')
_request_ids = itertools.count(1)


class IPPError(Exception):
    """The printer answered but refused, or could not be found: safe to fall back to CUPS."""

class Unreachable(IPPError):
    """Nothing was sent (connection refused, e.g. the proxy port changed after a replug)."""

class Uncertain(IPPError):
    """The connection broke after the request started: the printer may already have the job."""


def _encode_attribute(tag, name, value):
    values = value if isinstance(value, (list, tuple)) else [value]
    out = b''
    for i, v in enumerate(values):
        if tag in (INTEGER, ENUM): raw = struct.pack('>i', v)
        elif tag == BOOLEAN: raw = b'\x01' if v else b'\x00'
        else: raw = str(v).encode()
        key = name.encode() if i == 0 else b''  # further values of a 1setOf carry an empty name
        out += struct.pack('>BH', tag, len(key)) + key + struct.pack('>H', len(raw)) + raw
    return out


def encode(operation, operation_attributes, job_attributes=()):
    body = struct.pack('>BBHI', 1, 1, operation, next(_request_ids))
    body += bytes([OPERATION_GROUP]) + b''.join(_encode_attribute(*a) for a in operation_attributes)
    if job_attributes: body += bytes([JOB_GROUP]) + b''.join(_encode_attribute(*a) for a in job_attributes)
    return body + bytes([END])


def decode(data):
    status, attributes, name, i = struct.unpack('>H', data[2:4])[0], {}, None, 8
    while i < len(data):
        tag = data[i]; i += 1
        if tag == END: break
        if tag < 0x10: continue  # delimiter for the next attribute group
        n = struct.unpack('>H', data[i:i + 2])[0]; i += 2; key = data[i:i + n].decode('utf-8', 'replace'); i += n
        v = struct.unpack('>H', data[i:i + 2])[0]; i += 2; raw = data[i:i + v]; i += v
        if tag in (INTEGER, ENUM) and v == 4: value = struct.unpack('>i', raw)[0]
        elif tag == BOOLEAN: value = raw == b'\x01'
        elif 0x40 <= tag < 0x50: value = raw.decode('utf-8', 'replace')
        else: value = raw
        if key:
            name = key; attributes[name] = value
        elif name is not None:
            previous = attributes[name]
            attributes[name] = (previous if isinstance(previous, list) else [previous]) + [value]
    return status, attributes


class Printer:
    def __init__(self, host, port, path):
        self.host, self.port, self.path = host, port, path.lstrip('/')

    @property
    def uri(self):
        return f'ipp://{self.host}:{self.port}/{self.path}'

    def request(self, operation, operation_attributes=(), job_attributes=(), document=b'', timeout=10):
        head = [(CHARSET, 'attributes-charset', 'utf-8'), (LANGUAGE, 'attributes-natural-language', 'en'), (URI, 'printer-uri', self.uri)]
        body = encode(operation, head + list(operation_attributes), job_attributes) + document
        connection = http.client.HTTPConnection(self.host, self.port, timeout=timeout)
        try:
            try: connection.connect()
            except OSError as error: raise Unreachable(f'无法连接打印机 {self.uri}: {error}') from error
            try:
                connection.request('POST', '/' + self.path, body, {'Content-Type': 'application/ipp'})
                response = connection.getresponse(); data = response.read()
            except (OSError, http.client.HTTPException) as error:
                raise Uncertain(f'与打印机的连接中断: {error}') from error
        finally:
            connection.close()
        if response.status != 200: raise IPPError(f'HTTP {response.status}')
        status, attributes = decode(data)
        if status >= 0x0100:  # 0x0000–0x00FF are the successful-ok family
            raise IPPError(f'IPP 0x{status:04x} {attributes.get("status-message", "")}'.strip())
        return attributes


def page_attributes(media):
    """One A4 photo page, scaled to the printable area (the printer has no borderless mode)."""
    return [(KEYWORD, 'media', media), (KEYWORD, 'print-scaling', 'fit'), (ENUM, 'print-quality', 4),
            (KEYWORD, 'print-color-mode', 'color'), (KEYWORD, 'print-content-optimize', 'photo')]


def print_jpeg(printer, jpeg, job_name, media='iso_a4_210x297mm'):
    attributes = printer.request(PRINT_JOB, [USER, (NAME, 'job-name', job_name), (MIME, 'document-format', 'image/jpeg')],
                                 page_attributes(media), document=jpeg, timeout=60)
    return attributes['job-id'], JOB_STATES.get(attributes.get('job-state'), 'pending')


def job_state(printer, job_id):
    attributes = printer.request(GET_JOB_ATTRIBUTES, [(INTEGER, 'job-id', job_id), USER,
                                 (KEYWORD, 'requested-attributes', ['job-state', 'job-state-reasons', 'job-impressions-completed'])], timeout=4)
    return JOB_STATES.get(attributes.get('job-state'), 'unknown'), attributes


def device_uri(queue):
    out = subprocess.run(['lpstat', '-v', queue], capture_output=True, text=True, timeout=4).stdout
    found = re.search(r'\b(?:ippusb|ipps?|dnssd)://\S+', out)  # the wording around it is localized, the URI is not
    if not found: raise IPPError(f'{queue} 不是 IPP 打印机')
    return found.group(0)


def lookup(instance, service='_ipp._tcp', timeout=3.0):
    """Resolve a Bonjour printer instance with dns-sd (it never exits on its own, so read with a deadline)."""
    process = subprocess.Popen(['dns-sd', '-L', instance, service, 'local.'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    text, deadline = '', time.monotonic() + timeout
    try:
        while (left := deadline - time.monotonic()) > 0:
            ready, _, _ = select.select([process.stdout], [], [], left)
            if not ready: break
            chunk = os.read(process.stdout.fileno(), 4096)
            if not chunk: break
            text += chunk.decode('utf-8', 'replace')
            if 'reached at' in text: deadline = min(deadline, time.monotonic() + .3)  # the TXT record follows at once
    finally:
        process.kill(); process.wait()
    found = re.search(r'reached at (\S+?)\.?:(\d+)', text)
    if not found: raise IPPError(f'找不到打印机 {instance}')
    path = re.search(r'\brp=(\S+)', text)
    return Printer(found.group(1), int(found.group(2)), path.group(1) if path else 'ipp/print')


def resolve(queue):
    uri = urlparse(device_uri(queue))
    if uri.scheme == 'ipp': return Printer(uri.hostname, uri.port or 631, uri.path)
    instance, _, rest = unquote(uri.netloc).partition('._')  # "<name>._ipp._tcp.local."
    service = '_' + rest.split('.local')[0] if rest else '_ipp._tcp'
    if uri.scheme == 'ipps' or service.startswith('_ipps'): raise IPPError('ipps 需要 TLS，交给 CUPS')
    return lookup(instance, service)


def main(argv):
    queue = next((a for a in argv if not a.startswith('-')), None)
    if not queue:
        names = subprocess.run(['lpstat', '-e'], capture_output=True, text=True).stdout.split()
        queue = next((n for n in names if re.match(r'mi[_ ]|xiaomi', n, re.I)), names[0] if names else None)
    if not queue: sys.exit('没有打印机')
    printer = resolve(queue)
    print(f'{queue} -> {printer.uri}')
    attributes = printer.request(GET_PRINTER_ATTRIBUTES, [USER, (KEYWORD, 'requested-attributes', [
        'printer-make-and-model', 'printer-state', 'printer-state-reasons', 'media-ready', 'marker-names', 'marker-levels'])])
    for key in ['printer-make-and-model', 'printer-state', 'printer-state-reasons', 'media-ready', 'marker-names', 'marker-levels']:
        value = attributes.get(key)
        print(f'  {key}: {PRINTER_STATES.get(value, value) if key == "printer-state" else value}')
    if '--dry-run' in argv:
        printer.request(VALIDATE_JOB, [USER, (MIME, 'document-format', 'image/jpeg')], page_attributes('iso_a4_210x297mm'))
        print('  Validate-Job: ok')
        created = printer.request(CREATE_JOB, [USER, (NAME, 'job-name', 'between-dry-run')], page_attributes('iso_a4_210x297mm'))
        job_id = created['job-id']
        print(f'  Create-Job: job {job_id}, {job_state(printer, job_id)[0]}')
        printer.request(CANCEL_JOB, [(INTEGER, 'job-id', job_id), USER])
        print(f'  Cancel-Job: job {job_id}, {job_state(printer, job_id)[0]} (no document was sent)')


if __name__ == '__main__':
    main(sys.argv[1:])

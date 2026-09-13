FROM python:3.12.14-slim

ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 PORT=8080 \
    PRINTER_SOURCE=/app/printer RENDER_DATA=/tmp/between-artworks \
    RENDER_TIMEOUT_SECONDS=120

WORKDIR /app
COPY cloudflare-backend/container/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --disable-pip-version-check -r /app/requirements.txt \
    && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin renderer

COPY printer/server.py printer/garden_style.py printer/garden_style.json \
     printer/rarity.py printer/story.py printer/entry_sessions.py /app/printer/
COPY cloudflare-backend/container/app.py cloudflare-backend/container/runner.py /app/

USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=2)"
CMD ["python", "/app/app.py"]

# O-Jester — production container (Python 3.12, Waitress server, scheduler included)
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    APP_ENV=production \
    PORT=5080

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY ojester ./ojester
COPY run.py manage.py ./

# Run as an unprivileged user; ./instance holds the SQLite database when no DATABASE_URL is set.
RUN useradd --create-home --uid 10001 ojester && mkdir -p instance && chown -R ojester:ojester /app
USER ojester

EXPOSE 5080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD python -c "import os,urllib.request;urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\",\"5080\")}/api/health',timeout=4)"

CMD ["python", "run.py"]

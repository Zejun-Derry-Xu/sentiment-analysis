FROM python:3.12-slim@sha256:aa943ce411423c7582288f18707ff66eddcbaeb510502d747a72aeb34f30d159
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 TOKENIZERS_PARALLELISM=false OMP_NUM_THREADS=2 OPENBLAS_NUM_THREADS=1 HF_HUB_DISABLE_TELEMETRY=1
WORKDIR /bench
COPY requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock
COPY *.py *.html ./
RUN useradd -u 10001 -m bench && mkdir -p /assets /reports && chown bench:bench /assets /reports
USER bench
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]

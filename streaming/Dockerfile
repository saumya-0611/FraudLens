# Built with repo root as build context so shared/ is accessible inside the container:
#   docker build -f streaming/Dockerfile -t fraudlens-streaming .
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app \
    JAVA_HOME=/usr/lib/jvm/default-java

WORKDIR /app

# OpenJDK 17 (headless) is required for PySpark Structured Streaming
RUN apt-get update && apt-get install -y --no-install-recommends \
    default-jre-headless \
    procps \
    && rm -rf /var/lib/apt/lists/*

COPY streaming/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY shared ./shared
COPY streaming ./streaming

CMD ["python", "-m", "streaming.jobs.main_stream"]

# Built with repo root as build context so shared/ is accessible inside the container:
#   docker build -f ml-service/Dockerfile -t fraudlens-ml-service .
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

# Install system dependencies required by xgboost (libgomp1) and curl for container healthcheck
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY ml-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy shared feature module, data-science PSI module, and ml-service application code
COPY shared ./shared
COPY data-science/drift ./data_science_drift
COPY ml-service/app ./app
COPY ml-service/training ./training
COPY ml-service/tests ./tests
RUN mkdir -p /app/model_store

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

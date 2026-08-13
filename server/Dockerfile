# Railway / Docker 배포용 KPI API
FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    KPI_DATA_DIR=/data

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Volume 마운트 지점 (Railway Volume → /data)
RUN mkdir -p /data

EXPOSE 8080

# Railway가 PORT를 주입함. 없으면 8080
CMD ["sh", "-c", "python kpi_api.py"]

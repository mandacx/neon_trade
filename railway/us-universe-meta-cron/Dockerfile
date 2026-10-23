FROM python:3.12-slim
RUN pip install --no-cache-dir yfinance==1.7.0
WORKDIR /app
COPY meta_worker.py .
# Deployed as the us-universe-meta-cron service in the neon-trade-crons Railway project (weekly).
CMD ["python", "-I", "meta_worker.py"]

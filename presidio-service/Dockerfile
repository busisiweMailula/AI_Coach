FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PRESIDIO_HOST=0.0.0.0 \
    PRESIDIO_PORT=5002

WORKDIR /app
COPY requirements.txt ./
RUN python -m pip install --no-cache-dir -r requirements.txt
COPY app.py ./
COPY person_allowlist.json ./

EXPOSE 5002
CMD ["python", "app.py"]

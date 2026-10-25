FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPYCACHEPREFIX=/tmp/pycache
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py .
RUN useradd --create-home --uid 10001 garmin
USER garmin
EXPOSE 8000
CMD ["python", "app.py"]

FROM python:3.12-slim

WORKDIR /workspace

COPY . /workspace/app/

RUN pip install --no-cache-dir -r /workspace/app/requirements.txt

ENV PYTHONPATH=/workspace

EXPOSE 8000 8001

CMD ["python", "-m", "app.main"]

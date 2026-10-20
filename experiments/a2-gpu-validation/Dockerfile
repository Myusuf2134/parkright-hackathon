FROM python:3.12.13-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY experiments/a2-gpu-validation/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && pip freeze > /app/resolved-requirements.txt
COPY experiments/a2-finetune/a2_finetune /app/experiments/a2-finetune/a2_finetune
COPY experiments/a2-finetune/config.json /app/experiments/a2-finetune/config.json
COPY experiments/a2-gpu-validation/benchmark.py /app/experiments/a2-gpu-validation/benchmark.py
ENV PYTHONDONTWRITEBYTECODE=1 OMP_NUM_THREADS=4 NVIDIA_VISIBLE_DEVICES=all NVIDIA_DRIVER_CAPABILITIES=compute,utility
ENTRYPOINT ["python", "/app/experiments/a2-gpu-validation/benchmark.py"]

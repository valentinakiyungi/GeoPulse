FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    YOLO_CONFIG_DIR=/tmp/Ultralytics \
    MPLCONFIGDIR=/tmp/matplotlib \
    PORT=8000

# OpenCV runtime libraries (ultralytics pulls in the non-headless build).
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# CPU-only PyTorch keeps the image small. For NVIDIA GPUs, drop the index URL and use a CUDA base image.
RUN pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
# World-writable so the model can be downloaded when the container runs as a non-root user
# (Hugging Face Spaces runs containers as uid 1000).
RUN mkdir -p models && chmod 777 models

EXPOSE 8000
# Hosting platforms may assign the port through $PORT.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]

# GeoPulse AI 

> **Real-time spatial computer vision engine transforming aerial imagery into interactive Mapbox GeoJSON overlays.**

![Next.js](https://img.shields.io/badge/Next.js_14-000000?style=for-the-badge&logo=next.js&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![YOLOv8](https://img.shields.io/badge/YOLOv8-Ultralytics-00599C?style=for-the-badge)
![Mapbox](https://img.shields.io/badge/Mapbox_GL-000000?style=for-the-badge&logo=mapbox&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Python](https://img.shields.io/badge/Python_3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)

---

##  Tech Stack

- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, Mapbox GL JS
- **Backend**: FastAPI, Python, OpenCV, YOLOv8 (Ultralytics)
- **Spatial Engine**: Custom pixel-to-WGS84 affine GPS projection engine

---

### Key Features

**Aerial Object Detection**: Employs YOLOv8 deep learning models to detect urban infrastructure, vehicles, and land assets from drone or satellite frames.
**Spatial Geo-Referencing**: Built-in 4-corner affine transformation engine (`GeoMapper`) that projects pixel bounding boxes directly to WGS84 GPS coordinate polygons (`GeoJSON`).
**Dynamic Mapbox Overlay**: Renders real-time vector bounding polygons over Mapbox 3D satellite tile maps with pitch and rotation support.
**Asynchronous Pipeline**: FastAPI non-blocking background task queue with job status polling for handling high-resolution spatial frame processing.

---

##  Quick Start

### 1. Backend (FastAPI + YOLOv8)
```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

### 2. Frontend (Next.js + Mapbox)
```Bash
cd frontend
npm install
echo "NEXT_PUBLIC_MAPBOX_TOKEN=your_mapbox_token_here" > .env.local
npm run dev
```

### 📄 License
MIT

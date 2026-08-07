from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import vision

app = FastAPI(title="GeoPulse AI Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(vision.router)

@app.get("/")
def root():
    return {"message": "GeoPulse AI Engine API is running", "docs": "/docs"}

@app.get("/health")
def health_check():
    return {"status": "healthy", "service": "GeoPulse AI Engine"}

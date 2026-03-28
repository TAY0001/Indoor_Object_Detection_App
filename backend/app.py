from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
import numpy as np
import cv2
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pathlib import Path

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# -----------------------------
# Serve frontend (HTML / JS)
# -----------------------------
BASE_DIR = Path(__file__).resolve().parent          # backend/
FRONTEND_DIR = BASE_DIR.parent / "frontend" / "www" # C:/app/frontend/www

# Mount static files to /static instead of root
app.mount("/static", StaticFiles(directory=FRONTEND_DIR, html=True), name="static")

# Explicit routes for HTML and static files
@app.get("/")
def index():
    return FileResponse(FRONTEND_DIR / "index.html")

@app.get("/index.html")
def index_html():
    return FileResponse(FRONTEND_DIR / "index.html")

@app.get("/app.js")
def app_js():
    return FileResponse(FRONTEND_DIR / "app.js")

@app.get("/book.jpg")
def book_jpg():
    return FileResponse(FRONTEND_DIR / "book.jpg")

MODEL_PATH = BASE_DIR / "models" / "best.pt"

print("Loading model from:", MODEL_PATH)

model = YOLO(str(MODEL_PATH))

def direction_hint(x_center: float) -> str:
    # x_center is normalized 0..1
    if x_center < 0.33:
        return "left"
    elif x_center > 0.66:
        return "right"
    return "center"

@app.post("/detect/image")
async def detect_image(file: UploadFile = File(...)):
    # read bytes -> numpy -> cv2 image
    data = await file.read()
    img_np = np.frombuffer(data, np.uint8)
    img = cv2.imdecode(img_np, cv2.IMREAD_COLOR)

    results = model.predict(img, imgsz=640, conf=0.25, verbose=False)[0]

    detections = []
    if results.boxes is not None:
        names = results.names
        boxes = results.boxes
        for b in boxes:
            cls_id = int(b.cls.item())
            conf = float(b.conf.item())
            x1, y1, x2, y2 = map(float, b.xyxy[0].tolist())

            h, w = img.shape[:2]
            x_center = ((x1 + x2) / 2) / w

            detections.append({
                "label": names[cls_id],
                "conf": conf,
                "box": [x1, y1, x2, y2],
                "direction": direction_hint(x_center),
            })

    # simple "speech text"
    top = sorted(detections, key=lambda d: d["conf"], reverse=True)[:3]
    if top:
        speech = " , ".join([f"{d['label']} on the {d['direction']}" for d in top])
    else:
        speech = "No objects detected"

    return {"detections": detections, "speech": speech}
import time
from pathlib import Path
import tempfile

import cv2
import numpy as np
import streamlit as st
from ultralytics import YOLO

# -----------------------
# Config
# -----------------------
st.set_page_config(page_title="IndoorVision Streamlit", layout="wide")

MODEL_PATH = "models/best.pt" 
CONF_THRES = 0.25
IMGSZ = 640

@st.cache_resource
def load_model():
    return YOLO(MODEL_PATH)

model = load_model()

# -----------------------
# Helpers
# -----------------------
def draw_detections(frame_bgr, results):
    """Draw YOLO detections on a BGR frame."""
    if results.boxes is None:
        return frame_bgr

    names = results.names
    for b in results.boxes:
        cls_id = int(b.cls.item())
        conf = float(b.conf.item())
        x1, y1, x2, y2 = map(int, b.xyxy[0].tolist())

        label = f"{names[cls_id]} {conf:.2f}"
        cv2.rectangle(frame_bgr, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(frame_bgr, label, (x1, max(20, y1 - 8)),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)
    return frame_bgr

def process_video(input_path: str, output_path: str, conf=0.25, imgsz=640, progress_cb=None):
    cap = cv2.VideoCapture(input_path)
    if not cap.isOpened():
        raise RuntimeError("Cannot open uploaded video.")

    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 1 or np.isnan(fps):
        fps = 25.0

    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    out = cv2.VideoWriter(output_path, fourcc, fps, (w, h))

    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    i = 0

    while True:
        ok, frame = cap.read()
        if not ok:
            break

        # YOLO inference
        res = model.predict(frame, imgsz=imgsz, conf=conf, verbose=False)[0]
        frame = draw_detections(frame, res)
        out.write(frame)

        i += 1
        if progress_cb and total > 0 and i % 3 == 0:
            progress_cb(min(i / total, 1.0))

    cap.release()
    out.release()

def bgr_to_rgb(frame_bgr):
    return cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)

# -----------------------
# UI
# -----------------------
st.title("IndoorVision — Streamlit (Upload + RTSP Live)")

# ---- Safe mode switching (must happen BEFORE st.radio) ----
if "mode" not in st.session_state:
    st.session_state.mode = "Upload Video"

# if a button requested a mode change, apply it BEFORE creating the radio
if "goto_mode" in st.session_state:
    st.session_state.mode = st.session_state.pop("goto_mode")

# init cap early so Stop won't crash
if "cap" not in st.session_state:
    st.session_state.cap = None

mode = st.radio("Mode", ["Upload Video", "RTSP Live Stream"], horizontal=True, key="mode")

# =========================================================
# TAB 1: Upload Video -> Output annotated video
# =========================================================
if mode == "Upload Video":
    st.subheader("Upload a video → detect objects → show labeled output video")

    colA, colB = st.columns([1, 1])

    with colA:
        uploaded = st.file_uploader("Upload MP4 video", type=["mp4", "mov", "m4v", "avi"])
        conf = st.slider("Confidence", 0.05, 0.90, float(CONF_THRES), 0.05)
        imgsz = st.selectbox("Image Size (imgsz)", [416, 512, 640, 768, 896], index=2)

        run_btn = st.button("Run Detection on Video", type="primary", disabled=(uploaded is None))

    with colB:
        st.markdown("**Tips**")
        st.markdown("- Output is an MP4 with bounding boxes + labels.")
        st.markdown("- If it’s slow, try smaller **imgsz** or higher **confidence**.")

    if run_btn and uploaded is not None:
        with tempfile.TemporaryDirectory() as td:
            td = Path(td)
            in_path = td / "input.mp4"
            out_path = td / "output_annotated.mp4"

            # save upload to disk
            in_path.write_bytes(uploaded.read())

            prog = st.progress(0.0, text="Processing video...")
            try:
                process_video(
                    str(in_path),
                    str(out_path),
                    conf=conf,
                    imgsz=imgsz,
                    progress_cb=lambda p: prog.progress(p, text=f"Processing... {int(p*100)}%")
                )
                prog.progress(1.0, text="Done")

                st.success("Detection completed!")

                st.markdown("### Output Video (Annotated)")
                st.video(str(out_path))

                st.download_button(
                    "Download annotated video",
                    data=out_path.read_bytes(),
                    file_name="annotated_output.mp4",
                    mime="video/mp4"
                )

            except Exception as e:
                st.error(f"Failed: {e}")

# =========================================================
# TAB 2: RTSP Live Stream -> Real-time detection
# =========================================================
else:
    st.subheader("RTSP from phone camera → detect objects → display on laptop")

    # 🔹 1. DEFINE CONTROLS FIRST
    conf2 = st.slider("Confidence (Live)", 0.05, 0.90, 0.25, 0.05)
    imgsz2 = st.selectbox("Image Size (Live)", [416, 512, 640], index=2)

    st.markdown("### RTSP Settings")

    rtsp_host = st.text_input("Camera IP", value="172.16.52.209")
    rtsp_port = st.text_input("Port", value="8554")
    rtsp_path = st.text_input("Stream Path", value="/live")

    rtsp_user = st.text_input("Username", value="admin")
    rtsp_pass = st.text_input("Password", value="12345")

    # build final RTSP url
    if rtsp_user and rtsp_pass:
        rtsp_url = f"rtsp://{rtsp_user}:{rtsp_pass}@{rtsp_host}:{rtsp_port}{rtsp_path}"
    else:
        rtsp_url = f"rtsp://{rtsp_host}:{rtsp_port}{rtsp_path}"

    st.caption(f"RTSP URL: {rtsp_url.replace(rtsp_pass,'******')}")
    st.write("Actual RTSP URL:", rtsp_url)

    start = st.button("Start Live Detection", type="primary")
    stop = st.button("Stop", type="secondary")

    # 🔹 2. STATE
    if "live_run" not in st.session_state:
        st.session_state.live_run = False

    if start:
        st.session_state.live_run = True
        st.session_state.goto_mode = "RTSP Live Stream"
        st.rerun()

    if stop:
        st.session_state.live_run = False
        st.session_state.goto_mode = "RTSP Live Stream"
        if st.session_state.cap is not None:
            st.session_state.cap.release()
            st.session_state.cap = None
        st.rerun()

    frame_box = st.empty()
    status = st.empty()

    def open_cap():
        url = rtsp_url.strip()

        cap = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)

        return cap

    if st.session_state.live_run:
        status.info("Live running...")

        if st.session_state.cap is None:
            st.session_state.cap = open_cap()

        cap = st.session_state.cap

        if not cap or not cap.isOpened():
            status.error("Cannot open RTSP stream. Check URL / Wi-Fi / iPhone app.")
            st.session_state.live_run = False
            if cap:
                cap.release()
            st.session_state.cap = None
            st.stop()

        if st.session_state.live_run:
            status.info("Live running...")

            if st.session_state.cap is None:
                st.session_state.cap = open_cap()

            cap = st.session_state.cap

            frame_count = 0

            while st.session_state.live_run:
                ret, frame = cap.read()
                if not ret or frame is None:
                    status.warning("No frames received. Keep iPhone screen ON.")
                    time.sleep(0.1)
                    continue

                # YOLO inference
                res = model.predict(frame, imgsz=imgsz2, conf=conf2, verbose=False)[0]
                frame = draw_detections(frame, res)

                # Show frame
                frame_box.image(frame, channels="BGR", width="stretch")

                status.text("Live running...")
                time.sleep(0.03)  # small delay to reduce CPU load

            # Release cap if live_run stopped
            if cap is not None:
                cap.release()
                st.session_state.cap = None

    else:
        status.write("Stopped.")
        if st.session_state.cap is not None:
            st.session_state.cap.release()
            st.session_state.cap = None
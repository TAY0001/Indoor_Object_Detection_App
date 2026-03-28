/**
 * IndoorVision - Unified App Logic
 *
 * Current features:
 * 1) Start Page (idle, no buttons)
 * 2) Guidance Page (rules demonstration)
 * 3) Auto rule demo on launch
 * 4) Tap anywhere on Start → replay rules
 * 5) Tap anywhere during rules → stop immediately
 *
 * Detection & live camera will be added later.
 */

/* ===============================
   BACKEND CONFIG (KEEP)
================================ */
// const API = "http://192.168.100.25:8001"; // laptop IP for phone usage
const API = window.location.origin;
/* ===============================
   SPEECH CONTROL (KEEP)
================================ */
let muted = false;
let lastSpoken = "";

let speechUnlocked = false;

function unlockSpeechOnce() {
    if (speechUnlocked) return;
    speechUnlocked = true;

    try {
        // Some browsers require a tiny utterance after a user gesture
        const u = new SpeechSynthesisUtterance("unlock");
        u.volume = 0.1; // Very low but not silent
        u.onstart = () => {
            // Immediately stop it
            window.speechSynthesis.cancel();
        };
        window.speechSynthesis.speak(u)
    } catch {}
}

function speak(text) {
    if (muted) return;
    if (!text || text === lastSpoken) return;

    lastSpoken = text;
    window.speechSynthesis.cancel();

    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    u.pitch = 1.0;
    window.speechSynthesis.speak(u);
}

function stopSpeech() {
    try {
        window.speechSynthesis.cancel();
    } catch {}
    lastSpoken = "";
}

/* ===============================
   UI ELEMENTS
================================ */
const startScreen = document.getElementById("startScreen");
const guideScreen = document.getElementById("guideScreen");
const tapLayer = document.getElementById("tapLayer");

const detectionScreen = document.getElementById("detectionScreen");

const overlay = document.getElementById("overlay");
const octx = overlay.getContext("2d");

function showDetection() {
    startScreen.classList.add("hidden");
    tapLayer.classList.add("hidden");
    guideScreen.classList.add("hidden");
    detectionScreen.classList.remove("hidden");
}

/* ===============================
   RULE DEMONSTRATION CONFIG
================================ */
const RULES_TEXT =
    "Welcome to Indoor Vision. " +
    "Tap anywhere once on the screen to hear the guidance. " +
    "Tap once during the guidance to stop it immediately. " +
    "Tap anywhere twice on the screen to start or stop object detection. " +
    "Tap anywhere three times on the screen to exit the application.";

const FALLBACK_RULES_DURATION_MS = 2200;

/* ===============================
   STATE
================================ */
let isDemonstrating = false;
let fallbackTimer = null;
let ruleUtterance = null;
let demoToken = 0;

/* ===============================
   SCREEN CONTROL
================================ */
function showStart() {
    startScreen.classList.remove("hidden");
    tapLayer.classList.remove("hidden");
    guideScreen.classList.add("hidden");
    detectionScreen.classList.add("hidden");
}

function showGuide() {
    startScreen.classList.add("hidden");
    tapLayer.classList.add("hidden");
    guideScreen.classList.remove("hidden");
    detectionScreen.classList.add("hidden");
}

/* ===============================
   RULE FLOW CONTROL
================================ */
function clearFallbackTimer() {
    if (fallbackTimer) {
        clearTimeout(fallbackTimer);
        fallbackTimer = null;
    }
}

function endDemonstration(token) {
    if (token !== undefined && token !== demoToken) return;

    demoToken++;
    clearFallbackTimer();
    stopSpeech();
    isDemonstrating = false;
    showStart();
}

function startDemonstrationFlow() {
    if (isDemonstrating) return;

    isDemonstrating = true;
    showGuide();

    demoToken++;
    const myToken = demoToken;

    if (!speechUnlocked) {
        fallbackTimer = setTimeout(() => endDemonstration(myToken), FALLBACK_RULES_DURATION_MS);
        return;
    }

    stopSpeech();

    setTimeout(() => {
        if (myToken !== demoToken || !isDemonstrating) return;

        try {
        ruleUtterance = new SpeechSynthesisUtterance(RULES_TEXT);
        ruleUtterance.rate = 1.0;
        ruleUtterance.pitch = 1.0;

        ruleUtterance.onend = () => endDemonstration(myToken);
        ruleUtterance.onerror = () =>
            (fallbackTimer = setTimeout(() => endDemonstration(myToken), FALLBACK_RULES_DURATION_MS));

        window.speechSynthesis.speak(ruleUtterance);
        } catch {
        fallbackTimer = setTimeout(() => endDemonstration(myToken), FALLBACK_RULES_DURATION_MS);
        }
    }, 80);
}

/* ===============================
   TAP INTERACTIONS
================================ */

let tapCount = 0;
let tapTimer = null;
const TAP_WINDOW_MS = 350;

tapLayer.addEventListener("click", () => {
    unlockSpeechOnce();

    tapCount++;
    if (tapTimer) clearTimeout(tapTimer);

    tapTimer = setTimeout(() => {
        const count = tapCount;
        tapCount = 0;
        tapTimer = null;

        if (count === 1) {
        // 1 tap: play guidance
        startDemonstrationFlow();
        } else if (count === 2) {
        // 2 taps: go detection page
        showDetection();
        startDetectionLoop(); // starts “always detecting”
        } else if (count >= 3) {
        // 3 taps: try to exit (web cannot close tab reliably)
        // You can show a message instead.
        alert("Exit requested. Please close the browser tab.");
        }
    }, TAP_WINDOW_MS);
});

// Guidance Page: tap once → STOP immediately
guideScreen.addEventListener("click", () => {
    if (isDemonstrating) {
        endDemonstration(demoToken);
    }
});

/* ===============================
   APP STARTUP
================================ */

// Show start screen
window.addEventListener("load", () => {
    showStart();
});

// -----------------------------
// Detection UI elements (white box + speech output)
// -----------------------------
const statStatus = document.getElementById("statStatus");
const statObject = document.getElementById("statObject");
const statConf = document.getElementById("statConf");
const statDist = document.getElementById("statDist");
const statSpeech = document.getElementById("statSpeech");
const statRate = document.getElementById("statRate");
const speechOut = document.getElementById("speechOut");

// Speech settings (you can later connect to UI settings)
let speechRateLabel = "Normal"; // Slow / Normal / Fast

function setSpeechRate(label) {
    speechRateLabel = label;
    statRate.textContent = `(${label})`;
}

const cameraView = document.getElementById("cameraView");
let cameraStream = null;

// offscreen canvas for grabbing frames
const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d", { willReadFrequently: true });

async function startCamera() {
    if (cameraStream) return;

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" }, // back camera
            audio: false
        });

        cameraView.srcObject = cameraStream;

        cameraView.onloadedmetadata = () => {
            resizeOverlay();
        };
    } catch (err) {
        console.error("getUserMedia failed:", err);
        alert("Camera blocked on iPhone. Use HTTPS (not http://192.168...).");
    }
}

function stopCamera() {
    if (!cameraStream) return;
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
    cameraView.srcObject = null;
}

function setStatus(text) {
    statStatus.textContent = text;
}

function updateSpeechUi() {
    statSpeech.textContent = muted ? "Off" : "On";
    statRate.textContent = `(${speechRateLabel})`;
}

function boxArea(box) {
    const [x1, y1, x2, y2] = box;
    return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function drawBoxes(dets) {
    octx.clearRect(0, 0, overlay.width, overlay.height);

    octx.strokeStyle = "#00FF00";
    octx.lineWidth = 3;
    octx.font = "18px system-ui";
    octx.fillStyle = "#00FF00";

    for (const d of dets) {
        if (!Array.isArray(d.box)) continue;

        const [x1, y1, x2, y2] = mapBoxToDisplay(d.box);

        octx.strokeRect(
            x1,
            y1,
            x2 - x1,
            y2 - y1
        );

        const label = `${d.label} ${(d.conf * 100).toFixed(0)}%`;
        octx.fillText(label, x1 + 4, Math.max(y1 - 6, 18));
    }
}

// “Nearest” = biggest box area (closest proxy)
function pickNearest(dets) {
    if (!dets || dets.length === 0) return null;
    return dets
        .filter(d => Array.isArray(d.box))
        .sort((a, b) => boxArea(b.box) - boxArea(a.box))[0];
}

function resizeOverlay() {
    overlay.width = cameraView.videoWidth;
    overlay.height = cameraView.videoHeight;
}

function mapBoxToDisplay(box) {
    const [x1, y1, x2, y2] = box;

    const videoW = cameraView.videoWidth;
    const videoH = cameraView.videoHeight;

    const displayW = overlay.clientWidth;
    const displayH = overlay.clientHeight;

    // scale used by object-fit: cover
    const scale = Math.max(displayW / videoW, displayH / videoH);

    const scaledW = videoW * scale;
    const scaledH = videoH * scale;

    const offsetX = (scaledW - displayW) / 2;
    const offsetY = (scaledH - displayH) / 2;

    return [
        x1 * scale - offsetX,
        y1 * scale - offsetY,
        x2 * scale - offsetX,
        y2 * scale - offsetY
    ];
}

// estimate “distance” (not real meters) from box area
function estimateDistanceProxy(nearest, videoW, videoH) {
    if (!nearest?.box || !videoW || !videoH) return null;
    const a = boxArea(nearest.box);
    const norm = a / (videoW * videoH);
    if (norm <= 0) return null;

    const approxM = 1 / Math.sqrt(norm) * 0.6;
    return Math.min(Math.max(approxM, 0.3), 8.0);
}

let lastNearestKey2 = null;

function announceNearest(label, distM) {
    const bucket = distM ? (Math.round(distM * 2) / 2).toFixed(1) : "na";
    const key = `${label}|${bucket}`;
    if (key === lastNearestKey2) return;
    lastNearestKey2 = key;

    const sentence = distM
        ? `${label} ahead, ${distM.toFixed(1)} meters.`
        : `${label} ahead.`;

    speechOut.textContent = sentence;
    updateSpeechUi();
    if (!muted) speak(sentence);
}

async function detectOnce() {
    updateSpeechUi();

    if (!cameraStream) {
        setStatus("Camera Not Started");
        return;
    }

    if (cameraView.readyState < 2) {
        setStatus("Camera Loading...");
        return;
    }

    setStatus("Detecting");

    canvas.width = cameraView.videoWidth;
    canvas.height = cameraView.videoHeight;
    ctx.drawImage(cameraView, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.7)
    );
    if (!blob) return;

    const form = new FormData();
    form.append("file", blob, "frame.jpg");

    try {
        const res = await fetch(`${API}/detect/image`, {
        method: "POST",
        body: form,
        });

        if (!res.ok) {
        setStatus(`Backend Error (${res.status})`);
        return;
        }

        const data = await res.json();
        const dets = data.detections || [];
        drawBoxes(dets);

        const nearest = pickNearest(dets);

        if (!nearest) {
            statObject.textContent = "-";
            statConf.textContent = "-";
            statDist.textContent = "-";
            speechOut.textContent = "No objects detected";
            setStatus("Detecting (no objects)");
            return;
        }

        const label = nearest.label || "-";
        const confPct = Math.round((nearest.conf || 0) * 100);

        statObject.textContent = label;
        statConf.textContent = `${confPct}%`;

        const distM = estimateDistanceProxy(nearest, canvas.width, canvas.height);
        statDist.textContent = distM ? `${distM.toFixed(1)} m` : "-";

        setStatus("Detecting ✅");

        // speak only when nearest changed
        announceNearest(label, distM);
    } catch (e) {
        console.error("detectOnce error:", e);
        setStatus("Network/Backend Offline");
    }
}

// -----------------------------
// Nearest-object announcer state
// -----------------------------
let detectionTimer = null;
let isDetecting = false;

// Call this when entering detection screen
function startDetectionLoop() {
    if (isDetecting) return;
    isDetecting = true;

    startCamera();

    statStatus.textContent = "Starting...";
    statSpeech.textContent = muted ? "Off" : "On";
    setSpeechRate(speechRateLabel);

    // start polling backend
    if (detectionTimer) clearInterval(detectionTimer);
    detectionTimer = setInterval(detectOnce, 800);
}

function stopDetectionLoop() {
    isDetecting = false;

    lastNearestKey2 = null;
    speechOut.textContent = "-";
    setStatus("Stopped");

    stopCamera();

    if (detectionTimer) {
        clearInterval(detectionTimer);
        detectionTimer = null;
    }

    octx.clearRect(0, 0, overlay.width, overlay.height);
}

/* ===============================
   DETECTION SCREEN DOUBLE TAP → BACK TO START
================================ */

let detectTapCount = 0;
let detectTapTimer = null;
const DETECT_TAP_WINDOW_MS = 350;

detectionScreen.addEventListener("click", () => {
    detectTapCount++;
    if (detectTapTimer) clearTimeout(detectTapTimer);

    detectTapTimer = setTimeout(() => {
        const count = detectTapCount;
        detectTapCount = 0;
        detectTapTimer = null;

        if (count === 2) {
            // ✅ Double tap detected → back to Start
            stopDetectionLoop();
            stopSpeech();
            showStart();
        }
    }, DETECT_TAP_WINDOW_MS);
});
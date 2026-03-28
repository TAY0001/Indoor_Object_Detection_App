const API = "http://192.168.100.25:8000";
const fileEl = document.getElementById("file");
const logEl = document.getElementById("log");
const detectBtn = document.getElementById("detect");
const muteBtn = document.getElementById("mute");

let muted = false;
let lastSpoken = "";     // prevent repeating the same line

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

muteBtn.onclick = () => {
  muted = !muted;
  muteBtn.textContent = muted ? "Unmute" : "Mute";
  if (muted) window.speechSynthesis.cancel();
};

detectBtn.onclick = async () => {
  const f = fileEl.files?.[0];
  if (!f) {
    logEl.textContent = "Please select an image.";
    return;
  }

  const fd = new FormData();
  fd.append("file", f);

  logEl.textContent = "Detecting...";
  const res = await fetch(`${API}/detect/image`, { method: "POST", body: fd });
  const data = await res.json();

  logEl.textContent =
    "Speech: " + data.speech + "\n\n" +
    "Detections:\n" + data.detections.map(d => `${d.label} (${(d.conf*100).toFixed(1)}%) - ${d.direction}`).join("\n");

  speak(data.speech);
};
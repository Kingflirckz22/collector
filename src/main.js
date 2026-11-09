import "./style.css";
import { createClient } from "@supabase/supabase-js";
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import { initScene } from "./scene.js";

const $ = id => document.getElementById(id);
const banner = m => { $("banner").textContent = m; $("banner").hidden = false; };
const SB_URL = import.meta.env.VITE_SUPABASE_URL, KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const isSecret = k => k.startsWith("sb_secret_") || (() => { try {
  return JSON.parse(atob(k.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role === "service_role"; } catch { return false; } })();
let sb;
if (!SB_URL || !KEY) banner("Setup problem: VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY is missing from .env (restart npm run dev after editing it).");
else if (isSecret(KEY)) banner("Setup problem: that is a SECRET key. Use the anon/publishable key instead. Never put the secret key in this app.");
else sb = createClient(SB_URL, KEY);

const BUCKET = "face-videos", DURATION = 5, MIN_QUALITY = 0.8;
const DEPARTMENTS = ["CS", "NCC", "SWD"];   // add new departments here later
$("dept").innerHTML = '<option value="" disabled selected>Select department</option>'
  + DEPARTMENTS.map(d => `<option value="${d}">${d}</option>`).join("");

const PROMPTS = [
  "Place 1 of 3 Stay where you are. Look at the camera, then slowly turn left and right.",
  "Place 2 of 3 Move somewhere different (near a window, or outside). Look at the camera and tilt up and down a little.",
  "Place 3 of 3 Find a third spot or lighting. Look at the camera, smile, then relax."
];
const MODEL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

const scene = initScene($("bg"));
const show = n => [0, 1, 2, 3].forEach(i => $("s" + i).classList.toggle("active", i === n));
let stream, detector, loop, clips = [null, null, null], scores = [null, null, null], uploaded = [null, null, null];
let idx = 0, retake = null, attempt = "", info = {}, recording = false, total = 0, goodN = 0, goodSince = 0;
const sync = a => scene.set(clips.map(Boolean), a);

const detectorReady = (async () => {
  try {
    const files = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
    detector = await FaceDetector.createFromOptions(files, { baseOptions: { modelAssetPath: MODEL }, runningMode: "VIDEO", minDetectionConfidence: 0.5 });
  } catch (e) { console.warn("Face detector unavailable", e); }
})();

const pickMime = () => ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"].find(t => MediaRecorder.isTypeSupported(t)) || "";

function check() {
  const v = $("live"); if (!detector || v.readyState < 2) return;
  const d = detector.detectForVideo(v, performance.now()).detections;
  let msg = "", good = false;
  if (!d.length) msg = "😶 I can't see a face yet";
  else if (d.length > 1) msg = "👥 Only one person in the frame, please";
  else {
    const b = d[0].boundingBox, w = v.videoWidth, h = v.videoHeight, fw = b.width / w;
    const cx = (b.originX + b.width / 2) / w, cy = (b.originY + b.height / 2) / h;
    if (d[0].categories[0].score < 0.7) msg = "💡 A bit unclear. Try better light";
    else if (fw < 0.2) msg = "➕ Come a little closer";
    else if (fw > 0.5) msg = "➖ Move back a little";
    else if (((cx - 0.5) / 0.26) ** 2 + ((cy - 0.5) / 0.39) ** 2 > 1) msg = "🎯 Center your face in the oval";
    else good = true;
  }
  const now = performance.now();
  goodSince = good ? (goodSince || now) : 0;
  const stable = good && now - goodSince >= 1000;
  scene.mood(good);
  if (recording) {
    total++; if (good) goodN++;
    $("hint").textContent = good ? "Recording… 🎬" : "⚠️ " + msg;
    $("oval").classList.toggle("ok", good);
  } else {
    $("hint").textContent = stable ? "Perfect! Press record ✅" : good ? "Hold still…" : msg;
    $("oval").classList.toggle("ok", stable);
    $("recBtn").disabled = !stable;
  }
}

$("startBtn").onclick = async () => {
  if (!sb) return alert("Setup problem: see the red message at the top.");
  const matric = $("matric").value.trim().toUpperCase().replace(/\s+/g, " "), name = $("name").value.trim();
  if (!matric || !name) return alert("Please enter your matric number and full name.");
  if (!$("dept").value) return alert("Please select your department.");
  if (!$("consent").checked) return alert("Consent is needed to continue.");
  const { data } = await sb.rpc("matric_exists", { m: matric });
  if (data === true) return alert("This matric number is already enrolled. Ask the organizer if you need to redo it.");
  info = { matric, name, email: $("email").value.trim(), dept: $("dept").value, level: $("level").value };
  attempt = Date.now().toString(36);
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, frameRate: 24, facingMode: "user" }, audio: false }); }
  catch { return alert("Camera access was denied or no camera was found."); }
  $("live").srcObject = stream;
  await detectorReady;
  idx = 0; retake = null; goToRecord();
  clearInterval(loop); loop = setInterval(check, 100);
  if (!detector) { $("hint").textContent = "Face check unavailable. You can still record."; $("recBtn").disabled = false; }
};

function goToRecord() {
  const slot = retake ?? idx;
  $("prompt").textContent = PROMPTS[slot]; $("recBtn").textContent = "🎥 Record 5 seconds";
  $("recBtn").disabled = !!detector; goodSince = 0; sync(slot); show(1);
}

$("recBtn").onclick = () => {
  const slot = retake ?? idx;
  $("recBtn").disabled = true; recording = true; total = 0; goodN = 0;
  const mime = pickMime(), chunks = [];
  const rec = new MediaRecorder(stream, { ...(mime && { mimeType: mime }), videoBitsPerSecond: 1_000_000 });
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  let left = DURATION; $("timer").textContent = left;
  const tick = setInterval(() => { left--; $("timer").textContent = left > 0 ? left : ""; }, 1000);
  rec.onstop = () => {
    clearInterval(tick); $("timer").textContent = ""; recording = false;
    const q = detector ? goodN / Math.max(total, 1) : -1;
    if (detector && q < MIN_QUALITY) { $("hint").textContent = "Your face wasn't clear enough for the whole clip. Let's try again."; $("recBtn").textContent = "🔁 Record again"; return; }
    clips[slot] = new Blob(chunks, { type: rec.mimeType || "video/webm" });
    scores[slot] = Math.round(q * 100) / 100; uploaded[slot] = null;
    if (retake !== null || idx === 2) { retake = null; goToReview(); } else { idx++; goToRecord(); }
  };
  rec.start(); setTimeout(() => rec.stop(), DURATION * 1000);
};

function goToReview() {
  clearInterval(loop); sync(-1); $("clips").innerHTML = "";
  clips.forEach((b, i) => {
    const d = document.createElement("div"); d.className = "clip";
    d.innerHTML = `<span class="tick">✓</span><span>Place ${i + 1} recorded</span>`;
    const btn = document.createElement("button"); btn.className = "mini"; btn.textContent = "Retake";
    btn.onclick = () => { retake = i; loop = setInterval(check, 100); goToRecord(); };
    d.appendChild(btn); $("clips").appendChild(d);
  });
  $("sumMatric").textContent = info.matric; $("sumName").textContent = info.name;
  $("confirm").checked = false; $("submitBtn").disabled = true; $("status").textContent = ""; show(2);
}
$("confirm").onchange = e => $("submitBtn").disabled = !e.target.checked;
$("restartBtn").onclick = () => confirm("Throw everything away and start over?") && reset();

$("submitBtn").onclick = async () => {
  $("submitBtn").disabled = true; $("status").textContent = "Uploading…";
  const safe = info.matric.replace(/[^A-Za-z0-9_-]/g, "_");
  try {
    for (let i = 0; i < 3; i++) {
      if (uploaded[i]) continue;
      const path = `${safe}/${attempt}/place${i + 1}.${clips[i].type.includes("mp4") ? "mp4" : "webm"}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, clips[i], { contentType: clips[i].type.split(";")[0] });
      if (error) throw error;
      uploaded[i] = path; $("status").textContent = `Uploaded ${i + 1} of 3…`;
    }
    const { error } = await sb.from("enrollments").insert({
      matric: info.matric, full_name: info.name, email: info.email, department: info.dept, level: info.level,
      consent: true, video_paths: uploaded, quality_scores: scores, user_agent: navigator.userAgent });
    if (error) throw error.code === "23505" ? new Error("This matric number is already enrolled.") : error;
    stream.getTracks().forEach(t => t.stop()); show(3);
  } catch (e) { $("status").textContent = "Upload failed: " + (e.message || "network error") + ". Tap submit to retry."; $("submitBtn").disabled = false; }
};

function reset() {
  clearInterval(loop); stream?.getTracks().forEach(t => t.stop());
  clips = [null, null, null]; scores = [null, null, null]; uploaded = [null, null, null];
  idx = 0; retake = null; info = {}; recording = false;
  ["matric", "name", "email"].forEach(k => $(k).value = ""); $("dept").value = ""; $("consent").checked = false;
  sync(-1); show(0);
}
$("nextBtn").onclick = reset;
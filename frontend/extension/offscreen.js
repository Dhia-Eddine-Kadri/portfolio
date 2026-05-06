// Offscreen document — handles tab audio recording + local Whisper transcription
import { pipeline, env } from './transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriber = null;
let mediaRecorder = null;
let audioChunks = [];
let audioStream = null;
let audioCtx = null;

// ── Whisper model loader ──────────────────────────────────────────────────

async function getTranscriber() {
  if (transcriber) return transcriber;

  try {
    transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny', {
      progress_callback: (p) => {
        if (p.status === 'downloading' || p.status === 'initiate') {
          const pct = p.progress ? Math.round(p.progress) : 0;
          notify(`⬇️ Downloading Whisper model… ${pct}%`);
        }
        if (p.status === 'ready') notify('✅ Whisper ready');
      }
    });
  } catch (e) {
    transcriber = null;
    const msg = e && e.message ? e.message : 'Unknown error';
    notify(
      '❌ Failed to load Whisper model: ' + msg + '. Check your internet connection and try again.'
    );
    throw e;
  }
  return transcriber;
}

function notify(text) {
  chrome.runtime.sendMessage({ action: 'whisperProgress', text }).catch(() => {});
}

// ── Audio helpers ─────────────────────────────────────────────────────────

async function decodeToFloat32(arrayBuffer) {
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
  ctx.close();

  const TARGET = 16000;
  const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * TARGET), TARGET);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start(0);
  const resampled = await offline.startRendering();
  return resampled.getChannelData(0);
}

// ── Message handler ───────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg.target !== 'offscreen') return false;

  // Start recording tab audio
  if (msg.action === 'startRecording') {
    (async () => {
      try {
        audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'tab',
              chromeMediaSourceId: msg.streamId
            }
          },
          video: false
        });

        // Route audio back to speakers so user can still hear the lecture
        audioCtx = new AudioContext();
        audioCtx.createMediaStreamSource(audioStream).connect(audioCtx.destination);

        audioChunks = [];
        const mimeType =
          ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((m) =>
            MediaRecorder.isTypeSupported(m)
          ) || '';
        mediaRecorder = new MediaRecorder(audioStream, mimeType ? { mimeType } : {});
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) audioChunks.push(e.data);
        };
        mediaRecorder.start(5000);

        reply({ ok: true });
      } catch (e) {
        reply({ error: e.message });
      }
    })();
    return true;
  }

  // Stop recording and transcribe with Whisper
  if (msg.action === 'stopAndTranscribe') {
    (async () => {
      try {
        // Stop recorder and collect final chunk
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
          await new Promise((resolve) => {
            mediaRecorder.addEventListener('stop', resolve, { once: true });
            mediaRecorder.stop();
          });
        }
        if (audioStream) audioStream.getTracks().forEach((t) => t.stop());
        if (audioCtx) {
          audioCtx.close();
          audioCtx = null;
        }

        if (audioChunks.length === 0) {
          reply({ error: 'No audio recorded' });
          return;
        }

        const mimeType = mediaRecorder?.mimeType || 'audio/webm';
        const blob = new Blob(audioChunks, { type: mimeType });
        audioChunks = [];

        notify('🧠 Loading Whisper model…');
        const model = await getTranscriber();

        notify('🔄 Decoding audio…');
        const audioData = await decodeToFloat32(await blob.arrayBuffer());

        notify('🎙 Transcribing… (this takes a moment)');
        const result = await model(audioData, {
          task: 'transcribe',
          language: null, // auto-detect German or English
          chunk_length_s: 30,
          stride_length_s: 5
        });

        reply({ text: result.text });
      } catch (e) {
        reply({ error: e.message });
      }
    })();
    return true;
  }

  // Stop recording without transcribing
  if (msg.action === 'stopRecording') {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    if (audioStream) audioStream.getTracks().forEach((t) => t.stop());
    if (audioCtx) {
      audioCtx.close();
      audioCtx = null;
    }
    audioChunks = [];
    reply({ ok: true });
    return true;
  }

  return false;
});

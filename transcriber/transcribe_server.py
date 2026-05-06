"""
StudySphere Transcriber — local Whisper server
Runs silently in the system tray. The Chrome extension sends audio here.
"""

import threading
import tempfile
import os
import sys
import subprocess

from flask import Flask, request, jsonify
from flask_cors import CORS
from faster_whisper import WhisperModel
import pystray
from pystray import MenuItem as Item
from PIL import Image, ImageDraw

# ── Flask app ─────────────────────────────────────────────────────────────

app = Flask(__name__)
CORS(app)

model = None

def load_model():
    global model
    update_tray_title('StudySphere — Loading model…')
    model = WhisperModel('tiny', device='cpu', compute_type='int8')
    update_tray_title('StudySphere — Ready ✓')

def convert_to_wav(input_path):
    output_path = input_path + '.wav'
    ffmpeg = resource_path('ffmpeg.exe')
    subprocess.run(
        [ffmpeg, '-y', '-i', input_path, '-ar', '16000', '-ac', '1', output_path],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True
    )
    return output_path

@app.route('/transcribe', methods=['POST'])
def transcribe():
    if 'file' not in request.files:
        return jsonify({'error': 'No audio file'}), 400

    update_tray_title('StudySphere — Transcribing…')

    audio_file = request.files['file']
    with tempfile.NamedTemporaryFile(delete=False, suffix='.webm') as tmp:
        audio_file.save(tmp.name)
        webm_path = tmp.name

    wav_path = None
    try:
        wav_path = convert_to_wav(webm_path)
        segments, info = model.transcribe(wav_path, beam_size=5)
        text = ' '.join(seg.text.strip() for seg in segments)
        update_tray_title('StudySphere — Ready ✓')
        return jsonify({'text': text, 'language': info.language})
    except Exception as e:
        update_tray_title('StudySphere — Ready ✓')
        return jsonify({'error': str(e)}), 500
    finally:
        if os.path.exists(webm_path): os.unlink(webm_path)
        if wav_path and os.path.exists(wav_path): os.unlink(wav_path)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'ok': True})

def run_server():
    app.run(host='127.0.0.1', port=5050, debug=False, use_reloader=False)

# ── Helpers ───────────────────────────────────────────────────────────────

def resource_path(relative):
    base = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, relative)

tray_icon = None

def update_tray_title(title):
    if tray_icon:
        tray_icon.title = title

# ── System tray icon ──────────────────────────────────────────────────────

def make_icon():
    img = Image.new('RGBA', (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([4, 4, 60, 60], fill='#9B5DE5')
    d.text((18, 18), 'SS', fill='white')
    return img

def on_quit(icon, item):
    icon.stop()
    os._exit(0)

def setup_tray(icon):
    icon.visible = True
    # Load model and start server in background
    threading.Thread(target=load_model, daemon=True).start()
    threading.Thread(target=run_server, daemon=True).start()

def main():
    global tray_icon
    menu = pystray.Menu(
        Item('StudySphere Transcriber', None, enabled=False),
        Item('Quit', on_quit)
    )
    tray_icon = pystray.Icon(
        'StudySphere',
        make_icon(),
        'StudySphere — Loading…',
        menu
    )
    tray_icon.run(setup=setup_tray)

if __name__ == '__main__':
    main()

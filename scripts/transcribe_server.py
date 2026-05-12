"""
Minallo local transcription server.
Uses speech_recognition + local Whisper — no API calls, runs on your machine.

Setup (one time):
    pip install SpeechRecognition openai-whisper flask flask-cors pydub ffmpeg-python

Also install ffmpeg:
    Windows: https://ffmpeg.org/download.html  (add to PATH)

Run:
    python transcribe_server.py
"""

import speech_recognition as sr
from flask import Flask, request, jsonify
from flask_cors import CORS
import tempfile, os, subprocess

app = Flask(__name__)
CORS(app)

r = sr.Recognizer()

def convert_to_wav(input_path):
    """Convert any audio format (webm, ogg, mp3…) to WAV using ffmpeg."""
    output_path = input_path.replace('.webm', '.wav').replace('.ogg', '.wav')
    if not output_path.endswith('.wav'):
        output_path += '.wav'
    subprocess.run(
        ['ffmpeg', '-y', '-i', input_path, '-ar', '16000', '-ac', '1', output_path],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True
    )
    return output_path

@app.route('/transcribe', methods=['POST'])
def transcribe():
    if 'file' not in request.files:
        return jsonify({'error': 'No audio file provided'}), 400

    audio_file = request.files['file']

    # Save uploaded webm to temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix='.webm') as tmp:
        audio_file.save(tmp.name)
        webm_path = tmp.name

    wav_path = None
    try:
        # Convert webm → wav (speech_recognition needs wav)
        wav_path = convert_to_wav(webm_path)

        # Load wav into speech_recognition
        with sr.AudioFile(wav_path) as source:
            audio = r.record(source)

        # Transcribe locally using Whisper (no internet, no API)
        text = r.recognize_whisper(audio, model='tiny', language='german')

        return jsonify({'text': text})

    except subprocess.CalledProcessError:
        return jsonify({'error': 'ffmpeg not found — install ffmpeg and add it to PATH'}), 500
    except sr.UnknownValueError:
        return jsonify({'error': 'Could not understand audio'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500
    finally:
        if os.path.exists(webm_path): os.unlink(webm_path)
        if wav_path and os.path.exists(wav_path): os.unlink(wav_path)

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'ok': True})

if __name__ == '__main__':
    print('Minallo transcription server running at http://localhost:5050')
    print('Using local Whisper — no API calls, completely free.')
    app.run(host='127.0.0.1', port=5050, debug=False)

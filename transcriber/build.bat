@echo off
echo Installing dependencies...
pip install -r requirements.txt

echo.
echo Building StudySphere Transcriber.exe...
pyinstaller ^
  --onefile ^
  --windowed ^
  --name "StudySphere Transcriber" ^
  --icon icon.ico ^
  --add-binary "ffmpeg.exe;." ^
  --hidden-import="faster_whisper" ^
  --hidden-import="ctranslate2" ^
  --hidden-import="tokenizers" ^
  --hidden-import="huggingface_hub" ^
  --hidden-import="flask" ^
  --hidden-import="flask_cors" ^
  --hidden-import="pystray" ^
  --hidden-import="PIL" ^
  transcribe_server.py

echo.
echo Done! Find the exe in the dist/ folder.
pause

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import yt_dlp
import os
import uuid
import time
from typing import List, Optional, Dict

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TEMP_DIR = os.path.join(os.getcwd(), "temp_downloads")
os.makedirs(TEMP_DIR, exist_ok=True)

tasks: Dict[str, dict] = {}

class VideoRequest(BaseModel):
    url: str

class Clip(BaseModel):
    start: Optional[str] = None
    end: Optional[str] = None

class DownloadRequest(BaseModel):
    url: str
    format_id: str = "best"
    audio_only: bool = False
    clip: Optional[Clip] = None

def parse_time(timestr: str) -> float:
    if not timestr: return 0.0
    try:
        parts = list(map(int, timestr.split(':')))
        if len(parts) == 1: return float(parts[0])
        if len(parts) == 2: return parts[0] * 60 + parts[1]
        if len(parts) == 3: return parts[0] * 3600 + parts[1] * 60 + parts[2]
        return 0.0
    except:
        return 0.0

def download_worker(task_id: str, request: DownloadRequest):
    output_template = os.path.join(TEMP_DIR, f"{task_id}.%(ext)s")
    
    def progress_hook(d):
        if d['status'] == 'downloading':
            p_str = d.get('_percent_str', '0%').strip().replace('%', '')
            try:
                tasks[task_id]['progress'] = float(p_str)
            except:
                pass
        elif d['status'] == 'finished':
            tasks[task_id]['progress'] = 100

    try:
        ydl_opts = {
            'outtmpl': output_template,
            'quiet': True,
            'noplaylist': True,
            'progress_hooks': [progress_hook],
            'concurrent_fragment_downloads': 5,
            'format': 'bestvideo+bestaudio/best' if not request.audio_only else 'bestaudio/best',
            # SponsorBlock integration
            'sponsorblock_remove': ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview'],
        }

        if request.audio_only:
            ydl_opts['postprocessors'] = [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }]
        elif request.format_id != "best":
            ydl_opts['format'] = f"{request.format_id}+bestaudio/best"
            ydl_opts['merge_output_format'] = 'mp4'

        if request.clip:
            ydl_opts['download_ranges'] = lambda info_dict, ydl: [{
                'start_time': parse_time(request.clip.start),
                'end_time': parse_time(request.clip.end) if request.clip.end else info_dict.get('duration'),
            }]
            ydl_opts['force_keyframes_at_cuts'] = False

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([request.url])

        files = [f for f in os.listdir(TEMP_DIR) if f.startswith(task_id) and not f.endswith(('.part', '.ytdl'))]
        if files:
            tasks[task_id]['status'] = 'completed'
            tasks[task_id]['file_path'] = os.path.join(TEMP_DIR, files[0])
            tasks[task_id]['filename'] = f"{task_id}.{'mp3' if request.audio_only else 'mp4'}"
        else:
            tasks[task_id]['status'] = 'error'
            tasks[task_id]['error'] = "File not found."

    except Exception as e:
        tasks[task_id]['status'] = 'error'
        tasks[task_id]['error'] = str(e)

@app.post("/info")
def get_video_info(request: VideoRequest):
    try:
        ydl_opts = {'quiet': True, 'noplaylist': True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(request.url, download=False)
            
            # Extract chapters
            chapters = []
            for c in info.get('chapters', []):
                chapters.append({
                    'title': c.get('title'),
                    'start': c.get('start_time'),
                    'end': c.get('end_time')
                })

            formats = []
            seen_res = set()
            for f in info.get('formats', []):
                res = f.get('height')
                if res and res >= 360:
                    res_key = f"{res}p"
                    if res_key not in seen_res:
                        formats.append({'format_id': f['format_id'], 'resolution': res_key, 'ext': f.get('ext', 'mp4')})
                        seen_res.add(res_key)
            
            formats.sort(key=lambda x: int(x['resolution'][:-1]), reverse=True)
            
            return {
                "title": info.get('title'),
                "duration": info.get('duration'),
                "thumbnail": info.get('thumbnail'),
                "formats": formats,
                "chapters": chapters,
                "original_url": request.url
            }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/download")
def start_download(request: DownloadRequest, background_tasks: BackgroundTasks):
    task_id = str(uuid.uuid4())
    tasks[task_id] = {'status': 'processing', 'progress': 0}
    background_tasks.add_task(download_worker, task_id, request)
    return {"task_id": task_id}

@app.get("/status/{task_id}")
def get_status(task_id: str):
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    return tasks[task_id]

@app.get("/download/{task_id}")
def download_file(task_id: str, background_tasks: BackgroundTasks):
    if task_id not in tasks or tasks[task_id]['status'] != 'completed':
        raise HTTPException(status_code=400, detail="File not ready")
    
    file_path = tasks[task_id]['file_path']
    
    def cleanup():
        time.sleep(15)
        if os.path.exists(file_path):
            os.remove(file_path)
        if task_id in tasks:
            del tasks[task_id]

    background_tasks.add_task(cleanup)
    return FileResponse(file_path)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

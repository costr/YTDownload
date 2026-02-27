from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
import yt_dlp
import os
import uuid
import time
from typing import List, Optional, Dict

import requests
import re
import asyncio
import glob

from contextlib import asynccontextmanager

async def auto_cleanup():
    """Periodically deletes files older than 1 hour in the background."""
    while True:
        try:
            now = time.time()
            for f in glob.glob(os.path.join(TEMP_DIR, "*")):
                if os.path.isfile(f):
                    if os.stat(f).st_mtime < now - 3600: # 1 hour
                        os.remove(f)
        except Exception as e:
            print(f"Auto-cleanup error: {e}")
        await asyncio.sleep(1800) # Run every 30 mins

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Start the background cleanup task
    cleanup_task = asyncio.create_task(auto_cleanup())
    yield
    # Shutdown: Stop the task
    cleanup_task.cancel()

app = FastAPI(lifespan=lifespan)

# Limit to 3 concurrent downloads
download_semaphore = asyncio.Semaphore(3)

def cleanup_task_files(task_id: str):
    """Removes all files in TEMP_DIR that start with the task_id."""
    files = glob.glob(os.path.join(TEMP_DIR, f"{task_id}*"))
    for f in files:
        try:
            if os.path.exists(f):
                os.remove(f)
        except Exception as e:
            print(f"Failed to delete {f}: {e}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def parse_vtt(vtt_text: str):
    transcript = []
    # Simple VTT parser: look for timestamp lines and the following text
    # 00:00:00.000 --> 00:00:00.000
    blocks = re.split(r'\n\s*\n', vtt_text)
    for block in blocks:
        lines = block.strip().split('\n')
        if len(lines) >= 2:
            time_match = re.match(r'(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})', lines[0])
            if time_match:
                start_str = time_match.group(1)
                # Convert 00:00:00.000 to seconds
                h, m, s = start_str.split(':')
                start_sec = int(h) * 3600 + int(m) * 60 + float(s)
                
                text = " ".join(lines[1:]).replace('<c>', '').replace('</c>', '').strip()
                if text:
                    transcript.append({'start': start_sec, 'text': text})
    return transcript

TEMP_DIR = os.path.join(os.getcwd(), "temp_downloads")
if os.path.exists(TEMP_DIR):
    import shutil
    # Clear anything left over from previous runs
    for filename in os.listdir(TEMP_DIR):
        file_path = os.path.join(TEMP_DIR, filename)
        try:
            if os.path.isfile(file_path) or os.path.islink(file_path):
                os.unlink(file_path)
            elif os.path.isdir(file_path):
                shutil.rmtree(file_path)
        except Exception as e:
            print(f'Failed to delete {file_path}. Reason: {e}')
else:
    os.makedirs(TEMP_DIR, exist_ok=True)

tasks: Dict[str, dict] = {}

class VideoRequest(BaseModel):
    url: str
    tab: Optional[str] = None
    offset: Optional[int] = 0

class Clip(BaseModel):
    start: Optional[str] = None
    end: Optional[str] = None

class DownloadRequest(BaseModel):
    url: str
    title: Optional[str] = None
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

async def download_worker(task_id: str, request: DownloadRequest):
    async with download_semaphore:
        # Pre-cleanup in case this is a retry
        cleanup_task_files(task_id)
        
        tasks[task_id]['status'] = 'processing'
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
            # We run yt-dlp in a thread to keep the event loop free
            def run_ytdl():
                ydl_opts = {
                    'outtmpl': output_template,
                    'quiet': True,
                    'noplaylist': True,
                    'progress_hooks': [progress_hook],
                    'concurrent_fragment_downloads': 5,
                    'format': 'bestvideo+bestaudio/best' if not request.audio_only else 'bestaudio/best',
                    # SponsorBlock integration
                    'sponsorblock_remove': ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview'],
                    # Metadata & Thumbnail Tagging
                    'writethumbnail': True,
                    'postprocessors': [
                        {'key': 'FFmpegMetadata', 'add_chapters': True},
                        {'key': 'EmbedThumbnail'},
                    ],
                }

                if request.audio_only:
                    ydl_opts['postprocessors'].insert(0, {
                        'key': 'FFmpegExtractAudio',
                        'preferredcodec': 'mp3',
                        'preferredquality': '192',
                    })
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
                    if request.title:
                        ydl.params['parse_metadata'] = [f":(?P<title>{request.title})"]
                    ydl.download([request.url])

            # Run in a separate thread to avoid blocking the async loop
            await asyncio.to_thread(run_ytdl)

            # Get video info again to find the upload date
            upload_date = None
            try:
                with yt_dlp.YoutubeDL({'quiet': True, 'noplaylist': True}) as ydl:
                    info = ydl.extract_info(request.url, download=False)
                    upload_date = info.get('upload_date') # YYYYMMDD
            except:
                pass

            files = [f for f in os.listdir(TEMP_DIR) if f.startswith(task_id) and not f.endswith(('.part', '.ytdl', '.webp', '.vtt'))]
            if files:
                file_path = os.path.join(TEMP_DIR, files[0])
                
                # If we have an upload date, let's set the file's modification time to match it
                if upload_date:
                    try:
                        # Convert YYYYMMDD to a timestamp
                        year = int(upload_date[:4])
                        month = int(upload_date[4:6])
                        day = int(upload_date[6:8])
                        dt = time.mktime((year, month, day, 0, 0, 0, 0, 0, 0))
                        os.utime(file_path, (dt, dt))
                    except:
                        pass

                tasks[task_id]['status'] = 'completed'
                tasks[task_id]['file_path'] = file_path
                # We'll use the original extension
                ext = os.path.splitext(files[0])[1][1:]
                tasks[task_id]['filename'] = f"{task_id}.{ext}"
                
                # Format the display title for the download: "Title (YYYY-MM-DD)"
                display_title = request.title or "video"
                if upload_date:
                    formatted_date = f"{upload_date[:4]}-{upload_date[4:6]}-{upload_date[6:8]}"
                    display_title = f"{display_title} ({formatted_date})"
                tasks[task_id]['download_name'] = f"{display_title}.{ext}"

        except Exception as e:
            tasks[task_id]['status'] = 'error'
            tasks[task_id]['error'] = str(e)

@app.post("/info")
def get_video_info(request: VideoRequest):
    try:
        # Detect if it's a channel URL, ensuring it's not a watch URL
        is_watch = "watch?v=" in request.url or "youtu.be/" in request.url
        is_channel = not is_watch and ("/@" in request.url or "/channel/" in request.url or "/c/" in request.url or "/user/" in request.url)
        
        if is_channel:
            # Robust way to get the base channel URL (e.g., https://www.youtube.com/@name)
            # Remove any trailing slashes and then take everything up to the 4th part
            clean_url = request.url.rstrip('/')
            parts = clean_url.split('/')
            # parts will be ['https:', '', 'www.youtube.com', '@name', 'videos']
            if len(parts) >= 4:
                base_url = "/".join(parts[:4])
            else:
                base_url = clean_url
            
            # If a specific tab is requested (for infinite scroll)
            if request.tab:
                suffix = f"/{request.tab.lower()}"
                tab_url = f"{base_url}{suffix}"
                start = (request.offset or 0) + 1
                end = start + 49
                
                ydl_opts = {
                    'quiet': True, 
                    'extract_flat': 'in_playlist',
                    'playlist_items': f"{start}:{end}",
                }
                
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    res = ydl.extract_info(tab_url, download=False)
                    entries = []
                    for entry in res.get('entries', []):
                        if entry:
                            entries.append({
                                'title': entry.get('title'),
                                'url': entry.get('url') or f"https://www.youtube.com/watch?v={entry.get('id')}",
                                'id': entry.get('id'),
                                'thumbnail': entry.get('thumbnails', [{}])[0].get('url') if entry.get('thumbnails') else None
                            })
                    return {"entries": entries, "next_offset": end if entries else None}

            # Initial channel load - just get first page of everything or specific tabs
            tabs = ["Videos", "Shorts", "Streams", "Playlists"]
            return {
                "is_channel": True,
                "title": base_url.split('@')[-1],
                "tabs": tabs,
                "original_url": request.url
            }

        # Existing Playlist/Video logic
        ydl_opts = {
            'quiet': True, 
            'extract_flat': 'in_playlist',
            'noplaylist': True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            # First extraction to see what it is
            result = ydl.extract_info(request.url, download=False)
            
            if result.get('_type') == 'playlist':
                entries = []
                for entry in result.get('entries', []):
                    if entry:
                        entries.append({
                            'title': entry.get('title'),
                            'url': f"https://www.youtube.com/watch?v={entry.get('id')}",
                            'id': entry.get('id')
                        })
                return {
                    "is_playlist": True,
                    "is_channel": False,
                    "title": result.get('title'),
                    "entries": entries,
                    "original_url": request.url
                }

            # If it's a single video, we re-extract with full info (subtitles, heatmap, etc)
            ydl_opts['extract_flat'] = False
            ydl_opts['writesubtitles'] = True
            ydl_opts['writeautomaticsub'] = True
            ydl_opts['subtitleslangs'] = ['en.*']
            
            info = ydl.extract_info(request.url, download=False)
            
            # Extract chapters
            chapters = []
            raw_chapters = info.get('chapters') or []
            for c in raw_chapters:
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
            
            # Subtitle/Transcript logic
            transcript = []
            subs = info.get('subtitles', {}) or {}
            auto_subs = info.get('automatic_captions', {}) or {}
            
            # Prefer manual English, then auto English
            en_subs = subs.get('en') or auto_subs.get('en') or auto_subs.get('en-orig')
            
            if en_subs:
                # Find vtt format
                vtt_url = next((s['url'] for s in en_subs if s.get('ext') == 'vtt'), None)
                if vtt_url:
                    try:
                        vtt_resp = requests.get(vtt_url)
                        if vtt_resp.status_code == 200:
                            transcript = parse_vtt(vtt_resp.text)
                    except:
                        pass

            return {
                "is_playlist": False,
                "is_channel": False,
                "title": info.get('title'),
                "duration": info.get('duration'),
                "thumbnail": info.get('thumbnail'),
                "formats": formats,
                "chapters": chapters,
                "heatmap": info.get('heatmap'),
                "transcript": transcript,
                "original_url": request.url
            }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/download")
async def start_download(request: DownloadRequest):
    task_id = str(uuid.uuid4())
    tasks[task_id] = {'status': 'queued', 'progress': 0}
    asyncio.create_task(download_worker(task_id, request))
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
        cleanup_task_files(task_id)
        if task_id in tasks:
            del tasks[task_id]

    background_tasks.add_task(cleanup)
    
    # Use the human-friendly download name if available
    filename = tasks[task_id].get('download_name', tasks[task_id].get('filename', 'video.mp4'))
    return FileResponse(file_path, filename=filename)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

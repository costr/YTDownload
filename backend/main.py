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
from ytmusicapi import YTMusic
import shutil
import zipfile

from contextlib import asynccontextmanager

# Initialize YTMusic
ytmusic = YTMusic()

async def auto_cleanup():
    """Periodically deletes files older than 1 hour in the temp folder."""
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
                if os.path.isfile(f): os.remove(f)
                else: shutil.rmtree(f)
        except Exception as e:
            print(f"Failed to delete {f}: {e}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

TEMP_DIR = os.path.join(os.getcwd(), "temp_downloads")
LIBRARY_DIR = os.path.join(os.getcwd(), "library")

for d in [TEMP_DIR, LIBRARY_DIR]:
    if not os.path.exists(d):
        os.makedirs(d, exist_ok=True)

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
    precise: bool = False
    clip: Optional[Clip] = None
    artist: Optional[str] = None
    album: Optional[str] = None
    is_music: bool = False
    is_collection: bool = False

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

def sanitize_path(name: str) -> str:
    if not name: return "Unknown"
    return re.sub(r'[\\/*?:"<>|]', "", name).strip()

async def download_worker(task_id: str, request: DownloadRequest):
    async with download_semaphore:
        cleanup_task_files(task_id)
        tasks[task_id]['status'] = 'processing'
        
        # 1. Setup paths
        artist_folder = sanitize_path(request.artist or "Downloads")
        if request.audio_only:
            sub_folder = sanitize_path(request.album or "Singles & EPs")
        else:
            sub_folder = "Music Videos"
        
        # The persistent library path
        lib_target_dir = os.path.join(LIBRARY_DIR, artist_folder, sub_folder)
        os.makedirs(lib_target_dir, exist_ok=True)
        
        # The temporary work path for this specific task (to be zipped)
        # We put it inside temp_downloads to ensure cleanup
        task_work_dir = os.path.join(TEMP_DIR, task_id)
        os.makedirs(task_work_dir, exist_ok=True)

        def progress_hook(d):
            if d['status'] == 'downloading':
                p_str = d.get('_percent_str', '0%').strip().replace('%', '')
                try:
                    tasks[task_id]['progress'] = float(p_str)
                except: pass
            elif d['status'] == 'finished':
                tasks[task_id]['progress'] = 100

        try:
            def run_ytdl():
                # If it's a collection, we use a template that preserves track titles
                if request.is_collection:
                    # In task_work_dir for zipping
                    out_tmpl = os.path.join(task_work_dir, "%(title)s.%(ext)s")
                else:
                    # Single file
                    out_tmpl = os.path.join(task_work_dir, f"{task_id}.%(ext)s")

                ydl_opts = {
                    'outtmpl': out_tmpl,
                    'quiet': True,
                    'noplaylist': not request.is_collection,
                    'progress_hooks': [progress_hook],
                    'concurrent_fragment_downloads': 5,
                    'format': 'bestvideo+bestaudio/best' if not request.audio_only else 'bestaudio/best',
                    'sponsorblock_remove': ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview'],
                    'writethumbnail': True,
                    'writemetadata': True,
                    'postprocessors': [
                        {'key': 'FFmpegMetadata', 'add_chapters': True},
                        {'key': 'EmbedThumbnail'},
                    ],
                }

                if request.audio_only:
                    ydl_opts['postprocessors'].insert(0, {
                        'key': 'FFmpegExtractAudio',
                        'preferredcodec': 'mp3',
                        'preferredquality': '320',
                    })
                elif request.format_id != "best":
                    ydl_opts['format'] = f"{request.format_id}+bestaudio/best"
                    ydl_opts['merge_output_format'] = 'mp4'

                if request.clip and not request.is_collection:
                    ydl_opts['download_ranges'] = lambda info_dict, ydl: [{
                        'start_time': parse_time(request.clip.start),
                        'end_time': parse_time(request.clip.end) if request.clip.end else info_dict.get('duration'),
                    }]
                    ydl_opts['force_keyframes_at_cuts'] = request.precise
                    ydl_opts['prefer_ffmpeg'] = True

                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    ydl.download([request.url])

            await asyncio.to_thread(run_ytdl)

            # 2. After download, sync to LIBRARY and prepare return
            valid_extensions = ('.mp4', '.mp3', '.m4a', '.webm', '.mkv', '.wav', '.jpg', '.png', '.webp')
            downloaded_files = [f for f in os.listdir(task_work_dir) if f.lower().endswith(valid_extensions)]
            
            # Copy all files to the library for Plex (persistent)
            for f in downloaded_files:
                src = os.path.join(task_work_dir, f)
                # If it's a thumbnail and we want 'cover.jpg' logic
                if f.lower().endswith(('.jpg', '.png', '.webp')) and request.artist:
                    dst = os.path.join(lib_target_dir, "cover.jpg")
                    if not os.path.exists(dst): shutil.copy2(src, dst)
                else:
                    dst = os.path.join(lib_target_dir, f)
                    shutil.copy2(src, dst)

            # 3. Handle browser download delivery
            if request.is_collection:
                # Create a zip of the task_work_dir
                zip_filename = f"{sanitize_path(request.title or 'collection')}.zip"
                zip_path = os.path.join(TEMP_DIR, f"{task_id}.zip")
                
                with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                    for f in downloaded_files:
                        zipf.write(os.path.join(task_work_dir, f), f)
                
                tasks[task_id]['status'] = 'completed'
                tasks[task_id]['file_path'] = zip_path
                tasks[task_id]['filename'] = f"{task_id}.zip"
                tasks[task_id]['download_name'] = zip_filename
            else:
                # Single file delivery
                media_files = [f for f in downloaded_files if f.lower().endswith(('.mp4', '.mp3', '.m4a', '.webm', '.mkv', '.wav'))]
                if media_files:
                    # Rename task_id file if it's there
                    src = os.path.join(task_work_dir, media_files[0])
                    ext = os.path.splitext(media_files[0])[1][1:]
                    final_name = f"{task_id}.{ext}"
                    final_path = os.path.join(TEMP_DIR, final_name)
                    shutil.move(src, final_path)
                    
                    tasks[task_id]['status'] = 'completed'
                    tasks[task_id]['file_path'] = final_path
                    tasks[task_id]['filename'] = final_name
                    tasks[task_id]['download_name'] = f"{sanitize_path(request.title or 'video')}.{ext}"
                else:
                    tasks[task_id]['status'] = 'error'
                    tasks[task_id]['error'] = "No media file found after download"

            # Cleanup the task work dir
            shutil.rmtree(task_work_dir)

        except Exception as e:
            tasks[task_id]['status'] = 'error'
            tasks[task_id]['error'] = str(e)
            if os.path.exists(task_work_dir): shutil.rmtree(task_work_dir)

@app.post("/info")
def get_video_info(request: VideoRequest):
    print(f"DEBUG: Received /info request for URL: {request.url}, Tab: {request.tab}")
    try:
        is_music = "music.youtube.com" in request.url
        is_watch = "watch?v=" in request.url or "youtu.be/" in request.url
        is_channel = not is_watch and ("/@" in request.url or "/channel/" in request.url or "/c/" in request.url or "/user/" in request.url or (is_music and "/channel/" in request.url) or (is_music and "/browse/MPAD" in request.url))
        
        print(f"DEBUG: is_music={is_music}, is_watch={is_watch}, is_channel={is_channel}")
        
        if is_channel:
            # Clean the URL and extract the identifier (handle or ID)
            clean_url = request.url.split('?')[0].split('#')[0].rstrip('/')
            parts = clean_url.split('/')
            
            # The identifier is usually the last part (e.g., @Artist or UC...)
            # unless it's in the /channel/ID format
            identifier = parts[-1]
            if "/channel/" in clean_url:
                identifier = parts[parts.index("channel") + 1]
            
            print(f"DEBUG: Identifier extracted: {identifier}")
            
            # Resolve the actual channel ID if it's a handle or other type
            channel_id = identifier
            if identifier.startswith('@') or "/c/" in clean_url or "/user/" in clean_url:
                try:
                    print(f"DEBUG: Resolving handle/vanity URL: {clean_url}")
                    with yt_dlp.YoutubeDL({'quiet': True, 'extract_flat': True}) as ydl:
                        res = ydl.extract_info(clean_url, download=False)
                        channel_id = res.get('channel_id') or identifier
                    print(f"DEBUG: Resolved channel_id: {channel_id}")
                except Exception as e:
                    print(f"DEBUG: Handle resolution failed: {e}")

            if is_music:
                try:
                    norm_tab = request.tab.strip() if request.tab else ""
                    print(f"DEBUG: Processing music tab '{norm_tab}' for channel {channel_id}", flush=True)
                    
                    if norm_tab in ["Albums", "Singles", "Singles & EPs"]:
                        artist = ytmusic.get_artist(channel_id)
                        print(f"DEBUG: Artist keys: {list(artist.keys())}", flush=True)
                        is_singles_mode = "Singles" in norm_tab
                        
                        # Collect everything from both keys
                        raw_candidates = []
                        for k in ["singles", "albums"]:
                            tab_key = next((key for key in artist.keys() if key.lower() == k), None)
                            if not tab_key: continue
                            
                            data = artist[tab_key]
                            items = data.get('results', [])
                            if 'browseId' in data and 'params' in data:
                                try:
                                    print(f"DEBUG: Fetching full {k} list...", flush=True)
                                    items += ytmusic.get_artist_albums(data['browseId'], data['params'])
                                except: pass
                            
                            for r in items:
                                r['_src'] = k
                                raw_candidates.append(r)

                        results = []
                        seen = set()
                        for r in raw_candidates:
                            rid = r.get('browseId') or r.get('playlistId')
                            if not rid or rid in seen: continue
                            
                            rtype = (r.get('type') or "").lower()
                            rtitle = (r.get('title') or "").lower()
                            is_s = any(x in rtype for x in ["single", "ep"]) or any(x in rtitle for x in ["single", "ep"])
                            
                            if is_singles_mode:
                                # For Singles: include anything from 'singles' source OR anything marked single/ep
                                if r['_src'] == "singles" or is_s:
                                    results.append(r)
                                    seen.add(rid)
                            else:
                                # For Albums: include from 'albums' source that are NOT singles/eps
                                if r['_src'] == "albums" and not is_s:
                                    results.append(r)
                                    seen.add(rid)
                        
                        entries = []
                        for r in results:
                            p_id = r.get('browseId') or r.get('playlistId')
                            final_id = r.get('audioPlaylistId') or r.get('playlistId') or p_id
                            entries.append({
                                'title': r.get('title'),
                                'url': f"https://music.youtube.com/playlist?list={final_id}",
                                'id': p_id,
                                'thumbnail': r.get('thumbnails', [{}])[-1].get('url') if r.get('thumbnails') else None,
                                'is_music': True,
                                'is_playlist': True
                            })
                        print(f"DEBUG: Returning {len(entries)} entries for {norm_tab}", flush=True)
                        return {"entries": entries, "next_offset": None, "is_music": True}
                    
                    elif norm_tab == "Videos":
                        # For videos on music channels, we still use standard YT channel logic
                        tab_url = f"https://www.youtube.com/channel/{channel_id}/videos"
                        start = (request.offset or 0) + 1
                        end = start + 14
                        ydl_opts = {'quiet': True, 'extract_flat': 'in_playlist', 'playlist_items': f"{start}:{end}"}
                        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                            res = ydl.extract_info(tab_url, download=False)
                            entries = []
                            for entry in res.get('entries', []):
                                if not entry or not entry.get('id'): continue
                                entries.append({
                                    'title': entry.get('title'),
                                    'url': f"https://music.youtube.com/watch?v={entry.get('id')}",
                                    'id': entry.get('id'),
                                    'thumbnail': entry.get('thumbnail') or (entry.get('thumbnails')[0].get('url') if entry.get('thumbnails') else None),
                                    'is_music': True,
                                    'is_playlist': False
                                })
                            return {"entries": entries, "next_offset": end if len(entries) >= 15 else None, "is_music": True}

                    # Initial channel load
                    artist = ytmusic.get_artist(channel_id)
                    return {
                        "is_channel": True, "is_music": True, "title": artist.get('name') or identifier,
                        "tabs": ["Albums", "Singles & EPs", "Videos"], "active_tab": "Albums", "original_url": request.url
                    }
                except Exception as e:
                    print(f"Music browsing error: {e}", flush=True)
                    # If music browsing fails, we don't fall through to non-music logic for music URLs
                    raise HTTPException(status_code=400, detail=f"Failed to load music channel: {str(e)}")

            # Standard YouTube Channel Logic (non-music)
            base_url = clean_url
            if request.tab:
                yt_tab_map = {"Albums": "playlists", "Singles": "playlists", "Singles & EPs": "playlists", "Videos": "videos", "Playlists": "playlists", "Shorts": "shorts", "Streams": "streams"}
                tab_url = f"{base_url}/{yt_tab_map.get(request.tab, request.tab.lower())}"
                start = (request.offset or 0) + 1
                end = start + 14
                ydl_opts = {'quiet': True, 'extract_flat': 'in_playlist', 'playlist_items': f"{start}:{end}"}
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    res = ydl.extract_info(tab_url, download=False)
                    entries = []
                    for entry in res.get('entries', []):
                        if not entry or not entry.get('id') or entry.get('title') == '[Private video]': continue
                        entries.append({
                            'title': entry.get('title'),
                            'url': f"https://www.youtube.com/playlist?list={entry.get('id')}" if entry.get('_type') == 'playlist' else f"https://www.youtube.com/watch?v={entry.get('id')}",
                            'id': entry.get('id'),
                            'thumbnail': entry.get('thumbnail') or (entry.get('thumbnails')[0].get('url') if entry.get('thumbnails') else None),
                            'is_music': is_music,
                            'is_playlist': entry.get('_type') == 'playlist'
                        })
                    return {"entries": entries, "next_offset": end if len(entries) >= 15 else None, "is_music": is_music}

            with yt_dlp.YoutubeDL({'quiet': True, 'extract_flat': True}) as ydl:
                res = ydl.extract_info(base_url, download=False)
                channel_title = res.get('channel') or res.get('uploader') or res.get('title') or base_url.split('/')[-1]

            tabs = ["Albums", "Singles & EPs", "Videos", "Playlists"] if is_music else ["Videos", "Shorts", "Streams", "Playlists"]
            return {"is_channel": True, "is_music": is_music, "title": channel_title, "tabs": tabs, "active_tab": "Albums" if is_music else "Videos", "original_url": request.url}

        ydl_opts = {'quiet': True, 'extract_flat': 'in_playlist', 'noplaylist': True}
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            result = ydl.extract_info(request.url, download=False)
            if result.get('_type') == 'playlist' or 'entries' in result:
                entries = []
                for entry in result.get('entries', []):
                    if not entry or not entry.get('id') or entry.get('title') == '[Private video]': continue
                    entries.append({
                        'title': entry.get('title') or f"Video {entry.get('id')}",
                        'url': entry.get('url') or f"https://www.youtube.com/watch?v={entry.get('id')}",
                        'id': entry.get('id'),
                        'thumbnail': entry.get('thumbnail') or (entry.get('thumbnails')[0].get('url') if entry.get('thumbnails') else None),
                        'is_music': is_music
                    })
                return {"is_playlist": True, "is_channel": False, "is_music": is_music, "title": result.get('title'), "entries": entries, "original_url": request.url}

            ydl_opts['extract_flat'] = False
            if not is_music:
                ydl_opts['writesubtitles'] = True
                ydl_opts['writeautomaticsub'] = True
                ydl_opts['subtitleslangs'] = ['en.*', 'en', 'en-US', 'en-GB', '.*']
            
            info = ydl.extract_info(request.url, download=False)
            return {
                "is_playlist": False, "is_channel": False, "is_music": is_music,
                "title": info.get('title'), "artist": info.get('artist') or info.get('uploader'), "album": info.get('album'),
                "duration": info.get('duration'), "thumbnail": info.get('thumbnail'),
                "formats": [{'format_id': f['format_id'], 'resolution': f"{f.get('height')}p", 'ext': f.get('ext', 'mp4')} for f in info.get('formats', []) if f.get('height') and f.get('height') >= 360],
                "chapters": [{'title': c.get('title'), 'start': c.get('start_time'), 'end': c.get('end_time')} for c in (info.get('chapters') or [])],
                "heatmap": info.get('heatmap') if not is_music else None, "transcript": [], "original_url": request.url
            }
    except Exception as e: raise HTTPException(status_code=400, detail=str(e))

@app.post("/download")
async def start_download(request: DownloadRequest):
    task_id = str(uuid.uuid4())
    tasks[task_id] = {'status': 'queued', 'progress': 0}
    asyncio.create_task(download_worker(task_id, request))
    return {"task_id": task_id}

@app.get("/status/{task_id}")
def get_status(task_id: str):
    if task_id not in tasks: raise HTTPException(status_code=404, detail="Task not found")
    return tasks[task_id]

@app.get("/download/{task_id}")
def download_file(task_id: str, background_tasks: BackgroundTasks):
    if task_id not in tasks or tasks[task_id]['status'] != 'completed': raise HTTPException(status_code=400, detail="File not ready")
    file_path = tasks[task_id]['file_path']
    def cleanup():
        time.sleep(15)
        cleanup_task_files(task_id)
        if os.path.exists(file_path): 
            try: os.remove(file_path)
            except: pass
        if task_id in tasks: del tasks[task_id]
    background_tasks.add_task(cleanup)
    filename = tasks[task_id].get('download_name', tasks[task_id].get('filename', 'video.mp4'))
    return FileResponse(file_path, filename=filename)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)

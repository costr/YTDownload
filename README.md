# YouTube Split & Download

A modern web application for downloading YouTube videos, audio, and specific clips. Features include transcript searching, chapter suggestions, and channel browsing.

## Features

- **Video & Audio Downloads:** High-quality MP4 and MP3 support.
- **Precise Clipping:** Mark start and end times to download specific segments.
- **Channel & Playlist Browsing:** Search and select videos directly from channels and playlists.
- **Transcript Search:** Find specific moments in a video using its transcript.
- **Heatmap Visualization:** Identify the most replayed parts of a video.
- **SponsorBlock Integration:** Automatically removes sponsors and non-music sections.
- **No Installation Required (Browser-based):** Runs in your browser with a Python backend.

---

## Installation & Setup

### Option 1: Docker (Recommended)

Ensure you have [Docker](https://www.docker.com/) and [Docker Compose](https://docs.docker.com/compose/) installed.

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd YTDownloader
   ```

2. **Run with Docker Compose:**
   ```bash
   docker-compose up --build
   ```

3. **Access the application:**
   - Frontend: `http://localhost:3000`
   - Backend: `http://localhost:8000`

### Option 2: Manual Installation (Windows/Linux)

#### Prerequisites
- **Python 3.10+**
- **Node.js 18+**
- **FFmpeg:** Required for `yt-dlp` post-processing.
  - **Windows:** Download from [gyan.dev](https://www.gyan.dev/ffmpeg/builds/) and add to your PATH.
  - **Linux:** `sudo apt install ffmpeg`

#### Backend Setup
1. Navigate to the `backend` directory:
   ```bash
   cd backend
   ```
2. Create a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # Linux/Mac
   .\venv\Scripts\activate     # Windows
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Start the backend:
   ```bash
   python main.py
   ```

#### Frontend Setup
1. Navigate to the `frontend` directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the development server:
   ```bash
   npm run dev
   ```
4. Access the frontend at `http://localhost:5173`.

---

## How to Use

### 1. Fetching a Video
Paste a YouTube URL (Video, Playlist, or Channel) into the search box and click **Fetch Video**.

### 2. Creating Clips
- While the video is playing, click **Mark Current Time** to set the start or end point of a clip.
- You can manually adjust the timestamps in the **Download Queue**.
- Use the **Suggested Chapters** section to quickly add segments based on the video's chapters.

### 3. Searching Transcripts
- If the video has English captions, a search box will appear.
- Type keywords to find specific lines. Clicking a search result will seek the video player to that timestamp.

### 4. Downloading
- In the **Download Queue**, choose between **Video** or **Audio** format for each clip.
- Click **Start** to begin the process. Once finished, the file will automatically be saved to your downloads folder.
- Use **Queue Full Video** or **Queue Full Audio** to quickly add the entire video to the queue.

### 5. Channel/Playlist Browsing
- If you enter a channel or playlist URL, you can browse through the videos.
- Use the **Inspect** (Eye icon) to view details of a specific video or **Plus** icon to add it to your queue.
- Support for "Videos", "Shorts", "Streams", and "Playlists" tabs in channels.

---

## Tech Stack

- **Frontend:** React, TypeScript, Vite, Axios, Lucide-React.
- **Backend:** FastAPI (Python), yt-dlp, uvicorn.
- **Containerization:** Docker, Docker Compose, Nginx.

## Security & Safety

- No personal data is stored.
- Downloaded files are temporarily stored in `backend/temp_downloads` and automatically cleaned up.
- Never commit secrets or API keys.

## License
MIT License - See [LICENSE](LICENSE) for details.

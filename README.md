# YTDownloader

A modern web application for downloading YouTube videos, audio, and specific clips. Features include transcript searching, chapter suggestions, and channel browsing.

## Features

- **Video & Audio Downloads:** High-quality MP4 and MP3 (up to 320kbps) support.
- **Dual Format Support:** Independently select Video, Audio, or both for every clip in the queue.
- **YouTube Music Support:** Download songs, albums, and playlists directly from music.youtube.com with full metadata and album art.
- **Precise Clipping:** Mark start and end times to download specific segments.
- **Togglable Precision:** Choose between **Rough Cut** (fast, keyframe-accurate) and **Fine Cut** (precise, frame-accurate via re-encoding).
- **Channel & Playlist Browsing:** Search and select videos directly from channels and playlists.
- **Transcript Search:** Find specific moments in a video using its transcript.
- **Heatmap Visualization:** Identify the most replayed parts of a video.
- **SponsorBlock Integration:** Automatically removes sponsors and non-music sections.
- **User-Friendly UI:** Includes helpful tooltips for every control and floating status indicators.

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

## Local Network Access

By default, the application is configured for `localhost`. To access it from other devices on your network (e.g., a phone or another computer), follow these steps:

### Using Docker
1. Find your computer's local IP address (e.g., `192.168.1.138`).
   - **Windows**: Run `ipconfig` in PowerShell.
   - **Linux/Mac**: Run `hostname -I` or `ifconfig`.
2. Open `docker-compose.yml` and update the `VITE_API_BASE` build argument for the frontend:
   ```yaml
   args:
     - VITE_API_BASE=http://<YOUR_LOCAL_IP>:8000
   ```
3. Rebuild and restart the containers:
   ```bash
   docker-compose up --build
   ```
4. Access the app on any device using `http://<YOUR_LOCAL_IP>:3000`.

### Using Manual Installation
1. Ensure the backend is listening on all interfaces (it is by default in `main.py`):
   ```python
   uvicorn.run(app, host="0.0.0.0", port=8000)
   ```
2. In the `frontend` directory, create a `.env.local` file:
   ```env
   VITE_API_BASE=http://<YOUR_LOCAL_IP>:8000
   ```
3. Restart the frontend development server.
4. Access the app via `http://<YOUR_LOCAL_IP>:5173`.

---

## How to Use

### 1. Fetching a Video / Song
Paste a YouTube or YouTube Music URL (Video, Song, Album, Playlist, or Channel) into the search box and click **Fetch Video**.

### 2. Creating Clips
- While the video is playing, click **Mark Current Time** to set the start or end point of a clip.
- You can manually adjust the timestamps in the **Download Queue**.
- Use the **Suggested Chapters** section to quickly add segments based on the video's chapters.

### 3. Precision Settings (Fine vs. Rough Cut)
- For every clip, you can toggle between **Rough Cut** and **Fine Cut**.
- **Rough Cut**: Keyframe-accurate. Fastest processing but might be +/- 1-2 seconds off.
- **Fine Cut**: Frame-accurate. Uses re-encoding to match your exact timestamps. Takes slightly longer to process.

### 4. Searching Transcripts
- If the video has English captions, a search box will appear.
- Type keywords to find specific lines. Clicking a search result will seek the video player to that timestamp.

### 5. Downloading
- In the **Download Queue**, select **Video**, **Audio**, or both for each clip.
- Click **Start** to begin. If both formats are selected, the application will automatically create two separate download tasks.
- Once finished, files are automatically saved to your browser's downloads folder.

### 6. Channel/Playlist Browsing
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

## Credits

This project was developed with the assistance of **Gemini CLI**, an interactive AI agent specializing in software engineering tasks, which helped with implementation, containerization, and documentation.

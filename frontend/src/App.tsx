import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { Plus, Trash2, Download, Clock, Loader2, CheckCircle, AlertCircle, Music, Video, List, Search, CheckSquare, Square, Check } from 'lucide-react';
import './App.css';

interface VideoFormat {
  format_id: string;
  resolution: string;
  ext: string;
}

interface Chapter {
  title: string;
  start: number;
  end: number;
}

interface HeatmapPoint {
  start_time: number;
  end_time: number;
  value: number;
}

interface TranscriptLine {
  start: number;
  text: string;
}

interface PlaylistEntry {
  title: string;
  url: string;
  id: string;
}

interface VideoInfo {
  is_playlist: boolean;
  entries?: PlaylistEntry[];
  title: string;
  duration?: number;
  thumbnail?: string;
  formats: VideoFormat[];
  chapters: Chapter[];
  heatmap?: HeatmapPoint[];
  transcript?: TranscriptLine[];
  original_url: string;
}

interface Clip {
  id: string;
  title: string;
  url?: string;
  start: string;
  end: string;
  audioOnly: boolean;
  status: 'idle' | 'processing' | 'completed' | 'error';
  progress: number;
  taskId?: string;
}

const API_BASE = "http://localhost:8000";

declare global {
  interface Window {
    onYouTubeIframeAPIReady: () => void;
    YT: any;
  }
}

function App() {
  const [url, setUrl] = useState('');
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [clips, setClips] = useState<Clip[]>([]);
  const [selectedFormat, setSelectedFormat] = useState('best');
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<string[]>([]);

  const playerRef = useRef<any>(null);
  const [playerReady, setPlayerReady] = useState(false);

  useEffect(() => {
    if (!window.YT) {
      const tag = document.createElement('script');
      tag.src = "https://www.youtube.com/iframe_api";
      const firstScriptTag = document.getElementsByTagName('script')[0];
      firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
      window.onYouTubeIframeAPIReady = () => setPlayerReady(true);
    } else {
      setPlayerReady(true);
    }
  }, []);

  useEffect(() => {
    const processingClips = clips.filter(c => c.status === 'processing');
    if (processingClips.length === 0) return;

    const interval = setInterval(async () => {
      const updatedClips = [...clips];
      let changed = false;

      await Promise.all(processingClips.map(async (clip) => {
        try {
          const res = await axios.get(`${API_BASE}/status/${clip.taskId}`);
          const idx = updatedClips.findIndex(c => c.id === clip.id);
          if (idx !== -1) {
             const data = res.data;
             if (updatedClips[idx].progress !== data.progress || updatedClips[idx].status !== data.status) {
                updatedClips[idx] = { ...updatedClips[idx], status: data.status, progress: data.progress };
                changed = true;
                
                // If it just finished, trigger the file save automatically
                if (data.status === 'completed') {
                  finalizeDownload(updatedClips[idx].id);
                }
             }
          }
        } catch (e) {
          console.error("Status check failed", e);
        }
      }));

      if (changed) setClips(updatedClips);
    }, 1000);

    return () => clearInterval(interval);
  }, [clips]);

  useEffect(() => {
    if (info && playerReady) {
      const videoId = extractVideoId(info.original_url);
      if (videoId) {
        const timer = setTimeout(() => {
          if (playerRef.current && playerRef.current.loadVideoById) {
            playerRef.current.loadVideoById(videoId);
          } else if (window.YT && window.YT.Player) {
            playerRef.current = new window.YT.Player('yt-player', {
              videoId: videoId,
              height: '100%',
              width: '100%',
              playerVars: { 'autoplay': 0, 'modestbranding': 1 },
              events: { 'onReady': () => console.log('Player Ready') }
            });
          }
        }, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [info, playerReady]);

  const fetchInfo = async () => {
    if (!url) return;
    setLoading(true);
    setError('');
    try {
      const res = await axios.post(`${API_BASE}/info`, { url });
      setInfo(res.data);
      setClips([]);
      setTranscriptSearch('');
      setSelectedPlaylistIds([]);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to fetch video info');
    } finally {
      setLoading(false);
    }
  };

  const extractVideoId = (url: string) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [h > 0 ? h : null, m, s]
      .filter(x => x !== null)
      .map(x => x!.toString().padStart(2, '0'))
      .join(':');
  };

  const getCurrentTime = () => {
    if (playerRef.current && playerRef.current.getCurrentTime) {
      return formatTime(playerRef.current.getCurrentTime());
    }
    return "00:00";
  };

  const addClip = () => {
    const nextNum = clips.length + 1;
    setClips([...clips, { 
      id: Math.random().toString(36).substr(2, 9), 
      title: `Clip ${nextNum}`,
      start: '00:00', 
      end: '', 
      audioOnly: false,
      status: 'idle', 
      progress: 0 
    }]);
  };

  const addSuggestionAsClip = (chapter: Chapter) => {
    setClips([...clips, {
      id: Math.random().toString(36).substr(2, 9),
      title: chapter.title,
      start: formatTime(chapter.start),
      end: formatTime(chapter.end),
      audioOnly: false,
      status: 'idle',
      progress: 0
    }]);
  };

  const updateClip = (id: string, field: keyof Clip, value: any) => {
    setClips(clips.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const removeClip = (id: string) => {
    setClips(clips.filter(c => c.id !== id));
  };

  const startDownload = async (clipId: string, currentClips?: Clip[]) => {
    const list = currentClips || clips;
    const clip = list.find(c => c.id === clipId);
    if (!clip) return;

    setClips(prev => prev.map(c => c.id === clipId ? { ...c, status: 'processing', progress: 0 } : c));

    try {
      // If it's a "Full" download, we can skip the clip parameter for cleaner yt-dlp execution
      const isFull = clip.start === '00:00' && !clip.end;
      
      const res = await axios.post(`${API_BASE}/download`, {
        url: clip.url || info?.original_url,
        title: clip.title,
        format_id: selectedFormat,
        audio_only: clip.audioOnly,
        clip: isFull ? null : { start: clip.start, end: clip.end }
      });
      
      setClips(prev => prev.map(c => c.id === clipId ? { ...c, status: 'processing', taskId: res.data.task_id } : c));
    } catch (err) {
      setClips(prev => prev.map(c => c.id === clipId ? { ...c, status: 'error' } : c));
    }
  };

  const finalizeDownload = async (clipId: string) => {
    const clip = clips.find(c => c.id === clipId);
    if (!clip || !clip.taskId) return;

    try {
      const response = await axios.get(`${API_BASE}/download/${clip.taskId}`, { responseType: 'blob' });
      const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = blobUrl;
      
      // Preserve casing and spaces, but remove invalid system characters
      const safeTitle = clip.title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
      link.setAttribute('download', `${safeTitle}.${clip.audioOnly ? 'mp3' : 'mp4'}`);
      
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      alert("Failed to save file.");
    }
  };

  return (
    <div className="app-container">
      <h1>YouTube Split & Download</h1>
      
      <div className="card">
        <div className="input-group">
          <input 
            type="text" 
            placeholder="Paste YouTube URL here..." 
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={loading}
            style={{flex: 1}}
          />
          <button onClick={fetchInfo} disabled={loading}>
            {loading ? 'Loading...' : 'Fetch Video'}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
      </div>

      {info && info.is_playlist && (
        <div className="card">
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem'}}>
            <h2 style={{margin: 0}}>{info.title} (Playlist)</h2>
            <div style={{display: 'flex', gap: '0.5rem'}}>
              <button 
                onClick={() => {
                  if (selectedPlaylistIds.length === info.entries?.length) {
                    setSelectedPlaylistIds([]);
                  } else {
                    setSelectedPlaylistIds(info.entries?.map(e => e.id) || []);
                  }
                }}
                style={{background: '#333', color: 'white'}}
              >
                {selectedPlaylistIds.length === info.entries?.length ? 'Deselect All' : 'Select All'}
              </button>
              <button 
                disabled={selectedPlaylistIds.length === 0}
                onClick={() => {
                const newClips: Clip[] = [];
                info.entries?.forEach(entry => {
                  if (selectedPlaylistIds.includes(entry.id)) {
                    newClips.push({
                      id: Math.random().toString(36).substr(2, 9),
                      title: entry.title,
                      url: entry.url,
                      start: '00:00',
                      end: '',
                      audioOnly: false,
                      status: 'idle',
                      progress: 0,
                    });
                  }
                });
                setClips([...clips, ...newClips]);
                setSelectedPlaylistIds([]);
              }}
              style={{background: selectedPlaylistIds.length > 0 ? '#ff0000' : '#555'}}
            >
              Add {selectedPlaylistIds.length} to Queue
            </button>
          </div>
        </div>
        <div className="playlist-entries">
            {info.entries?.map(entry => (
              <div 
                key={entry.id} 
                className={`playlist-item ${selectedPlaylistIds.includes(entry.id) ? 'selected' : ''}`}
                onClick={() => {
                  if (selectedPlaylistIds.includes(entry.id)) {
                    setSelectedPlaylistIds(selectedPlaylistIds.filter(id => id !== entry.id));
                  } else {
                    setSelectedPlaylistIds([...selectedPlaylistIds, entry.id]);
                  }
                }}
              >
                {selectedPlaylistIds.includes(entry.id) ? <CheckSquare size={18} color="#ff0000"/> : <Square size={18}/>}
                <span>{entry.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {info && !info.is_playlist && (
        <div className="card">
          <div className="video-section">
            <div>
              <div className="player-container">
                <div id="yt-player"></div>
              </div>

              {info.heatmap && info.heatmap.length > 0 && (
                <div className="heatmap-container" title="Most Replayed Moments">
                  {info.heatmap.map((point, i) => (
                    <div 
                      key={i} 
                      className="heatmap-bar" 
                      style={{height: `${Math.max(10, point.value * 100)}%`}}
                      onClick={() => {
                        if (playerRef.current && playerRef.current.seekTo) {
                          playerRef.current.seekTo(point.start_time, true);
                        }
                      }}
                    ></div>
                  ))}
                </div>
              )}

              <div className="controls-overlay">
                <button onClick={() => {
                   const time = getCurrentTime();
                   if (clips.length === 0) {
                     setClips([{ id: '1', title: 'Clip 1', start: time, end: '', audioOnly: false, status: 'idle', progress: 0 }]);
                   } else {
                     const last = clips[clips.length - 1];
                     if (!last.end && last.status === 'idle') {
                        updateClip(last.id, 'end', time);
                     } else {
                        setClips([...clips, { 
                          id: Math.random().toString(36).substr(2, 9), 
                          title: `Clip ${clips.length + 1}`,
                          start: time, 
                          end: '', 
                          audioOnly: false,
                          status: 'idle', 
                          progress: 0 
                        }]);
                     }
                   }
                }}>
                  <Clock size={16} style={{marginRight: '5px'}} />
                  Mark Current Time
                </button>

                {info.transcript && info.transcript.length > 0 && (
                  <div className="transcript-search-wrapper">
                    <Search size={14} style={{position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#666'}}/>
                    <input 
                      type="text" 
                      className="transcript-search-input"
                      placeholder="Search transcript..."
                      value={transcriptSearch}
                      onChange={(e) => setTranscriptSearch(e.target.value)}
                    />
                  </div>
                )}
              </div>

              {info.transcript && info.transcript.length > 0 && transcriptSearch && (
                <div className="transcript-results" style={{marginTop: '0.5rem'}}>
                  {info.transcript
                    .filter(line => line.text.toLowerCase().includes(transcriptSearch.toLowerCase()))
                    .slice(0, 15)
                    .map((line, i) => (
                      <div 
                        key={i} 
                        className="transcript-item"
                        onClick={() => {
                          if (playerRef.current && playerRef.current.seekTo) {
                            playerRef.current.seekTo(line.start, true);
                          }
                        }}
                      >
                        <span className="transcript-time">{formatTime(line.start)}</span>
                        <span className="transcript-text">{line.text}</span>
                      </div>
                    ))
                  }
                  {info.transcript.filter(line => line.text.toLowerCase().includes(transcriptSearch.toLowerCase())).length === 0 && (
                    <div style={{color: '#666', fontSize: '0.85rem', padding: '0.5rem'}}>No matches found.</div>
                  )}
                </div>
              )}

              <div className="footer-controls" style={{ marginTop: '1.5rem', justifyContent: 'flex-start' }}>
                <div style={{display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap'}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                    <label style={{fontSize: '0.9rem', color: '#888'}}>Output:</label>
                    <select className="format-select" value={selectedFormat} onChange={(e) => setSelectedFormat(e.target.value)}>
                      <option value="best">Best Quality</option>
                      {info.formats.map(f => (
                        <option key={f.format_id} value={f.format_id}>{f.resolution} ({f.ext})</option>
                      ))}
                    </select>
                  </div>

                  <div style={{display: 'flex', gap: '0.5rem'}}>
                    <button 
                      onClick={() => {
                        const id = Math.random().toString(36).substr(2, 9);
                        const newClip: Clip = {
                          id,
                          title: info.title + " (Full Video)",
                          start: '00:00',
                          end: '',
                          audioOnly: false,
                          status: 'idle',
                          progress: 0
                        };
                        setClips(prev => {
                          const newList = [...prev, newClip];
                          startDownload(id, newList);
                          return newList;
                        });
                      }}
                      style={{background: '#333', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem'}}
                    >
                      <Video size={16}/> Full Video
                    </button>
                    <button 
                      onClick={() => {
                        const id = Math.random().toString(36).substr(2, 9);
                        const newClip: Clip = {
                          id,
                          title: info.title + " (Full Audio)",
                          start: '00:00',
                          end: '',
                          audioOnly: true,
                          status: 'idle',
                          progress: 0
                        };
                        setClips(prev => {
                          const newList = [...prev, newClip];
                          startDownload(id, newList);
                          return newList;
                        });
                      }}
                      style={{background: '#333', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem'}}
                    >
                      <Music size={16}/> Full Audio
                    </button>
                  </div>
                </div>
              </div>

              {info.chapters && info.chapters.length > 0 && (
                <div style={{marginTop: '1.5rem'}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#888', marginBottom: '0.5rem', fontSize: '0.9rem'}}>
                    <List size={16}/> Suggested Chapters
                  </div>
                  <div className="suggestions-container">
                    {info.chapters.map((chapter, i) => (
                      <div key={i} className="suggestion-chip" onClick={() => addSuggestionAsClip(chapter)}>
                         {chapter.title}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {clips.length > 0 && (
        <div className="card">
          <div className="clip-list">
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
              <h3 style={{margin: 0}}>Download Queue ({clips.length})</h3>
              <div style={{display: 'flex', gap: '0.5rem'}}>
                <button 
                  onClick={() => {
                    clips.filter(c => c.status === 'idle').forEach(c => startDownload(c.id));
                  }}
                  className="icon-btn" 
                  style={{backgroundColor: '#ff0000', borderRadius: '6px', padding: '0.5rem 1rem', width: 'auto', fontSize: '0.8rem', display: 'flex', gap: '0.5rem', height: 'auto'}}
                  title="Start All"
                >
                  <Download size={14}/> Start All
                </button>
                <button 
                  onClick={() => setClips(clips.map(c => ({ ...c, audioOnly: false })))}
                  className="icon-btn" 
                  style={{backgroundColor: '#444', borderRadius: '6px', padding: '0.5rem 1rem', width: 'auto', fontSize: '0.8rem', display: 'flex', gap: '0.5rem', height: 'auto'}}
                  title="Set all to Video"
                >
                  <Video size={14}/> Video All
                </button>
                <button 
                  onClick={() => setClips(clips.map(c => ({ ...c, audioOnly: true })))}
                  className="icon-btn" 
                  style={{backgroundColor: '#444', borderRadius: '6px', padding: '0.5rem 1rem', width: 'auto', fontSize: '0.8rem', display: 'flex', gap: '0.5rem', height: 'auto'}}
                  title="Set all to Audio"
                >
                  <Music size={14}/> Audio All
                </button>
                <button onClick={addClip} className="icon-btn" style={{backgroundColor: '#444', padding: '0.5rem'}}>
                  <Plus size={20}/>
                </button>
              </div>
            </div>
            
            {clips.map((clip) => (
              <div key={clip.id} className="clip-item">
                <div className="clip-row">
                  <div className="clip-inputs">
                    <input 
                      className="clip-title-input"
                      type="text" 
                      placeholder="Title"
                      value={clip.title}
                      onChange={(e) => updateClip(clip.id, 'title', e.target.value)}
                      disabled={clip.status !== 'idle'}
                    />
                    <input 
                      className="clip-time-input"
                      type="text" 
                      value={clip.start} 
                      onChange={(e) => updateClip(clip.id, 'start', e.target.value)}
                      disabled={clip.status !== 'idle'} 
                    />
                    <span style={{color: '#888'}}>to</span>
                    <input 
                      className="clip-time-input"
                      type="text" 
                      placeholder="End"
                      value={clip.end} 
                      onChange={(e) => updateClip(clip.id, 'end', e.target.value)}
                      disabled={clip.status !== 'idle'} 
                    />
                  </div>
                  
                  <div className="clip-actions">
                    <div style={{display: 'flex', gap: '0.2rem', background: '#222', padding: '2px', borderRadius: '6px', marginRight: '4px'}}>
                      <button 
                        className={`icon-btn clip-type-btn ${!clip.audioOnly ? 'active' : ''}`}
                        onClick={() => updateClip(clip.id, 'audioOnly', false)}
                        disabled={clip.status !== 'idle'}
                        title="Video"
                      >
                        <Video size={14}/>
                      </button>
                      <button 
                        className={`icon-btn clip-type-btn ${clip.audioOnly ? 'active' : ''}`}
                        onClick={() => updateClip(clip.id, 'audioOnly', true)}
                        disabled={clip.status !== 'idle'}
                        title="Audio"
                      >
                        <Music size={14}/>
                      </button>
                    </div>

                    {clip.status === 'idle' && (
                      <button onClick={() => startDownload(clip.id)} style={{background: '#ff0000', padding: '6px 12px', fontSize: '0.85rem'}}>Start</button>
                    )}
                    {clip.status === 'processing' && (
                       <div className="status-tag status-processing">
                         <Loader2 size={12} className="spinning" style={{marginRight: '6px'}}/> 
                         {Math.round(clip.progress)}%
                       </div>
                    )}
                                          {clip.status === 'completed' && (
                                            <div className="status-tag status-completed">
                                              <CheckCircle size={12} style={{marginRight: '6px'}}/> Finished
                                            </div>
                                          )}
                    
                    {clip.status === 'error' && (
                       <div className="status-tag status-error"><AlertCircle size={12}/> Error</div>
                    )}
                    <button onClick={() => removeClip(clip.id)} className="icon-btn" style={{color: '#ff4444'}}><Trash2 size={18}/></button>
                  </div>
                </div>
                {clip.status === 'processing' && (
                  <div className="progress-container"><div className="progress-bar" style={{width: `${clip.progress}%`}}></div></div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

import { useState, useRef, useEffect } from 'react';
import axios from 'axios';
import { Plus, Trash2, Download, Clock, Loader2, CheckCircle, AlertCircle, Music, Video, List, Search, CheckSquare, Square, Check, Eraser, Eye, LayoutList, ArrowLeft } from 'lucide-react';
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
  thumbnail?: string;
}

interface VideoInfo {
  is_playlist: boolean;
  is_channel: boolean;
  entries?: PlaylistEntry[];
  tabs?: string[];
  active_tab?: string;
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
  status: 'idle' | 'queued' | 'processing' | 'completed' | 'error';
  progress: number;
  taskId?: string;
}

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

declare global {
  interface Window {
    onYouTubeIframeAPIReady: () => void;
    YT: any;
  }
}

function App() {
  const [url, setUrl] = useState('');
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const [selectedVideoInfo, setSelectedVideoInfo] = useState<VideoInfo | null>(null);
  const [browsingPlaylist, setBrowsingPlaylist] = useState<VideoInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [inspectingVideo, setInspectingVideo] = useState(false);
  const [loadingPlaylist, setLoadingPlaylist] = useState(false);
  const [error, setError] = useState('');
  const [clips, setClips] = useState<Clip[]>([]);
  const [selectedFormat, setSelectedFormat] = useState('best');
  const [transcriptSearch, setTranscriptSearch] = useState('');
  const [selectedPlaylistIds, setSelectedPlaylistIds] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState('Videos');
  const [channelEntries, setChannelEntries] = useState<PlaylistEntry[]>([]);
  const [channelOffset, setChannelOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [downloadedTaskIds, setDownloadedTaskIds] = useState<Set<string>>(new Set());

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
    const activeClips = clips.filter(c => c.status === 'processing' || c.status === 'queued');
    if (activeClips.length === 0) return;

    const interval = setInterval(async () => {
      const updatedClips = [...clips];
      let changed = false;

      await Promise.all(activeClips.map(async (clip) => {
        try {
          const res = await axios.get(`${API_BASE}/status/${clip.taskId}`);
          const idx = updatedClips.findIndex(c => c.id === clip.id);
          if (idx !== -1) {
             const data = res.data;
             if (updatedClips[idx].progress !== data.progress || updatedClips[idx].status !== data.status) {
                updatedClips[idx] = { ...updatedClips[idx], status: data.status, progress: data.progress };
                changed = true;
                if (data.status === 'completed' && clip.taskId) {
                  setDownloadedTaskIds(prev => {
                    if (prev.has(clip.taskId!)) return prev;
                    const next = new Set(prev);
                    next.add(clip.taskId!);
                    finalizeDownload(clip.id);
                    return next;
                  });
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
    const activeInfo = selectedVideoInfo || info;
    if (activeInfo && !activeInfo.is_channel && playerReady) {
      const videoId = extractVideoId(activeInfo.original_url);
      if (videoId) {
        playerRef.current = null;
        const timer = setTimeout(() => {
          if (window.YT && window.YT.Player) {
            playerRef.current = new window.YT.Player('yt-player', {
              videoId: videoId,
              height: '100%',
              width: '100%',
              playerVars: { 'autoplay': 0, 'modestbranding': 1 },
              events: { 
                'onReady': () => console.log('Player Ready'),
                'onError': (e: any) => console.error('YT Player Error:', e.data)
              }
            });
          }
        }, 100);
        return () => clearTimeout(timer);
      }
    }
  }, [info?.original_url, selectedVideoInfo?.original_url, playerReady]);

  const fetchInfo = async (overrideUrl?: string, isBrowsingPlaylist: boolean = false, showLoadingState: boolean = true) => {
    const targetUrl = overrideUrl || url;
    if (!targetUrl) return;
    
    if (isBrowsingPlaylist) {
      setLoadingPlaylist(true);
    } else if (overrideUrl && showLoadingState) {
      setInspectingVideo(true);
    } else if (!overrideUrl) {
      setLoading(true);
    }
    
    setError('');
    try {
      const res = await axios.post(`${API_BASE}/info`, { url: targetUrl });
      if (isBrowsingPlaylist) {
        setBrowsingPlaylist(res.data);
      } else if (overrideUrl) {
        setSelectedVideoInfo(res.data);
      } else {
        setInfo(res.data);
        setSelectedVideoInfo(null);
        setBrowsingPlaylist(null);
        setClips([]);
      }
      setTranscriptSearch('');
      setSelectedPlaylistIds([]);
    } catch (err: any) {
      setError(err.response?.data?.detail || 'Failed to fetch video info');
    } finally {
      setLoading(false);
      setInspectingVideo(false);
      setLoadingPlaylist(false);
    }
  };

  const fetchTabEntries = async (tabName: string, offset: number, reset: boolean = false) => {
    if (!info || !info.is_channel) return;
    setLoadingMore(true);
    try {
      const res = await axios.post(`${API_BASE}/info`, { 
        url: info.original_url, 
        tab: tabName, 
        offset 
      });
      const newEntries = res.data.entries || [];
      if (reset) {
        setChannelEntries(newEntries);
      } else {
        setChannelEntries(prev => [...prev, ...newEntries]);
      }
      setChannelOffset(res.data.next_offset || offset + newEntries.length);
      setHasMore(newEntries.length === 50);
    } catch (err) {
      console.error("Failed to fetch tab entries", err);
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    if (info?.is_channel) {
      setActiveTab(info.active_tab || 'Videos');
      setChannelEntries([]);
      setChannelOffset(0);
      setHasMore(true);
      fetchTabEntries(info.active_tab || 'Videos', 0, true);
    }
  }, [info?.original_url, info?.active_tab]);

  useEffect(() => {
    if (info?.is_channel && activeTab) {
      setChannelEntries([]);
      setChannelOffset(0);
      setHasMore(true);
      fetchTabEntries(activeTab, 0, true);
    }
  }, [activeTab]);

  const extractVideoId = (url: string) => {
    // Standard and mobile URLs
    const standardRegExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const standardMatch = url.match(standardRegExp);
    if (standardMatch && standardMatch[2].length === 11) return standardMatch[2];

    // Shorts URLs (e.g., youtube.com/shorts/ID)
    const shortsRegExp = /\/shorts\/([a-zA-Z0-9_-]{11})/;
    const shortsMatch = url.match(shortsRegExp);
    if (shortsMatch && shortsMatch[1]) return shortsMatch[1];

    return null;
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
      const isFull = clip.start === '00:00' && !clip.end;
      const res = await axios.post(`${API_BASE}/download`, {
        url: clip.url || info?.original_url,
        title: clip.title,
        format_id: selectedFormat,
        audio_only: clip.audioOnly,
        clip: isFull ? null : { start: clip.start, end: clip.end }
      });
      setClips(prev => prev.map(c => c.id === clipId ? { ...c, status: 'queued', taskId: res.data.task_id } : c));
    } catch (err) {
      setClips(prev => prev.map(c => c.id === clipId ? { ...c, status: 'error' } : c));
    }
  };

  const finalizeDownload = async (clipId: string) => {
    const clip = clips.find(c => c.id === clipId);
    if (!clip || !clip.taskId) return;
    try {
      const response = await axios.get(`${API_BASE}/download/${clip.taskId}`, { responseType: 'blob' });
      const contentDisposition = response.headers['content-disposition'];
      let filename = `${clip.title}.${clip.audioOnly ? 'mp3' : 'mp4'}`;
      if (contentDisposition) {
        const fileNameMatch = contentDisposition.match(/filename="?(.+)"?/i);
        if (fileNameMatch && fileNameMatch[1]) filename = fileNameMatch[1];
      }
      const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      alert("Failed to save file.");
    }
  };

  const addPlaylistToQueue = async (playlistUrl: string) => {
    setLoading(true);
    try {
      const res = await axios.post(`${API_BASE}/info`, { url: playlistUrl });
      if (res.data.entries) {
        const newClips: Clip[] = res.data.entries.map((entry: any) => ({
          id: Math.random().toString(36).substr(2, 9),
          title: entry.title,
          url: entry.url,
          start: '00:00',
          end: '',
          audioOnly: false,
          status: 'idle',
          progress: 0
        }));
        setClips(prev => [...prev, ...newClips]);
      }
    } catch (err) {
      alert("Failed to add playlist to queue.");
    } finally {
      setLoading(false);
    }
  };

  const activeInfo = (selectedVideoInfo && !selectedVideoInfo.is_playlist && !selectedVideoInfo.is_channel) 
    ? selectedVideoInfo 
    : (info && !info.is_channel && !info.is_playlist ? info : null);

  return (
    <div className="app-container">
      <h1>YouTube Split & Download</h1>
      
      {/* 1. Search Box */}
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
          <button onClick={() => fetchInfo()} disabled={loading}>
            {loading ? 'Loading...' : 'Fetch Video'}
          </button>
        </div>
        {error && <div className="error">{error}</div>}
      </div>

      {/* 2. Video Viewer (if active or loading) */}
      {inspectingVideo && (
        <div className="card" style={{minHeight: '300px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem'}}>
          <Loader2 size={40} className="spinning" color="#ff0000" />
          <div style={{color: '#888'}}>Fetching video details...</div>
        </div>
      )}

      {activeInfo && !inspectingVideo && (
        <div className="card">
          <div className="video-section">
            <div>
              <div className="player-container" key={extractVideoId(activeInfo.original_url) || 'none'}>
                <div id="yt-player"></div>
              </div>

              {activeInfo.heatmap && activeInfo.heatmap.length > 0 && (
                <div className="heatmap-container" title="Most Replayed Moments">
                  {activeInfo.heatmap.map((point, i) => (
                    <div 
                      key={i} 
                      className="heatmap-bar" 
                      style={{height: `${Math.max(10, point.value * 100)}%`}}
                      onClick={() => playerRef.current?.seekTo(point.start_time, true)}
                    ></div>
                  ))}
                </div>
              )}

              <div className="controls-overlay">
                <button onClick={() => {
                   const time = getCurrentTime();
                   const last = clips[clips.length - 1];
                   if (clips.length > 0 && !last.end && last.status === 'idle') {
                      updateClip(last.id, 'end', time);
                   } else {
                      setClips([...clips, { 
                        id: Math.random().toString(36).substr(2, 9), 
                        title: `Clip ${clips.length + 1}`,
                        start: time, end: '', audioOnly: false, status: 'idle', progress: 0 
                      }]);
                   }
                }}>
                  <Clock size={16} style={{marginRight: '5px'}} />
                  Mark Current Time
                </button>

                {activeInfo.transcript && activeInfo.transcript.length > 0 && (
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

              {activeInfo.transcript && activeInfo.transcript.length > 0 && transcriptSearch && (
                <div className="transcript-results" style={{marginTop: '0.5rem'}}>
                  {activeInfo.transcript
                    .filter(line => line.text.toLowerCase().includes(transcriptSearch.toLowerCase()))
                    .slice(0, 15)
                    .map((line, i) => (
                      <div key={i} className="transcript-item" onClick={() => playerRef.current?.seekTo(line.start, true)}>
                        <span className="transcript-time">{formatTime(line.start)}</span>
                        <span className="transcript-text">{line.text}</span>
                      </div>
                    ))
                  }
                </div>
              )}

              <div className="footer-controls" style={{ marginTop: '1.5rem', justifyContent: 'flex-start' }}>
                <div style={{display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap'}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem'}}>
                    <label style={{fontSize: '0.9rem', color: '#888'}}>Output:</label>
                    <select className="format-select" value={selectedFormat} onChange={(e) => setSelectedFormat(e.target.value)}>
                      <option value="best">Best Quality</option>
                      {activeInfo.formats?.map(f => (
                        <option key={f.format_id} value={f.format_id}>{f.resolution} ({f.ext})</option>
                      ))}
                    </select>
                  </div>
                  <div style={{display: 'flex', gap: '0.5rem'}}>
                    <button onClick={() => {
                      const id = Math.random().toString(36).substr(2, 9);
                      const newClip: Clip = { id, title: activeInfo.title + " (Full Video)", url: activeInfo.original_url, start: '00:00', end: '', audioOnly: false, status: 'idle', progress: 0 };
                      setClips(prev => [...prev, newClip]);
                      // Small timeout to let state update, then start
                      setTimeout(() => startDownload(id), 50);
                    }} style={{background: '#333', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem'}}><Video size={16}/> Queue Full Video</button>
                    <button onClick={() => {
                      const id = Math.random().toString(36).substr(2, 9);
                      const newClip: Clip = { id, title: activeInfo.title + " (Full Audio)", url: activeInfo.original_url, start: '00:00', end: '', audioOnly: true, status: 'idle', progress: 0 };
                      setClips(prev => [...prev, newClip]);
                      setTimeout(() => startDownload(id), 50);
                    }} style={{background: '#333', display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 1rem'}}><Music size={16}/> Queue Full Audio</button>
                  </div>
                </div>
              </div>

              {activeInfo.chapters && activeInfo.chapters.length > 0 && (
                <div style={{marginTop: '1.5rem'}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#888', marginBottom: '0.5rem', fontSize: '0.9rem'}}><List size={16}/> Suggested Chapters</div>
                  <div className="suggestions-container">
                    {activeInfo.chapters.map((chapter, i) => (
                      <div key={i} className="suggestion-chip" onClick={() => addSuggestionAsClip(chapter)}>{chapter.title}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 3. Playlist Dashboard */}
      {info && info.is_playlist && !info.is_channel && (
        <div className="card">
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem'}}>
            <h2 style={{margin: 0}}>{info.title} (Playlist)</h2>
            <div style={{display: 'flex', gap: '0.5rem'}}>
              <button onClick={() => selectedPlaylistIds.length === info.entries?.length ? setSelectedPlaylistIds([]) : setSelectedPlaylistIds(info.entries?.map(e => e.id) || [])} style={{background: '#333', color: 'white'}}>
                {selectedPlaylistIds.length === info.entries?.length ? 'Deselect All' : 'Select All'}
              </button>
              {selectedPlaylistIds.length > 0 && (
                <button onClick={() => {
                  const newClips: Clip[] = [];
                  info.entries?.forEach(entry => { if (selectedPlaylistIds.includes(entry.id)) newClips.push({ id: Math.random().toString(36).substr(2, 9), title: entry.title, url: entry.url, start: '00:00', end: '', audioOnly: false, status: 'idle', progress: 0 }); });
                  setClips([...clips, ...newClips]);
                  setSelectedPlaylistIds([]);
                }} style={{background: '#ff0000'}}>Add {selectedPlaylistIds.length} to Queue</button>
              )}
            </div>
          </div>
          <div className="playlist-entries">
            {info.entries?.map(entry => (
              <div key={entry.id} className={`playlist-item ${selectedPlaylistIds.includes(entry.id) ? 'selected' : ''}`} onClick={() => selectedPlaylistIds.includes(entry.id) ? setSelectedPlaylistIds(selectedPlaylistIds.filter(id => id !== entry.id)) : setSelectedPlaylistIds([...selectedPlaylistIds, entry.id])}>
                {selectedPlaylistIds.includes(entry.id) ? <CheckSquare size={18} color="#ff0000"/> : <Square size={18}/>}
                <span>{entry.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. Channel Dashboard */}
      {info && info.is_channel && (
        <div className="card">
          <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem'}}>
            <h2 style={{margin: 0}}>{info.title}</h2>
            {selectedPlaylistIds.length > 0 && (
              <button onClick={() => {
                const newClips: Clip[] = [];
                channelEntries.forEach(entry => { if (selectedPlaylistIds.includes(entry.id)) newClips.push({ id: Math.random().toString(36).substr(2, 9), title: entry.title, url: entry.url, start: '00:00', end: '', audioOnly: false, status: 'idle', progress: 0 }); });
                setClips([...clips, ...newClips]);
                setSelectedPlaylistIds([]);
              }} style={{background: '#ff0000'}}>Add {selectedPlaylistIds.length} to Queue</button>
            )}
          </div>
          <div className="channel-tabs">
            {info.tabs?.map(tab => (
              <button key={tab} className={`tab-btn ${activeTab === tab ? 'active' : ''}`} onClick={() => { setActiveTab(tab); setBrowsingPlaylist(null); }}>{tab}</button>
            ))}
          </div>
          <div style={{marginTop: '1.5rem'}}>
            {loadingPlaylist ? (
              <div style={{textAlign: 'center', padding: '5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem'}}>
                <Loader2 size={40} className="spinning" color="#ff0000" />
                <div style={{color: '#888'}}>Loading playlist content...</div>
              </div>
            ) : browsingPlaylist ? (
              <>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid #333', paddingBottom: '0.5rem'}}>
                  <div style={{display: 'flex', alignItems: 'center', gap: '1rem'}}>
                    <button onClick={() => setBrowsingPlaylist(null)} className="icon-btn" style={{backgroundColor: '#333', borderRadius: '4px'}}><ArrowLeft size={18}/></button>
                    <h3 style={{margin: 0}}>{browsingPlaylist.title} (Playlist)</h3>
                  </div>
                  <button onClick={() => {
                    const sectionIds = browsingPlaylist.entries?.map(e => e.id) || [];
                    const allSelected = sectionIds.every(id => selectedPlaylistIds.includes(id));
                    if (allSelected) {
                      setSelectedPlaylistIds(selectedPlaylistIds.filter(id => !sectionIds.includes(id)));
                    } else {
                      setSelectedPlaylistIds([...new Set([...selectedPlaylistIds, ...sectionIds])]);
                    }
                  }} style={{background: '#333', fontSize: '0.75rem', padding: '4px 10px'}}>
                    {(browsingPlaylist.entries?.every(e => selectedPlaylistIds.includes(e.id))) ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
                <div className="channel-grid">
                  {browsingPlaylist.entries?.map(entry => (
                    <div key={entry.id} className={`channel-card ${selectedPlaylistIds.includes(entry.id) ? 'selected' : ''}`}>
                      <div className="channel-thumb-wrapper">
                        {entry.thumbnail && <img src={entry.thumbnail} alt="" />}
                        <div className="channel-card-overlay">
                          <button className="overlay-btn select-btn" onClick={() => selectedPlaylistIds.includes(entry.id) ? setSelectedPlaylistIds(selectedPlaylistIds.filter(id => id !== entry.id)) : setSelectedPlaylistIds([...selectedPlaylistIds, entry.id])}>
                            {selectedPlaylistIds.includes(entry.id) ? <CheckSquare size={18}/> : <Plus size={18}/>}
                          </button>
                          <button className="overlay-btn inspect-btn" onClick={() => { fetchInfo(entry.url); window.scrollTo({ top: 0, behavior: 'smooth' }); }}><Eye size={18} /></button>
                        </div>
                        {selectedPlaylistIds.includes(entry.id) && <div className="selection-badge"><Check size={14} color="white" /></div>}
                      </div>
                      <div className="channel-card-title">{entry.title}</div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
                  <h3 style={{margin: 0}}>{activeTab}</h3>
                                {channelEntries.length > 0 && (
                                  <button onClick={() => {
                                    const sectionIds = channelEntries.map(e => e.id);
                                    const allSelected = sectionIds.every(id => selectedPlaylistIds.includes(id));
                                    setSelectedPlaylistIds(allSelected ? selectedPlaylistIds.filter(id => !sectionIds.includes(id)) : [...new Set([...selectedPlaylistIds, ...sectionIds])]);
                                  }} style={{background: '#333', fontSize: '0.75rem', padding: '4px 10px'}}>
                                    {channelEntries.every(e => selectedPlaylistIds.includes(e.id)) ? 'Deselect All' : 'Select All'}
                                  </button>
                                )}
                  
                </div>
                {loadingMore && channelEntries.length === 0 ? (
                  <div style={{textAlign: 'center', padding: '5rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem'}}><Loader2 size={40} className="spinning" color="#ff0000" /><div style={{color: '#888'}}>Loading {activeTab}...</div></div>
                ) : (
                  <>
                    <div className="channel-grid">
                      {channelEntries.map(entry => (
                        <div key={entry.id} className={`channel-card ${selectedPlaylistIds.includes(entry.id) ? 'selected' : ''}`}>
                          <div className="channel-thumb-wrapper">
                            {entry.thumbnail && <img src={entry.thumbnail} alt="" />}
                            <div className="channel-card-overlay">
                              {activeTab === 'Playlists' ? (
                                <button 
                                  className="overlay-btn select-btn" 
                                  title="Add Playlist to Queue"
                                  onClick={() => addPlaylistToQueue(entry.url)}
                                >
                                  <Plus size={18}/>
                                </button>
                              ) : (
                                <button 
                                  className="overlay-btn select-btn" 
                                  onClick={() => selectedPlaylistIds.includes(entry.id) ? setSelectedPlaylistIds(selectedPlaylistIds.filter(id => id !== entry.id)) : setSelectedPlaylistIds([...selectedPlaylistIds, entry.id])}
                                >
                                  {selectedPlaylistIds.includes(entry.id) ? <CheckSquare size={18}/> : <Plus size={18}/>}
                                </button>
                              )}
                              
                              {activeTab === 'Playlists' ? (
                                <button className="overlay-btn inspect-btn" title="Browse Playlist" onClick={() => fetchInfo(entry.url, true, false)}>
                                  <LayoutList size={18} />
                                </button>
                              ) : (
                                <button className="overlay-btn inspect-btn" title="Inspect Video" onClick={() => { fetchInfo(entry.url); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                                  <Eye size={18} />
                                </button>
                              )}
                            </div>
                            {selectedPlaylistIds.includes(entry.id) && <div className="selection-badge"><Check size={14} color="white" /></div>}
                          </div>
                          <div className="channel-card-title">{entry.title}</div>
                        </div>
                      ))}
                    </div>
                    {!loadingMore && channelEntries.length === 0 && <div style={{textAlign: 'center', padding: '3rem', color: '#666'}}>No {activeTab} found.</div>}
                    {hasMore && channelEntries.length > 0 && (
                      <div style={{textAlign: 'center', marginTop: '2rem'}}>
                        <button onClick={() => fetchTabEntries(activeTab, channelOffset)} disabled={loadingMore} style={{background: '#333', minWidth: '200px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem'}}>
                          {loadingMore ? <><Loader2 size={16} className="spinning" /> Fetching...</> : 'Load More'}
                        </button>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* 5. Download Queue */}
      {clips.length > 0 && (
        <div className="card">
          <div className="clip-list">
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem'}}>
              <h3 style={{margin: 0}}>Download Queue ({clips.length})</h3>
              <div style={{display: 'flex', gap: '0.5rem'}}>
                <button onClick={() => clips.filter(c => c.status === 'idle').forEach(c => startDownload(c.id))} className="icon-btn" style={{backgroundColor: '#ff0000', borderRadius: '6px', padding: '0.5rem 0.75rem', width: 'auto', fontSize: '0.8rem', display: 'flex', gap: '0.4rem', height: 'auto'}} title="Start All"><Download size={14}/> Start All</button>
                <button onClick={() => setClips(clips.filter(c => c.status !== 'completed' && c.status !== 'error'))} className="icon-btn" style={{backgroundColor: '#444', borderRadius: '6px', padding: '0.5rem 0.75rem', width: 'auto', fontSize: '0.8rem', display: 'flex', gap: '0.4rem', height: 'auto'}} title="Clear Finished"><Eraser size={14}/> Clear Done</button>
                <button onClick={() => setClips([])} className="icon-btn" style={{backgroundColor: '#444', borderRadius: '6px', padding: '0.5rem 0.75rem', width: 'auto', fontSize: '0.8rem', display: 'flex', gap: '0.4rem', height: 'auto'}} title="Clear Entire Queue"><Trash2 size={14}/> Clear Queue</button>
                <button onClick={() => setClips(clips.map(c => ({ ...c, audioOnly: false })))} className="icon-btn" style={{backgroundColor: '#444', borderRadius: '6px', padding: '0.5rem 0.75rem', width: 'auto', fontSize: '0.8rem', display: 'flex', gap: '0.4rem', height: 'auto'}} title="Set all to Video"><Video size={14}/> All</button>
                <button onClick={() => setClips(clips.map(c => ({ ...c, audioOnly: true })))} className="icon-btn" style={{backgroundColor: '#444', borderRadius: '6px', padding: '0.5rem 0.75rem', width: 'auto', fontSize: '0.8rem', display: 'flex', gap: '0.4rem', height: 'auto'}} title="Set all to Audio"><Music size={14}/> All</button>
              </div>
            </div>
            {clips.map((clip) => (
              <div key={clip.id} className="clip-item">
                <div className="clip-row">
                  <div className="clip-inputs">
                    <input className="clip-title-input" type="text" placeholder="Title" value={clip.title} onChange={(e) => updateClip(clip.id, 'title', e.target.value)} disabled={clip.status !== 'idle'} />
                    <input className="clip-time-input" type="text" value={clip.start} onChange={(e) => updateClip(clip.id, 'start', e.target.value)} disabled={clip.status !== 'idle'} />
                    <span style={{color: '#888'}}>to</span>
                    <input className="clip-time-input" type="text" placeholder="End" value={clip.end} onChange={(e) => updateClip(clip.id, 'end', e.target.value)} disabled={clip.status !== 'idle'} />
                  </div>
                  <div className="clip-actions">
                    <div style={{display: 'flex', gap: '0.2rem', background: '#222', padding: '2px', borderRadius: '6px', marginRight: '4px'}}>
                      <button className={`icon-btn clip-type-btn ${!clip.audioOnly ? 'active' : ''}`} onClick={() => updateClip(clip.id, 'audioOnly', false)} disabled={clip.status !== 'idle'} title="Video"><Video size={14}/></button>
                      <button className={`icon-btn clip-type-btn ${clip.audioOnly ? 'active' : ''}`} onClick={() => updateClip(clip.id, 'audioOnly', true)} disabled={clip.status !== 'idle'} title="Audio"><Music size={14}/></button>
                    </div>
                    {clip.status === 'idle' && <button onClick={() => startDownload(clip.id)} style={{background: '#ff0000', padding: '6px 12px', fontSize: '0.85rem'}}>Start</button>}
                    {clip.status === 'queued' && <div className="status-tag status-queued"><Clock size={12} style={{marginRight: '6px'}}/> Waiting...</div>}
                    {clip.status === 'processing' && <div className="status-tag status-processing"><Loader2 size={12} className="spinning" style={{marginRight: '6px'}}/> {Math.round(clip.progress)}%</div>}
                    {clip.status === 'completed' && <div className="status-tag status-completed"><CheckCircle size={12} style={{marginRight: '6px'}}/> Finished</div>}
                    {clip.status === 'error' && (
                       <div style={{display: 'flex', gap: '0.5rem', alignItems: 'center'}}>
                         <div className="status-tag status-error"><AlertCircle size={12}/> Error</div>
                         <button onClick={() => startDownload(clip.id)} style={{background: '#444', padding: '4px 8px', fontSize: '0.7rem', borderRadius: '4px'}}>Retry</button>
                       </div>
                    )}
                    <button onClick={() => removeClip(clip.id)} className="icon-btn" style={{color: '#ff4444'}}><Trash2 size={18}/></button>
                  </div>
                </div>
                {clip.status === 'processing' && <div className="progress-container"><div className="progress-bar" style={{width: `${clip.progress}%`}}></div></div>}
              </div>
            ))}
          </div>
        </div>
      )}
      {clips.length > 0 && (
        <div 
          className="floating-queue-pill"
          onClick={() => {
            const queueElement = document.querySelector('.clip-list');
            queueElement?.scrollIntoView({ behavior: 'smooth' });
          }}
        >
          <LayoutList size={18} />
          <span>
            {clips.some(c => c.status === 'completed') 
              ? `${clips.filter(c => c.status === 'completed').length} ready to save`
              : clips.some(c => c.status === 'processing' || c.status === 'queued')
                ? `${clips.filter(c => c.status === 'processing' || c.status === 'queued').length} downloading...`
                : `${clips.length} in queue`}
          </span>
        </div>
      )}
    </div>
  );
}

export default App;

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";

interface VideoFile {
  id: string;
  file: File;
  objectUrl: string;
}

const App: React.FC = () => {
  const [videos, setVideos] = useState<VideoFile[]>([]);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Ready. Upload videos to begin.');
  const [outputUrl, setOutputUrl] = useState<string | null>(null);

  const [musicPrompt, setMusicPrompt] = useState('Epic cinematic score');
  const [musicDescription, setMusicDescription] = useState('');
  const [isGeneratingMusic, setIsGeneratingMusic] = useState(false);

  const [masterDuration, setMasterDuration] = useState(10);
  const [masterLoop, setMasterLoop] = useState(true);

  const [outputFormat, setOutputFormat] = useState<'webm' | 'mp4'>('webm');

  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  
  // Use a ref to get access to the latest videos list in the unmount cleanup function.
  const videosRef = useRef(videos);
  videosRef.current = videos;

  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY! });
  
  const totalDuration = videos.length * masterDuration;

  // Corrected useEffect hooks for robust memory management.
  useEffect(() => {
    // This effect handles cleanup for the video object URLs ONLY when the component unmounts.
    return () => {
      videosRef.current.forEach(v => URL.revokeObjectURL(v.objectUrl));
    };
  }, []);

  useEffect(() => {
    // This effect handles cleanup of the PREVIOUS outputUrl when a new one is generated.
    return () => {
      if (outputUrl) {
        URL.revokeObjectURL(outputUrl);
      }
    };
  }, [outputUrl]);

  const handleVideoUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    // FIX: Cast event.target to HTMLInputElement to access files property. This resolves multiple related type errors.
    const files = Array.from((event.target as HTMLInputElement).files || []);
    if (files.length === 0) return;

    const newVideos: VideoFile[] = files.map(file => ({
      id: `${file.name}-${Date.now()}`,
      file,
      objectUrl: URL.createObjectURL(file),
    }));

    setVideos(prev => [...prev, ...newVideos]);
    setStatus(`${files.length} video(s) added. Adjust master settings and render.`);
  };

  const handleAudioUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    // FIX: Cast event.target to HTMLInputElement to access files property.
    const file = (event.target as HTMLInputElement).files?.[0];
    if (file) {
      setAudioFile(file);
    }
  };
  
  const handleGenerateMusic = async () => {
    if (!musicPrompt.trim() || totalDuration <= 0) {
        // FIX: Use window.alert as alert is a browser global.
        window.alert("Please add videos to set a total duration and enter a music prompt.");
        return;
    }
    setIsGeneratingMusic(true);
    setMusicDescription('');
    try {
        const fullPrompt = `Describe a piece of instrumental background music for a video that is ${totalDuration.toFixed(2)} seconds long. The desired mood is: "${musicPrompt}". Describe the instruments, tempo, and emotional progression of the music.`;

        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: fullPrompt,
        });

        setMusicDescription(response.text);
    } catch (error) {
        console.error("Error generating music description:", error);
        setMusicDescription("Failed to generate music description. Please try again.");
    } finally {
        setIsGeneratingMusic(false);
    }
  };

  const handleRemoveVideo = (idToRemove: string) => {
    setVideos(prevVideos => {
      const videoToRemove = prevVideos.find(v => v.id === idToRemove);
      if (videoToRemove) {
        URL.revokeObjectURL(videoToRemove.objectUrl);
      }
      return prevVideos.filter(video => video.id !== idToRemove);
    });
    setStatus('Video removed.');
  };

  const handleClearAllVideos = () => {
    videos.forEach(video => URL.revokeObjectURL(video.objectUrl));
    setVideos([]);
    setStatus('All videos cleared.');
  };


  const handleRenderVideo = useCallback(async () => {
    if (videos.length === 0) {
      // FIX: Use window.alert as it is a browser global.
      window.alert('Please upload videos before rendering.');
      return;
    }

    setIsRendering(true);
    setProgress(0);
    setStatus('Initializing render...');
    setOutputUrl(null);

    try {
      const mimeType = outputFormat === 'mp4' ? 'video/mp4' : 'video/webm';
      // FIX: Use window.MediaRecorder as it is a browser global.
      if (!window.MediaRecorder.isTypeSupported(mimeType)) {
        setStatus(`Error: Your browser does not support ${mimeType} recording. Please choose another format.`);
        setIsRendering(false);
        return;
      }
      const recorderOptions = {
        mimeType,
        ...(outputFormat === 'mp4' && { videoBitsPerSecond: 25000000 }), // 25 Mbps for high quality MP4
      };

      // FIX: Use window.document as it is a browser global.
      const canvas = window.document.createElement('canvas');
      // FIX: Use window.document as it is a browser global.
      const tempVideo = window.document.createElement('video');
      
      // FIX: To prevent browser power-saving from interrupting playback in background tabs,
      // we play the video with volume=0 instead of muted=true, and disable Picture-in-Picture.
      tempVideo.volume = 0;
      tempVideo.disablePictureInPicture = true;

      // Get dimensions from the first video
      await new Promise<void>((resolve, reject) => {
        tempVideo.onloadedmetadata = () => {
          canvas.width = tempVideo.videoWidth;
          canvas.height = tempVideo.videoHeight;
          resolve();
        };
        tempVideo.onerror = (e) => reject(new Error('Failed to load video metadata.'));
        tempVideo.src = videos[0].objectUrl;
      });

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not get canvas context');

      const canvasStream = canvas.captureStream(30); // 30 FPS
      
      // FIX: Use window.AudioContext as it is a browser global.
      const audioContext = new window.AudioContext();
      const audioDestination = audioContext.createMediaStreamDestination();
      
      // If audio file is provided, add it to the stream
      if (audioFile) {
        const audioBuffer = await audioContext.decodeAudioData(await audioFile.arrayBuffer());
        const source = audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioDestination);
        source.start();
      } else {
        // Add a silent track to ensure the video has an audio channel
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        gain.gain.setValueAtTime(0, audioContext.currentTime);
        oscillator.connect(gain);
        gain.connect(audioDestination);
        oscillator.start();
      }

      // FIX: Use window.MediaStream as it is a browser global.
      const combinedStream = new window.MediaStream([
          ...canvasStream.getVideoTracks(),
          ...audioDestination.stream.getAudioTracks()
      ]);

      // FIX: Use window.MediaRecorder as it is a browser global.
      const recorder = new window.MediaRecorder(combinedStream, recorderOptions);
      const chunks: Blob[] = [];
      recorder.ondataavailable = event => chunks.push(event.data);
      
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        setOutputUrl(URL.createObjectURL(blob));
        setStatus('Render complete! Your video is ready for download.');
        setIsRendering(false);
      };

      recorder.start();
      
      let overallProgress = 0;

      for (const video of videos) {
        setStatus(`Rendering: ${video.file.name}`);
        tempVideo.src = video.objectUrl;
        await tempVideo.play();
        
        let elapsed = 0;
        const clipDuration = masterDuration * 1000; // in ms
        let lastFrameTime = performance.now();

        while (elapsed < clipDuration) {
          const now = performance.now();
          const delta = now - lastFrameTime;
          elapsed += delta;
          lastFrameTime = now;

          if (masterLoop && tempVideo.currentTime >= tempVideo.duration - 0.1) {
             tempVideo.currentTime = 0;
          }

          ctx.drawImage(tempVideo, 0, 0, canvas.width, canvas.height);
          
          overallProgress += delta;
          setProgress(Math.min(100, (overallProgress / (totalDuration * 1000)) * 100));

          await new Promise(resolve => requestAnimationFrame(resolve));
        }
      }

      recorder.stop();
      tempVideo.pause();
      audioContext.close();

    } catch (error) {
      console.error('Render failed:', error);
      setStatus(`Error during render: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsRendering(false);
    }
  }, [videos, audioFile, totalDuration, masterDuration, masterLoop, outputFormat]);

  return (
    <>
      <h1>AI Video Combiner</h1>
      <div className="panel controls-panel">
        <div className="form-group">
            <label htmlFor="video-upload">1. Upload Videos</label>
            <button className="btn" onClick={() => videoInputRef.current?.click()}>
                Add Videos
            </button>
            <input
                ref={videoInputRef}
                id="video-upload"
                type="file"
                multiple
                accept="video/*"
                onChange={handleVideoUpload}
            />
        </div>
        <div className="form-group">
            <label>2. Master Clip Settings</label>
            <div className="master-controls">
                <div className="form-group" style={{gap: '0.2rem'}}>
                    <label htmlFor="master-duration" style={{fontSize: '0.8rem'}}>Duration per clip (s)</label>
                    <input
                        id="master-duration"
                        className="input"
                        type="number"
                        min="1"
                        value={masterDuration}
                        // FIX: Cast event target to HTMLInputElement to access value property.
                        onChange={e => setMasterDuration(parseInt((e.target as HTMLInputElement).value, 10))}
                        style={{width: '100px', padding: '0.3rem'}}
                    />
                </div>
                <div className="checkbox-group">
                    <input
                        id="master-loop"
                        type="checkbox"
                        checked={masterLoop}
                        // FIX: Cast event target to HTMLInputElement to access checked property.
                        onChange={e => setMasterLoop((e.target as HTMLInputElement).checked)}
                    />
                    <label htmlFor="master-loop">Loop clips</label>
                </div>
            </div>
        </div>
        <div className="form-group">
            <label htmlFor="audio-upload">3. Upload Background Audio (Optional)</label>
            <button className="btn btn-secondary" onClick={() => audioInputRef.current?.click()}>
                Select Audio File
            </button>
             <input
                ref={audioInputRef}
                id="audio-upload"
                type="file"
                accept="audio/*"
                onChange={handleAudioUpload}
            />
            {audioFile && <p style={{fontSize: '0.8rem', margin: '0.5rem 0 0', color: 'var(--text-secondary-color)'}}>Selected: {audioFile.name}</p>}
        </div>
        <div className="form-group">
            <label htmlFor="music-prompt">4. Or Generate Music Idea (Optional)</label>
             <input
                id="music-prompt"
                type="text"
                className="input"
                value={musicPrompt}
                // FIX: Cast event target to HTMLInputElement to access value property.
                onChange={e => setMusicPrompt((e.target as HTMLInputElement).value)}
                placeholder="e.g., Calm lo-fi beats"
            />
            <button className="btn btn-secondary" onClick={handleGenerateMusic} disabled={isGeneratingMusic || videos.length === 0}>
                Generate Description
                {isGeneratingMusic && <span className="spinner"></span>}
            </button>
        </div>
      </div>
      {musicDescription && (
        <div className="panel">
            <h4>Generated Music Description:</h4>
            <div className="ai-music-description">{musicDescription}</div>
        </div>
       )}

      <div className="main-container">
        <div className="panel timeline-panel">
          <div className="panel-header">
            <h2>Timeline ({videos.length} clips, {totalDuration.toFixed(1)}s total)</h2>
            {videos.length > 0 && (
                <button className="btn btn-danger btn-small" onClick={handleClearAllVideos}>
                    Clear All
                </button>
            )}
          </div>
          {videos.length > 0 ? (
            <ul className="video-list">
              {videos.map(video => (
                <li key={video.id} className="video-item">
                  <video src={video.objectUrl}></video>
                  <div className="video-info">
                    <p title={video.file.name}>{video.file.name}</p>
                    <small style={{color: 'var(--text-secondary-color)'}}>
                      {(video.file.size / 1024 / 1024).toFixed(2)} MB
                    </small>
                  </div>
                   <button
                    className="btn btn-remove"
                    title="Remove video"
                    onClick={() => handleRemoveVideo(video.id)}
                    aria-label={`Remove ${video.file.name}`}
                  >
                    &times;
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{color: 'var(--text-secondary-color)', textAlign: 'center'}}>No videos uploaded.</p>
          )}
        </div>
        <div className="panel preview-panel">
          <h2>Preview & Export</h2>
          <video className="video-preview" controls src={outputUrl ?? videos[0]?.objectUrl ?? ''}></video>
          <div className="form-group">
            <label htmlFor="output-format">Export Format</label>
            <select
                id="output-format"
                className="input"
                value={outputFormat}
                // FIX: Cast event target to HTMLSelectElement to access value property.
                onChange={e => setOutputFormat((e.target as HTMLSelectElement).value as 'webm' | 'mp4')}
                disabled={isRendering}
            >
                <option value="webm">WebM (Recommended)</option>
                <option value="mp4">MP4 (High Quality)</option>
            </select>
          </div>
           <div className="status-message">{status}</div>
          {isRendering && (
            <div className="progress-bar">
                <div className="progress-bar-inner" style={{width: `${progress}%`}}></div>
            </div>
           )}
          {outputUrl ? (
            <a href={outputUrl} download={`combined-video-${Date.now()}.${outputFormat}`} className="btn btn-success">
                Download Video
            </a>
          ) : (
             <button className="btn" onClick={handleRenderVideo} disabled={isRendering || videos.length === 0}>
                {isRendering ? 'Rendering...' : `Render Video (${totalDuration.toFixed(1)}s)`}
             </button>
          )}
        </div>
      </div>
    </>
  );
};

// FIX: Use window.document as it is a browser global.
const container = window.document.getElementById('root');
const root = createRoot(container!);
root.render(<App />);
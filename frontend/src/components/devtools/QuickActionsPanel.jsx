import { useState } from 'react';
import './QuickActionsPanel.css';

const QuickActionsPanel = () => {
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(3600000); // 1 hour default
  const [memoryThreshold, setMemoryThreshold] = useState(85);

  const clearEverything = () => {
    if (window.confirm('This will clear all caches, storage, and reload the page. Continue?')) {
      // Clear all storage
      localStorage.clear();
      sessionStorage.clear();
      
      // Clear cookies
      document.cookie.split(';').forEach(cookie => {
        const name = cookie.split('=')[0].trim();
        document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
      });
      
      // Clear caches
      if ('caches' in window) {
        caches.keys().then(names => {
          names.forEach(name => caches.delete(name));
        });
      }
      
      // Hard reload
      window.location.reload(true);
    }
  };

  const forceGarbageCollection = () => {
    if (window.gc) {
      window.gc();
      alert('Garbage collection triggered (Chrome with --js-flags=--expose-gc)');
    } else {
      alert('Garbage collection not available. Run Chrome with --js-flags=--expose-gc');
    }
  };

  const stopAllMedia = () => {
    // Stop all video elements
    document.querySelectorAll('video').forEach(video => {
      video.pause();
      video.src = '';
      video.load();
    });
    
    // Stop all audio elements
    document.querySelectorAll('audio').forEach(audio => {
      audio.pause();
      audio.src = '';
      audio.load();
    });
    
    alert('All media elements stopped and reset');
  };

  const resetVideoElements = () => {
    document.querySelectorAll('video').forEach(video => {
      const src = video.src;
      video.src = '';
      video.load();
      video.src = src;
      video.load();
    });
    alert('All video elements reset');
  };

  const toggleAutoRefresh = () => {
    const enabled = !autoRefreshEnabled;
    setAutoRefreshEnabled(enabled);
    
    if (enabled) {
      localStorage.setItem('devtools_auto_refresh', 'true');
      localStorage.setItem('devtools_refresh_interval', refreshInterval.toString());
      setTimeout(() => {
        window.location.reload();
      }, refreshInterval);
    } else {
      localStorage.removeItem('devtools_auto_refresh');
    }
  };

  const exportDebugReport = () => {
    const report = {
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      screenResolution: `${window.screen.width}x${window.screen.height}`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      memory: performance.memory ? {
        used: Math.round(performance.memory.usedJSHeapSize / 1048576),
        total: Math.round(performance.memory.totalJSHeapSize / 1048576),
        limit: Math.round(performance.memory.jsHeapSizeLimit / 1048576)
      } : null,
      performance: {
        loadTime: performance.timing.loadEventEnd - performance.timing.navigationStart,
        domReady: performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart
      },
      errors: window.devtoolsErrors || [],
      consoleLogs: window.devtoolsLogs || [],
      networkRequests: window.devtoolsNetwork || [],
      localStorage: { ...localStorage },
      sessionStorage: { ...sessionStorage }
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `debug-report-${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const generateQRCode = () => {
    const url = window.location.href;
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(url)}`;
    
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#fff;padding:20px;border:4px solid #000;box-shadow:8px 8px 0 #000;z-index:10000;';
    modal.innerHTML = `
      <h3 style="margin:0 0 16px;font-family:'Space Grotesk',sans-serif;">Scan to Access Console</h3>
      <img src="${qrUrl}" style="border:2px solid #000;" />
      <button onclick="this.parentElement.remove()" style="margin-top:16px;padding:8px 16px;background:#000;color:#fff;border:2px solid #000;cursor:pointer;font-family:'Space Grotesk',sans-serif;font-weight:600;">Close</button>
    `;
    document.body.appendChild(modal);
  };

  const takeScreenshot = () => {
    // This would require html2canvas or similar library
    // For now, just use browser's screenshot capability
    alert('Use browser DevTools (F12) > More Tools > Screenshot to capture screen');
  };

  const checkMissingResources = () => {
    const resources = performance.getEntriesByType('resource');
    const failed = [];
    
    document.querySelectorAll('img, video, audio, script, link[rel="stylesheet"]').forEach(el => {
      if (el.tagName === 'IMG' && !el.complete) {
        failed.push({ type: 'image', src: el.src });
      }
      if ((el.tagName === 'VIDEO' || el.tagName === 'AUDIO') && el.error) {
        failed.push({ type: el.tagName.toLowerCase(), src: el.src, error: el.error.message });
      }
    });

    if (failed.length === 0) {
      alert('All resources loaded successfully!');
    } else {
      console.table(failed);
      alert(`Found ${failed.length} failed resources. Check console for details.`);
    }
  };

  return (
    <div className="quick-actions-panel">
      <div className="panel-header">
        <h3>Emergency Controls</h3>
      </div>

      <div className="actions-grid">
        <button 
          className="emergency-btn danger"
          onClick={clearEverything}
          data-testid="clear-everything-btn"
        >
          <span className="btn-icon">⚠️</span>
          <div className="btn-content">
            <div className="btn-title">Clear Everything</div>
            <div className="btn-subtitle">Storage + Cache + Reload</div>
          </div>
        </button>

        <button 
          className="emergency-btn"
          onClick={stopAllMedia}
          data-testid="stop-media-btn"
        >
          <span className="btn-icon">⏸</span>
          <div className="btn-content">
            <div className="btn-title">Stop All Media</div>
            <div className="btn-subtitle">Pause & Reset Videos/Audio</div>
          </div>
        </button>

        <button 
          className="emergency-btn"
          onClick={forceGarbageCollection}
          data-testid="gc-btn"
        >
          <span className="btn-icon">🗑️</span>
          <div className="btn-content">
            <div className="btn-title">Force GC</div>
            <div className="btn-subtitle">Trigger Garbage Collection</div>
          </div>
        </button>

        <button 
          className="emergency-btn"
          onClick={resetVideoElements}
          data-testid="reset-video-btn"
        >
          <span className="btn-icon">🔄</span>
          <div className="btn-content">
            <div className="btn-title">Reset Videos</div>
            <div className="btn-subtitle">Reload All Video Elements</div>
          </div>
        </button>

        <button 
          className="emergency-btn"
          onClick={exportDebugReport}
          data-testid="export-report-btn"
        >
          <span className="btn-icon">📥</span>
          <div className="btn-content">
            <div className="btn-title">Export Report</div>
            <div className="btn-subtitle">Download Full Debug Info</div>
          </div>
        </button>

        <button 
          className="emergency-btn"
          onClick={generateQRCode}
          data-testid="qr-code-btn"
        >
          <span className="btn-icon">📱</span>
          <div className="btn-content">
            <div className="btn-title">Remote Access</div>
            <div className="btn-subtitle">Generate QR Code</div>
          </div>
        </button>

        <button 
          className="emergency-btn"
          onClick={checkMissingResources}
          data-testid="check-resources-btn"
        >
          <span className="btn-icon">🔍</span>
          <div className="btn-content">
            <div className="btn-title">Check Resources</div>
            <div className="btn-subtitle">Find Missing Assets</div>
          </div>
        </button>

        <button 
          className="emergency-btn"
          onClick={takeScreenshot}
          data-testid="screenshot-btn"
        >
          <span className="btn-icon">📸</span>
          <div className="btn-content">
            <div className="btn-title">Screenshot</div>
            <div className="btn-subtitle">Capture Current View</div>
          </div>
        </button>
      </div>

      <div className="panel-section">
        <h4>Auto-Refresh Settings</h4>
        <div className="refresh-controls">
          <label className="control-label">
            <input 
              type="checkbox"
              checked={autoRefreshEnabled}
              onChange={toggleAutoRefresh}
              data-testid="auto-refresh-toggle"
            />
            Enable Auto-Refresh
          </label>
          
          <div className="control-group">
            <label>Interval (hours):</label>
            <input 
              type="number"
              min="1"
              max="24"
              value={refreshInterval / 3600000}
              onChange={(e) => setRefreshInterval(e.target.value * 3600000)}
              disabled={autoRefreshEnabled}
              data-testid="refresh-interval-input"
            />
          </div>

          <div className="control-group">
            <label>Memory Threshold (%):</label>
            <input 
              type="number"
              min="50"
              max="95"
              value={memoryThreshold}
              onChange={(e) => setMemoryThreshold(e.target.value)}
              data-testid="memory-threshold-input"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default QuickActionsPanel;

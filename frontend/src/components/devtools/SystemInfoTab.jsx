import { useState, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import './SystemInfoTab.css';

const SystemInfoTab = () => {
  const [systemInfo, setSystemInfo] = useState({});
  const [networkStatus, setNetworkStatus] = useState({});
  const [uptime, setUptime] = useState(0);
  const [pingStatus, setPingStatus] = useState({ latency: 0, status: 'checking' });

  useEffect(() => {
    loadSystemInfo();
    startUptimeCounter();
    startPingMonitor();

    const interval = setInterval(() => {
      loadSystemInfo();
      checkNetworkStatus();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const loadSystemInfo = () => {
    const info = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      cookiesEnabled: navigator.cookieEnabled,
      onLine: navigator.onLine,
      cpuCores: navigator.hardwareConcurrency || 'Unknown',
      deviceMemory: navigator.deviceMemory ? `${navigator.deviceMemory} GB` : 'Unknown',
      screenResolution: `${window.screen.width}x${window.screen.height}`,
      availableResolution: `${window.screen.availWidth}x${window.screen.availHeight}`,
      colorDepth: `${window.screen.colorDepth}-bit`,
      pixelRatio: window.devicePixelRatio || 1,
      orientation: window.screen.orientation?.type || 'Unknown',
      touchSupport: 'ontouchstart' in window,
      maxTouchPoints: navigator.maxTouchPoints || 0,
      fullscreen: document.fullscreenElement !== null,
      timestamp: new Date().toLocaleString()
    };

    // Memory info (Chrome only)
    if (performance.memory) {
      info.jsHeapSize = `${Math.round(performance.memory.usedJSHeapSize / 1048576)} MB / ${Math.round(performance.memory.jsHeapSizeLimit / 1048576)} MB`;
      info.memoryUsage = `${Math.round((performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100)}%`;
    }

    // Storage estimate
    if (navigator.storage && navigator.storage.estimate) {
      navigator.storage.estimate().then(estimate => {
        const used = Math.round(estimate.usage / 1048576);
        const quota = Math.round(estimate.quota / 1048576);
        setSystemInfo(prev => ({
          ...prev,
          storageUsed: `${used} MB`,
          storageQuota: `${quota} MB`,
          storagePercent: `${Math.round((estimate.usage / estimate.quota) * 100)}%`
        }));
      });
    }

    // GPU info
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (gl) {
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        info.gpuVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL);
        info.gpuRenderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      }
      info.hardwareAcceleration = 'Enabled';
    } else {
      info.hardwareAcceleration = 'Disabled or Not Available';
    }

    setSystemInfo(info);
  };

  const checkNetworkStatus = () => {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (connection) {
      setNetworkStatus({
        effectiveType: connection.effectiveType || 'Unknown',
        downlink: connection.downlink ? `${connection.downlink} Mbps` : 'Unknown',
        rtt: connection.rtt ? `${connection.rtt} ms` : 'Unknown',
        saveData: connection.saveData ? 'Enabled' : 'Disabled',
        type: connection.type || 'Unknown'
      });
    }
  };

  const startUptimeCounter = () => {
    const startTime = performance.timing.navigationStart;
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      setUptime(elapsed);
    }, 1000);
    return () => clearInterval(interval);
  };

  const startPingMonitor = () => {
    const pingTest = async () => {
      try {
        const startTime = performance.now();
        await fetch(window.location.origin, { method: 'HEAD', cache: 'no-cache' });
        const latency = Math.round(performance.now() - startTime);
        setPingStatus({ latency, status: 'online' });
      } catch (error) {
        setPingStatus({ latency: 0, status: 'offline' });
      }
    };

    pingTest();
    const interval = setInterval(pingTest, 10000);
    return () => clearInterval(interval);
  };

  const formatUptime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const testOrientation = () => {
    if (window.screen.orientation && window.screen.orientation.lock) {
      window.screen.orientation.lock('landscape').catch(err => {
        console.log('Orientation lock not supported:', err);
      });
    }
  };

  const testFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.log('Fullscreen not supported:', err);
      });
    } else {
      document.exitFullscreen();
    }
  };

  const copySystemInfo = () => {
    const text = JSON.stringify({ ...systemInfo, networkStatus, uptime: formatUptime(uptime) }, null, 2);
    navigator.clipboard.writeText(text);
    alert('System info copied to clipboard!');
  };

  return (
    <div className="system-info-tab">
      <ScrollArea className="system-scroll">
        {/* Status Overview */}
        <div className="status-overview">
          <div className="status-card online">
            <div className="status-icon">●</div>
            <div className="status-info">
              <div className="status-label">Connection</div>
              <div className="status-value">{pingStatus.status}</div>
              <div className="status-detail">{pingStatus.latency}ms</div>
            </div>
          </div>

          <div className="status-card">
            <div className="status-icon">⏱</div>
            <div className="status-info">
              <div className="status-label">Uptime</div>
              <div className="status-value" data-testid="uptime-value">{formatUptime(uptime)}</div>
            </div>
          </div>

          <div className="status-card">
            <div className="status-icon">💾</div>
            <div className="status-info">
              <div className="status-label">Memory</div>
              <div className="status-value">{systemInfo.memoryUsage || 'N/A'}</div>
              <div className="status-detail">{systemInfo.jsHeapSize || 'Unknown'}</div>
            </div>
          </div>

          <div className="status-card">
            <div className="status-icon">📱</div>
            <div className="status-info">
              <div className="status-label">Resolution</div>
              <div className="status-value">{systemInfo.screenResolution}</div>
              <div className="status-detail">{systemInfo.orientation}</div>
            </div>
          </div>
        </div>

        {/* Quick Actions */}
        <div className="info-section">
          <div className="section-header">
            <h3 className="section-title">Quick Actions</h3>
          </div>
          <div className="quick-actions">
            <button className="action-btn" onClick={testFullscreen} data-testid="toggle-fullscreen-btn">
              Toggle Fullscreen
            </button>
            <button className="action-btn" onClick={testOrientation} data-testid="lock-orientation-btn">
              Lock Orientation
            </button>
            <button className="action-btn" onClick={copySystemInfo} data-testid="copy-info-btn">
              Copy Info
            </button>
            <button className="action-btn" onClick={() => window.location.reload()} data-testid="reload-page-btn">
              Reload Page
            </button>
          </div>
        </div>

        {/* System Information */}
        <div className="info-section">
          <div className="section-header">
            <h3 className="section-title">System Information</h3>
          </div>
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Platform:</span>
              <span className="info-value">{systemInfo.platform}</span>
            </div>
            <div className="info-item">
              <span className="info-label">CPU Cores:</span>
              <span className="info-value">{systemInfo.cpuCores}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Device Memory:</span>
              <span className="info-value">{systemInfo.deviceMemory}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Language:</span>
              <span className="info-value">{systemInfo.language}</span>
            </div>
          </div>
        </div>

        {/* Display Information */}
        <div className="info-section">
          <div className="section-header">
            <h3 className="section-title">Display Information</h3>
          </div>
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Screen Resolution:</span>
              <span className="info-value">{systemInfo.screenResolution}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Available Resolution:</span>
              <span className="info-value">{systemInfo.availableResolution}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Color Depth:</span>
              <span className="info-value">{systemInfo.colorDepth}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Pixel Ratio:</span>
              <span className="info-value">{systemInfo.pixelRatio}x</span>
            </div>
            <div className="info-item">
              <span className="info-label">Orientation:</span>
              <span className="info-value">{systemInfo.orientation}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Fullscreen:</span>
              <span className="info-value">{systemInfo.fullscreen ? 'Yes' : 'No'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Touch Support:</span>
              <span className="info-value">{systemInfo.touchSupport ? 'Yes' : 'No'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Max Touch Points:</span>
              <span className="info-value">{systemInfo.maxTouchPoints}</span>
            </div>
          </div>
        </div>

        {/* GPU Information */}
        <div className="info-section">
          <div className="section-header">
            <h3 className="section-title">Graphics</h3>
          </div>
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Hardware Acceleration:</span>
              <span className="info-value">{systemInfo.hardwareAcceleration}</span>
            </div>
            {systemInfo.gpuVendor && (
              <div className="info-item">
                <span className="info-label">GPU Vendor:</span>
                <span className="info-value">{systemInfo.gpuVendor}</span>
              </div>
            )}
            {systemInfo.gpuRenderer && (
              <div className="info-item full-width">
                <span className="info-label">GPU Renderer:</span>
                <span className="info-value">{systemInfo.gpuRenderer}</span>
              </div>
            )}
          </div>
        </div>

        {/* Network Information */}
        <div className="info-section">
          <div className="section-header">
            <h3 className="section-title">Network Status</h3>
          </div>
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Online Status:</span>
              <span className={`info-value ${systemInfo.onLine ? 'online' : 'offline'}`}>
                {systemInfo.onLine ? 'Online' : 'Offline'}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">Connection Type:</span>
              <span className="info-value">{networkStatus.effectiveType || 'Unknown'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Downlink Speed:</span>
              <span className="info-value">{networkStatus.downlink || 'Unknown'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">RTT:</span>
              <span className="info-value">{networkStatus.rtt || 'Unknown'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Ping Latency:</span>
              <span className="info-value">{pingStatus.latency}ms</span>
            </div>
          </div>
        </div>

        {/* Storage Information */}
        <div className="info-section">
          <div className="section-header">
            <h3 className="section-title">Storage</h3>
          </div>
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Used:</span>
              <span className="info-value">{systemInfo.storageUsed || 'Unknown'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Quota:</span>
              <span className="info-value">{systemInfo.storageQuota || 'Unknown'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Usage:</span>
              <span className="info-value">{systemInfo.storagePercent || 'Unknown'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Cookies:</span>
              <span className="info-value">{systemInfo.cookiesEnabled ? 'Enabled' : 'Disabled'}</span>
            </div>
          </div>
        </div>

        {/* User Agent */}
        <div className="info-section">
          <div className="section-header">
            <h3 className="section-title">User Agent</h3>
          </div>
          <div className="user-agent">{systemInfo.userAgent}</div>
        </div>
      </ScrollArea>
    </div>
  );
};

export default SystemInfoTab;

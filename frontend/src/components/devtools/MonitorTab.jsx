import { useState, useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import './MonitorTab.css';

const MonitorTab = () => {
  const [metrics, setMetrics] = useState({
    fps: 0,
    memory: { used: 0, total: 0, limit: 0 },
    performance: { loadTime: 0, domContentLoaded: 0, domInteractive: 0 },
    resources: []
  });
  const [history, setHistory] = useState({ fps: [], memory: [] });
  const frameRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const fpsHistoryRef = useRef([]);
  const memoryHistoryRef = useRef([]);

  useEffect(() => {
    // FPS Monitoring
    let animationFrameId;
    let frameCount = 0;
    let lastFpsUpdate = performance.now();

    const measureFPS = () => {
      frameCount++;
      const now = performance.now();
      
      if (now >= lastFpsUpdate + 1000) {
        const fps = Math.round((frameCount * 1000) / (now - lastFpsUpdate));
        
        setMetrics(prev => ({ ...prev, fps }));
        
        fpsHistoryRef.current = [...fpsHistoryRef.current.slice(-29), fps];
        setHistory(prev => ({
          ...prev,
          fps: fpsHistoryRef.current
        }));
        
        frameCount = 0;
        lastFpsUpdate = now;
      }
      
      animationFrameId = requestAnimationFrame(measureFPS);
    };

    animationFrameId = requestAnimationFrame(measureFPS);

    // Memory Monitoring
    const updateMemory = () => {
      if (performance.memory) {
        const memory = {
          used: Math.round(performance.memory.usedJSHeapSize / 1048576),
          total: Math.round(performance.memory.totalJSHeapSize / 1048576),
          limit: Math.round(performance.memory.jsHeapSizeLimit / 1048576)
        };
        
        setMetrics(prev => ({ ...prev, memory }));
        
        memoryHistoryRef.current = [...memoryHistoryRef.current.slice(-29), memory.used];
        setHistory(prev => ({
          ...prev,
          memory: memoryHistoryRef.current
        }));
      }
    };

    const memoryInterval = setInterval(updateMemory, 1000);

    // Performance Metrics
    const updatePerformance = () => {
      const timing = performance.timing;
      const perfData = {
        loadTime: timing.loadEventEnd - timing.navigationStart,
        domContentLoaded: timing.domContentLoadedEventEnd - timing.navigationStart,
        domInteractive: timing.domInteractive - timing.navigationStart
      };
      setMetrics(prev => ({ ...prev, performance: perfData }));
    };

    if (document.readyState === 'complete') {
      updatePerformance();
    } else {
      window.addEventListener('load', updatePerformance);
    }

    // Resource Monitoring
    const updateResources = () => {
      const resources = performance.getEntriesByType('resource').map(entry => ({
        name: entry.name,
        type: entry.initiatorType,
        duration: Math.round(entry.duration),
        size: entry.transferSize || 0,
        startTime: Math.round(entry.startTime)
      }));
      setMetrics(prev => ({ ...prev, resources }));
    };

    updateResources();
    const resourceInterval = setInterval(updateResources, 5000);

    return () => {
      cancelAnimationFrame(animationFrameId);
      clearInterval(memoryInterval);
      clearInterval(resourceInterval);
      window.removeEventListener('load', updatePerformance);
    };
  }, []);

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const formatTime = (ms) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const getFPSStatus = (fps) => {
    if (fps >= 55) return 'excellent';
    if (fps >= 30) return 'good';
    if (fps >= 20) return 'fair';
    return 'poor';
  };

  const getMemoryStatus = (used, limit) => {
    const percent = (used / limit) * 100;
    if (percent < 50) return 'excellent';
    if (percent < 70) return 'good';
    if (percent < 85) return 'fair';
    return 'poor';
  };

  const Chart = ({ data, label, color, max }) => {
    const maxValue = max || Math.max(...data, 1);
    return (
      <div className="chart-container">
        <div className="chart-label">{label}</div>
        <div className="chart">
          {data.map((value, idx) => {
            const height = (value / maxValue) * 100;
            return (
              <div
                key={idx}
                className="chart-bar"
                style={{
                  height: `${height}%`,
                  background: color
                }}
                title={`${value}`}
              />
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="monitor-tab">
      <ScrollArea className="monitor-scroll">
        {/* Real-time Metrics */}
        <div className="metrics-grid">
          <div className="metric-card fps">
            <div className="metric-header">
              <span className="metric-title">FPS</span>
              <span className={`metric-status ${getFPSStatus(metrics.fps)}`}>
                {getFPSStatus(metrics.fps)}
              </span>
            </div>
            <div className="metric-value" data-testid="fps-value">{metrics.fps}</div>
            <div className="metric-label">Frames Per Second</div>
            {history.fps.length > 0 && (
              <Chart data={history.fps} label="Last 30s" color="#00FF66" max={60} />
            )}
          </div>

          <div className="metric-card memory">
            <div className="metric-header">
              <span className="metric-title">Memory</span>
              <span className={`metric-status ${getMemoryStatus(metrics.memory.used, metrics.memory.limit)}`}>
                {getMemoryStatus(metrics.memory.used, metrics.memory.limit)}
              </span>
            </div>
            <div className="metric-value" data-testid="memory-value">{metrics.memory.used} MB</div>
            <div className="metric-label">Used / {metrics.memory.limit} MB Limit</div>
            {history.memory.length > 0 && (
              <Chart data={history.memory} label="Last 30s" color="#0099FF" max={metrics.memory.limit} />
            )}
          </div>

          <div className="metric-card performance">
            <div className="metric-header">
              <span className="metric-title">Load Time</span>
            </div>
            <div className="metric-value" data-testid="loadtime-value">
              {formatTime(metrics.performance.loadTime)}
            </div>
            <div className="metric-details">
              <div className="detail-row">
                <span className="detail-label">DOM Interactive:</span>
                <span className="detail-value">{formatTime(metrics.performance.domInteractive)}</span>
              </div>
              <div className="detail-row">
                <span className="detail-label">DOM Content Loaded:</span>
                <span className="detail-value">{formatTime(metrics.performance.domContentLoaded)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Resource Table */}
        <div className="resources-section">
          <div className="section-header">
            <h3 className="section-title">Resource Timing</h3>
            <span className="resource-count">{metrics.resources.length} resources</span>
          </div>
          
          <div className="resources-table">
            <div className="table-header">
              <div className="col-name">Name</div>
              <div className="col-type">Type</div>
              <div className="col-size">Size</div>
              <div className="col-duration">Duration</div>
            </div>
            
            <div className="table-body">
              {metrics.resources.slice(0, 50).map((resource, idx) => (
                <div key={idx} className="table-row" data-testid="resource-row">
                  <div className="col-name" title={resource.name}>{resource.name}</div>
                  <div className="col-type">{resource.type}</div>
                  <div className="col-size">{formatBytes(resource.size)}</div>
                  <div className="col-duration">{resource.duration}ms</div>
                </div>
              ))}
              {metrics.resources.length === 0 && (
                <div className="table-empty" data-testid="resources-empty">
                  No resources loaded yet
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Additional Info */}
        <div className="info-section">
          <div className="section-header">
            <h3 className="section-title">System Information</h3>
          </div>
          
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Platform:</span>
              <span className="info-value">{navigator.platform}</span>
            </div>
            <div className="info-item">
              <span className="info-label">CPU Cores:</span>
              <span className="info-value">{navigator.hardwareConcurrency || 'Unknown'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Device Memory:</span>
              <span className="info-value">
                {navigator.deviceMemory ? `${navigator.deviceMemory} GB` : 'Unknown'}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">Connection:</span>
              <span className="info-value">
                {navigator.connection?.effectiveType || 'Unknown'}
              </span>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};

export default MonitorTab;

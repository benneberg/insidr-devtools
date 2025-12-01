import { useState, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import './NetworkTab.css';

const NetworkTab = () => {
  const [requests, setRequests] = useState([]);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    // Intercept fetch
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
      const startTime = performance.now();
      const url = typeof args[0] === 'string' ? args[0] : args[0].url;
      const method = args[1]?.method || 'GET';
      
      const requestEntry = {
        id: Date.now() + Math.random(),
        url,
        method,
        type: 'fetch',
        status: 'pending',
        startTime: new Date().toLocaleTimeString(),
        duration: 0,
        size: 0,
        requestHeaders: args[1]?.headers || {},
        requestBody: args[1]?.body || null,
        responseHeaders: {},
        responseBody: null
      };

      setRequests(prev => [...prev, requestEntry]);

      try {
        const response = await originalFetch.apply(this, args);
        const endTime = performance.now();
        const duration = Math.round(endTime - startTime);
        
        const clonedResponse = response.clone();
        const responseBody = await clonedResponse.text();
        const size = new Blob([responseBody]).size;

        const responseHeaders = {};
        clonedResponse.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        setRequests(prev => prev.map(req => 
          req.id === requestEntry.id 
            ? { 
                ...req, 
                status: response.status,
                statusText: response.statusText,
                duration, 
                size,
                responseHeaders,
                responseBody
              }
            : req
        ));

        return response;
      } catch (error) {
        const endTime = performance.now();
        const duration = Math.round(endTime - startTime);
        
        setRequests(prev => prev.map(req => 
          req.id === requestEntry.id 
            ? { ...req, status: 'failed', duration, error: error.message }
            : req
        ));
        throw error;
      }
    };

    // Intercept XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
      this._devtools = {
        method,
        url,
        startTime: performance.now()
      };
      return originalXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
      if (this._devtools) {
        const requestEntry = {
          id: Date.now() + Math.random(),
          url: this._devtools.url,
          method: this._devtools.method,
          type: 'xhr',
          status: 'pending',
          startTime: new Date().toLocaleTimeString(),
          duration: 0,
          size: 0,
          requestBody: body,
          responseBody: null
        };

        setRequests(prev => [...prev, requestEntry]);

        this.addEventListener('load', function() {
          const duration = Math.round(performance.now() - this._devtools.startTime);
          const size = this.responseText ? new Blob([this.responseText]).size : 0;

          setRequests(prev => prev.map(req => 
            req.id === requestEntry.id 
              ? { 
                  ...req, 
                  status: this.status,
                  statusText: this.statusText,
                  duration, 
                  size,
                  responseBody: this.responseText
                }
              : req
          ));
        });

        this.addEventListener('error', function() {
          const duration = Math.round(performance.now() - this._devtools.startTime);
          
          setRequests(prev => prev.map(req => 
            req.id === requestEntry.id 
              ? { ...req, status: 'failed', duration }
              : req
          ));
        });
      }

      return originalXHRSend.apply(this, arguments);
    };

    return () => {
      window.fetch = originalFetch;
      XMLHttpRequest.prototype.open = originalXHROpen;
      XMLHttpRequest.prototype.send = originalXHRSend;
    };
  }, []);

  const clearRequests = () => {
    setRequests([]);
    setSelectedRequest(null);
  };

  const exportRequests = (format) => {
    if (format === 'json') {
      const dataStr = JSON.stringify(requests, null, 2);
      const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
      const link = document.createElement('a');
      link.setAttribute('href', dataUri);
      link.setAttribute('download', `network-logs-${Date.now()}.json`);
      link.click();
    } else if (format === 'csv') {
      const csvContent = [
        ['Method', 'URL', 'Status', 'Type', 'Size', 'Time', 'Timestamp'],
        ...requests.map(req => [
          req.method,
          req.url,
          req.status,
          req.type,
          req.size,
          `${req.duration}ms`,
          req.startTime
        ])
      ].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
      
      const dataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', dataUri);
      link.setAttribute('download', `network-logs-${Date.now()}.csv`);
      link.click();
    }
  };

  const getStatusClass = (status) => {
    if (status === 'pending') return 'pending';
    if (status === 'failed') return 'failed';
    if (status >= 200 && status < 300) return 'success';
    if (status >= 300 && status < 400) return 'redirect';
    if (status >= 400 && status < 500) return 'client-error';
    if (status >= 500) return 'server-error';
    return '';
  };

  const filteredRequests = filter === 'all' 
    ? requests 
    : requests.filter(req => req.type === filter);

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  return (
    <div className="network-tab">
      <div className="network-toolbar">
        <div className="network-filters">
          <button 
            data-testid="filter-all-requests-btn"
            className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All ({requests.length})
          </button>
          <button 
            data-testid="filter-fetch-btn"
            className={`filter-btn ${filter === 'fetch' ? 'active' : ''}`}
            onClick={() => setFilter('fetch')}
          >
            Fetch ({requests.filter(r => r.type === 'fetch').length})
          </button>
          <button 
            data-testid="filter-xhr-btn"
            className={`filter-btn ${filter === 'xhr' ? 'active' : ''}`}
            onClick={() => setFilter('xhr')}
          >
            XHR ({requests.filter(r => r.type === 'xhr').length})
          </button>
        </div>
        
        <div className="network-actions">
          <button 
            data-testid="export-network-json-btn"
            className="export-btn"
            onClick={() => exportRequests('json')}
          >
            Export JSON
          </button>
          <button 
            data-testid="export-network-csv-btn"
            className="export-btn"
            onClick={() => exportRequests('csv')}
          >
            Export CSV
          </button>
          <button 
            data-testid="clear-network-btn"
            className="clear-btn"
            onClick={clearRequests}
          >
            Clear
          </button>
        </div>
      </div>

      <div className="network-layout">
        <div className="network-list">
          <div className="network-header">
            <div className="col-method">Method</div>
            <div className="col-url">URL</div>
            <div className="col-status">Status</div>
            <div className="col-type">Type</div>
            <div className="col-size">Size</div>
            <div className="col-time">Time</div>
          </div>
          
          <ScrollArea className="network-requests">
            {filteredRequests.map(req => (
              <div 
                key={req.id}
                className={`network-request ${selectedRequest?.id === req.id ? 'selected' : ''}`}
                onClick={() => setSelectedRequest(req)}
                data-testid="network-request"
              >
                <div className="col-method">{req.method}</div>
                <div className="col-url" title={req.url}>{req.url}</div>
                <div className={`col-status ${getStatusClass(req.status)}`}>
                  {req.status === 'pending' ? '...' : req.status}
                </div>
                <div className="col-type">{req.type}</div>
                <div className="col-size">{formatBytes(req.size)}</div>
                <div className="col-time">{req.duration}ms</div>
              </div>
            ))}
            {filteredRequests.length === 0 && (
              <div className="network-empty" data-testid="network-empty">
                No network requests recorded
              </div>
            )}
          </ScrollArea>
        </div>

        {selectedRequest && (
          <div className="network-details">
            <div className="details-header">
              <span className="details-title">Request Details</span>
              <button 
                data-testid="close-details-btn"
                className="close-details"
                onClick={() => setSelectedRequest(null)}
              >
                ✕
              </button>
            </div>
            
            <ScrollArea className="details-content">
              <div className="details-section">
                <div className="section-title">General</div>
                <div className="detail-item">
                  <span className="detail-key">URL:</span>
                  <span className="detail-value">{selectedRequest.url}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-key">Method:</span>
                  <span className="detail-value">{selectedRequest.method}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-key">Status:</span>
                  <span className="detail-value">{selectedRequest.status} {selectedRequest.statusText}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-key">Time:</span>
                  <span className="detail-value">{selectedRequest.startTime}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-key">Duration:</span>
                  <span className="detail-value">{selectedRequest.duration}ms</span>
                </div>
              </div>

              {selectedRequest.requestHeaders && Object.keys(selectedRequest.requestHeaders).length > 0 && (
                <div className="details-section">
                  <div className="section-title">Request Headers</div>
                  {Object.entries(selectedRequest.requestHeaders).map(([key, value]) => (
                    <div key={key} className="detail-item">
                      <span className="detail-key">{key}:</span>
                      <span className="detail-value">{value}</span>
                    </div>
                  ))}
                </div>
              )}

              {selectedRequest.requestBody && (
                <div className="details-section">
                  <div className="section-title">Request Body</div>
                  <pre className="detail-code">{selectedRequest.requestBody}</pre>
                </div>
              )}

              {selectedRequest.responseHeaders && Object.keys(selectedRequest.responseHeaders).length > 0 && (
                <div className="details-section">
                  <div className="section-title">Response Headers</div>
                  {Object.entries(selectedRequest.responseHeaders).map(([key, value]) => (
                    <div key={key} className="detail-item">
                      <span className="detail-key">{key}:</span>
                      <span className="detail-value">{value}</span>
                    </div>
                  ))}
                </div>
              )}

              {selectedRequest.responseBody && (
                <div className="details-section">
                  <div className="section-title">Response Body</div>
                  <pre className="detail-code">{selectedRequest.responseBody}</pre>
                </div>
              )}

              {selectedRequest.error && (
                <div className="details-section">
                  <div className="section-title">Error</div>
                  <div className="detail-error">{selectedRequest.error}</div>
                </div>
              )}
            </ScrollArea>
          </div>
        )}
      </div>
    </div>
  );
};

export default NetworkTab;

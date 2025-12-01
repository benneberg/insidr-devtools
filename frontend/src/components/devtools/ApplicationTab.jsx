import { useState, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import './ApplicationTab.css';

const ApplicationTab = () => {
  const [serviceWorkers, setServiceWorkers] = useState([]);
  const [cacheStorages, setCacheStorages] = useState([]);
  const [manifest, setManifest] = useState(null);

  useEffect(() => {
    loadServiceWorkers();
    loadCacheStorages();
    loadManifest();

    // Refresh periodically
    const interval = setInterval(() => {
      loadServiceWorkers();
      loadCacheStorages();
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const loadServiceWorkers = async () => {
    if ('serviceWorker' in navigator) {
      try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        const workers = registrations.map(reg => ({
          scope: reg.scope,
          state: reg.active?.state || reg.installing?.state || reg.waiting?.state || 'unknown',
          updateViaCache: reg.updateViaCache,
          scriptURL: reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL
        }));
        setServiceWorkers(workers);
      } catch (error) {
        console.error('Error loading service workers:', error);
      }
    }
  };

  const loadCacheStorages = async () => {
    if ('caches' in window) {
      try {
        const cacheNames = await caches.keys();
        const cacheData = await Promise.all(
          cacheNames.map(async (name) => {
            const cache = await caches.open(name);
            const keys = await cache.keys();
            return {
              name,
              count: keys.length,
              urls: keys.map(req => req.url)
            };
          })
        );
        setCacheStorages(cacheData);
      } catch (error) {
        console.error('Error loading cache storages:', error);
      }
    }
  };

  const loadManifest = () => {
    const manifestLink = document.querySelector('link[rel="manifest"]');
    if (manifestLink) {
      fetch(manifestLink.href)
        .then(res => res.json())
        .then(data => setManifest(data))
        .catch(err => console.error('Error loading manifest:', err));
    }
  };

  const unregisterServiceWorker = async (scope) => {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      const registration = registrations.find(reg => reg.scope === scope);
      if (registration) {
        await registration.unregister();
        loadServiceWorkers();
      }
    }
  };

  const clearCache = async (cacheName) => {
    if ('caches' in window) {
      await caches.delete(cacheName);
      loadCacheStorages();
    }
  };

  const clearAllCaches = async () => {
    if (window.confirm('Are you sure you want to clear all caches?')) {
      if ('caches' in window) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
        loadCacheStorages();
      }
    }
  };

  return (
    <div className="application-tab">
      <ScrollArea className="application-scroll">
        {/* Service Workers Section */}
        <div className="app-section">
          <div className="section-header">
            <h3 className="section-title">Service Workers</h3>
            <div className="status-badge">
              <span className={`status-dot ${serviceWorkers.length > 0 ? 'active' : 'inactive'}`} />
              {serviceWorkers.length > 0 ? 'Active' : 'None'}
            </div>
          </div>
          
          {serviceWorkers.length === 0 ? (
            <div className="section-empty" data-testid="sw-empty">
              No service workers registered
            </div>
          ) : (
            <div className="sw-list">
              {serviceWorkers.map((sw, idx) => (
                <div key={idx} className="sw-item" data-testid="sw-item">
                  <div className="sw-header">
                    <span className={`sw-state ${sw.state}`}>{sw.state}</span>
                    <button 
                      data-testid="unregister-sw-btn"
                      className="sw-action"
                      onClick={() => unregisterServiceWorker(sw.scope)}
                    >
                      Unregister
                    </button>
                  </div>
                  <div className="sw-detail">
                    <span className="detail-label">Scope:</span>
                    <span className="detail-value">{sw.scope}</span>
                  </div>
                  <div className="sw-detail">
                    <span className="detail-label">Script:</span>
                    <span className="detail-value">{sw.scriptURL}</span>
                  </div>
                  <div className="sw-detail">
                    <span className="detail-label">Update:</span>
                    <span className="detail-value">{sw.updateViaCache}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Cache Storage Section */}
        <div className="app-section">
          <div className="section-header">
            <h3 className="section-title">Cache Storage</h3>
            <button 
              data-testid="clear-all-caches-btn"
              className="section-action"
              onClick={clearAllCaches}
            >
              Clear All
            </button>
          </div>
          
          {cacheStorages.length === 0 ? (
            <div className="section-empty" data-testid="cache-empty">
              No cache storages found
            </div>
          ) : (
            <div className="cache-list">
              {cacheStorages.map((cache, idx) => (
                <div key={idx} className="cache-item" data-testid="cache-item">
                  <div className="cache-header">
                    <div className="cache-info">
                      <span className="cache-name">{cache.name}</span>
                      <span className="cache-count">{cache.count} items</span>
                    </div>
                    <button 
                      data-testid="clear-cache-btn"
                      className="cache-action"
                      onClick={() => clearCache(cache.name)}
                    >
                      Clear
                    </button>
                  </div>
                  <div className="cache-urls">
                    {cache.urls.slice(0, 5).map((url, urlIdx) => (
                      <div key={urlIdx} className="cache-url">{url}</div>
                    ))}
                    {cache.urls.length > 5 && (
                      <div className="cache-more">...and {cache.urls.length - 5} more</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Manifest Section */}
        <div className="app-section">
          <div className="section-header">
            <h3 className="section-title">App Manifest</h3>
          </div>
          
          {!manifest ? (
            <div className="section-empty" data-testid="manifest-empty">
              No manifest file found
            </div>
          ) : (
            <div className="manifest-content">
              <pre className="manifest-json">{JSON.stringify(manifest, null, 2)}</pre>
            </div>
          )}
        </div>

        {/* Additional Info Section */}
        <div className="app-section">
          <div className="section-header">
            <h3 className="section-title">App Information</h3>
          </div>
          
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Online Status:</span>
              <span className={`info-value ${navigator.onLine ? 'online' : 'offline'}`}>
                {navigator.onLine ? 'Online' : 'Offline'}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">Protocol:</span>
              <span className="info-value">{window.location.protocol}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Host:</span>
              <span className="info-value">{window.location.host}</span>
            </div>
            <div className="info-item">
              <span className="info-label">User Agent:</span>
              <span className="info-value">{navigator.userAgent}</span>
            </div>
          </div>
        </div>
      </ScrollArea>
    </div>
  );
};

export default ApplicationTab;

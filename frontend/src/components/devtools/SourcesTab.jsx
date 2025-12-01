import { useState, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import './SourcesTab.css';

const SourcesTab = () => {
  const [sources, setSources] = useState({
    scripts: [],
    stylesheets: [],
    images: [],
    other: []
  });
  const [selectedSource, setSelectedSource] = useState(null);
  const [sourceContent, setSourceContent] = useState('');
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSources();
  }, []);

  const loadSources = () => {
    const scripts = Array.from(document.scripts).map(script => ({
      url: script.src || 'inline',
      type: 'script',
      size: script.textContent?.length || 0,
      inline: !script.src,
      content: script.textContent
    }));

    const stylesheets = Array.from(document.styleSheets)
      .map(sheet => {
        try {
          return {
            url: sheet.href || 'inline',
            type: 'stylesheet',
            rules: sheet.cssRules?.length || 0,
            inline: !sheet.href
          };
        } catch (e) {
          return {
            url: sheet.href || 'inline',
            type: 'stylesheet',
            rules: 0,
            inline: !sheet.href,
            error: 'CORS restricted'
          };
        }
      });

    const images = Array.from(document.images).map(img => ({
      url: img.src,
      type: 'image',
      size: img.naturalWidth && img.naturalHeight ? `${img.naturalWidth}x${img.naturalHeight}` : 'Unknown',
      alt: img.alt || 'No alt text'
    }));

    const resources = performance.getEntriesByType('resource');
    const other = resources
      .filter(r => !['script', 'css', 'img'].includes(r.initiatorType))
      .map(r => ({
        url: r.name,
        type: r.initiatorType || 'other',
        duration: Math.round(r.duration),
        size: r.transferSize || 0
      }));

    setSources({ scripts, stylesheets, images, other });
  };

  const loadSourceContent = async (source) => {
    setSelectedSource(source);
    setLoading(true);

    try {
      if (source.inline && source.content) {
        setSourceContent(source.content);
      } else if (source.url && source.url !== 'inline') {
        const response = await fetch(source.url);
        const content = await response.text();
        setSourceContent(content);
      } else {
        setSourceContent('Content not available');
      }
    } catch (error) {
      setSourceContent(`Error loading content: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const getFilteredSources = () => {
    switch (filter) {
      case 'scripts':
        return sources.scripts;
      case 'stylesheets':
        return sources.stylesheets;
      case 'images':
        return sources.images;
      case 'other':
        return sources.other;
      default:
        return [
          ...sources.scripts,
          ...sources.stylesheets,
          ...sources.images,
          ...sources.other
        ];
    }
  };

  const getFileIcon = (type) => {
    switch (type) {
      case 'script':
        return '📜';
      case 'stylesheet':
        return '🎨';
      case 'image':
        return '🖼️';
      default:
        return '📄';
    }
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const getTotalCount = () => {
    return sources.scripts.length + sources.stylesheets.length + 
           sources.images.length + sources.other.length;
  };

  const filteredSources = getFilteredSources();

  return (
    <div className="sources-tab">
      <div className="sources-toolbar">
        <div className="sources-filters">
          <button 
            data-testid="filter-all-sources-btn"
            className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All ({getTotalCount()})
          </button>
          <button 
            data-testid="filter-scripts-btn"
            className={`filter-btn ${filter === 'scripts' ? 'active' : ''}`}
            onClick={() => setFilter('scripts')}
          >
            Scripts ({sources.scripts.length})
          </button>
          <button 
            data-testid="filter-stylesheets-btn"
            className={`filter-btn ${filter === 'stylesheets' ? 'active' : ''}`}
            onClick={() => setFilter('stylesheets')}
          >
            Styles ({sources.stylesheets.length})
          </button>
          <button 
            data-testid="filter-images-btn"
            className={`filter-btn ${filter === 'images' ? 'active' : ''}`}
            onClick={() => setFilter('images')}
          >
            Images ({sources.images.length})
          </button>
          <button 
            data-testid="filter-other-btn"
            className={`filter-btn ${filter === 'other' ? 'active' : ''}`}
            onClick={() => setFilter('other')}
          >
            Other ({sources.other.length})
          </button>
        </div>
        
        <button 
          data-testid="refresh-sources-btn"
          className="refresh-btn"
          onClick={loadSources}
        >
          Refresh
        </button>
      </div>

      <div className="sources-layout">
        <div className="sources-tree">
          <ScrollArea className="tree-scroll">
            {filteredSources.length === 0 ? (
              <div className="sources-empty" data-testid="sources-empty">
                No sources found
              </div>
            ) : (
              <div className="sources-list">
                {filteredSources.map((source, idx) => (
                  <div
                    key={idx}
                    className={`source-item ${selectedSource === source ? 'selected' : ''}`}
                    onClick={() => loadSourceContent(source)}
                    data-testid="source-item"
                  >
                    <span className="source-icon">{getFileIcon(source.type)}</span>
                    <div className="source-info">
                      <div className="source-url" title={source.url}>
                        {source.url === 'inline' ? `Inline ${source.type}` : source.url}
                      </div>
                      <div className="source-meta">
                        <span className="source-type">{source.type}</span>
                        {source.size && typeof source.size === 'number' && (
                          <span className="source-size">{formatBytes(source.size)}</span>
                        )}
                        {source.size && typeof source.size === 'string' && (
                          <span className="source-size">{source.size}</span>
                        )}
                        {source.rules !== undefined && (
                          <span className="source-rules">{source.rules} rules</span>
                        )}
                        {source.inline && (
                          <span className="source-badge">inline</span>
                        )}
                        {source.error && (
                          <span className="source-error">{source.error}</span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        <div className="sources-viewer">
          {selectedSource ? (
            <>
              <div className="viewer-header">
                <span className="viewer-title">{selectedSource.url}</span>
                <button 
                  data-testid="close-viewer-btn"
                  className="close-viewer"
                  onClick={() => setSelectedSource(null)}
                >
                  ✕
                </button>
              </div>
              <ScrollArea className="viewer-content">
                {loading ? (
                  <div className="viewer-loading" data-testid="viewer-loading">
                    Loading...
                  </div>
                ) : (
                  <pre className="source-code" data-testid="source-code">
                    <code>{sourceContent}</code>
                  </pre>
                )}
              </ScrollArea>
            </>
          ) : (
            <div className="viewer-empty" data-testid="viewer-empty">
              Select a source file to view its content
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SourcesTab;

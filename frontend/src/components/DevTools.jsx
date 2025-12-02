import { useState, useEffect, useRef } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import ConsoleTab from './devtools/ConsoleTab';
import ElementsTab from './devtools/ElementsTab';
import NetworkTab from './devtools/NetworkTab';
import StorageTab from './devtools/StorageTab';
import ApplicationTab from './devtools/ApplicationTab';
import MonitorTab from './devtools/MonitorTab';
import ScriptRunnerTab from './devtools/ScriptRunnerTab';
import SourcesTab from './devtools/SourcesTab';
import SystemInfoTab from './devtools/SystemInfoTab';
import QuickActionsPanel from './devtools/QuickActionsPanel';
import './DevTools.css';

const DevTools = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('console');
  const [height, setHeight] = useState(400);
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef(null);

  const handleMouseDown = (e) => {
    setIsResizing(true);
    e.preventDefault();
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (isResizing) {
        const newHeight = window.innerHeight - e.clientY;
        if (newHeight >= 200 && newHeight <= window.innerHeight - 100) {
          setHeight(newHeight);
        }
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  return (
    <>
      {/* Toggle Button */}
      <button
        data-testid="devtools-toggle-btn"
        className={`devtools-toggle ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="toggle-icon">
          {isOpen ? '▼' : '▲'}
        </div>
        <span className="toggle-text">DevTools</span>
        <div className={`status-indicator ${isOpen ? 'active' : ''}`} />
      </button>

      {/* DevTools Panel */}
      <div 
        className={`devtools-container ${isOpen ? 'open' : ''}`}
        style={{ height: isOpen ? `${height}px` : '0px' }}
      >
        {/* Resize Handle */}
        <div 
          className="devtools-resize-handle"
          onMouseDown={handleMouseDown}
        >
          <div className="resize-line" />
        </div>

        <div className="devtools-header">
          <h2 className="devtools-title">DevTools</h2>
          <div className="devtools-actions">
            <button 
              data-testid="devtools-minimize-btn"
              className="action-btn"
              onClick={() => setIsOpen(false)}
            >
              Minimize
            </button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="devtools-tabs">
          <TabsList className="devtools-tabs-list">
            <TabsTrigger value="console" data-testid="tab-console">Console</TabsTrigger>
            <TabsTrigger value="elements" data-testid="tab-elements">Elements</TabsTrigger>
            <TabsTrigger value="network" data-testid="tab-network">Network</TabsTrigger>
            <TabsTrigger value="sources" data-testid="tab-sources">Sources</TabsTrigger>
            <TabsTrigger value="storage" data-testid="tab-storage">Storage</TabsTrigger>
            <TabsTrigger value="application" data-testid="tab-application">Application</TabsTrigger>
            <TabsTrigger value="monitor" data-testid="tab-monitor">Monitor</TabsTrigger>
            <TabsTrigger value="system" data-testid="tab-system">System Info</TabsTrigger>
            <TabsTrigger value="actions" data-testid="tab-actions">Quick Actions</TabsTrigger>
            <TabsTrigger value="runner" data-testid="tab-runner">Script Runner</TabsTrigger>
          </TabsList>

          <div className="devtools-content">
            <TabsContent value="console" className="tab-content">
              <ConsoleTab />
            </TabsContent>
            
            <TabsContent value="elements" className="tab-content">
              <ElementsTab />
            </TabsContent>
            
            <TabsContent value="network" className="tab-content">
              <NetworkTab />
            </TabsContent>
            
            <TabsContent value="sources" className="tab-content">
              <SourcesTab />
            </TabsContent>
            
            <TabsContent value="storage" className="tab-content">
              <StorageTab />
            </TabsContent>
            
            <TabsContent value="application" className="tab-content">
              <ApplicationTab />
            </TabsContent>
            
            <TabsContent value="monitor" className="tab-content">
              <MonitorTab />
            </TabsContent>
            
            <TabsContent value="runner" className="tab-content">
              <ScriptRunnerTab />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </>
  );
};

export default DevTools;

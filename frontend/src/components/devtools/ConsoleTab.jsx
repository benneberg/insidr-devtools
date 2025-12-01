import { useState, useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import './ConsoleTab.css';

const ConsoleTab = () => {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState('all');
  const [input, setInput] = useState('');
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    // Intercept console methods
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;
    const originalInfo = console.info;

    const createLogEntry = (type, args) => {
      return {
        id: Date.now() + Math.random(),
        type,
        message: args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
        ).join(' '),
        timestamp: new Date().toLocaleTimeString()
      };
    };

    console.log = function(...args) {
      setLogs(prev => [...prev, createLogEntry('log', args)]);
      originalLog.apply(console, args);
    };

    console.warn = function(...args) {
      setLogs(prev => [...prev, createLogEntry('warn', args)]);
      originalWarn.apply(console, args);
    };

    console.error = function(...args) {
      setLogs(prev => [...prev, createLogEntry('error', args)]);
      originalError.apply(console, args);
    };

    console.info = function(...args) {
      setLogs(prev => [...prev, createLogEntry('info', args)]);
      originalInfo.apply(console, args);
    };

    return () => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
      console.info = originalInfo;
    };
  }, []);

  const executeCommand = () => {
    if (!input.trim()) return;

    const commandLog = {
      id: Date.now() + Math.random(),
      type: 'command',
      message: `> ${input}`,
      timestamp: new Date().toLocaleTimeString()
    };

    setLogs(prev => [...prev, commandLog]);
    setHistory(prev => [...prev, input]);
    setHistoryIndex(-1);

    try {
      const result = eval(input);
      const resultLog = {
        id: Date.now() + Math.random() + 1,
        type: 'result',
        message: typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result),
        timestamp: new Date().toLocaleTimeString()
      };
      setLogs(prev => [...prev, resultLog]);
    } catch (error) {
      const errorLog = {
        id: Date.now() + Math.random() + 1,
        type: 'error',
        message: error.message,
        timestamp: new Date().toLocaleTimeString()
      };
      setLogs(prev => [...prev, errorLog]);
    }

    setInput('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      executeCommand();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length > 0) {
        const newIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
        setHistoryIndex(newIndex);
        setInput(history[newIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex !== -1) {
        const newIndex = historyIndex + 1;
        if (newIndex >= history.length) {
          setHistoryIndex(-1);
          setInput('');
        } else {
          setHistoryIndex(newIndex);
          setInput(history[newIndex]);
        }
      }
    }
  };

  const clearLogs = () => {
    setLogs([]);
  };

  const exportLogs = (format) => {
    if (format === 'json') {
      const dataStr = JSON.stringify(logs, null, 2);
      const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
      const link = document.createElement('a');
      link.setAttribute('href', dataUri);
      link.setAttribute('download', `console-logs-${Date.now()}.json`);
      link.click();
    } else if (format === 'csv') {
      const csvContent = [
        ['Type', 'Message', 'Timestamp'],
        ...logs.map(log => [log.type, log.message.replace(/"/g, '""'), log.timestamp])
      ].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
      
      const dataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', dataUri);
      link.setAttribute('download', `console-logs-${Date.now()}.csv`);
      link.click();
    }
  };

  const filteredLogs = filter === 'all' 
    ? logs 
    : logs.filter(log => log.type === filter);

  return (
    <div className="console-tab">
      <div className="console-toolbar">
        <div className="console-filters">
          <button 
            data-testid="filter-all-btn"
            className={`filter-btn ${filter === 'all' ? 'active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All ({logs.length})
          </button>
          <button 
            data-testid="filter-log-btn"
            className={`filter-btn ${filter === 'log' ? 'active' : ''}`}
            onClick={() => setFilter('log')}
          >
            Logs ({logs.filter(l => l.type === 'log').length})
          </button>
          <button 
            data-testid="filter-warn-btn"
            className={`filter-btn ${filter === 'warn' ? 'active' : ''}`}
            onClick={() => setFilter('warn')}
          >
            Warnings ({logs.filter(l => l.type === 'warn').length})
          </button>
          <button 
            data-testid="filter-error-btn"
            className={`filter-btn ${filter === 'error' ? 'active' : ''}`}
            onClick={() => setFilter('error')}
          >
            Errors ({logs.filter(l => l.type === 'error').length})
          </button>
        </div>
        
        <div className="console-actions">
          <button 
            data-testid="export-json-btn"
            className="export-btn"
            onClick={() => exportLogs('json')}
          >
            Export JSON
          </button>
          <button 
            data-testid="export-csv-btn"
            className="export-btn"
            onClick={() => exportLogs('csv')}
          >
            Export CSV
          </button>
          <button 
            data-testid="clear-console-btn"
            className="clear-btn"
            onClick={clearLogs}
          >
            Clear
          </button>
        </div>
      </div>

      <ScrollArea className="console-output">
        <div className="console-logs">
          {filteredLogs.map(log => (
            <div key={log.id} className={`console-log-entry ${log.type}`} data-testid={`log-entry-${log.type}`}>
              <span className="log-timestamp">{log.timestamp}</span>
              <span className="log-type-icon">
                {log.type === 'error' && '✕'}
                {log.type === 'warn' && '⚠'}
                {log.type === 'info' && 'ℹ'}
                {log.type === 'log' && '○'}
                {log.type === 'command' && '▶'}
                {log.type === 'result' && '←'}
              </span>
              <pre className="log-message">{log.message}</pre>
            </div>
          ))}
          {filteredLogs.length === 0 && (
            <div className="console-empty" data-testid="console-empty">
              No logs to display
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="console-input-container">
        <span className="console-prompt">▶</span>
        <input
          ref={inputRef}
          data-testid="console-input"
          type="text"
          className="console-input"
          placeholder="Execute JavaScript..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button 
          data-testid="execute-btn"
          className="execute-btn"
          onClick={executeCommand}
        >
          Execute
        </button>
      </div>
    </div>
  );
};

export default ConsoleTab;

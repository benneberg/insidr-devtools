import { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import './ScriptRunnerTab.css';

const ScriptRunnerTab = () => {
  const [code, setCode] = useState('// Write your JavaScript code here\nconsole.log("Hello from Script Runner!");');
  const [output, setOutput] = useState([]);
  const [savedScripts, setSavedScripts] = useState([]);
  const [scriptName, setScriptName] = useState('');

  const runScript = () => {
    const newOutput = [];
    
    // Capture console outputs
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = (...args) => {
      newOutput.push({ type: 'log', message: args.join(' '), timestamp: new Date().toLocaleTimeString() });
      originalLog.apply(console, args);
    };

    console.warn = (...args) => {
      newOutput.push({ type: 'warn', message: args.join(' '), timestamp: new Date().toLocaleTimeString() });
      originalWarn.apply(console, args);
    };

    console.error = (...args) => {
      newOutput.push({ type: 'error', message: args.join(' '), timestamp: new Date().toLocaleTimeString() });
      originalError.apply(console, args);
    };

    try {
      const result = eval(code);
      if (result !== undefined) {
        newOutput.push({ 
          type: 'result', 
          message: typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result),
          timestamp: new Date().toLocaleTimeString()
        });
      }
      newOutput.push({ 
        type: 'success', 
        message: 'Script executed successfully',
        timestamp: new Date().toLocaleTimeString()
      });
    } catch (error) {
      newOutput.push({ 
        type: 'error', 
        message: error.message,
        timestamp: new Date().toLocaleTimeString()
      });
    } finally {
      // Restore original console methods
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    }

    setOutput(prev => [...prev, ...newOutput]);
  };

  const clearOutput = () => {
    setOutput([]);
  };

  const clearCode = () => {
    setCode('');
  };

  const saveScript = () => {
    if (!scriptName.trim()) {
      alert('Please enter a script name');
      return;
    }

    const newScript = {
      id: Date.now(),
      name: scriptName,
      code,
      savedAt: new Date().toLocaleString()
    };

    setSavedScripts(prev => [...prev, newScript]);
    setScriptName('');
    
    // Save to localStorage
    const scripts = [...savedScripts, newScript];
    localStorage.setItem('devtools_saved_scripts', JSON.stringify(scripts));
  };

  const loadScript = (script) => {
    setCode(script.code);
  };

  const deleteScript = (id) => {
    const updatedScripts = savedScripts.filter(s => s.id !== id);
    setSavedScripts(updatedScripts);
    localStorage.setItem('devtools_saved_scripts', JSON.stringify(updatedScripts));
  };

  const loadSavedScripts = () => {
    const saved = localStorage.getItem('devtools_saved_scripts');
    if (saved) {
      try {
        setSavedScripts(JSON.parse(saved));
      } catch (e) {
        console.error('Error loading saved scripts:', e);
      }
    }
  };

  // Load saved scripts on mount
  useState(() => {
    loadSavedScripts();
  }, []);

  const exportOutput = (format) => {
    if (format === 'json') {
      const dataStr = JSON.stringify(output, null, 2);
      const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
      const link = document.createElement('a');
      link.setAttribute('href', dataUri);
      link.setAttribute('download', `script-output-${Date.now()}.json`);
      link.click();
    } else if (format === 'csv') {
      const csvContent = [
        ['Type', 'Message', 'Timestamp'],
        ...output.map(item => [item.type, item.message.replace(/"/g, '""'), item.timestamp])
      ].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
      
      const dataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);
      const link = document.createElement('a');
      link.setAttribute('href', dataUri);
      link.setAttribute('download', `script-output-${Date.now()}.csv`);
      link.click();
    }
  };

  const exampleScripts = [
    {
      name: 'DOM Manipulation',
      code: `// Change all buttons to green\nconst buttons = document.querySelectorAll('button');\nbuttons.forEach(btn => {\n  btn.style.background = '#00FF66';\n});\nconsole.log('Changed ' + buttons.length + ' buttons');`
    },
    {
      name: 'Performance Test',
      code: `// Measure page performance\nconst timing = performance.timing;\nconst loadTime = timing.loadEventEnd - timing.navigationStart;\nconsole.log('Page load time: ' + loadTime + 'ms');\nconsole.log('DOM ready: ' + (timing.domContentLoadedEventEnd - timing.navigationStart) + 'ms');`
    },
    {
      name: 'Find Elements',
      code: `// Find all elements with specific class\nconst elements = document.querySelectorAll('.demo-btn');\nconsole.log('Found ' + elements.length + ' elements');\nelements.forEach((el, i) => {\n  console.log(i + ': ' + el.textContent);\n});`
    }
  ];

  return (
    <div className="script-runner-tab">
      <div className="runner-layout">
        <div className="code-editor">
          <div className="editor-toolbar">
            <div className="toolbar-left">
              <button 
                data-testid="run-script-btn"
                className="run-btn"
                onClick={runScript}
              >
                ▶ Run
              </button>
              <button 
                data-testid="clear-code-btn"
                className="clear-code-btn"
                onClick={clearCode}
              >
                Clear Code
              </button>
            </div>
            <div className="toolbar-right">
              <input
                data-testid="script-name-input"
                type="text"
                className="script-name-input"
                placeholder="Script name..."
                value={scriptName}
                onChange={(e) => setScriptName(e.target.value)}
              />
              <button 
                data-testid="save-script-btn"
                className="save-btn"
                onClick={saveScript}
              >
                Save
              </button>
            </div>
          </div>
          
          <textarea
            data-testid="code-editor"
            className="code-textarea"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Write your JavaScript code here..."
            spellCheck="false"
          />
        </div>

        <div className="output-panel">
          <div className="output-toolbar">
            <span className="output-title">Output</span>
            <div className="output-actions">
              <button 
                data-testid="export-output-json-btn"
                className="export-btn"
                onClick={() => exportOutput('json')}
              >
                Export JSON
              </button>
              <button 
                data-testid="export-output-csv-btn"
                className="export-btn"
                onClick={() => exportOutput('csv')}
              >
                Export CSV
              </button>
              <button 
                data-testid="clear-output-btn"
                className="clear-output-btn"
                onClick={clearOutput}
              >
                Clear
              </button>
            </div>
          </div>
          
          <ScrollArea className="output-content">
            {output.length === 0 ? (
              <div className="output-empty" data-testid="output-empty">
                Run a script to see output
              </div>
            ) : (
              <div className="output-list">
                {output.map((item, idx) => (
                  <div key={idx} className={`output-item ${item.type}`} data-testid="output-item">
                    <span className="output-timestamp">{item.timestamp}</span>
                    <span className="output-type">
                      {item.type === 'error' && '✕'}
                      {item.type === 'warn' && '⚠'}
                      {item.type === 'log' && '○'}
                      {item.type === 'result' && '→'}
                      {item.type === 'success' && '✓'}
                    </span>
                    <pre className="output-message">{item.message}</pre>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      </div>

      <div className="scripts-sidebar">
        <div className="sidebar-section">
          <h3 className="sidebar-title">Example Scripts</h3>
          <div className="scripts-list">
            {exampleScripts.map((script, idx) => (
              <div key={idx} className="script-item" data-testid="example-script">
                <div className="script-name">{script.name}</div>
                <button 
                  data-testid="load-example-btn"
                  className="script-load-btn"
                  onClick={() => setCode(script.code)}
                >
                  Load
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="sidebar-section">
          <h3 className="sidebar-title">Saved Scripts</h3>
          <div className="scripts-list">
            {savedScripts.length === 0 ? (
              <div className="scripts-empty" data-testid="saved-scripts-empty">
                No saved scripts
              </div>
            ) : (
              savedScripts.map((script) => (
                <div key={script.id} className="script-item saved" data-testid="saved-script">
                  <div className="script-info">
                    <div className="script-name">{script.name}</div>
                    <div className="script-date">{script.savedAt}</div>
                  </div>
                  <div className="script-actions">
                    <button 
                      data-testid="load-saved-btn"
                      className="script-load-btn"
                      onClick={() => loadScript(script)}
                    >
                      Load
                    </button>
                    <button 
                      data-testid="delete-saved-btn"
                      className="script-delete-btn"
                      onClick={() => deleteScript(script.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScriptRunnerTab;

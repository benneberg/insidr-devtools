import { useState, useEffect } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import './StorageTab.css';

const StorageTab = () => {
  const [localStorageData, setLocalStorageData] = useState([]);
  const [sessionStorageData, setSessionStorageData] = useState([]);
  const [cookies, setCookies] = useState([]);
  const [indexedDBs, setIndexedDBs] = useState([]);
  const [editingKey, setEditingKey] = useState(null);
  const [editingValue, setEditingValue] = useState('');

  const loadLocalStorage = () => {
    const items = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key);
      items.push({ key, value });
    }
    setLocalStorageData(items);
  };

  const loadSessionStorage = () => {
    const items = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      const value = sessionStorage.getItem(key);
      items.push({ key, value });
    }
    setSessionStorageData(items);
  };

  const loadCookies = () => {
    const cookieArray = document.cookie.split(';').map(cookie => {
      const [key, ...valueParts] = cookie.trim().split('=');
      return { key, value: valueParts.join('=') };
    }).filter(c => c.key);
    setCookies(cookieArray);
  };

  const loadIndexedDB = async () => {
    try {
      const databases = await window.indexedDB.databases();
      setIndexedDBs(databases.map(db => ({ name: db.name, version: db.version })));
    } catch (error) {
      console.error('Error loading IndexedDB:', error);
      setIndexedDBs([]);
    }
  };

  useEffect(() => {
    loadLocalStorage();
    loadSessionStorage();
    loadCookies();
    loadIndexedDB();

    // Refresh data periodically
    const interval = setInterval(() => {
      loadLocalStorage();
      loadSessionStorage();
      loadCookies();
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const deleteLocalStorageItem = (key) => {
    localStorage.removeItem(key);
    loadLocalStorage();
  };

  const deleteSessionStorageItem = (key) => {
    sessionStorage.removeItem(key);
    loadSessionStorage();
  };

  const deleteCookie = (key) => {
    document.cookie = `${key}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
    loadCookies();
  };

  const startEditing = (key, value) => {
    setEditingKey(key);
    setEditingValue(value);
  };

  const saveEdit = (storageType) => {
    if (storageType === 'local') {
      localStorage.setItem(editingKey, editingValue);
      loadLocalStorage();
    } else if (storageType === 'session') {
      sessionStorage.setItem(editingKey, editingValue);
      loadSessionStorage();
    }
    setEditingKey(null);
    setEditingValue('');
  };

  const cancelEdit = () => {
    setEditingKey(null);
    setEditingValue('');
  };

  const exportStorage = (data, filename) => {
    const jsonStr = JSON.stringify(data, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(jsonStr);
    const link = document.createElement('a');
    link.setAttribute('href', dataUri);
    link.setAttribute('download', `${filename}-${Date.now()}.json`);
    link.click();
  };

  const exportCSV = (data, filename) => {
    const csvContent = [
      ['Key', 'Value'],
      ...data.map(item => [item.key, item.value])
    ].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    
    const dataUri = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', dataUri);
    link.setAttribute('download', `${filename}-${Date.now()}.csv`);
    link.click();
  };

  const clearAllLocalStorage = () => {
    if (window.confirm('Are you sure you want to clear all localStorage?')) {
      localStorage.clear();
      loadLocalStorage();
    }
  };

  const clearAllSessionStorage = () => {
    if (window.confirm('Are you sure you want to clear all sessionStorage?')) {
      sessionStorage.clear();
      loadSessionStorage();
    }
  };

  const StorageTable = ({ data, storageType, onDelete, onEdit }) => (
    <div className="storage-table">
      <div className="table-header">
        <div className="col-key">Key</div>
        <div className="col-value">Value</div>
        <div className="col-actions">Actions</div>
      </div>
      <ScrollArea className="table-body">
        {data.length === 0 ? (
          <div className="storage-empty" data-testid="storage-empty">
            No items stored
          </div>
        ) : (
          data.map((item, idx) => (
            <div key={idx} className="table-row" data-testid="storage-row">
              <div className="col-key">{item.key}</div>
              <div className="col-value">
                {editingKey === item.key ? (
                  <input
                    data-testid="edit-value-input"
                    type="text"
                    className="edit-input"
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                  />
                ) : (
                  <span>{item.value}</span>
                )}
              </div>
              <div className="col-actions">
                {editingKey === item.key ? (
                  <>
                    <button 
                      data-testid="save-edit-btn"
                      className="action-btn save"
                      onClick={() => saveEdit(storageType)}
                    >
                      Save
                    </button>
                    <button 
                      data-testid="cancel-edit-btn"
                      className="action-btn cancel"
                      onClick={cancelEdit}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    {onEdit && (
                      <button 
                        data-testid="edit-btn"
                        className="action-btn edit"
                        onClick={() => onEdit(item.key, item.value)}
                      >
                        Edit
                      </button>
                    )}
                    <button 
                      data-testid="delete-btn"
                      className="action-btn delete"
                      onClick={() => onDelete(item.key)}
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </ScrollArea>
    </div>
  );

  return (
    <div className="storage-tab">
      <Tabs defaultValue="local" className="storage-tabs">
        <div className="storage-header">
          <TabsList className="storage-tabs-list">
            <TabsTrigger value="local" data-testid="tab-local-storage">localStorage</TabsTrigger>
            <TabsTrigger value="session" data-testid="tab-session-storage">sessionStorage</TabsTrigger>
            <TabsTrigger value="cookies" data-testid="tab-cookies">Cookies</TabsTrigger>
            <TabsTrigger value="indexeddb" data-testid="tab-indexeddb">IndexedDB</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="local" className="storage-content">
          <div className="storage-toolbar">
            <span className="item-count">Items: {localStorageData.length}</span>
            <div className="toolbar-actions">
              <button 
                data-testid="export-local-json-btn"
                className="toolbar-btn"
                onClick={() => exportStorage(localStorageData, 'localStorage')}
              >
                Export JSON
              </button>
              <button 
                data-testid="export-local-csv-btn"
                className="toolbar-btn"
                onClick={() => exportCSV(localStorageData, 'localStorage')}
              >
                Export CSV
              </button>
              <button 
                data-testid="clear-local-btn"
                className="toolbar-btn danger"
                onClick={clearAllLocalStorage}
              >
                Clear All
              </button>
            </div>
          </div>
          <StorageTable 
            data={localStorageData} 
            storageType="local"
            onDelete={deleteLocalStorageItem}
            onEdit={startEditing}
          />
        </TabsContent>

        <TabsContent value="session" className="storage-content">
          <div className="storage-toolbar">
            <span className="item-count">Items: {sessionStorageData.length}</span>
            <div className="toolbar-actions">
              <button 
                data-testid="export-session-json-btn"
                className="toolbar-btn"
                onClick={() => exportStorage(sessionStorageData, 'sessionStorage')}
              >
                Export JSON
              </button>
              <button 
                data-testid="export-session-csv-btn"
                className="toolbar-btn"
                onClick={() => exportCSV(sessionStorageData, 'sessionStorage')}
              >
                Export CSV
              </button>
              <button 
                data-testid="clear-session-btn"
                className="toolbar-btn danger"
                onClick={clearAllSessionStorage}
              >
                Clear All
              </button>
            </div>
          </div>
          <StorageTable 
            data={sessionStorageData} 
            storageType="session"
            onDelete={deleteSessionStorageItem}
            onEdit={startEditing}
          />
        </TabsContent>

        <TabsContent value="cookies" className="storage-content">
          <div className="storage-toolbar">
            <span className="item-count">Cookies: {cookies.length}</span>
            <div className="toolbar-actions">
              <button 
                data-testid="export-cookies-json-btn"
                className="toolbar-btn"
                onClick={() => exportStorage(cookies, 'cookies')}
              >
                Export JSON
              </button>
              <button 
                data-testid="export-cookies-csv-btn"
                className="toolbar-btn"
                onClick={() => exportCSV(cookies, 'cookies')}
              >
                Export CSV
              </button>
            </div>
          </div>
          <StorageTable 
            data={cookies} 
            onDelete={deleteCookie}
          />
        </TabsContent>

        <TabsContent value="indexeddb" className="storage-content">
          <div className="indexeddb-list">
            <div className="storage-toolbar">
              <span className="item-count">Databases: {indexedDBs.length}</span>
            </div>
            <ScrollArea className="indexeddb-scroll">
              {indexedDBs.length === 0 ? (
                <div className="storage-empty" data-testid="indexeddb-empty">
                  No IndexedDB databases found
                </div>
              ) : (
                indexedDBs.map((db, idx) => (
                  <div key={idx} className="indexeddb-item" data-testid="indexeddb-item">
                    <div className="db-name">{db.name}</div>
                    <div className="db-version">Version: {db.version}</div>
                  </div>
                ))
              )}
            </ScrollArea>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default StorageTab;

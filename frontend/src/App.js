import { useState, useEffect } from 'react';
import '@/App.css';
import DevTools from './components/DevTools';

// Demo page to showcase the DevTools
function App() {
  const [count, setCount] = useState(0);
  const [items, setItems] = useState([]);

  useEffect(() => {
    // Simulate some console logs
    console.log('App mounted');
    console.warn('This is a warning');
    console.error('This is an error');
    console.info('App initialized successfully');

    // Add some localStorage data
    localStorage.setItem('demo_key', 'demo_value');
    localStorage.setItem('user_preferences', JSON.stringify({ theme: 'light', language: 'en' }));

    // Simulate API calls
    fetch('https://jsonplaceholder.typicode.com/posts/1')
      .then(res => res.json())
      .then(data => {
        console.log('Fetched data:', data);
        setItems([data]);
      })
      .catch(err => console.error('Fetch error:', err));
  }, []);

  const handleClick = () => {
    setCount(count + 1);
    console.log(`Button clicked ${count + 1} times`);
  };

  const triggerError = () => {
    try {
      throw new Error('Intentional error for testing');
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="demo-app">
      <div className="demo-header">
        <h1>Custom DevTools Demo</h1>
        <p>Try the DevTools by clicking the toggle button at the bottom right</p>
      </div>

      <div className="demo-content">
        <div className="demo-card">
          <h2>Counter Example</h2>
          <p className="count-display">Count: {count}</p>
          <button 
            data-testid="increment-btn"
            className="demo-btn" 
            onClick={handleClick}
          >
            Increment
          </button>
        </div>

        <div className="demo-card">
          <h2>Error Testing</h2>
          <button 
            data-testid="trigger-error-btn"
            className="demo-btn error" 
            onClick={triggerError}
          >
            Trigger Error
          </button>
        </div>

        <div className="demo-card">
          <h2>Network Requests</h2>
          <button 
            data-testid="fetch-data-btn"
            className="demo-btn"
            onClick={() => {
              fetch('https://jsonplaceholder.typicode.com/users')
                .then(res => res.json())
                .then(data => console.log('Users:', data));
            }}
          >
            Fetch Data
          </button>
        </div>

        <div className="demo-card">
          <h2>Fetched Items</h2>
          <div className="items-list">
            {items.map((item, idx) => (
              <div key={idx} className="item">
                <strong>{item.title}</strong>
                <p>{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* The DevTools Component */}
      <DevTools />
    </div>
  );
}

export default App;

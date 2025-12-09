import React from 'react';
import { createRoot } from 'react-dom/client';
import DevTools from './components/DevTools';
import './index.css';
import './App.css';

/**
 * Standalone DevTools initialization
 * This file is the entry point for the standalone webpack bundle
 * Usage: Include the bundle in any HTML page and call window.CustomDevTools.init()
 */

class CustomDevToolsStandalone {
  constructor() {
    this.isInitialized = false;
    this.root = null;
    this.container = null;
  }

  /**
   * Initialize and render DevTools
   * @param {Object} options - Configuration options
   * @param {boolean} options.enabled - Enable/disable DevTools (default: true)
   * @param {boolean} options.startOpen - Start with DevTools open (default: false)
   * @param {string} options.containerId - Custom container ID (default: 'custom-devtools-root')
   */
  init(options = {}) {
    if (this.isInitialized) {
      console.warn('CustomDevTools already initialized');
      return;
    }

    const {
      enabled = true,
      startOpen = false,
      containerId = 'custom-devtools-root',
    } = options;

    if (!enabled) {
      console.log('CustomDevTools is disabled');
      return;
    }

    // Create container if it doesn't exist
    this.container = document.getElementById(containerId);
    if (!this.container) {
      this.container = document.createElement('div');
      this.container.id = containerId;
      document.body.appendChild(this.container);
    }

    // Render DevTools
    this.root = createRoot(this.container);
    this.root.render(
      <React.StrictMode>
        <DevTools initialOpen={startOpen} />
      </React.StrictMode>
    );

    this.isInitialized = true;
    console.log('CustomDevTools initialized successfully');

    // Dispatch custom event
    window.dispatchEvent(new CustomEvent('devtools:initialized'));
  }

  /**
   * Destroy and remove DevTools from the page
   */
  destroy() {
    if (!this.isInitialized) {
      console.warn('CustomDevTools not initialized');
      return;
    }

    if (this.root) {
      this.root.unmount();
      this.root = null;
    }

    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
      this.container = null;
    }

    this.isInitialized = false;
    console.log('CustomDevTools destroyed');

    // Dispatch custom event
    window.dispatchEvent(new CustomEvent('devtools:destroyed'));
  }

  /**
   * Check if DevTools is initialized
   */
  isReady() {
    return this.isInitialized;
  }
}

// Create singleton instance
const devToolsInstance = new CustomDevToolsStandalone();

// Auto-initialize if window.AUTO_INIT_DEVTOOLS is true
if (typeof window !== 'undefined') {
  // Make available globally
  window.CustomDevTools = devToolsInstance;

  // Auto-init if flag is set
  if (window.AUTO_INIT_DEVTOOLS) {
    document.addEventListener('DOMContentLoaded', () => {
      devToolsInstance.init();
    });
  }
}

// Export for module systems
export default devToolsInstance;

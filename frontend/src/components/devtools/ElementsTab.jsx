import { useState, useEffect } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import './ElementsTab.css';

const ElementsTab = () => {
  const [domTree, setDomTree] = useState([]);
  const [selectedElement, setSelectedElement] = useState(null);
  const [hoveredElement, setHoveredElement] = useState(null);
  const [highlightOverlay, setHighlightOverlay] = useState(null);

  useEffect(() => {
    buildDomTree();
    
    // Debounce the mutation observer to prevent infinite loops
    let timeoutId;
    const observer = new MutationObserver(() => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        buildDomTree();
      }, 300); // Wait 300ms before rebuilding tree
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true
    });

    return () => {
      observer.disconnect();
      clearTimeout(timeoutId);
    };
  }, []);

  const buildDomTree = () => {
    const parseElement = (element, depth = 0) => {
      // Exclude DevTools and its children from the tree
      if (!element || 
          element.classList?.contains('devtools-container') ||
          element.id === 'custom-devtools-root' ||
          element.closest('#custom-devtools-root') ||
          element.closest('.devtools-container')) {
        return null;
      }

      const node = {
        tag: element.tagName?.toLowerCase() || 'text',
        id: element.id || '',
        classes: Array.from(element.classList || []),
        attributes: {},
        children: [],
        element: element,
        depth
      };

      if (element.attributes) {
        Array.from(element.attributes).forEach(attr => {
          if (attr.name !== 'class' && attr.name !== 'id') {
            node.attributes[attr.name] = attr.value;
          }
        });
      }

      if (element.children) {
        Array.from(element.children).forEach(child => {
          const childNode = parseElement(child, depth + 1);
          if (childNode) {
            node.children.push(childNode);
          }
        });
      }

      return node;
    };

    const tree = parseElement(document.documentElement);
    setDomTree(tree ? [tree] : []);
  };

  const handleElementClick = (node) => {
    setSelectedElement(node);
    if (node.element) {
      node.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleElementHover = (node) => {
    setHoveredElement(node);
    if (node?.element) {
      const rect = node.element.getBoundingClientRect();
      setHighlightOverlay({
        top: rect.top + window.scrollY,
        left: rect.left + window.scrollX,
        width: rect.width,
        height: rect.height
      });
    } else {
      setHighlightOverlay(null);
    }
  };

  const DomNode = ({ node, expanded = false }) => {
    const [isExpanded, setIsExpanded] = useState(expanded);
    const hasChildren = node.children && node.children.length > 0;

    return (
      <div className="dom-node" style={{ paddingLeft: `${node.depth * 16}px` }}>
        <div 
          className={`dom-node-header ${selectedElement === node ? 'selected' : ''}`}
          onClick={() => handleElementClick(node)}
          onMouseEnter={() => handleElementHover(node)}
          onMouseLeave={() => handleElementHover(null)}
          data-testid="dom-node"
        >
          {hasChildren && (
            <button 
              className="expand-btn"
              onClick={(e) => {
                e.stopPropagation();
                setIsExpanded(!isExpanded);
              }}
              data-testid="expand-btn"
            >
              {isExpanded ? '▼' : '▶'}
            </button>
          )}
          {!hasChildren && <span className="expand-spacer" />}
          
          <span className="tag-name">&lt;{node.tag}</span>
          {node.id && <span className="tag-id">#{node.id}</span>}
          {node.classes.length > 0 && (
            <span className="tag-classes">.{node.classes.join('.')}</span>
          )}
          <span className="tag-name">&gt;</span>
        </div>
        
        {isExpanded && hasChildren && (
          <div className="dom-node-children">
            {node.children.map((child, idx) => (
              <DomNode key={idx} node={child} />
            ))}
          </div>
        )}
      </div>
    );
  };

  const getComputedStyles = () => {
    if (!selectedElement?.element) return {};
    const styles = window.getComputedStyle(selectedElement.element);
    return {
      display: styles.display,
      position: styles.position,
      width: styles.width,
      height: styles.height,
      margin: styles.margin,
      padding: styles.padding,
      color: styles.color,
      backgroundColor: styles.backgroundColor,
      fontSize: styles.fontSize,
      fontWeight: styles.fontWeight
    };
  };

  return (
    <div className="elements-tab">
      <div className="elements-layout">
        <div className="elements-tree">
          <ScrollArea className="tree-scroll">
            {domTree.map((node, idx) => (
              <DomNode key={idx} node={node} expanded={true} />
            ))}
          </ScrollArea>
        </div>
        
        <div className="elements-inspector">
          <div className="inspector-header">Properties</div>
          {selectedElement ? (
            <ScrollArea className="inspector-content">
              <div className="property-section">
                <div className="section-title">Element</div>
                <div className="property-item">
                  <span className="property-key">Tag:</span>
                  <span className="property-value">{selectedElement.tag}</span>
                </div>
                {selectedElement.id && (
                  <div className="property-item">
                    <span className="property-key">ID:</span>
                    <span className="property-value">{selectedElement.id}</span>
                  </div>
                )}
                {selectedElement.classes.length > 0 && (
                  <div className="property-item">
                    <span className="property-key">Classes:</span>
                    <span className="property-value">{selectedElement.classes.join(', ')}</span>
                  </div>
                )}
              </div>

              {Object.keys(selectedElement.attributes).length > 0 && (
                <div className="property-section">
                  <div className="section-title">Attributes</div>
                  {Object.entries(selectedElement.attributes).map(([key, value]) => (
                    <div key={key} className="property-item">
                      <span className="property-key">{key}:</span>
                      <span className="property-value">{value}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="property-section">
                <div className="section-title">Computed Styles</div>
                {Object.entries(getComputedStyles()).map(([key, value]) => (
                  <div key={key} className="property-item">
                    <span className="property-key">{key}:</span>
                    <span className="property-value">{value}</span>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <div className="inspector-empty" data-testid="inspector-empty">
              Select an element to inspect
            </div>
          )}
        </div>
      </div>

      {highlightOverlay && (
        <div 
          className="element-highlight"
          style={{
            position: 'absolute',
            top: `${highlightOverlay.top}px`,
            left: `${highlightOverlay.left}px`,
            width: `${highlightOverlay.width}px`,
            height: `${highlightOverlay.height}px`,
            pointerEvents: 'none',
            zIndex: 9997
          }}
        />
      )}
    </div>
  );
};

export default ElementsTab;

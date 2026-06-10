import { clearContainer, formatNumber } from './chart-base.js';

const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };
const PRIORITY_COLORS = {
  high: '#e74c3c',
  medium: '#f39c12',
  low: '#27ae60'
};

export class SuggestionPanel {
  constructor() {
    this.container = null;
    this.data = [];
  }

  init(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Container #${containerId} not found`);
    }
    this._injectStyles();
  }

  _injectStyles() {
    if (document.getElementById('suggestion-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'suggestion-panel-styles';
    style.textContent = `
      .suggestion-card {
        padding: 14px 16px;
        margin-bottom: 8px;
        border-radius: 6px;
        background: #fff;
        border: 1px solid #eee;
        box-shadow: 0 1px 3px rgba(0,0,0,0.06);
        transition: box-shadow 0.2s;
      }
      .suggestion-card:hover {
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      }
      .suggestion-card.high {
        border-left: 4px solid ${PRIORITY_COLORS.high};
      }
      .suggestion-card.medium {
        border-left: 4px solid ${PRIORITY_COLORS.medium};
      }
      .suggestion-card.low {
        border-left: 4px solid ${PRIORITY_COLORS.low};
      }
      .suggestion-header {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
        flex-wrap: wrap;
      }
      .suggestion-category {
        display: inline-block;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #fff;
        background: #7f8c8d;
        padding: 2px 8px;
        border-radius: 10px;
      }
      .suggestion-priority {
        display: inline-block;
        font-size: 10px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        padding: 2px 8px;
        border-radius: 10px;
        color: #fff;
      }
      .suggestion-card.high .suggestion-priority {
        background: ${PRIORITY_COLORS.high};
      }
      .suggestion-card.medium .suggestion-priority {
        background: ${PRIORITY_COLORS.medium};
      }
      .suggestion-card.low .suggestion-priority {
        background: ${PRIORITY_COLORS.low};
      }
      .suggestion-title {
        font-size: 14px;
        font-weight: 600;
        color: #333;
        margin-bottom: 6px;
      }
      .suggestion-message {
        font-size: 13px;
        color: #555;
        line-height: 1.5;
        margin-bottom: 8px;
      }
      .suggestion-saving {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 12px;
        font-weight: 600;
        color: #27ae60;
        background: #eafaf1;
        padding: 4px 10px;
        border-radius: 4px;
      }
      .suggestion-saving::before {
        content: '\\2193';
        font-size: 14px;
      }
    `;
    document.head.appendChild(style);
  }

  update(data) {
    if (!this.container) return;
    clearContainer(this.container);

    if (!data || data.length === 0) {
      this.showEmpty();
      return;
    }

    this.data = this._sortData(data);

    const wrapper = document.createElement('div');
    wrapper.className = 'suggestion-panel-list';
    wrapper.style.cssText = 'overflow-y:auto;max-height:100%;padding:4px;';

    this.data.forEach(item => {
      const card = this._createCard(item);
      wrapper.appendChild(card);
    });

    this.container.appendChild(wrapper);
  }

  _sortData(data) {
    return [...data].sort((a, b) => {
      const prioA = PRIORITY_ORDER[a.priority] !== undefined ? PRIORITY_ORDER[a.priority] : 99;
      const prioB = PRIORITY_ORDER[b.priority] !== undefined ? PRIORITY_ORDER[b.priority] : 99;
      return prioA - prioB;
    });
  }

  _createCard(item) {
    const card = document.createElement('div');
    card.className = `suggestion-card ${item.priority || 'low'}`;

    // Header: category tag + priority indicator
    const header = document.createElement('div');
    header.className = 'suggestion-header';

    const category = document.createElement('span');
    category.className = 'suggestion-category';
    category.textContent = item.category || 'General';
    header.appendChild(category);

    const priority = document.createElement('span');
    priority.className = 'suggestion-priority';
    priority.textContent = item.priority || 'low';
    header.appendChild(priority);

    card.appendChild(header);

    // Title
    const title = document.createElement('div');
    title.className = 'suggestion-title';
    title.textContent = item.title || '';
    card.appendChild(title);

    // Message
    const message = document.createElement('div');
    message.className = 'suggestion-message';
    message.textContent = item.message || '';
    card.appendChild(message);

    // Estimated saving
    if (item.estimatedSaving !== undefined && item.estimatedSaving !== null) {
      const saving = document.createElement('div');
      saving.className = 'suggestion-saving';
      const savingValue = typeof item.estimatedSaving === 'number'
        ? `Est. saving: ${formatNumber(item.estimatedSaving)} kWh/year`
        : `Est. saving: ${item.estimatedSaving}`;
      saving.textContent = savingValue;
      card.appendChild(saving);
    }

    return card;
  }

  showEmpty() {
    if (!this.container) return;
    clearContainer(this.container);
    const msg = document.createElement('div');
    msg.className = 'chart-empty';
    msg.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:#999;font-size:14px;padding:40px 0;';
    msg.textContent = 'No suggestions available';
    this.container.appendChild(msg);
  }

  destroy() {
    if (this.container) {
      clearContainer(this.container);
    }
    this.container = null;
    this.data = [];
  }

  toDataURL() {
    return null;
  }
}

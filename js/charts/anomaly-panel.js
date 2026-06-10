import { clearContainer } from './chart-base.js';

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 };
const SEVERITY_COLORS = {
  critical: '#e74c3c',
  warning: '#f39c12',
  info: '#3498db'
};

export class AnomalyPanel {
  constructor() {
    this.container = null;
    this.data = [];
    this._cards = [];
  }

  init(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Container #${containerId} not found`);
    }
    this._injectStyles();
  }

  _injectStyles() {
    if (document.getElementById('anomaly-panel-styles')) return;
    const style = document.createElement('style');
    style.id = 'anomaly-panel-styles';
    style.textContent = `
      .alert-card {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 12px 16px;
        margin-bottom: 8px;
        border-radius: 6px;
        background: #fff;
        border: 1px solid #eee;
        box-shadow: 0 1px 3px rgba(0,0,0,0.06);
        transition: opacity 0.3s, transform 0.3s;
        position: relative;
      }
      .alert-card.critical {
        border-left: 4px solid ${SEVERITY_COLORS.critical};
      }
      .alert-card.warning {
        border-left: 4px solid ${SEVERITY_COLORS.warning};
      }
      .alert-card.info {
        border-left: 4px solid ${SEVERITY_COLORS.info};
      }
      .alert-card.removing {
        opacity: 0;
        transform: translateX(20px);
      }
      .alert-severity {
        flex-shrink: 0;
        width: 10px;
        height: 10px;
        border-radius: 50%;
        margin-top: 4px;
      }
      .alert-card.critical .alert-severity {
        background: ${SEVERITY_COLORS.critical};
      }
      .alert-card.warning .alert-severity {
        background: ${SEVERITY_COLORS.warning};
      }
      .alert-card.info .alert-severity {
        background: ${SEVERITY_COLORS.info};
      }
      .alert-content {
        flex: 1;
        min-width: 0;
      }
      .alert-type {
        display: inline-block;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        color: #666;
        margin-bottom: 4px;
        background: #f5f5f5;
        padding: 2px 6px;
        border-radius: 3px;
      }
      .alert-message {
        font-size: 13px;
        color: #333;
        line-height: 1.4;
        margin-bottom: 4px;
      }
      .alert-meta {
        font-size: 11px;
        color: #999;
      }
      .alert-dismiss {
        flex-shrink: 0;
        background: none;
        border: none;
        color: #ccc;
        font-size: 18px;
        cursor: pointer;
        padding: 0 4px;
        line-height: 1;
        transition: color 0.2s;
      }
      .alert-dismiss:hover {
        color: #e74c3c;
      }
    `;
    document.head.appendChild(style);
  }

  update(data) {
    if (!this.container) return;
    clearContainer(this.container);
    this._cards = [];

    if (!data || data.length === 0) {
      this.showEmpty();
      this._updateBadge(0);
      return;
    }

    this.data = this._sortData(data);
    this._updateBadge(this.data.length);

    const wrapper = document.createElement('div');
    wrapper.className = 'anomaly-panel-list';
    wrapper.style.cssText = 'overflow-y:auto;max-height:100%;padding:4px;';

    this.data.forEach((item, index) => {
      const card = this._createCard(item, index);
      this._cards.push(card);
      wrapper.appendChild(card);
    });

    this.container.appendChild(wrapper);
  }

  _sortData(data) {
    return [...data].sort((a, b) => {
      const sevA = SEVERITY_ORDER[a.severity] !== undefined ? SEVERITY_ORDER[a.severity] : 99;
      const sevB = SEVERITY_ORDER[b.severity] !== undefined ? SEVERITY_ORDER[b.severity] : 99;
      if (sevA !== sevB) return sevA - sevB;

      const tsA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tsB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tsB - tsA;
    });
  }

  _createCard(item, index) {
    const card = document.createElement('div');
    card.className = `alert-card ${item.severity || 'info'}`;
    card.dataset.index = index;

    // Severity dot
    const dot = document.createElement('div');
    dot.className = 'alert-severity';
    card.appendChild(dot);

    // Content area
    const content = document.createElement('div');
    content.className = 'alert-content';

    const typeLabel = document.createElement('span');
    typeLabel.className = 'alert-type';
    typeLabel.textContent = item.type || 'Unknown';
    content.appendChild(typeLabel);

    const message = document.createElement('div');
    message.className = 'alert-message';
    message.textContent = item.message || '';
    content.appendChild(message);

    const meta = document.createElement('div');
    meta.className = 'alert-meta';
    const parts = [];
    if (item.entityId) parts.push(`Entity: ${item.entityId}`);
    if (item.timestamp) {
      const date = new Date(item.timestamp);
      parts.push(isNaN(date.getTime()) ? item.timestamp : date.toLocaleString());
    }
    meta.textContent = parts.join(' | ');
    content.appendChild(meta);

    card.appendChild(content);

    // Dismiss button
    const dismiss = document.createElement('button');
    dismiss.className = 'alert-dismiss';
    dismiss.innerHTML = '&times;';
    dismiss.title = 'Dismiss';
    dismiss.addEventListener('click', () => this._dismissCard(card));
    card.appendChild(dismiss);

    return card;
  }

  _dismissCard(card) {
    card.classList.add('removing');
    setTimeout(() => {
      if (card.parentNode) {
        card.parentNode.removeChild(card);
      }
      this._cards = this._cards.filter(c => c !== card);
      this._updateBadge(this._cards.length);

      if (this._cards.length === 0) {
        this.showEmpty();
      }
    }, 300);
  }

  _updateBadge(count) {
    const badge = document.getElementById('anomaly-count');
    if (badge) {
      badge.textContent = String(count);
      badge.style.display = count > 0 ? '' : 'none';
    }
  }

  showEmpty() {
    if (!this.container) return;
    clearContainer(this.container);
    this._cards = [];
    const msg = document.createElement('div');
    msg.className = 'chart-empty';
    msg.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:#999;font-size:14px;padding:40px 0;';
    msg.textContent = 'No anomalies detected';
    this.container.appendChild(msg);
  }

  destroy() {
    if (this.container) {
      clearContainer(this.container);
    }
    this.container = null;
    this.data = [];
    this._cards = [];
  }

  toDataURL() {
    return null;
  }
}

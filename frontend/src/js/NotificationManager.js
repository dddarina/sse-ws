export default class NotificationManager {
  constructor(container) {
    this.container = container;
    this.notifications = new Set();
  }

  show(message, type = 'info') {
    const notification = this.createNotification(message, type);
    this.container.append(notification);
    this.notifications.add(notification);

    const autoRemove = setTimeout(() => {
      this.remove(notification);
    }, 5000);

    this.setupEventListeners(notification, autoRemove);
  }

  createNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
      <div class="notification-content">
        <span class="notification-message">${this.escapeHtml(message)}</span>
        <button class="notification-close">×</button>
      </div>
    `;
    
    return notification;
  }

  setupEventListeners(notification, autoRemoveTimer) {
    const closeButton = notification.querySelector('.notification-close');
    if (closeButton) {
      closeButton.addEventListener('click', () => {
        clearTimeout(autoRemoveTimer);
        this.remove(notification);
      });
    }

    notification.addEventListener('click', (e) => {
      if (e.target === notification) {
        clearTimeout(autoRemoveTimer);
        this.remove(notification);
      }
    });
  }

  remove(notification) {
    if (!notification || !this.notifications.has(notification)) return;
    
    notification.classList.add('notification-hiding');
    
    setTimeout(() => {
      notification.remove();
      this.notifications.delete(notification);
    }, 300);
  }

  clearAll() {
    this.notifications.forEach(notification => {
      notification.remove();
    });
    this.notifications.clear();
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
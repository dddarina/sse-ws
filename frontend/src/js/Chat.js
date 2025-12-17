import ChatAPI from "./api/ChatAPI";
import NotificationManager from "./NotificationManager";

export default class Chat {
  constructor(container) {
    this.container = container;
    this.api = new ChatAPI();
    this.websocket = null;
    this.currentUser = null;
    this.users = [];
    this.isConnecting = false;
    this.autoReconnect = true;
    this.isExiting = false;
    this.messageHistory = [];
    this.reconnectionAttempts = 0;
    this.maxReconnectionAttempts = 10;
    this.errorTimer = null;
    this.heartbeatInterval = null;
    this.heartbeatTimeout = null;
    this.lastPongTime = null;
    this.notificationManager = null;
  }

  init() {
    this.bindToDOM();
    this.registerEvents();

    this.checkAndCleanStuckUsers().then(() => {
      this.showAuthModal();
    });

    window.addEventListener('beforeunload', () => {
      this.exitOnUnload();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        console.log('Страница в фоне, проверяем соединение...');
      } else {
        if (this.websocket && this.websocket.readyState !== WebSocket.OPEN) {
          console.log('Страница активна, проверяем соединение...');
          this.reconnectIfNeeded();
        }
      }
    });
  }

  bindToDOM() {
    this.authModal = document.createElement('div');
    this.authModal.className = 'modal__form';
    this.authModal.innerHTML = `
      <div class="modal__background"></div>
      <div class="modal__content">
        <div class="modal__header">Добро пожаловать в чат!</div>
        <div class="modal__body">
          <form class="auth-form">
            <div class="form__group">
              <label class="form__label">Введите ваш никнейм:</label>
              <input type="text" class="form__input auth-input" placeholder="Ваш никнейм" required>
              <div class="form__hint">От 2 до 20 символов</div>
            </div>
            <div class="form__hint error-message" style="display: none;"></div>
          </form>
        </div>
        <div class="modal__footer">
          <div class="modal__ok auth-button">Присоединиться к чату</div>
        </div>
      </div>
    `;

    this.chatContainer = document.createElement('div');
    this.chatContainer.className = 'container hidden';
    this.chatContainer.innerHTML = `
      <div class="chat-header-container">
        <h1 class="chat__header">Чат для друзей</h1>
        <div class="user-info">
          <span class="current-username"></span>
          <div class="chat__connect exit-button">Выйти</div>
        </div>
      </div>
      
      <div class="connection-status hidden">
        <div class="form__hint status-text">Подключение...</div>
      </div>
      
      <!-- Контейнер для уведомлений -->
      <div class="notifications-container"></div>
      
      <div class="chat__container">
        <div class="chat__area">
          <div class="chat__messages-container">
            <div class="welcome-message">
              <h3>👋 Добро пожаловать в чат!</h3>
              <p>Выберите пользователя из списка справа, чтобы начать общение.</p>
            </div>
            <ul class="messages-list"></ul>
          </div>
          <div class="chat__messages-input">
            <form class="form message-form">
              <div class="form__group form_second">
                <textarea class="form__input message-input" placeholder="Введите сообщение..." autocomplete="off" disabled rows="1"></textarea>
                <button type="submit" class="send-button" disabled>Отправить</button>
              </div>
            </form>
          </div>
        </div>
        
        <div class="chat__userlist">
          <div class="users-header">
            <h3>Участники (<span class="users-count">0</span>)</h3>
            <button class="refresh-users" title="Обновить список">🔄</button>
          </div>
          <ul class="users-list">
            <li class="no-users">Пока никого нет</li>
          </ul>
        </div>
      </div>
    `;

    this.confirmModal = document.createElement('div');
    this.confirmModal.className = 'modal__delete hidden';
    this.confirmModal.innerHTML = `
      <div class="modal__background"></div>
      <div class="modal__content">
        <div class="modal__header">Подтверждение выхода</div>
        <div class="modal__body">
          <div class="modal-text">Вы уверены, что хотите выйти из чата?</div>
        </div>
        <div class="modal__footer">
          <div class="modal__close cancel-button">Остаться</div>
          <div class="modal__ok confirm-exit-button">Выйти</div>
        </div>
      </div>
    `;

    this.container.append(this.authModal, this.chatContainer, this.confirmModal);

    const notificationsContainer = this.chatContainer.querySelector('.notifications-container');
    this.notificationManager = new NotificationManager(notificationsContainer);
  }

  registerEvents() {
    this.authModal.querySelector('.auth-button').addEventListener('click', (e) => {
      e.preventDefault();
      this.onEnterChatHandler(e);
    });

    this.authModal.querySelector('.auth-form').addEventListener('submit', (e) => {
      e.preventDefault();
      this.onEnterChatHandler(e);
    });

    this.authModal.querySelector('.auth-input').addEventListener('input', () => {
      this.hideError();
    });

    this.messageForm = this.chatContainer.querySelector('.message-form');
    this.messageForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this.sendMessage();
    });

    this.chatContainer.querySelector('.exit-button').addEventListener('click', () => {
      this.showExitConfirmation();
    });

    this.chatContainer.querySelector('.refresh-users').addEventListener('click', () => {
      this.refreshUsersList();
    });

    this.confirmModal.querySelector('.cancel-button').addEventListener('click', () => {
      this.hideExitConfirmation();
    });

    this.confirmModal.querySelector('.confirm-exit-button').addEventListener('click', () => {
      this.performExit();
    });

    this.messageInput = this.chatContainer.querySelector('.message-input');
    this.messageInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    this.messageInput.addEventListener('input', () => {
      this.messageInput.style.height = 'auto';
      this.messageInput.style.height = Math.min(this.messageInput.scrollHeight, 150) + 'px';
    });
  }

  startHeartbeat() {
    this.stopHeartbeat();

    console.log('Heartbeat запущен');

    this.heartbeatInterval = setInterval(() => {
      if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
        try {
          this.websocket.send(JSON.stringify({ type: 'ping' }));
          console.log('Отправлен ping');
        } catch (error) {
          console.error('Ошибка отправки ping:', error);
        }
      }
    }, 15000);

    this.lastPongTime = Date.now();
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }

    console.log('Heartbeat остановлен');
  }

  refreshUsersList() {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify({ type: 'get_users' }));
      this.showNotification('Список пользователей обновлен', 'info');
    } else {
      this.showNotification('Нет соединения с сервером', 'error');
    }
  }

  reconnectIfNeeded() {
    if (!this.currentUser || this.isExiting) return;

    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      console.log('Проверка: соединение не активно, пытаемся переподключиться...');
      this.connectWebSocket();
    }
  }

  async checkAndCleanStuckUsers() {
    const lastUsername = localStorage.getItem('last_chat_username');
    const lastSessionTime = localStorage.getItem('last_chat_session_time');

    if (lastUsername && lastSessionTime) {
      const timePassed = Date.now() - parseInt(lastSessionTime);
      const FIVE_MINUTES = 5 * 60 * 1000;

      if (timePassed > FIVE_MINUTES) {
        console.log(`Обнаружен "зависший" пользователь "${lastUsername}", удаляем...`);
        await this.removeStuckUser(lastUsername);
      }
    }

    localStorage.setItem('last_chat_session_time', Date.now().toString());
  }

  async removeStuckUser(username) {
    try {
      const response = await fetch('http://localhost:3000/force-remove-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: username })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.status === 'ok') {
        console.log(`Пользователь "${username}" успешно удален с сервера`);
        localStorage.removeItem('last_chat_username');
        localStorage.removeItem('last_chat_session_time');
        return true;
      }
    } catch (error) {
      console.error('Ошибка при удалении "зависшего" пользователя:', error);
    }
    return false;
  }

  subscribeOnEvents() {
    if (!this.websocket) return;

    this.websocket.onopen = () => {
      console.log('WebSocket connection established');
      this.updateConnectionStatus('connected', 'Подключено');
      this.enableMessageInput();
      this.autoReconnect = true;
      this.reconnectionAttempts = 0;
      this.showNotification('Подключено к чату', 'success');

      this.startHeartbeat();

      if (this.currentUser) {
        const joinMessage = {
          type: 'join',
          user: this.currentUser
        };
        this.websocket.send(JSON.stringify(joinMessage));
      }

      this.updateUserInfo();

      if (this.websocket.readyState === WebSocket.OPEN) {
        this.websocket.send(JSON.stringify({ type: 'get_users' }));
      }
    };

    this.websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('Получено от сервера:', data);

        if (data.type === 'pong') {
          this.lastPongTime = Date.now();
          console.log('Получен pong от сервера');
          return;
        }

        if (Array.isArray(data)) {
          this.updateUsersList(data);
        } else if (data && typeof data === 'object') {
          switch (data.type) {
            case 'send':
              this.renderMessage(data);
              break;
            case 'user_joined':
              this.showSystemMessage(`${data.user.name} присоединился к чату`);
              this.showNotification(`${data.user.name} присоединился`, 'info');
              if (this.websocket.readyState === WebSocket.OPEN) {
                this.websocket.send(JSON.stringify({ type: 'get_users' }));
              }
              break;
            case 'user_left':
              this.showSystemMessage(`${data.user.name} покинул чат`);
              this.showNotification(`${data.user.name} вышел`, 'info');
              if (this.websocket.readyState === WebSocket.OPEN) {
                this.websocket.send(JSON.stringify({ type: 'get_users' }));
              }
              break;
            case 'error':
              this.showNotification(data.message, 'error');
              break;
            case 'system':
              this.showSystemMessage(data.message);
              break;
          }
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    this.websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
      this.updateConnectionStatus('error', 'Ошибка соединения');
      this.disableMessageInput();
      this.showNotification('Ошибка соединения с сервером', 'error');
    };

    this.websocket.onclose = (event) => {
      console.log('WebSocket connection closed:', event.code, event.reason);

      this.stopHeartbeat();

      if (this.autoReconnect && !this.isExiting) {
        this.reconnectionAttempts++;

        if (this.reconnectionAttempts <= this.maxReconnectionAttempts) {
          const delay = Math.min(2000 * this.reconnectionAttempts, 10000);
          this.updateConnectionStatus('reconnecting', `Переподключение... (${this.reconnectionAttempts}/${this.maxReconnectionAttempts})`);
          this.showNotification(`Переподключение через ${delay / 1000} сек...`, 'warning');

          setTimeout(() => {
            if (this.currentUser && !this.isExiting) {
              console.log(`Attempting to reconnect (${this.reconnectionAttempts}/${this.maxReconnectionAttempts})...`);
              this.connectWebSocket();
            }
          }, delay);
        } else {
          this.updateConnectionStatus('disconnected', 'Соединение потеряно');
          this.disableMessageInput();
          this.showNotification('Не удалось подключиться к серверу', 'error');
        }
      } else {
        this.updateConnectionStatus('disconnected', 'Соединение закрыто');
        this.disableMessageInput();

        if (!this.isExiting) {
          this.showNotification('Соединение с сервером потеряно', 'error');
        }
      }
    };
  }

  async onEnterChatHandler(e) {
    if (this.isConnecting) return;

    const input = this.authModal.querySelector('.auth-input');
    const button = this.authModal.querySelector('.auth-button');

    const nickname = input.value.trim();

    if (!nickname) {
      this.showError('Пожалуйста, введите никнейм');
      return;
    }

    if (nickname.length < 2 || nickname.length > 20) {
      this.showError('Никнейм должен быть от 2 до 20 символов');
      return;
    }

    this.isConnecting = true;
    button.disabled = true;
    button.textContent = 'Подключение...';
    button.classList.add('loading');

    try {
      localStorage.setItem('last_chat_username', nickname);
      localStorage.setItem('last_chat_session_time', Date.now().toString());

      const response = await this.api.create({ name: nickname });

      if (response.status === 'ok') {
        this.currentUser = response.user;
        this.hideAuthModal();
        this.showChat();
        this.connectWebSocket();
        this.showNotification(`Добро пожаловать, ${nickname}!`, 'success');
      } else {
        this.showError(response.message || 'Ошибка регистрации');
      }
    } catch (error) {
      if (error.message && error.message.includes('This name is already taken!') ||
        error.message && error.message.includes('409')) {

        this.showError('Этот никнейм уже занят. Выберите другой.');

        if (confirm(`Никнейм "${nickname}" уже занят. Попробовать освободить его?`)) {
          const autoCleanup = await this.autoCleanupAndRetry(nickname);

          if (!autoCleanup) {
            this.showNotification('Не удалось освободить никнейм. Выберите другой.', 'error');
          }
        } else {
          this.showNotification('Пожалуйста, выберите другой никнейм', 'info');
        }

      } else {
        this.showError('Не удалось подключиться к серверу. Проверьте соединение.');
        this.showNotification('Не удалось подключиться к серверу. Проверьте соединение.', 'error');
      }
      console.error('Registration error:', error);
    } finally {
      this.isConnecting = false;
      button.disabled = false;
      button.textContent = 'Присоединиться к чату';
      button.classList.remove('loading');
    }
  }

  async autoCleanupAndRetry(nickname) {
    console.log(`Пытаемся автоматически очистить никнейм "${nickname}"...`);

    this.showNotification(`Освобождаем никнейм "${nickname}"...`, 'info');

    try {
      const removed = await this.removeStuckUser(nickname);

      if (removed) {
        await new Promise(resolve => setTimeout(resolve, 1000));

        this.showNotification('Никнейм освобожден. Пробуем войти...', 'info');

        const retryResponse = await this.api.create({ name: nickname });

        if (retryResponse.status === 'ok') {
          this.currentUser = retryResponse.user;
          this.hideAuthModal();
          this.showChat();
          this.connectWebSocket();
          this.showNotification(`Добро пожаловать, ${nickname}!`, 'success');
          return true;
        }
      }
    } catch (retryError) {
      console.error('Auto-cleanup retry error:', retryError);
    }

    return false;
  }

  updateUserInfo() {
    const usernameElement = this.chatContainer.querySelector('.current-username');
    if (usernameElement && this.currentUser) {
      usernameElement.textContent = `${this.currentUser.name}`;
    }
  }

  showError(message) {
    const errorElement = this.authModal.querySelector('.error-message');

    if (this.errorTimer) {
      clearTimeout(this.errorTimer);
      this.errorTimer = null;
    }

    errorElement.textContent = message;
    errorElement.style.display = 'flex';

    this.errorTimer = setTimeout(() => {
      this.hideError();
    }, 5000);
  }

  hideError() {
    const errorElement = this.authModal.querySelector('.error-message');
    if (errorElement) {
      errorElement.style.display = 'none';
      errorElement.textContent = '';

      if (this.errorTimer) {
        clearTimeout(this.errorTimer);
        this.errorTimer = null;
      }
    }
  }

  hideAuthModal() {
    this.authModal.classList.remove('active');
    this.authModal.querySelector('.auth-input').value = '';
    this.hideError();
    const button = this.authModal.querySelector('.auth-button');
    button.disabled = false;
    button.textContent = 'Присоединиться к чату';
    button.classList.remove('loading');
    this.isConnecting = false;
  }

  showAuthModal() {
    this.authModal.classList.add('active');
    const button = this.authModal.querySelector('.auth-button');
    button.textContent = 'Присоединиться к чату';
    button.disabled = false;
    button.classList.remove('loading');
    this.authModal.querySelector('.auth-input').focus();
    this.hideError();
  }

  showChat() {
    this.chatContainer.classList.remove('hidden');
    this.updateUserInfo();
  }

  connectWebSocket() {
    this.stopHeartbeat();

    if (this.websocket) {
      if (this.websocket.readyState !== WebSocket.CLOSED) {
        this.websocket.close();
      }
      this.websocket = null;
    }

    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = 'wss://sse-nq1x22rx8-dddarinas-projects.vercel.app';

    console.log(`Подключение к WebSocket: ${wsUrl}`);
    this.websocket = new WebSocket(wsUrl);

    this.updateConnectionStatus('connecting', 'Подключение к серверу...');
    this.subscribeOnEvents();
  }

  updateConnectionStatus(status, text) {
    const statusElement = this.chatContainer.querySelector('.connection-status');
    const statusText = this.chatContainer.querySelector('.status-text');

    if (statusElement) {
      if (status === 'connected') {
        setTimeout(() => {
          statusElement.classList.add('hidden');
        }, 3000);
      } else {
        statusElement.classList.remove('hidden');
      }

      statusText.textContent = text;

      statusElement.setAttribute('data-status', status);
    }
  }

  enableMessageInput() {
    this.messageInput.disabled = false;
    this.messageInput.placeholder = 'Введите сообщение...';
    this.chatContainer.querySelector('.send-button').disabled = false;
    this.messageInput.focus();
  }

  disableMessageInput() {
    this.messageInput.disabled = true;
    this.messageInput.placeholder = 'Соединение потеряно...';
    this.chatContainer.querySelector('.send-button').disabled = true;
  }

  updateUsersList(users) {
    this.users = users;
    const usersList = this.chatContainer.querySelector('.users-list');
    const usersCount = this.chatContainer.querySelector('.users-count');

    usersList.innerHTML = '';
    usersCount.textContent = users.length;

    if (users.length === 0) {
      usersList.innerHTML = '<li class="no-users">Пока никого нет</li>';
      return;
    }

    const sortedUsers = [...users].sort((a, b) => {
      if (this.currentUser && a.id === this.currentUser.id) return -1;
      if (this.currentUser && b.id === this.currentUser.id) return 1;
      return a.name.localeCompare(b.name);
    });

    sortedUsers.forEach(user => {
      const li = document.createElement('li');
      li.className = 'chat__user';

      if (this.currentUser && user.id === this.currentUser.id) {
        li.classList.add('current-user');
        li.innerHTML = `
          <div class="user-avatar-small">${user.name.charAt(0).toUpperCase()}</div>
          <span class="user-name">${this.escapeHtml(user.name)}</span>
          <span class="user-you"> (Вы)</span>
        `;
      } else {
        li.innerHTML = `
          <div class="user-avatar-small">${user.name.charAt(0).toUpperCase()}</div>
          <span class="user-name">${this.escapeHtml(user.name)}</span>
        `;
      }

      usersList.append(li);
    });
  }

  sendMessage() {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      console.error('WebSocket is not connected. State:',
        this.websocket ? this.websocket.readyState : 'no websocket');

      this.showSystemMessage('Нет соединения с сервером');
      this.showNotification('Нет соединения с сервером', 'error');
      this.updateConnectionStatus('error', 'Нет соединения');
      return;
    }

    const messageText = this.messageInput.value.trim();
    if (!messageText || !this.currentUser) {
      if (!messageText) {
        this.showNotification('Введите текст сообщения', 'warning');
      }
      return;
    }

    const message = {
      type: 'send',
      message: messageText,
      user: this.currentUser
    };

    try {
      this.websocket.send(JSON.stringify(message));
      console.log('Отправлено сообщение:', message);
      this.messageInput.value = '';
      this.messageInput.style.height = 'auto';
      this.messageInput.focus();
    } catch (error) {
      console.error('Error sending message:', error);
      this.showNotification('Ошибка отправки сообщения', 'error');
    }
  }

  renderMessage(data) {
    console.log('Rendering message:', data);

    const welcomeMessage = this.chatContainer.querySelector('.welcome-message');
    if (welcomeMessage) {
      welcomeMessage.style.display = 'none';
    }

    this.messageHistory.push({
      ...data,
      timestamp: new Date()
    });

    const messagesList = this.chatContainer.querySelector('.messages-list');
    const messageContainer = document.createElement('div');

    const isOwnMessage = this.currentUser && data.user.id === this.currentUser.id;
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (isOwnMessage) {
      messageContainer.className = 'message__container message__container-yourself';
      messageContainer.innerHTML = `
        <div class="message__header" data-time="${timestamp}">Вы</div>
        <div class="message__body">${this.escapeHtml(data.message)}</div>
      `;
    } else {
      messageContainer.className = 'message__container message__container-interlocutor';
      messageContainer.innerHTML = `
        <div class="message__header" data-time="${timestamp}">${this.escapeHtml(data.user.name)}</div>
        <div class="message__body">${this.escapeHtml(data.message)}</div>
      `;
    }

    messagesList.append(messageContainer);

    const messagesContainer = this.chatContainer.querySelector('.chat__messages-container');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  showSystemMessage(text) {
    const messagesList = this.chatContainer.querySelector('.messages-list');
    const messageContainer = document.createElement('div');
    messageContainer.className = 'message__container';
    messageContainer.style.textAlign = 'center';
    messageContainer.style.margin = '10px 0';
    messageContainer.innerHTML = `
      <div class="message__body system-message">${text}</div>
    `;
    messagesList.append(messageContainer);

    const messagesContainer = this.chatContainer.querySelector('.chat__messages-container');
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  showExitConfirmation() {
    this.confirmModal.classList.add('active');
    this.confirmModal.classList.remove('hidden');
  }

  hideExitConfirmation() {
    this.confirmModal.classList.remove('active');
    setTimeout(() => {
      this.confirmModal.classList.add('hidden');
    }, 300);
  }

  exitOnUnload() {
    if (this.currentUser && this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      try {
        const exitMessage = {
          type: 'exit',
          user: this.currentUser
        };
        this.websocket.send(JSON.stringify(exitMessage));
      } catch (error) {
        console.error('Error sending exit message on unload:', error);
      }
    }

    if (this.currentUser) {
      localStorage.setItem('last_chat_session_time', Date.now().toString());
    }
  }

  performExit() {
    this.hideExitConfirmation();
    this.isExiting = true;
    this.autoReconnect = false;

    this.stopHeartbeat();

    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
      const exitMessage = {
        type: 'exit',
        user: this.currentUser
      };
      try {
        this.websocket.send(JSON.stringify(exitMessage));
      } catch (error) {
        console.error('Error sending exit message:', error);
      }
      this.websocket.close();
    }

    this.showNotification('Вы вышли из чата', 'info');
    this.resetChat();
    setTimeout(() => {
      this.showAuthModal();
    }, 500);
  }

  resetChat() {
    if (this.notificationManager) {
      this.notificationManager.clearAll();
    }

    this.currentUser = null;
    this.users = [];

    this.stopHeartbeat();

    if (this.websocket) {
      if (this.websocket.readyState !== WebSocket.CLOSED) {
        this.websocket.close();
      }
      this.websocket = null;
    }

    this.isExiting = false;
    this.autoReconnect = true;
    this.reconnectionAttempts = 0;
    this.chatContainer.classList.add('hidden');
    this.messageHistory = [];

    this.chatContainer.querySelector('.messages-list').innerHTML = '';
    this.chatContainer.querySelector('.users-list').innerHTML = '<li class="no-users">Пока никого нет</li>';
    this.chatContainer.querySelector('.users-count').textContent = '0';

    const welcomeMessage = this.chatContainer.querySelector('.welcome-message');
    if (welcomeMessage) {
      welcomeMessage.style.display = 'block';
    }

    this.messageInput.value = '';
    this.messageInput.disabled = true;
    this.messageInput.placeholder = 'Введите сообщение...';
    this.messageInput.style.height = 'auto';
    this.chatContainer.querySelector('.send-button').disabled = true;

    if (this.errorTimer) {
      clearTimeout(this.errorTimer);
      this.errorTimer = null;
    }
  }

  showNotification(message, type = 'info') {
    if (this.notificationManager) {
      this.notificationManager.show(message, type);
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
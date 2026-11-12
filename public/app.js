// PickleChat frontend — plain JavaScript, no frameworks.
// Talks to our little server (server.js) at /api/chat using streaming (SSE).

const $ = (sel) => document.querySelector(sel);

const DEFAULTS = {
  apiKey: '',
  model: '',
  baseUrl: '',
  appPassword: '',
  theme: 'pickle',
  botName: 'PickleChat',
  personality: '',
  knowledge: '',
};

const state = {
  conversations: loadJSON('pc_conversations', []),
  currentId: loadJSON('pc_current', null),
  settings: Object.assign({}, DEFAULTS, loadJSON('pc_settings', {})),
  pendingFiles: [],
  busy: false,
};

/* ---------- Storage helpers ---------- */

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function save() {
  try {
    saveJSON('pc_conversations', state.conversations);
    saveJSON('pc_current', state.currentId);
  } catch {
    // Browser storage is full (usually big image attachments).
    // Keep the chats but drop the heavy attachment data so nothing crashes.
    for (const conv of state.conversations) {
      for (const msg of conv.messages) {
        if (msg.attachments) {
          msg.attachments = msg.attachments.map((a) => ({ type: a.type, name: a.name }));
        }
      }
    }
    try {
      saveJSON('pc_conversations', state.conversations);
    } catch {
      /* give up quietly */
    }
  }
}

function saveSettings() {
  saveJSON('pc_settings', state.settings);
}

/* ---------- Small helpers ---------- */

function botName() {
  return (state.settings.botName || 'PickleChat').trim() || 'PickleChat';
}

function currentConversation() {
  return state.conversations.find((c) => c.id === state.currentId) || null;
}

function titleFrom(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > 34 ? clean.slice(0, 34) + '…' : clean || 'New chat';
}

function escapeHTML(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Tiny safe formatter: code fences, inline code, **bold**, newlines.
function format(text) {
  let html = escapeHTML(text);
  html = html.replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.replace(/^\n/, '')}</code></pre>`);
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  return html;
}

function applyTheme() {
  document.documentElement.dataset.theme = state.settings.theme || 'pickle';
}

/* ---------- Rendering ---------- */

function render() {
  applyTheme();
  $('#brand-name').textContent = botName();
  renderSidebar();
  renderMessages();
  renderModeBadge();
}

function renderModeBadge() {
  const badge = $('#mode-badge');
  const live = Boolean(state.settings.apiKey);
  badge.textContent = live ? 'Live AI' : 'Demo mode';
  badge.className = 'mode-badge ' + (live ? 'live' : 'demo');
}

function renderSidebar() {
  const list = $('#conversation-list');
  list.innerHTML = '';

  for (const conv of state.conversations) {
    const row = document.createElement('div');
    row.className = 'conv-row' + (conv.id === state.currentId ? ' active' : '');

    const title = document.createElement('button');
    title.className = 'conv-item';
    title.textContent = conv.title;
    title.title = conv.title;
    title.addEventListener('click', () => {
      state.currentId = conv.id;
      save();
      render();
    });
    row.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'conv-actions';

    const renameBtn = document.createElement('button');
    renameBtn.className = 'conv-action';
    renameBtn.title = 'Rename';
    renameBtn.textContent = '✏️';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startRename(conv, row);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'conv-action';
    deleteBtn.title = 'Delete';
    deleteBtn.textContent = '🗑️';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConversation(conv);
    });

    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);
    row.appendChild(actions);
    list.appendChild(row);
  }
}

function startRename(conv, row) {
  const title = row.querySelector('.conv-item');
  const input = document.createElement('input');
  input.className = 'conv-rename-input';
  input.value = conv.title;
  row.replaceChild(input, title);
  input.focus();
  input.select();

  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    if (value) conv.title = value;
    save();
    render();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      done = true;
      render();
    }
  });
  input.addEventListener('blur', commit);
}

function deleteConversation(conv) {
  if (!confirm(`Delete "${conv.title}"? This cannot be undone.`)) return;
  state.conversations = state.conversations.filter((c) => c.id !== conv.id);
  if (state.currentId === conv.id) {
    state.currentId = state.conversations[0] ? state.conversations[0].id : null;
  }
  save();
  render();
}

function welcomeHTML() {
  const name = escapeHTML(botName());
  const demoNote = state.settings.apiKey
    ? ''
    : '<p class="welcome-note">Running in <strong>demo mode</strong> — add an API key in Settings to unlock a real AI brain.</p>';
  return `
    <div class="welcome">
      <div class="welcome-icon">🥒</div>
      <h2>Hey! I'm ${name}.</h2>
      <p>A ChatGPT-style chat app you built yourself. Try one of these:</p>
      <div class="suggestions">
        <button class="suggestion">Explain how AI chatbots work</button>
        <button class="suggestion">Write a short poem about pickles</button>
        <button class="suggestion">Give me 3 ideas for a fun weekend project</button>
      </div>
      ${demoNote}
    </div>`;
}

function messageEl(role, msg) {
  const row = document.createElement('div');
  row.className = 'msg ' + role;

  if (role === 'assistant') {
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = '🥒';
    row.appendChild(avatar);
  }

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (role === 'assistant') {
    bubble.innerHTML = format(msg.content || '');
  } else {
    const images = (msg.attachments || []).filter((a) => a.type === 'image' && a.dataUrl);
    if (images.length) {
      const wrap = document.createElement('div');
      wrap.className = 'msg-images';
      for (const img of images) {
        const el = document.createElement('img');
        el.src = img.dataUrl;
        el.alt = img.name || 'image';
        wrap.appendChild(el);
      }
      bubble.appendChild(wrap);
    }

    for (const file of (msg.attachments || []).filter((a) => a.type === 'text')) {
      const chip = document.createElement('span');
      chip.className = 'file-chip';
      chip.textContent = '📄 ' + (file.name || 'file');
      bubble.appendChild(chip);
    }

    if (msg.content) {
      const textEl = document.createElement('div');
      textEl.className = 'msg-text';
      textEl.textContent = msg.content;
      bubble.appendChild(textEl);
    }
  }

  row.appendChild(bubble);
  return row;
}

function renderMessages() {
  const container = $('#messages');
  const conv = currentConversation();
  $('#chat-title').textContent = conv ? conv.title : 'New chat';

  if (!conv || conv.messages.length === 0) {
    container.innerHTML = welcomeHTML();
    return;
  }

  container.innerHTML = '';
  for (const m of conv.messages) container.appendChild(messageEl(m.role, m));
  scrollToBottom();
}

function scrollToBottom() {
  const container = $('#messages');
  container.scrollTop = container.scrollHeight;
}

/* ---------- Building the request ---------- */

function buildSystemPrompt() {
  const s = state.settings;
  const name = botName();
  let prompt = (s.personality || '').trim();
  if (!prompt) {
    prompt = `You are ${name}, a friendly and helpful AI assistant with a playful pickle-themed personality. You give clear, accurate and concise answers.`;
  }
  if ((s.knowledge || '').trim()) {
    prompt +=
      '\n\nHere is information you know and should use when it is relevant:\n' +
      s.knowledge.trim();
  }
  return prompt;
}

// Convert stored messages (with attachments) into the API message format.
function toApiMessages(messages) {
  return messages.map((m) => {
    if (m.role === 'assistant') return { role: 'assistant', content: m.content || '' };

    let text = m.content || '';
    for (const a of m.attachments || []) {
      if (a.type === 'text' && a.text) {
        text += `\n\n--- File: ${a.name} ---\n${a.text}\n--- End of file ---`;
      }
    }

    const images = (m.attachments || []).filter((a) => a.type === 'image' && a.dataUrl);
    if (images.length) {
      const content = [];
      if (text.trim()) content.push({ type: 'text', text });
      for (const img of images) content.push({ type: 'image_url', image_url: { url: img.dataUrl } });
      return { role: 'user', content };
    }

    return { role: 'user', content: text || '(sent an attachment)' };
  });
}

async function requestChat(payload) {
  const makeHeaders = () => {
    const headers = { 'Content-Type': 'application/json', 'x-api-key': state.settings.apiKey || '' };
    if (state.settings.appPassword) headers['x-app-password'] = state.settings.appPassword;
    return headers;
  };

  let res = await fetch('/api/chat', {
    method: 'POST',
    headers: makeHeaders(),
    body: JSON.stringify(payload),
  });

  if (res.status === 401) {
    const password = window.prompt('This app is password protected. Enter the access password:');
    if (password) {
      state.settings.appPassword = password;
      saveSettings();
      res = await fetch('/api/chat', {
        method: 'POST',
        headers: makeHeaders(),
        body: JSON.stringify(payload),
      });
    }
  }

  return res;
}

/* ---------- Sending (with live streaming) ---------- */

async function sendMessage(rawText) {
  const text = String(rawText || '').trim();
  const files = state.pendingFiles.slice();
  if (state.busy || (!text && files.length === 0)) return;

  state.busy = true;
  setSendEnabled(false);

  let conv = currentConversation();
  if (!conv) {
    conv = { id: crypto.randomUUID(), title: 'New chat', messages: [] };
    state.conversations.unshift(conv);
    state.currentId = conv.id;
  }

  conv.messages.push({ role: 'user', content: text, attachments: files });
  if (conv.title === 'New chat') conv.title = titleFrom(text || (files[0] && files[0].name));
  state.pendingFiles = [];
  renderPendingFiles();
  save();
  renderMessages();

  // Placeholder message that will fill up as words stream in.
  const assistant = { role: 'assistant', content: '' };
  conv.messages.push(assistant);
  renderMessages();

  const bubbles = document.querySelectorAll('.msg.assistant .bubble');
  const bubble = bubbles[bubbles.length - 1];
  if (bubble) bubble.classList.add('streaming');
  scrollToBottom();

  const apiMessages = toApiMessages(conv.messages.slice(0, -1));

  try {
    const res = await requestChat({
      messages: apiMessages,
      system: buildSystemPrompt(),
      model: state.settings.model || undefined,
      baseUrl: state.settings.baseUrl || undefined,
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Server error (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue;
          let evt;
          try {
            evt = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (evt.error) throw new Error(evt.error);
          if (evt.delta) {
            assistant.content += evt.delta;
            if (bubble) bubble.innerHTML = format(assistant.content);
            scrollToBottom();
          }
        }
      }
    }

    if (!assistant.content.trim()) assistant.content = '(empty reply)';
    if (bubble) {
      bubble.classList.remove('streaming');
      bubble.innerHTML = format(assistant.content);
    }
    save();
  } catch (err) {
    if (bubble) bubble.classList.remove('streaming');

    if (!assistant.content.trim()) {
      conv.messages.pop(); // remove the empty placeholder
      renderMessages();
      $('#messages').appendChild(messageEl('assistant', { content: '⚠️ ' + err.message }));
    } else {
      assistant.content += '\n\n⚠️ ' + err.message;
      if (bubble) bubble.innerHTML = format(assistant.content);
      save();
    }
    scrollToBottom();
  } finally {
    state.busy = false;
    setSendEnabled(true);
    $('#input').focus();
  }
}

function setSendEnabled(enabled) {
  $('#send').disabled = !enabled;
}

/* ---------- Attachments ---------- */

function isTextFile(file) {
  const okExt = /\.(txt|md|markdown|js|ts|jsx|tsx|json|csv|html|css|py|java|c|cpp|h|log|yml|yaml|xml|ini|sh|ps1)$/i;
  return file.type.startsWith('text/') || okExt.test(file.name) || ['application/json', 'application/xml'].includes(file.type);
}

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsText(file);
  });
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1024;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const width = Math.round(img.width * scale);
      const height = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read image'));
    };
    img.src = url;
  });
}

async function handleFiles(fileList) {
  for (const file of fileList) {
    try {
      if (file.type.startsWith('image/')) {
        const dataUrl = await compressImage(file);
        state.pendingFiles.push({ type: 'image', name: file.name, dataUrl });
      } else if (isTextFile(file)) {
        const text = await readTextFile(file);
        state.pendingFiles.push({ type: 'text', name: file.name, text: text.slice(0, 200000) });
      } else {
        alert(`Sorry, "${file.name}" is not supported yet. Try an image or a text file.`);
      }
    } catch (err) {
      alert(`Could not attach "${file.name}": ${err.message}`);
    }
  }
  renderPendingFiles();
}

function renderPendingFiles() {
  const wrap = $('#pending-files');
  wrap.innerHTML = '';
  state.pendingFiles.forEach((file, index) => {
    const chip = document.createElement('div');
    chip.className = 'pending-chip';

    if (file.type === 'image' && file.dataUrl) {
      const img = document.createElement('img');
      img.src = file.dataUrl;
      img.alt = file.name;
      chip.appendChild(img);
    }

    const label = document.createElement('span');
    label.textContent = (file.type === 'image' ? '🖼️ ' : '📄 ') + file.name;
    chip.appendChild(label);

    const remove = document.createElement('button');
    remove.textContent = '✕';
    remove.title = 'Remove';
    remove.addEventListener('click', () => {
      state.pendingFiles.splice(index, 1);
      renderPendingFiles();
    });
    chip.appendChild(remove);

    wrap.appendChild(chip);
  });
}

/* ---------- Input & composer ---------- */

const input = $('#input');

input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 180) + 'px';
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    const text = input.value;
    input.value = '';
    input.style.height = 'auto';
    sendMessage(text);
  }
});

$('#send').addEventListener('click', () => {
  const text = input.value;
  input.value = '';
  input.style.height = 'auto';
  sendMessage(text);
});

$('#attach-btn').addEventListener('click', () => $('#file-input').click());

$('#file-input').addEventListener('change', async (e) => {
  await handleFiles(e.target.files);
  e.target.value = '';
});

$('#new-chat').addEventListener('click', () => {
  const conv = { id: crypto.randomUUID(), title: 'New chat', messages: [] };
  state.conversations.unshift(conv);
  state.currentId = conv.id;
  save();
  render();
  $('#input').focus();
});

// Suggestion buttons (delegation, because the welcome screen is re-rendered).
$('#messages').addEventListener('click', (e) => {
  const btn = e.target.closest('.suggestion');
  if (btn) sendMessage(btn.textContent);
});

/* ---------- Settings ---------- */

$('#settings-btn').addEventListener('click', () => {
  $('#bot-name').value = state.settings.botName || '';
  $('#personality').value = state.settings.personality || '';
  $('#knowledge').value = state.settings.knowledge || '';
  $('#theme').value = state.settings.theme || 'pickle';
  $('#api-key').value = state.settings.apiKey || '';
  $('#model').value = state.settings.model || '';
  $('#base-url').value = state.settings.baseUrl || '';
  $('#app-password').value = state.settings.appPassword || '';
  $('#settings-modal').classList.remove('hidden');
});

$('#settings-cancel').addEventListener('click', () => {
  $('#settings-modal').classList.add('hidden');
});

$('#settings-save').addEventListener('click', () => {
  state.settings = {
    botName: $('#bot-name').value.trim() || 'PickleChat',
    personality: $('#personality').value,
    knowledge: $('#knowledge').value,
    theme: $('#theme').value || 'pickle',
    apiKey: $('#api-key').value.trim(),
    model: $('#model').value.trim(),
    baseUrl: $('#base-url').value.trim(),
    appPassword: $('#app-password').value.trim(),
  };
  saveSettings();
  $('#settings-modal').classList.add('hidden');
  render();
});

$('#settings-modal').addEventListener('click', (e) => {
  if (e.target === $('#settings-modal')) $('#settings-modal').classList.add('hidden');
});

/* ---------- Boot ---------- */

if (!currentConversation() && state.conversations.length > 0) {
  state.currentId = state.conversations[0].id;
  save();
}
render();
renderPendingFiles();

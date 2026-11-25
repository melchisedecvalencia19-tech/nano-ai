const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

const els = {
  sidebar: $("#sidebar"),
  sidebarToggleBtn: $("#sidebarToggleBtn"),
  menuButton: $("#menuButton"),
  sidebarBackdrop: $("#sidebarBackdrop"),
  newChat: $("#newChat"),
  historyList: $("#historyList"),
  clearHistory: $("#clearHistory"),
  chatView: $("#chatView"),
  welcome: $("#welcome"),
  messages: $("#messages"),
  chatForm: $("#chatForm"),
  prompt: $("#promptInput"),
  send: $("#sendButton"),
  file: $("#fileInput"),
  attachment: $("#attachmentPreview"),
  web: $("#webSearch"),
  model: $("#modelSelect"),
  statusDot: $("#statusDot"),
  statusText: $("#statusText"),
  memoryView: $("#memoryView"),
  dashboardView: $("#dashboardView"),
  toast: $("#toast"),
  voice: $("#voiceButton"),
  themeButton: $("#themeButton"),
  settingsButton: $("#settingsButton"),
  topSettingsBtn: $("#topSettingsBtn"),
  exportChatBtn: $("#exportChatBtn"),
  closeModal: $("#closeModal"),
  modal: $("#modal"),
  imageModal: $("#imageModal"),
  lightboxImg: $("#lightboxImg"),
  downloadImgBtn: $("#downloadImgBtn"),
  closeImageModal: $("#closeImageModal"),
  // User Account & Authentication Elements
  userAvatarBtn: $("#userAvatarBtn"),
  userAvatar: $("#userAvatar"),
  userInitial: $("#userInitial"),
  accountPopover: $("#accountPopover"),
  popoverAvatar: $("#popoverAvatar"),
  popoverInitial: $("#popoverInitial"),
  popoverUserName: $("#popoverUserName"),
  popoverUserEmail: $("#popoverUserEmail"),
  loggedOutState: $("#loggedOutState"),
  loggedInState: $("#loggedInState"),
  openLoginBtn: $("#openLoginBtn"),
  openRegisterBtn: $("#openRegisterBtn"),
  accountSyncBtn: $("#accountSyncBtn"),
  logoutBtn: $("#logoutBtn"),
  authModal: $("#authModal"),
  closeAuthModal: $("#closeAuthModal"),
  authTabs: $$(".auth-tab"),
  loginForm: $("#loginForm"),
  registerForm: $("#registerForm"),
  loginIdentifier: $("#loginIdentifier"),
  loginPassword: $("#loginPassword"),
  loginSubmitBtn: $("#loginSubmitBtn"),
  regName: $("#regName"),
  regUsername: $("#regUsername"),
  regEmail: $("#regEmail"),
  regPassword: $("#regPassword"),
  registerSubmitBtn: $("#registerSubmitBtn"),
  authFeedback: $("#authFeedback"),
  oneClickDemoBtn: $("#oneClickDemoBtn"),
  toggleLoginPwd: $("#toggleLoginPwd"),
  userChatCount: $("#userChatCount"),
  userMemoryCount: $("#userMemoryCount")
};

const STORE_KEY = "nova_ultimate_chats_v4";
const AUTH_TOKEN_KEY = "nova_auth_token";
let currentUser = null;

function getAuthHeaders() {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  return token ? { "Authorization": `Bearer ${token}` } : {};
}

let chats = loadChats();
let activeId = chats[0]?.id || null;
let attachedText = "";
let attachedName = "";
let busy = false;
let abortController = null;
let currentlySpeakingText = null;

function loadChats() {
  try {
    const value = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveChats() {
  localStorage.setItem(STORE_KEY, JSON.stringify(chats));
  if (currentUser) {
    syncChatsToCloud(false);
  }
}

async function syncChatsToCloud(showToastNotice = true) {
  if (!currentUser) return;
  try {
    const res = await fetch("/api/user/chats", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders()
      },
      body: JSON.stringify({ chats })
    });
    if (res.ok && showToastNotice) {
      toast("Riwayat chat berhasil disinkronkan ke akun Anda!");
    }
  } catch {}
}

async function loadChatsFromCloud() {
  if (!currentUser) return;
  try {
    const res = await fetch("/api/user/chats", {
      headers: getAuthHeaders()
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.chats) && data.chats.length) {
        chats = data.chats;
        localStorage.setItem(STORE_KEY, JSON.stringify(chats));
        if (!activeId || !chats.find(c => c.id === activeId)) {
          activeId = chats[0].id;
        }
        renderHistory();
        renderMessages();
      }
    }
  } catch {}
}

function currentChat() {
  return chats.find((c) => c.id === activeId);
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("show"), 2800);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}

function renderMarkdown(value) {
  if (!value) return "";
  let text = String(value);

  // Extract and preserve code blocks
  const codeBlocks = [];
  text = text.replace(/```([\w-]*)\r?\n([\s\S]*?)```/g, (_, lang, code) => {
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push({ lang: lang || "code", code: code.trim() });
    return placeholder;
  });

  // Headers
  text = text.replace(/^### (.*$)/gim, "<h3>$1</h3>");
  text = text.replace(/^## (.*$)/gim, "<h2>$1</h2>");
  text = text.replace(/^# (.*$)/gim, "<h2>$1</h2>");

  // Bold & Italic
  text = text.replace(/\*\*\*(.*?)\*\*\*/g, "<strong><em>$1</em></strong>");
  text = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/\*(.*?)\*/g, "<em>$1</em>");

  // Inline Code
  text = text.replace(/`([^`]+)`/g, "<code>$1</code>");

  // Links
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Blockquotes
  text = text.replace(/^>\s+(.*$)/gim, "<blockquote>$1</blockquote>");

  // Markdown Tables
  text = text.replace(/((?:\|[^\r\n]+\|\r?\n)+)/g, (tableMatch) => {
    const lines = tableMatch.trim().split(/\r?\n/);
    if (lines.length >= 2 && lines[1].includes("---")) {
      const headers = lines[0].split("|").slice(1, -1).map(h => `<th>${h.trim()}</th>`).join("");
      const rows = lines.slice(2).map(row => {
        const cells = row.split("|").slice(1, -1).map(c => `<td>${c.trim()}</td>`).join("");
        return `<tr>${cells}</tr>`;
      }).join("");
      return `<div class="table-wrap"><table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    return tableMatch;
  });

  // Bullet Lists
  text = text.replace(/^\s*[-*]\s+(.*$)/gim, "<ul><li>$1</li></ul>");
  text = text.replace(/<\/ul>\s*<ul>/g, "");

  // Numbered lists
  text = text.replace(/^\s*\d+\.\s+(.*$)/gim, "<ol><li>$1</li></ol>");
  text = text.replace(/<\/ol>\s*<ol>/g, "");

  // Paragraphs
  const parts = text.split(/\r?\n\r?\n/);
  text = parts
    .map((p) => {
      p = p.trim();
      if (!p) return "";
      if (p.startsWith("<h2") || p.startsWith("<h3") || p.startsWith("<ul") || p.startsWith("<ol") || p.startsWith("<blockquote") || p.startsWith("<div") || p.startsWith("__CODE_BLOCK_")) {
        return p;
      }
      return `<p>${p.replace(/\r?\n/g, "<br>")}</p>`;
    })
    .join("");

  // Restore code blocks with Gemini header & copy button
  codeBlocks.forEach((item, idx) => {
    const placeholder = `__CODE_BLOCK_${idx}__`;
    const escaped = escapeHtml(item.code);
    const html = `
      <div class="code-block">
        <div class="code-header">
          <span>${escapeHtml(item.lang.toUpperCase())}</span>
          <button class="copy-code-btn" type="button" title="Salin kode">
            <span class="material-symbols-rounded">content_copy</span>
            <span>Salin kode</span>
          </button>
        </div>
        <pre><code>${escaped}</code></pre>
      </div>
    `;
    text = text.replace(placeholder, html);
  });

  return text;
}

function newChat() {
  const chat = {
    id: Date.now().toString(),
    title: "Percakapan baru",
    messages: [],
    updatedAt: Date.now()
  };
  chats.unshift(chat);
  activeId = chat.id;
  saveChats();
  renderHistory();
  renderMessages();
  showView("chat");
  els.prompt.focus();
}

function renderHistory() {
  els.historyList.innerHTML = "";
  if (!chats.length) {
    els.historyList.innerHTML = `<div style="padding:14px;font-size:12.5px;color:var(--text-muted);text-align:center;">Belum ada riwayat</div>`;
    return;
  }
  chats.forEach((chat) => {
    const row = document.createElement("div");
    row.className = "history-item" + (chat.id === activeId ? " active" : "");

    const title = document.createElement("span");
    title.className = "history-item-title";
    title.textContent = chat.title || "Percakapan baru";
    title.title = "Klik untuk membuka, klik ganda untuk mengubah nama";
    title.onclick = () => {
      activeId = chat.id;
      renderHistory();
      renderMessages();
      showView("chat");
      closeMobileSidebar();
    };

    title.ondblclick = (e) => {
      e.stopPropagation();
      const newTitle = prompt("Ubah judul percakapan:", chat.title);
      if (newTitle && newTitle.trim()) {
        chat.title = newTitle.trim();
        saveChats();
        renderHistory();
      }
    };

    const del = document.createElement("button");
    del.className = "history-item-del";
    del.innerHTML = '<span class="material-symbols-rounded" style="font-size:16px;">close</span>';
    del.title = "Hapus percakapan";
    del.onclick = (e) => {
      e.stopPropagation();
      chats = chats.filter((c) => c.id !== chat.id);
      if (activeId === chat.id) activeId = chats[0]?.id || null;
      saveChats();
      renderHistory();
      renderMessages();
    };

    row.append(title, del);
    els.historyList.append(row);
  });
}

function renderMessages() {
  const chat = currentChat();
  els.messages.innerHTML = "";
  const has = !!chat?.messages?.length;
  els.welcome.classList.toggle("hidden", has);

  if (!has) return;

  chat.messages.forEach((m, idx) => {
    const isLast = idx === chat.messages.length - 1;
    const item = document.createElement("article");
    item.className = `message ${m.role}`;
    if (busy && isLast && m.role === "assistant") {
      item.classList.add("streaming");
    }

    // Avatar
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    if (m.role === "assistant") {
      avatar.innerHTML = `<img src="/nova-logo.svg" alt="Nano AI" title="Nano AI">`;
    }
    item.appendChild(avatar);

    // Bubble Container
    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if (m.role === "user") {
      // User message
      bubble.innerHTML = renderMarkdown(m.content || "");

      // Edit button for user message on hover
      const editBtn = document.createElement("button");
      editBtn.className = "user-edit-btn";
      editBtn.title = "Edit pesan ini";
      editBtn.innerHTML = '<span class="material-symbols-rounded">edit</span>';
      editBtn.onclick = () => {
        els.prompt.value = m.content.replace(/^\[Dokumen terlampir:[^\]]+\]\r?\n[\s\S]*?\n\n/g, "");
        autosize();
        els.prompt.focus();
        toast("Pesan dimuat ke kotak input.");
      };
      item.appendChild(editBtn);
    } else {
      // Assistant message
      if (m.image) {
        bubble.innerHTML = `
          <img src="${m.image}" alt="Gambar Nano AI" class="chat-image" title="Klik untuk memperbesar">
          <p>${escapeHtml(m.content || "Gambar berhasil dibuat.")}</p>
        `;
      } else {
        bubble.innerHTML = renderMarkdown(m.content || "");
        if (busy && isLast && m.role === "assistant") {
          const cursor = document.createElement("span");
          cursor.className = "streaming-cursor";
          bubble.appendChild(cursor);
        }
      }

      // Grounding / Web Search Sources
      if (m.sources && m.sources.length) {
        const sourcesBox = document.createElement("div");
        sourcesBox.className = "grounding-sources";
        sourcesBox.innerHTML = `
          <div class="grounding-header">
            <span class="material-symbols-rounded">travel_explore</span>
            <span>Sumber Web Ditemukan (${m.sources.length})</span>
          </div>
          <div class="grounding-chips">
            ${m.sources.map(s => `
              <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer" class="grounding-chip" title="${escapeHtml(s.title || s.url)}">
                <span class="material-symbols-rounded">link</span>
                <span>${escapeHtml(s.title || s.url)}</span>
              </a>
            `).join("")}
          </div>
        `;
        bubble.appendChild(sourcesBox);
      }

      // Action buttons for assistant message
      if (m.content && (!busy || !isLast)) {
        const actions = document.createElement("div");
        actions.className = "message-actions";

        // Copy button
        const copyBtn = document.createElement("button");
        copyBtn.className = "action-icon-btn";
        copyBtn.title = "Salin respons";
        copyBtn.innerHTML = '<span class="material-symbols-rounded">content_copy</span>';
        copyBtn.onclick = () => {
          navigator.clipboard?.writeText(m.content).then(() => {
            copyBtn.innerHTML = '<span class="material-symbols-rounded" style="color:var(--accent-blue)">check</span>';
            setTimeout(() => {
              copyBtn.innerHTML = '<span class="material-symbols-rounded">content_copy</span>';
            }, 1800);
            toast("Jawaban berhasil disalin.");
          });
        };

        // Speak button
        const speakBtn = document.createElement("button");
        speakBtn.className = "action-icon-btn" + (currentlySpeakingText === m.content ? " speaking" : "");
        speakBtn.title = currentlySpeakingText === m.content ? "Hentikan suara" : "Dengarkan respons";
        speakBtn.innerHTML = `<span class="material-symbols-rounded">${currentlySpeakingText === m.content ? "volume_off" : "volume_up"}</span>`;
        speakBtn.onclick = () => toggleSpeech(m.content, speakBtn);

        // Regenerate button on last assistant message
        actions.append(copyBtn, speakBtn);
        if (isLast) {
          const regenBtn = document.createElement("button");
          regenBtn.className = "action-icon-btn";
          regenBtn.title = "Buat ulang respons ini";
          regenBtn.innerHTML = '<span class="material-symbols-rounded">refresh</span>';
          regenBtn.onclick = () => regenerateLast();
          actions.appendChild(regenBtn);
        }

        bubble.appendChild(actions);
      }
    }

    item.appendChild(bubble);
    els.messages.appendChild(item);
  });

  els.messages.scrollTop = els.messages.scrollHeight;
}

function showView(view) {
  $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  els.chatView.classList.toggle("hidden", view !== "chat");
  els.memoryView.classList.toggle("hidden", view !== "memory");
  els.dashboardView.classList.toggle("hidden", view !== "dashboard");
  $("#pageTitle").textContent = view === "chat" ? "Nano" : view === "memory" ? "Memori" : "Dashboard";
  if (view === "memory") loadMemory();
  if (view === "dashboard") loadDashboard();
  closeMobileSidebar();
}

function closeMobileSidebar() {
  els.sidebar.classList.remove("open");
  els.sidebarBackdrop.classList.remove("active");
}

async function loadModels() {
  try {
    const r = await fetch("/api/models");
    const data = await r.json();
    els.model.innerHTML = "";

    const labels = {
      "gemini-3.5-flash-lite": "Nano 3.5 Flash Lite (Kilat)",
      "gemini-3.1-flash-lite": "Nano 3.1 Flash Lite (Cepat)",
      "gemini-flash-lite-latest": "Nano Flash Lite (Terbaru)",
      "gemini-3.8-flash": "Nano 3.8 Flash"
    };

    (data.models || []).forEach((model) => {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = labels[model] || model;
      els.model.appendChild(option);
    });
    els.model.value = data.default || data.models?.[0] || "";
    $("#currentModel").textContent = els.model.value || "-";
  } catch {
    toast("Tidak dapat memuat daftar model.");
  }
}

async function checkStatus() {
  try {
    const r = await fetch("/api/status");
    const d = await r.json();
    els.statusDot.classList.toggle("online", !!d.configured);
    els.statusText.textContent = d.configured ? "Nano AI Online" : "API key belum diatur";
  } catch {
    els.statusText.textContent = "Server offline";
  }
}

async function sendMessage(text) {
  if (busy) {
    // If currently busy and user clicks send button, abort current stream!
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    return;
  }

  text = (text || "").trim();
  if (!text && !attachedText) return toast("Tulis pesan atau lampirkan dokumen terlebih dahulu.");

  if (!currentChat()) newChat();
  const chat = currentChat();

  let combined = text;
  if (attachedText) {
    combined = `${text ? text + "\n\n" : ""}[Dokumen terlampir: ${attachedName}]\n${attachedText}`;
  }

  chat.messages.push({ role: "user", content: combined });
  if (chat.messages.length === 1) {
    chat.title = (text || attachedName || "Percakapan baru").slice(0, 36);
  }
  chat.updatedAt = Date.now();

  removeAttachment();
  els.prompt.value = "";
  autosize();

  chat.messages.push({ role: "assistant", content: "", sources: null });
  saveChats();
  renderHistory();
  renderMessages();

  busy = true;
  updateSendButtonState();

  abortController = new AbortController();
  const history = chat.messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content }));

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders()
      },
      body: JSON.stringify({
        messages: history,
        model: els.model.value,
        webSearch: els.web.checked
      }),
      signal: abortController.signal
    });

    if (!response.ok) {
      let err = {};
      try { err = await response.json(); } catch {}
      throw new Error(err.error || `Permintaan gagal (${response.status}).`);
    }

    if (!response.body) throw new Error("Browser tidak mendukung streaming.");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const assistant = chat.messages[chat.messages.length - 1];

    let streamRaf = null;
    const updateStreamingBubble = () => {
      const assistantMsg = els.messages.querySelector(".message.assistant:last-child");
      if (!assistantMsg) {
        renderMessages();
        return;
      }
      const bubble = assistantMsg.querySelector(".bubble");
      if (bubble) {
        bubble.innerHTML = renderMarkdown(assistant.content) + '<span class="streaming-cursor"></span>';
      }
      const isNearBottom = els.messages.scrollHeight - els.messages.scrollTop - els.messages.clientHeight < 200;
      if (isNearBottom) {
        els.messages.scrollTop = els.messages.scrollHeight;
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || "";

      for (const event of events) {
        for (const line of event.split(/\r?\n/)) {
          if (!line.startsWith("data:")) continue;
          const raw = line.slice(5).trim();
          if (!raw || raw === "[DONE]") continue;
          try {
            const packet = JSON.parse(raw);
            if (packet.error) throw new Error(packet.error);

            if (packet.text) {
              assistant.content += packet.text;
            }
            if (packet.sources && packet.sources.length) {
              assistant.sources = packet.sources;
            }

            if (!streamRaf) {
              streamRaf = requestAnimationFrame(() => {
                updateStreamingBubble();
                streamRaf = null;
              });
            }
          } catch (e) {
            if (e.message && !e.message.includes("Unexpected")) throw e;
          }
        }
      }
    }

    if (streamRaf) {
      cancelAnimationFrame(streamRaf);
      streamRaf = null;
    }

    if (!assistant.content) assistant.content = "Nano tidak menerima teks respons. Silakan coba kembali.";
  } catch (e) {
    if (e.name === "AbortError") {
      toast("Pembuatan respons dihentikan.");
    } else {
      chat.messages.pop();
      chat.messages.push({ role: "assistant", content: `**Terjadi kesalahan:** ${e.message}` });
      toast(e.message);
    }
  } finally {
    busy = false;
    abortController = null;
    updateSendButtonState();
    saveChats();
    renderMessages();
    renderHistory();
  }
}

function updateSendButtonState() {
  if (busy) {
    els.send.innerHTML = '<span class="material-symbols-rounded">stop</span>';
    els.send.title = "Hentikan pembuatan";
    els.send.style.backgroundColor = "#ea4335";
    els.send.disabled = false;
  } else {
    els.send.innerHTML = '<span class="material-symbols-rounded">arrow_upward</span>';
    els.send.title = "Kirim pesan";
    els.send.style.backgroundColor = "";
    els.send.disabled = false;
  }
}

function regenerateLast() {
  const chat = currentChat();
  if (!chat || chat.messages.length < 2) return;
  // Remove last assistant message
  chat.messages.pop();
  // Pop last user message and resend
  const lastUser = chat.messages.pop();
  saveChats();
  renderMessages();
  if (lastUser && lastUser.content) {
    sendMessage(lastUser.content);
  }
}

function autosize() {
  els.prompt.style.height = "auto";
  els.prompt.style.height = Math.min(els.prompt.scrollHeight, 160) + "px";
}

async function uploadFile(file) {
  if (!file) return;
  els.attachment.innerHTML = `<span style="font-size:12px;color:var(--text-muted)">Membaca ${escapeHtml(file.name)}...</span>`;
  try {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch("/api/upload-file", { method: "POST", body: form });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Gagal membaca file.");

    attachedText = d.text;
    attachedName = d.name;

    els.attachment.innerHTML = `
      <div class="attachment-chip">
        <span class="material-symbols-rounded" style="font-size:16px;color:var(--accent-blue);">description</span>
        <span>${escapeHtml(d.name)}</span>
        <span class="chip-remove-btn" title="Hapus lampiran" onclick="removeAttachment()">
          <span class="material-symbols-rounded" style="font-size:14px;">close</span>
        </span>
      </div>
    `;
    toast("Dokumen berhasil dilampirkan.");
  } catch (e) {
    removeAttachment();
    toast(e.message);
  }
  els.file.value = "";
}

window.removeAttachment = function () {
  attachedText = "";
  attachedName = "";
  els.attachment.innerHTML = "";
};

function toggleSpeech(text, btn) {
  if (!("speechSynthesis" in window)) return toast("Fitur suara tidak didukung browser ini.");

  if (speechSynthesis.speaking && currentlySpeakingText === text) {
    speechSynthesis.cancel();
    currentlySpeakingText = null;
    renderMessages();
    return;
  }

  speechSynthesis.cancel();
  currentlySpeakingText = text;
  renderMessages();

  const clean = text.replace(/[*#`_\[\]]/g, "").replace(/\n+/g, ". ");
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = "id-ID";
  utterance.rate = 1.05;

  utterance.onend = () => {
    currentlySpeakingText = null;
    renderMessages();
  };
  utterance.onerror = () => {
    currentlySpeakingText = null;
    renderMessages();
  };

  speechSynthesis.speak(utterance);
}

function startVoice() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return toast("Dikte suara tidak didukung browser ini. Gunakan Google Chrome.");

  const recognition = new Recognition();
  recognition.lang = "id-ID";
  recognition.interimResults = false;

  recognition.onstart = () => {
    els.voice.classList.add("recording");
    toast("Mendengarkan... Silakan berbicara.");
  };

  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    els.prompt.value += (els.prompt.value ? " " : "") + transcript;
    autosize();
  };

  recognition.onerror = () => {
    els.voice.classList.remove("recording");
    toast("Mikrofon tidak dapat diakses.");
  };

  recognition.onend = () => {
    els.voice.classList.remove("recording");
  };

  recognition.start();
}

async function generateImage() {
  const prompt = els.prompt.value.trim();
  if (!prompt) return toast("Tulis deskripsi gambar yang ingin dibuat di kotak input.");
  if (busy) return;

  busy = true;
  updateSendButtonState();
  toast("Sedang memproses gambar...");

  try {
    const r = await fetch("/api/image", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...getAuthHeaders()
      },
      body: JSON.stringify({ prompt })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Gagal membuat gambar.");

    if (!currentChat()) newChat();
    currentChat().messages.push({ role: "user", content: `Buat gambar: ${prompt}` });
    currentChat().messages.push({
      role: "assistant",
      content: d.text || "Gambar berhasil dibuat.",
      image: `data:${d.mimeType};base64,${d.image}`,
      sources: null
    });

    saveChats();
    renderMessages();
    renderHistory();
    els.prompt.value = "";
    autosize();
  } catch (e) {
    toast(e.message);
  } finally {
    busy = false;
    updateSendButtonState();
  }
}

function exportCurrentChat() {
  const chat = currentChat();
  if (!chat || !chat.messages.length) return toast("Tidak ada percakapan untuk diekspor.");

  let md = `# Percakapan Nano AI\n`;
  md += `**Judul:** ${chat.title || "Percakapan"}\n`;
  md += `**Tanggal:** ${new Date(chat.updatedAt || Date.now()).toLocaleString("id-ID")}\n\n---\n\n`;

  chat.messages.forEach((m) => {
    const roleName = m.role === "user" ? "Pengguna" : "Nano AI";
    md += `### ${roleName}:\n${m.content}\n\n`;
    if (m.sources && m.sources.length) {
      md += `*Sumber Web:*\n`;
      m.sources.forEach((s) => {
        md += `- [${s.title}](${s.url})\n`;
      });
      md += `\n`;
    }
  });

  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(chat.title || "nano-ai-chat").replace(/[^\w-]/g, "_")}.md`;
  a.click();
  URL.revokeObjectURL(url);
  toast("Percakapan berhasil diekspor ke file Markdown.");
}

async function loadMemory() {
  const box = $("#memoryList");
  box.innerHTML = `<span style="font-size:13px;color:var(--text-muted)">Memuat memori...</span>`;
  try {
    const r = await fetch("/api/memory", {
      headers: getAuthHeaders()
    });
    const d = await r.json();
    box.innerHTML = "";
    (d.items || []).forEach((item) => {
      const card = document.createElement("div");
      card.className = "memory-card";

      const text = document.createElement("span");
      text.textContent = item.text;

      const del = document.createElement("button");
      del.className = "memory-del-btn";
      del.textContent = "Hapus";
      del.onclick = async () => {
        await fetch(`/api/memory/${encodeURIComponent(item.id)}`, {
          method: "DELETE",
          headers: getAuthHeaders()
        });
        loadMemory();
        toast("Memori dihapus.");
      };

      card.append(text, del);
      box.appendChild(card);
    });

    if (!d.items?.length) {
      box.innerHTML = `<span style="font-size:13px;color:var(--text-muted)">Belum ada memori tersimpan. Tambahkan preferensi Anda di atas.</span>`;
    }
  } catch {
    box.innerHTML = `<span style="font-size:13px;color:#d93025">Gagal memuat memori.</span>`;
  }
}

async function loadDashboard() {
  const grid = $("#statsGrid");
  try {
    const r = await fetch("/api/dashboard");
    const d = await r.json();
    const stats = [
      ["Status API", d.apiConfigured ? "Terhubung" : "Belum diatur"],
      ["Permintaan Chat", d.requests ?? 0],
      ["Gambar Dibuat", d.images ?? 0],
      ["Memori Tersimpan", d.memoryItems ?? 0]
    ];
    grid.innerHTML = stats
      .map(([a, b]) => `
        <div class="stat-card">
          <span>${escapeHtml(a)}</span>
          <strong>${escapeHtml(b)}</strong>
        </div>
      `)
      .join("");

    $("#dashboardModels").innerHTML = (d.models || [])
      .map((m) => `<span class="model-chip">${escapeHtml(m)}</span>`)
      .join("") || "Tidak ada model.";
  } catch {
    grid.innerHTML = `<span style="color:#d93025">Gagal memuat dashboard.</span>`;
  }
}

/* Event Listeners */
els.newChat.onclick = newChat;

els.clearHistory.onclick = () => {
  if (!confirm("Hapus seluruh riwayat percakapan di browser ini?")) return;
  chats = [];
  activeId = null;
  saveChats();
  renderHistory();
  renderMessages();
  toast("Semua riwayat telah dihapus.");
};

els.chatForm.addEventListener("submit", (e) => {
  e.preventDefault();
  sendMessage(els.prompt.value);
});

els.prompt.addEventListener("input", autosize);

els.prompt.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    els.chatForm.requestSubmit();
  }
});

els.file.addEventListener("change", (e) => uploadFile(e.target.files[0]));
els.voice.onclick = startVoice;
$("#imageButton").onclick = generateImage;
if (els.exportChatBtn) els.exportChatBtn.onclick = exportCurrentChat;

$$(".nav-item").forEach((b) => (b.onclick = () => showView(b.dataset.view)));

$$(".suggestion").forEach((b) => {
  b.onclick = () => {
    els.prompt.value = b.dataset.prompt;
    autosize();
    els.prompt.focus();
  };
});

// Sidebar Toggle (Mobile & Desktop)
els.menuButton.onclick = () => {
  if (window.innerWidth <= 768) {
    els.sidebar.classList.toggle("open");
    els.sidebarBackdrop.classList.toggle("active");
  } else {
    els.sidebar.classList.toggle("collapsed");
  }
};

els.sidebarToggleBtn.onclick = () => {
  if (window.innerWidth <= 768) {
    closeMobileSidebar();
  } else {
    els.sidebar.classList.toggle("collapsed");
  }
};

els.sidebarBackdrop.onclick = closeMobileSidebar;

// Settings Modal
function openSettings() {
  $("#currentModel").textContent = els.model.value || "-";
  els.modal.classList.remove("hidden");
}

els.settingsButton.onclick = openSettings;
els.topSettingsBtn.onclick = openSettings;
els.closeModal.onclick = () => els.modal.classList.add("hidden");
els.modal.onclick = (e) => {
  if (e.target.id === "modal") els.modal.classList.add("hidden");
};

// Image Lightbox Modal
document.addEventListener("click", (e) => {
  if (e.target.classList.contains("chat-image")) {
    els.lightboxImg.src = e.target.src;
    els.downloadImgBtn.href = e.target.src;
    els.imageModal.classList.remove("hidden");
  }
});

if (els.closeImageModal) {
  els.closeImageModal.onclick = () => els.imageModal.classList.add("hidden");
}
if (els.imageModal) {
  els.imageModal.onclick = (e) => {
    if (e.target.id === "imageModal") els.imageModal.classList.add("hidden");
  };
}

// Escape key closes modals
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    els.modal.classList.add("hidden");
    if (els.imageModal) els.imageModal.classList.add("hidden");
  }
});

// Theme Toggle
function applyTheme(isDark) {
  document.body.classList.toggle("dark", isDark);
  const icon = els.themeButton.querySelector(".material-symbols-rounded");
  if (icon) icon.textContent = isDark ? "light_mode" : "dark_mode";
  localStorage.setItem("nova_dark", isDark ? "1" : "0");
}

els.themeButton.onclick = () => {
  const isDark = !document.body.classList.contains("dark");
  applyTheme(isDark);
};

// Copy Code Button Delegation
document.addEventListener("click", (e) => {
  const copyBtn = e.target.closest(".copy-code-btn");
  if (copyBtn) {
    const codeEl = copyBtn.closest(".code-block")?.querySelector("pre code");
    if (codeEl) {
      navigator.clipboard.writeText(codeEl.innerText).then(() => {
        const textSpan = copyBtn.querySelector("span:last-child");
        const iconSpan = copyBtn.querySelector(".material-symbols-rounded");
        if (textSpan) textSpan.textContent = "Disalin!";
        if (iconSpan) iconSpan.textContent = "check";
        setTimeout(() => {
          if (textSpan) textSpan.textContent = "Salin kode";
          if (iconSpan) iconSpan.textContent = "content_copy";
        }, 2000);
        toast("Kode berhasil disalin!");
      });
    }
  }
});

// Memory Form
$("#memoryForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#memoryInput");
  if (!input.value.trim()) return;
  const r = await fetch("/api/memory", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders()
    },
    body: JSON.stringify({ text: input.value })
  });
  const d = await r.json();
  if (!r.ok) return toast(d.error || "Gagal menyimpan memori.");
  input.value = "";
  loadMemory();
  updateAccountStats();
  toast("Memori berhasil disimpan.");
});

// ======================================
// USER AUTHENTICATION & ACCOUNT UI
// ======================================

function showAuthFeedback(msg, type = "error") {
  if (!els.authFeedback) return;
  els.authFeedback.textContent = msg;
  els.authFeedback.className = `auth-feedback ${type}`;
  els.authFeedback.classList.remove("hidden");
}

function clearAuthFeedback() {
  if (!els.authFeedback) return;
  els.authFeedback.textContent = "";
  els.authFeedback.classList.add("hidden");
}

function setLoggedInUser(user) {
  currentUser = user;
  const initial = (user.avatar || user.name.charAt(0) || "U").toUpperCase();

  if (els.userInitial) els.userInitial.textContent = initial;
  if (els.userAvatar && user.avatarColor) {
    els.userAvatar.style.background = user.avatarColor;
  }

  if (els.popoverInitial) els.popoverInitial.textContent = initial;
  if (els.popoverAvatar && user.avatarColor) {
    els.popoverAvatar.style.background = user.avatarColor;
  }
  if (els.popoverUserName) els.popoverUserName.textContent = user.name;
  if (els.popoverUserEmail) els.popoverUserEmail.textContent = user.email || `@${user.username}`;

  if (els.loggedOutState) els.loggedOutState.classList.add("hidden");
  if (els.loggedInState) els.loggedInState.classList.remove("hidden");

  updateAccountStats();

  const greetingGradient = $(".gemini-gradient");
  if (greetingGradient) {
    greetingGradient.textContent = `Halo, ${user.name.split(" ")[0]}!`;
  }
}

function setLoggedOutUser() {
  currentUser = null;
  localStorage.removeItem(AUTH_TOKEN_KEY);

  if (els.userInitial) els.userInitial.textContent = "G";
  if (els.userAvatar) els.userAvatar.style.background = "";

  if (els.popoverInitial) els.popoverInitial.textContent = "G";
  if (els.popoverAvatar) els.popoverAvatar.style.background = "";
  if (els.popoverUserName) els.popoverUserName.textContent = "Tamu";
  if (els.popoverUserEmail) els.popoverUserEmail.textContent = "Belum masuk";

  if (els.loggedOutState) els.loggedOutState.classList.remove("hidden");
  if (els.loggedInState) els.loggedInState.classList.add("hidden");

  const greetingGradient = $(".gemini-gradient");
  if (greetingGradient) {
    greetingGradient.textContent = "Halo,";
  }
}

function updateAccountStats() {
  if (els.userChatCount) els.userChatCount.textContent = chats.length;
  fetch("/api/memory", { headers: getAuthHeaders() })
    .then(r => r.json())
    .then(d => {
      if (els.userMemoryCount && Array.isArray(d.items)) {
        els.userMemoryCount.textContent = d.items.length;
      }
    })
    .catch(() => {});
}

async function checkAuthStatus() {
  const token = localStorage.getItem(AUTH_TOKEN_KEY);
  if (!token) {
    setLoggedOutUser();
    return;
  }
  try {
    const res = await fetch("/api/auth/me", { headers: getAuthHeaders() });
    const data = await res.json();
    if (data.loggedIn && data.user) {
      setLoggedInUser(data.user);
      loadChatsFromCloud();
    } else {
      setLoggedOutUser();
    }
  } catch {
    setLoggedOutUser();
  }
}

// User Avatar Popover Toggle
if (els.userAvatarBtn && els.accountPopover) {
  els.userAvatarBtn.onclick = (e) => {
    e.stopPropagation();
    updateAccountStats();
    els.accountPopover.classList.toggle("hidden");
  };

  // Close popover when clicking anywhere outside
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".user-account-wrap")) {
      els.accountPopover.classList.add("hidden");
    }
  });
}

// Open Auth Modal
function openAuthModal(defaultTab = "loginTab") {
  if (els.accountPopover) els.accountPopover.classList.add("hidden");
  clearAuthFeedback();
  switchAuthTab(defaultTab);
  if (els.authModal) els.authModal.classList.remove("hidden");
}

function switchAuthTab(tabId) {
  clearAuthFeedback();
  $$(".auth-tab").forEach(tab => {
    tab.classList.toggle("active", tab.getAttribute("data-tab") === tabId);
  });
  if (tabId === "loginTab") {
    if (els.loginForm) els.loginForm.classList.add("active");
    if (els.registerForm) els.registerForm.classList.remove("active");
  } else {
    if (els.loginForm) els.loginForm.classList.remove("active");
    if (els.registerForm) els.registerForm.classList.add("active");
  }
}

$$(".auth-tab").forEach(tab => {
  tab.onclick = () => {
    switchAuthTab(tab.getAttribute("data-tab"));
  };
});

if (els.openLoginBtn) {
  els.openLoginBtn.onclick = () => openAuthModal("loginTab");
}

if (els.openRegisterBtn) {
  els.openRegisterBtn.onclick = () => openAuthModal("registerTab");
}

if (els.closeAuthModal) {
  els.closeAuthModal.onclick = () => els.authModal.classList.add("hidden");
}

if (els.authModal) {
  els.authModal.onclick = (e) => {
    if (e.target.id === "authModal") els.authModal.classList.add("hidden");
  };
}

// Password Visibility Toggle
if (els.toggleLoginPwd && els.loginPassword) {
  els.toggleLoginPwd.onclick = () => {
    const isPwd = els.loginPassword.type === "password";
    els.loginPassword.type = isPwd ? "text" : "password";
    const icon = els.toggleLoginPwd.querySelector(".material-symbols-rounded");
    if (icon) icon.textContent = isPwd ? "visibility_off" : "visibility";
  };
}

// One-Click Demo Login
if (els.oneClickDemoBtn) {
  els.oneClickDemoBtn.onclick = () => {
    if (els.loginIdentifier) els.loginIdentifier.value = "demo";
    if (els.loginPassword) els.loginPassword.value = "password123";
    if (els.loginForm) els.loginForm.requestSubmit();
  };
}

// Login Form Submit
if (els.loginForm) {
  els.loginForm.onsubmit = async (e) => {
    e.preventDefault();
    clearAuthFeedback();

    const identifier = els.loginIdentifier?.value.trim();
    const password = els.loginPassword?.value;

    if (!identifier || !password) {
      return showAuthFeedback("Masukkan username/email dan password.");
    }

    if (els.loginSubmitBtn) {
      els.loginSubmitBtn.disabled = true;
      els.loginSubmitBtn.innerHTML = '<span class="material-symbols-rounded">hourglass_top</span><span>Memverifikasi...</span>';
    }

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifier, password })
      });
      const data = await res.json();

      if (!res.ok) {
        showAuthFeedback(data.error || "Gagal masuk ke akun.");
        return;
      }

      localStorage.setItem(AUTH_TOKEN_KEY, data.token);
      setLoggedInUser(data.user);
      loadChatsFromCloud();
      loadMemory();

      showAuthFeedback(data.message || "Berhasil masuk!", "success");
      setTimeout(() => {
        if (els.authModal) els.authModal.classList.add("hidden");
        toast(`Selamat datang, ${data.user.name}!`);
      }, 700);

    } catch (err) {
      showAuthFeedback("Gagal terhubung ke server. Pastikan server aktif.");
    } finally {
      if (els.loginSubmitBtn) {
        els.loginSubmitBtn.disabled = false;
        els.loginSubmitBtn.innerHTML = '<span class="material-symbols-rounded">login</span><span>Masuk Sekarang</span>';
      }
    }
  };
}

// Register Form Submit
if (els.registerForm) {
  els.registerForm.onsubmit = async (e) => {
    e.preventDefault();
    clearAuthFeedback();

    const name = els.regName?.value.trim();
    const username = els.regUsername?.value.trim();
    const email = els.regEmail?.value.trim();
    const password = els.regPassword?.value;

    if (!name || !username || !email || !password) {
      return showAuthFeedback("Semua kolom pendaftaran wajib diisi.");
    }

    if (els.registerSubmitBtn) {
      els.registerSubmitBtn.disabled = true;
      els.registerSubmitBtn.innerHTML = '<span class="material-symbols-rounded">hourglass_top</span><span>Membuat Akun...</span>';
    }

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, username, email, password })
      });
      const data = await res.json();

      if (!res.ok) {
        showAuthFeedback(data.error || "Gagal mendaftarkan akun.");
        return;
      }

      localStorage.setItem(AUTH_TOKEN_KEY, data.token);
      setLoggedInUser(data.user);
      loadMemory();

      showAuthFeedback("Akun berhasil dibuat!", "success");
      setTimeout(() => {
        if (els.authModal) els.authModal.classList.add("hidden");
        toast(`Akun berhasil dibuat! Halo, ${data.user.name}.`);
      }, 700);

    } catch (err) {
      showAuthFeedback("Terjadi kesalahan jaringan.");
    } finally {
      if (els.registerSubmitBtn) {
        els.registerSubmitBtn.disabled = false;
        els.registerSubmitBtn.innerHTML = '<span class="material-symbols-rounded">person_add</span><span>Buat Akun Baru</span>';
      }
    }
  };
}

// Logout Action
if (els.logoutBtn) {
  els.logoutBtn.onclick = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: getAuthHeaders()
      });
    } catch {}
    setLoggedOutUser();
    if (els.accountPopover) els.accountPopover.classList.add("hidden");
    loadMemory();
    toast("Anda telah keluar dari akun.");
  };
}

// Manual Sync Button
if (els.accountSyncBtn) {
  els.accountSyncBtn.onclick = () => {
    syncChatsToCloud(true);
  };
}

// Initialize
if (localStorage.getItem("nova_dark") === "1") {
  applyTheme(true);
} else {
  applyTheme(false);
}

renderHistory();
if (!activeId && chats.length) activeId = chats[0].id;
renderMessages();
loadModels();
checkStatus();
checkAuthStatus();


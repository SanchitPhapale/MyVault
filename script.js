// ===============================
// STATE & HELPERS
// ===============================
const State = {
  view: "files",
  currentFolderId: "root",
  folderPath: [{ id: "root", name: "Home" }],
  files: [],
  folders: [],
  selectedIds: new Set(),
  viewMode: localStorage.getItem("mv-view") || "grid",
  sortBy: localStorage.getItem("mv-sort") || "name-asc",
  filter: "all",
  searchQuery: "",
  sessionExpiry: null,
  sessionTimer: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function formatDate(ts) {
  if (!ts) return "--";
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatTime(ts) {
  if (!ts) return "--";
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60000) return "just now";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
  if (diff < 604800000) return Math.floor(diff / 86400000) + "d ago";
  return formatDate(ts);
}

function fileCategory(ext) {
  const docs = [
    "doc",
    "docx",
    "txt",
    "rtf",
    "odt",
    "ppt",
    "pptx",
    "odp",
    "xls",
    "xlsx",
    "csv",
    "ods",
    "pdf",
  ];
  const imgs = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"];
  const vids = ["mp4", "webm", "mov", "mkv"];
  const auds = ["mp3", "wav", "m4a", "ogg"];
  const arcs = ["zip", "rar", "7z", "tar", "gz"];
  const code = [
    "html",
    "css",
    "js",
    "json",
    "xml",
    "c",
    "cpp",
    "java",
    "py",
    "sql",
    "md",
  ];
  if (imgs.includes(ext)) return "img";
  if (vids.includes(ext)) return "vid";
  if (auds.includes(ext)) return "aud";
  if (arcs.includes(ext)) return "arc";
  if (code.includes(ext)) return "code";
  if (docs.includes(ext)) return "doc";
  return "doc";
}

function fileIconClass(ext) {
  const cat = fileCategory(ext);
  return (
    "icon-" +
    (cat === "img"
      ? "img"
      : cat === "vid"
        ? "vid"
        : cat === "aud"
          ? "aud"
          : cat === "arc"
            ? "arc"
            : cat === "code"
              ? "code"
              : ext === "pdf"
                ? "pdf"
                : "doc")
  );
}

function fileIconLabel(ext) {
  return (ext || "file").toUpperCase().slice(0, 4);
}

function isImage(ext) {
  return ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"].includes(ext);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    credentials: "same-origin",
    ...opts,
  });
  if (res.status === 401) {
    showLogin();
    throw new Error("Session expired");
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ===============================
// AUTHENTICATION
// ===============================
async function checkSession() {
  try {
    const data = await api("/api/auth/session");
    if (data.ok) {
      State.sessionExpiry = data.expires;
      showApp();
      return true;
    }
  } catch {
    /* no session */
  }
  return false;
}

async function login(password) {
  const data = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
  State.sessionExpiry = data.expires;
  return data;
}

async function logout() {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } catch {}
  showLogin();
}

// ===============================
// SESSION
// ===============================
function startSessionTimer() {
  if (State.sessionTimer) clearInterval(State.sessionTimer);
  updateSessionDisplay();
  State.sessionTimer = setInterval(updateSessionDisplay, 1000);
}

function updateSessionDisplay() {
  if (!State.sessionExpiry) return;
  const remaining = State.sessionExpiry - Date.now();
  if (remaining <= 0) {
    logout();
    return;
  }
  const h = Math.floor(remaining / 3600000);
  const m = Math.floor((remaining % 3600000) / 60000);
  const s = Math.floor((remaining % 60000) / 1000);
  const text = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  const el = $("#sessionExpiry");
  if (el) el.textContent = `Session expires in ${text}`;
}

function showLogin() {
  $("#loginScreen").classList.remove("hidden");
  $("#app").classList.add("hidden");
  if (State.sessionTimer) {
    clearInterval(State.sessionTimer);
    State.sessionTimer = null;
  }
}

function showApp() {
  $("#loginScreen").classList.add("hidden");
  $("#app").classList.remove("hidden");
  startSessionTimer();
  loadView();
}

// ===============================
// FILE MANAGEMENT
// ===============================
async function loadFiles() {
  const data = await api(`/api/files?folderId=${State.currentFolderId}`);
  State.files = data;
  renderFiles();
}

async function loadFolders() {
  const data = await api(`/api/folders?parentId=${State.currentFolderId}`);
  State.folders = data;
  renderFiles();
}

async function deleteFile(id, permanent) {
  await api(`/api/files/${id}?permanent=${permanent}`, { method: "DELETE" });
  toast("File deleted", "success");
}

async function renameFile(id, name) {
  await api(`/api/files/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  toast("File renamed", "success");
}

async function moveFile(id, folderId) {
  await api(`/api/files/${id}/move`, {
    method: "POST",
    body: JSON.stringify({ folderId }),
  });
  toast("File moved", "success");
}

async function toggleFavorite(id) {
  await api(`/api/files/${id}/favorite`, { method: "POST" });
}

async function downloadFile(id) {
  window.location.href = `/api/files/${id}/download`;
}

// ===============================
// UPLOAD SYSTEM
// ===============================
const UploadQueue = {
  items: [],
  active: 0,
  maxConcurrent: 2,
  panelOpen: false,
};

function uploadFiles(fileList) {
  const files = Array.from(fileList);
  for (const file of files) {
    const item = {
      id: Math.random().toString(36).slice(2),
      file,
      name: file.name,
      progress: 0,
      status: "queued",
      xhr: null,
    };
    UploadQueue.items.push(item);
  }
  showUploadPanel();
  renderUploadList();
  processUploadQueue();
}

function showUploadPanel() {
  $("#uploadPanel").classList.remove("collapsed");
  UploadQueue.panelOpen = true;
}

function renderUploadList() {
  const list = $("#uploadList");
  const active = UploadQueue.items.filter((i) => i.status !== "done");
  if (
    active.length === 0 &&
    UploadQueue.items.every((i) => i.status === "done")
  ) {
    setTimeout(() => {
      if (
        UploadQueue.items.every(
          (i) => i.status === "done" || i.status === "error",
        )
      ) {
        $("#uploadPanel").classList.add("collapsed");
        UploadQueue.items = [];
      }
    }, 3000);
  }
  list.innerHTML = UploadQueue.items
    .map(
      (item) => `
    <div class="upload-item ${item.status === "done" ? "done" : item.status === "error" ? "error" : ""}" data-id="${item.id}">
      <div class="upload-item-name">${escapeHtml(item.name)}</div>
      <div class="upload-progress-bar"><div class="upload-progress-fill" style="width:${item.progress}%"></div></div>
      <div class="upload-progress-info">
        <span>${item.status === "done" ? "Complete" : item.status === "error" ? "Failed" : item.status === "queued" ? "Queued" : Math.round(item.progress) + "%"}</span>
        <span>${formatBytes(item.file.size)}</span>
      </div>
    </div>
  `,
    )
    .join("");
  $("#uploadPanelTitle").textContent =
    `Uploading ${UploadQueue.items.filter((i) => i.status === "uploading" || i.status === "queued").length} file(s)`;
}

function processUploadQueue() {
  const pending = UploadQueue.items.filter((i) => i.status === "queued");
  for (const item of pending) {
    if (UploadQueue.active >= UploadQueue.maxConcurrent) break;
    uploadSingle(item);
  }
}

function uploadSingle(item) {
  item.status = "uploading";
  UploadQueue.active++;
  renderUploadList();

  const formData = new FormData();
  formData.append("files", item.file);
  formData.append("folderId", State.currentFolderId);

  const xhr = new XMLHttpRequest();
  item.xhr = xhr;

  xhr.upload.addEventListener("progress", (e) => {
    if (e.lengthComputable) {
      item.progress = (e.loaded / e.total) * 100;
      renderUploadList();
    }
  });

  xhr.addEventListener("load", () => {
    UploadQueue.active--;
    if (xhr.status >= 200 && xhr.status < 300) {
      item.status = "done";
      item.progress = 100;
      toast(`${item.name} uploaded`, "success");
      if (State.view === "files" || State.view === "recent") loadFiles();
      loadStats();
    } else {
      item.status = "error";
      toast(`${item.name} upload failed`, "error");
    }
    renderUploadList();
    processUploadQueue();
  });

  xhr.addEventListener("error", () => {
    UploadQueue.active--;
    item.status = "error";
    renderUploadList();
    processUploadQueue();
    toast(`${item.name} upload failed`, "error");
  });

  xhr.open("POST", "/api/files/upload");
  xhr.withCredentials = true;
  xhr.send(formData);
}

function setupUpload() {
  const fileInput = $("#fileInput");
  $("#uploadBtn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length) uploadFiles(e.target.files);
    fileInput.value = "";
  });

  // Drag & drop
  let dragCounter = 0;
  document.addEventListener("dragenter", (e) => {
    if (e.dataTransfer.types.includes("Files")) {
      dragCounter++;
      $("#dropOverlay").classList.remove("hidden");
    }
  });
  document.addEventListener("dragleave", () => {
    dragCounter--;
    if (dragCounter <= 0) {
      dragCounter = 0;
      $("#dropOverlay").classList.add("hidden");
    }
  });
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    dragCounter = 0;
    $("#dropOverlay").classList.add("hidden");
    if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
  });

  $("#uploadPanelToggle").addEventListener("click", () => {
    $("#uploadPanel").classList.toggle("collapsed");
  });
}

// ===============================
// SEARCH
// ===============================
let searchDebounce;
function setupSearch() {
  $("#searchInput").addEventListener("input", (e) => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      State.searchQuery = e.target.value.trim();
      if (State.searchQuery) {
        doSearch();
      } else if (State.view === "search") {
        State.view = "files";
        loadView();
      }
    }, 250);
  });
}

async function doSearch() {
  const type = State.filter !== "all" ? State.filter : "all";
  const data = await api(
    `/api/search?q=${encodeURIComponent(State.searchQuery)}&type=${type}`,
  );
  State.files = data.files;
  State.folders = data.folders;
  State.view = "search";
  renderFiles();
}

// ===============================
// FOLDERS
// ===============================
async function createFolder(name) {
  await api("/api/folders", {
    method: "POST",
    body: JSON.stringify({ name, parentId: State.currentFolderId }),
  });
  toast("Folder created", "success");
  loadFolders();
  loadStats();
}

function openFolder(folderId, folderName) {
  State.currentFolderId = folderId;
  State.folderPath.push({ id: folderId, name: folderName });
  State.selectedIds.clear();
  loadView();
}

function navigateTo(index) {
  State.folderPath = State.folderPath.slice(0, index + 1);
  State.currentFolderId = State.folderPath[State.folderPath.length].id;
  State.selectedIds.clear();
  loadView();
}

async function deleteFolder(id, permanent) {
  await api(`/api/folders/${id}?permanent=${permanent}`, { method: "DELETE" });
  toast("Folder deleted", "success");
}

async function renameFolder(id, name) {
  await api(`/api/folders/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
  toast("Folder renamed", "success");
}

// ===============================
// FAVORITES
// ===============================
async function loadFavorites() {
  const data = await api("/api/favorites");
  State.files = data.files;
  State.folders = data.folders;
  renderFiles();
}

// ===============================
// TRASH
// ===============================
async function loadTrash() {
  const data = await api("/api/trash");
  State.files = data.files;
  State.folders = data.folders;
  renderFiles();
}

async function restoreItem(id) {
  await api(`/api/trash/${id}/restore`, { method: "POST" });
  toast("Item restored", "success");
  loadTrash();
}

async function permanentDelete(id) {
  await api(`/api/trash/${id}/permanent`, { method: "DELETE" });
  toast("Deleted permanently", "success");
  loadTrash();
  loadStats();
}

async function emptyTrash() {
  await api("/api/trash", { method: "DELETE" });
  toast("Trash emptied", "success");
  loadTrash();
  loadStats();
}

// ===============================
// SHARING
// ===============================
async function createShareLink(fileId, expiresInHours, password) {
  const data = await api("/api/share", {
    method: "POST",
    body: JSON.stringify({ fileId, expiresInHours, password }),
  });
  return data;
}

async function loadSharedLinks() {
  const data = await api("/api/share");
  renderSharedLinks(data);
}

async function revokeShare(token) {
  await api(`/api/share/${token}`, { method: "DELETE" });
  toast("Link revoked", "success");
  loadSharedLinks();
}

// ===============================
// FILE PREVIEW
// ===============================
async function previewFile(id) {
  const f =
    State.files.find((x) => x.id === id) || (await api(`/api/files/${id}`));
  let content = "";
  const cat = fileCategory(f.ext);

  if (isImage(f.ext)) {
    content = `<img src="/api/files/${f.id}/download" alt="${escapeHtml(f.name)}" />`;
  } else if (f.ext === "pdf") {
    content = `<iframe src="/api/files/${f.id}/download"></iframe>`;
  } else if (cat === "vid") {
    content = `<video controls autoplay src="/api/files/${f.id}/download"></video>`;
  } else if (cat === "aud") {
    content = `<audio controls autoplay src="/api/files/${f.id}/download"></audio>`;
  } else if (cat === "code" || ["txt", "rtf", "md"].includes(f.ext)) {
    try {
      const res = await fetch(`/api/files/${f.id}/download`, {
        credentials: "same-origin",
      });
      const text = await res.text();
      content = `<div class="preview-text">${escapeHtml(text)}</div>`;
    } catch {
      content =
        '<div class="preview-unsupported"><p>Preview unavailable</p></div>';
    }
  } else {
    content = `
      <div class="preview-unsupported">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <p style="margin-top:12px;font-size:16px;font-weight:600">Preview unavailable</p>
        <p style="margin-top:4px">Download to view this file</p>
        <button class="btn-primary" style="margin-top:16px" onclick="downloadFile('${f.id}')">Download</button>
      </div>`;
  }

  showModal({
    title: f.name,
    className: "preview-modal",
    body: `<div class="preview-container">${content}</div>`,
    footer: `<button class="btn-ghost" data-modal-close>Close</button><button class="btn-primary" onclick="downloadFile('${f.id}')">Download</button>`,
  });
}

// ===============================
// UI / MODALS
// ===============================
function showModal({ title, body, footer, className, onMount }) {
  const root = $("#modalRoot");
  const id = "modal-" + Date.now();
  root.innerHTML = `
    <div class="modal-backdrop" data-modal-id="${id}">
      <div class="modal ${className || ""}" onclick="event.stopPropagation()">
        <div class="modal-header">
          <div class="modal-title">${title || ""}</div>
          <button class="modal-close" data-modal-close>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal-body">${body || ""}</div>
        ${footer ? `<div class="modal-footer">${footer}</div>` : ""}
      </div>
    </div>`;
  root.querySelector(".modal-backdrop").addEventListener("click", closeModal);
  $$("[data-modal-close]").forEach((b) =>
    b.addEventListener("click", closeModal),
  );
  if (onMount) onMount(root);
}

function closeModal() {
  $("#modalRoot").innerHTML = "";
}

function showContextMenu(e, items) {
  e.preventDefault();
  closeContextMenu();
  const menu = document.createElement("div");
  menu.className = "context-menu";
  menu.id = "contextMenu";
  menu.style.left = Math.min(e.clientX, window.innerWidth - 220) + "px";
  menu.style.top =
    Math.min(e.clientY, window.innerHeight - items.length * 40) + "px";
  menu.innerHTML = items
    .map((item, i) => {
      if (item.separator) return '<div class="context-separator"></div>';
      return `<button class="context-item ${item.danger ? "danger" : ""}" data-ctx-action="${i}">
      ${item.icon || ""}
      <span>${item.label}</span>
    </button>`;
    })
    .join("");
  document.body.appendChild(menu);
  menu.querySelectorAll("[data-ctx-action]").forEach((btn) => {
    const idx = parseInt(btn.dataset.ctxAction, 10);
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      items[idx].action();
      closeContextMenu();
    });
  });
  setTimeout(
    () => document.addEventListener("click", closeContextMenu, { once: true }),
    0,
  );
}

function closeContextMenu() {
  const m = $("#contextMenu");
  if (m) m.remove();
}

function toast(message, type = "info") {
  const container = $("#toastContainer");
  const t = document.createElement("div");
  t.className = `toast ${type}`;
  const icon =
    type === "success"
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>'
      : type === "error"
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
        : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4f7cff" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
  t.innerHTML = `${icon}<span>${escapeHtml(message)}</span>`;
  container.appendChild(t);
  setTimeout(() => {
    t.classList.add("removing");
    setTimeout(() => t.remove(), 300);
  }, 3000);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str || "");
  return div.innerHTML;
}

function confirmModal({
  title,
  message,
  confirmText,
  confirmClass,
  onConfirm,
}) {
  showModal({
    title,
    body: `<p class="modal-text">${message}</p>`,
    footer: `
      <button class="btn-ghost" data-modal-close>Cancel</button>
      <button class="${confirmClass || "btn-primary"}" id="confirmModalBtn">${confirmText || "Confirm"}</button>`,
  });
  setTimeout(() => {
    const btn = $("#confirmModalBtn");
    if (btn)
      btn.addEventListener("click", () => {
        closeModal();
        onConfirm();
      });
  }, 0);
}

function promptModal({ title, label, value, confirmText, onConfirm }) {
  showModal({
    title,
    body: `<div class="modal-detail-label" style="margin-bottom:8px">${label}</div><input class="modal-input" id="promptInput" value="${escapeHtml(value || "")}" />`,
    footer: `<button class="btn-ghost" data-modal-close>Cancel</button><button class="btn-primary" id="promptModalBtn">${confirmText || "Save"}</button>`,
  });
  setTimeout(() => {
    const input = $("#promptInput");
    if (input) {
      input.focus();
      input.select();
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          closeModal();
          onConfirm(input.value);
        }
      });
    }
    const btn = $("#promptModalBtn");
    if (btn)
      btn.addEventListener("click", () => {
        const v = input.value.trim();
        if (v) {
          closeModal();
          onConfirm(v);
        }
      });
  }, 0);
}

// ===============================
// THEME
// ===============================
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("mv-theme", theme);
  $$(".theme-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.theme === theme),
  );
}

function setupTheme() {
  const saved = localStorage.getItem("mv-theme") || "dark";
  applyTheme(saved);
}

// ===============================
// RENDERING
// ===============================
async function loadView() {
  State.selectedIds.clear();
  updateSelectionBar();
  $$(".nav-item, .mnav-item").forEach((n) =>
    n.classList.toggle("active", n.dataset.view === State.view),
  );

  // Hide/show content header based on view
  const header = $("#contentHeader");
  const isFilesView = [
    "files",
    "search",
    "recent",
    "favorites",
    "trash",
  ].includes(State.view);
  header.style.display = isFilesView ? "" : "none";

  switch (State.view) {
    case "files":
      await Promise.all([loadFiles(), loadFolders()]);
      renderBreadcrumb();
      break;
    case "recent":
      const recent = await api("/api/files?recent=true");
      State.files = recent;
      State.folders = [];
      renderBreadcrumb("Recent");
      renderFiles();
      break;
    case "favorites":
      await loadFavorites();
      renderBreadcrumb("Favorites");
      break;
    case "trash":
      await loadTrash();
      renderBreadcrumb("Trash");
      break;
    case "shared":
      await loadSharedLinks();
      renderBreadcrumb("Shared Links");
      break;
    case "storage":
      await renderStorage();
      break;
    case "activity":
      await renderActivity();
      break;
    case "settings":
      renderSettings();
      break;
    case "search":
      if (State.searchQuery) doSearch();
      break;
    case "more":
      renderMore();
      break;
  }
  loadStats();
}

function renderBreadcrumb(label) {
  const bc = $("#breadcrumb");
  if (label) {
    bc.innerHTML = `<span class="breadcrumb-item current">${label}</span>`;
    return;
  }
  bc.innerHTML = State.folderPath
    .map((f, i) => {
      const isLast = i === State.folderPath.length - 1;
      return `<span class="breadcrumb-item ${isLast ? "current" : ""}" data-nav="${i}">${escapeHtml(f.name)}</span>${!isLast ? '<span class="breadcrumb-sep">/</span>' : ""}`;
    })
    .join("");
  bc.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", () =>
      navigateTo(parseInt(el.dataset.nav, 10)),
    );
  });
}

function getSortedItems() {
  let files = [...State.files];
  let folders = [...State.folders];

  // Filter
  if (State.filter !== "all" && State.view === "files") {
    const typeMap = {
      documents: [
        "doc",
        "docx",
        "txt",
        "rtf",
        "odt",
        "ppt",
        "pptx",
        "odp",
        "xls",
        "xlsx",
        "csv",
        "ods",
        "pdf",
      ],
      pdf: ["pdf"],
      images: ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp"],
      videos: ["mp4", "webm", "mov", "mkv"],
      audio: ["mp3", "wav", "m4a", "ogg"],
      archives: ["zip", "rar", "7z", "tar", "gz"],
    };
    if (typeMap[State.filter])
      files = files.filter((f) => typeMap[State.filter].includes(f.ext));
  }

  // Sort
  const sort = State.sortBy;
  const cmp =
    {
      "name-asc": (a, b) => a.name.localeCompare(b.name),
      "name-desc": (a, b) => b.name.localeCompare(a.name),
      newest: (a, b) => (b.createdAt || 0) - (a.createdAt || 0),
      oldest: (a, b) => (a.createdAt || 0) - (b.createdAt || 0),
      largest: (a, b) => (b.size || 0) - (a.size || 0),
      smallest: (a, b) => (a.size || 0) - (b.size || 0),
      type: (a, b) => (a.ext || "").localeCompare(b.ext || ""),
    }[sort] || cmp["name-asc"];

  files.sort(cmp);
  folders.sort((a, b) => a.name.localeCompare(b.name));
  return { files, folders };
}

function renderFiles() {
  const area = $("#fileArea");
  const { files, folders } = getSortedItems();
  const allItems = [...folders, ...files];

  if (allItems.length === 0) {
    area.innerHTML = renderEmptyState();
    return;
  }

  if (State.viewMode === "grid") {
    area.innerHTML = `<div class="file-grid">${allItems.map((item) => (item.parentId !== undefined ? renderFolderCard(item) : renderFileCard(item))).join("")}</div>`;
  } else {
    area.innerHTML = `
      <div class="file-list">
        <div class="file-row file-row-header">
          <span></span><span></span><span>Name</span><span class="col-size">Size</span><span class="col-type">Type</span><span class="col-modified">Modified</span><span></span>
        </div>
        ${allItems.map((item) => (item.parentId !== undefined ? renderFolderRow(item) : renderFileRow(item))).join("")}
      </div>`;
  }
  attachFileEvents();
}

function renderFileCard(f) {
  const selected = State.selectedIds.has(f.id) ? "selected" : "";
  const fav = f.favorite ? '<span class="file-card-fav">★</span>' : "";
  const thumb = isImage(f.ext)
    ? `<img class="file-card-thumb" src="/api/files/${f.id}/download" alt="${escapeHtml(f.name)}" loading="lazy" onerror="this.style.display='none'" />`
    : "";
  const icon = thumb
    ? ""
    : `<div class="file-card-icon ${fileIconClass(f.ext)}">${fileIconLabel(f.ext)}</div>`;
  return `
    <div class="file-card ${selected}" data-id="${f.id}" data-type="file">
      <input type="checkbox" class="file-card-checkbox" data-id="${f.id}" ${State.selectedIds.has(f.id) ? "checked" : ""} />
      ${fav}
      <button class="file-card-menu" data-menu="${f.id}" data-type="file">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
      </button>
      ${thumb || icon}
      <div class="file-card-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
      <div class="file-card-meta">${formatBytes(f.size)} · ${formatTime(f.updatedAt)}</div>
    </div>`;
}

function renderFolderCard(f) {
  const selected = State.selectedIds.has(f.id) ? "selected" : "";
  const fav = f.favorite ? '<span class="file-card-fav">★</span>' : "";
  return `
    <div class="file-card ${selected}" data-id="${f.id}" data-type="folder">
      <input type="checkbox" class="file-card-checkbox" data-id="${f.id}" ${State.selectedIds.has(f.id) ? "checked" : ""} />
      ${fav}
      <button class="file-card-menu" data-menu="${f.id}" data-type="folder">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
      </button>
      <div class="file-card-icon icon-folder">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-3H5a2 2 0 0 0-2 2z"/></svg>
      </div>
      <div class="file-card-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</div>
      <div class="file-card-meta">Folder · ${formatTime(f.updatedAt)}</div>
    </div>`;
}

function renderFileRow(f) {
  const selected = State.selectedIds.has(f.id) ? "selected" : "";
  const thumb = isImage(f.ext)
    ? `<img class="file-row-thumb" src="/api/files/${f.id}/download" loading="lazy" onerror="this.style.display='none'" />`
    : "";
  const icon = thumb
    ? ""
    : `<div class="file-row-icon ${fileIconClass(f.ext)}">${fileIconLabel(f.ext)}</div>`;
  return `
    <div class="file-row ${selected}" data-id="${f.id}" data-type="file">
      <input type="checkbox" class="file-row-checkbox" data-id="${f.id}" ${State.selectedIds.has(f.id) ? "checked" : ""} />
      ${thumb || icon}
      <span class="file-row-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
      <span class="file-row-meta col-size">${formatBytes(f.size)}</span>
      <span class="file-row-meta col-type">${(f.ext || "").toUpperCase()}</span>
      <span class="file-row-meta col-modified">${formatTime(f.updatedAt)}</span>
      <button class="file-row-menu" data-menu="${f.id}" data-type="file">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
      </button>
    </div>`;
}

function renderFolderRow(f) {
  const selected = State.selectedIds.has(f.id) ? "selected" : "";
  return `
    <div class="file-row ${selected}" data-id="${f.id}" data-type="folder">
      <input type="checkbox" class="file-row-checkbox" data-id="${f.id}" ${State.selectedIds.has(f.id) ? "checked" : ""} />
      <div class="file-row-icon icon-folder">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-3H5a2 2 0 0 0-2 2z"/></svg>
      </div>
      <span class="file-row-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
      <span class="file-row-meta col-size">--</span>
      <span class="file-row-meta col-type">Folder</span>
      <span class="file-row-meta col-modified">${formatTime(f.updatedAt)}</span>
      <button class="file-row-menu" data-menu="${f.id}" data-type="folder">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
      </button>
    </div>`;
}

function renderEmptyState() {
  if (State.view === "trash") {
    return `<div class="empty-state">
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
      <h3>Trash is empty</h3>
      <p>Deleted files will appear here.</p>
    </div>`;
  }
  if (State.view === "favorites") {
    return `<div class="empty-state">
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9 12 2"/></svg>
      <h3>No favorites yet</h3>
      <p>Star files to find them quickly here.</p>
    </div>`;
  }
  if (State.view === "shared") {
    return `<div class="empty-state">
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/></svg>
      <h3>No shared links</h3>
      <p>Create a share link from any file's menu.</p>
    </div>`;
  }
  if (State.view === "search") {
    return `<div class="empty-state">
      <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      <h3>No results found</h3>
      <p>Try a different search term.</p>
    </div>`;
  }
  return `<div class="empty-state">
    <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-3H5a2 2 0 0 0-2 2z"/></svg>
    <h3>No files yet</h3>
    <p>Upload your first file to start organizing your personal file space.</p>
    <button class="btn-primary" onclick="$('#fileInput').click()">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      Upload File
    </button>
  </div>`;
}

function attachFileEvents() {
  $$(".file-card, .file-row").forEach((el) => {
    const id = el.dataset.id;
    const type = el.dataset.type;

    el.addEventListener("click", (e) => {
      if (
        e.target.closest(".file-card-menu") ||
        e.target.closest(".file-row-menu") ||
        e.target.tagName === "INPUT"
      )
        return;
      if (type === "folder") {
        const folder = State.folders.find((f) => f.id === id);
        if (folder) openFolder(id, folder.name);
      } else {
        previewFile(id);
      }
    });

    el.addEventListener("contextmenu", (e) => {
      if (type === "file") showFileContextMenu(e, id);
      else showFolderContextMenu(e, id);
    });

    const checkbox = el.querySelector('input[type="checkbox"]');
    if (checkbox) {
      checkbox.addEventListener("click", (e) => e.stopPropagation());
      checkbox.addEventListener("change", () => toggleSelection(id));
    }
  });

  $$("[data-menu]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.menu;
      const type = btn.dataset.type;
      const rect = btn.getBoundingClientRect();
      const fakeEvent = {
        preventDefault: () => {},
        clientX: rect.left,
        clientY: rect.bottom,
      };
      if (type === "file") showFileContextMenu(fakeEvent, id);
      else showFolderContextMenu(fakeEvent, id);
    });
  });
}

function showFileContextMenu(e, id) {
  const f = State.files.find((x) => x.id === id);
  if (!f) return;
  const isTrash = State.view === "trash";
  showContextMenu(
    e,
    isTrash
      ? [
          {
            label: "Restore",
            icon: restoreIcon(),
            action: () => restoreItem(id),
          },
          {
            label: "Delete Permanently",
            icon: trashIcon(),
            danger: true,
            action: () =>
              confirmModal({
                title: "Permanent Delete",
                message: "This action cannot be undone.",
                confirmText: "Delete Permanently",
                confirmClass: "btn-danger",
                onConfirm: () => permanentDelete(id),
              }),
          },
        ]
      : [
          { label: "Open", icon: openIcon(), action: () => previewFile(id) },
          {
            label: "Preview",
            icon: previewIcon(),
            action: () => previewFile(id),
          },
          {
            label: "Download",
            icon: downloadIcon(),
            action: () => downloadFile(id),
          },
          {
            label: "Rename",
            icon: renameIcon(),
            action: () =>
              promptModal({
                title: "Rename File",
                label: "New name",
                value: f.name,
                confirmText: "Rename",
                onConfirm: async (name) => {
                  await renameFile(id, name);
                  loadFiles();
                },
              }),
          },
          {
            label: "Move",
            icon: moveIcon(),
            action: () => showMoveModal(id, "file"),
          },
          {
            label: "Add to Favorites",
            icon: favIcon(),
            action: async () => {
              await toggleFavorite(id);
              toast("Favorite updated", "success");
              loadFiles();
            },
          },
          {
            label: "Create Share Link",
            icon: shareIcon(),
            action: () => showShareModal(id),
          },
          { separator: true },
          {
            label: "File Details",
            icon: detailsIcon(),
            action: () => showFileDetails(f),
          },
          {
            label: "Delete",
            icon: trashIcon(),
            danger: true,
            action: () =>
              confirmModal({
                title: `Delete "${f.name}"?`,
                message: "This file will be moved to Trash.",
                confirmText: "Move to Trash",
                confirmClass: "btn-danger",
                onConfirm: async () => {
                  await deleteFile(id, false);
                  loadFiles();
                  loadStats();
                },
              }),
          },
        ],
  );
}

function showFolderContextMenu(e, id) {
  const f = State.folders.find((x) => x.id === id);
  if (!f) return;
  const isTrash = State.view === "trash";
  showContextMenu(
    e,
    isTrash
      ? [
          {
            label: "Restore",
            icon: restoreIcon(),
            action: () => restoreItem(id),
          },
          {
            label: "Delete Permanently",
            icon: trashIcon(),
            danger: true,
            action: () =>
              confirmModal({
                title: "Permanent Delete",
                message: "This action cannot be undone.",
                confirmText: "Delete Permanently",
                confirmClass: "btn-danger",
                onConfirm: () => permanentDelete(id),
              }),
          },
        ]
      : [
          {
            label: "Open",
            icon: openIcon(),
            action: () => openFolder(id, f.name),
          },
          {
            label: "Rename",
            icon: renameIcon(),
            action: () =>
              promptModal({
                title: "Rename Folder",
                label: "New name",
                value: f.name,
                confirmText: "Rename",
                onConfirm: async (name) => {
                  await renameFolder(id, name);
                  loadFolders();
                },
              }),
          },
          {
            label: "Move",
            icon: moveIcon(),
            action: () => showMoveModal(id, "folder"),
          },
          {
            label: "Favorite",
            icon: favIcon(),
            action: async () => {
              await api(`/api/folders/${id}/favorite`, { method: "POST" });
              toast("Favorite updated", "success");
              loadFolders();
            },
          },
          { separator: true },
          {
            label: "Details",
            icon: detailsIcon(),
            action: () => showFolderDetails(f),
          },
          {
            label: "Delete",
            icon: trashIcon(),
            danger: true,
            action: () =>
              confirmModal({
                title: `Delete "${f.name}"?`,
                message: "This folder will be moved to Trash.",
                confirmText: "Move to Trash",
                confirmClass: "btn-danger",
                onConfirm: async () => {
                  await deleteFolder(id, false);
                  loadFolders();
                  loadStats();
                },
              }),
          },
        ],
  );
}

// Context menu icons
const iconSvg = (paths) =>
  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
const openIcon = () => iconSvg('<path d="M15 3h6v6M21 3l-9 9"/>');
const previewIcon = () =>
  iconSvg(
    '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  );
const downloadIcon = () =>
  iconSvg(
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  );
const renameIcon = () =>
  iconSvg('<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>');
const moveIcon = () =>
  iconSvg(
    '<polyline points="5 9 2 12 5 15"/><polyline points="9 5 12 2 15 5"/><line x1="2" y1="12" x2="22" y2="12"/>',
  );
const favIcon = () =>
  iconSvg(
    '<polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9 12 2"/>',
  );
const shareIcon = () =>
  iconSvg(
    '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="8.6" y1="10.5" x2="15.4" y2="6.5"/>',
  );
const detailsIcon = () =>
  iconSvg(
    '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  );
const trashIcon = () =>
  iconSvg(
    '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/>',
  );
const restoreIcon = () =>
  iconSvg(
    '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
  );

function showFileDetails(f) {
  showModal({
    title: "File Details",
    body: `
      <div style="margin-bottom:16px;display:flex;align-items:center;gap:12px">
        <div class="file-card-icon ${fileIconClass(f.ext)}" style="margin:0">${fileIconLabel(f.ext)}</div>
        <div><strong>${escapeHtml(f.name)}</strong><div style="font-size:12px;color:var(--text-dim)">${(f.ext || "").toUpperCase()} file</div></div>
      </div>
      <div class="modal-detail-grid">
        <div class="modal-detail-item"><div class="modal-detail-label">File Name</div><div class="modal-detail-value">${escapeHtml(f.name)}</div></div>
        <div class="modal-detail-item"><div class="modal-detail-label">Type</div><div class="modal-detail-value">${(f.ext || "").toUpperCase()}</div></div>
        <div class="modal-detail-item"><div class="modal-detail-label">Size</div><div class="modal-detail-value">${formatBytes(f.size)}</div></div>
        <div class="modal-detail-item"><div class="modal-detail-label">MIME</div><div class="modal-detail-value">${escapeHtml(f.mime || "--")}</div></div>
        <div class="modal-detail-item"><div class="modal-detail-label">Created</div><div class="modal-detail-value">${formatDate(f.createdAt)}</div></div>
        <div class="modal-detail-item"><div class="modal-detail-label">Modified</div><div class="modal-detail-value">${formatDate(f.updatedAt)}</div></div>
        <div class="modal-detail-item"><div class="modal-detail-label">Extension</div><div class="modal-detail-value">.${f.ext || ""}</div></div>
        <div class="modal-detail-item"><div class="modal-detail-label">Uploaded</div><div class="modal-detail-value">${formatDate(f.createdAt)}</div></div>
      </div>`,
    footer: `<button class="btn-ghost" data-modal-close>Close</button>`,
  });
}

function showFolderDetails(f) {
  showModal({
    title: "Folder Details",
    body: `
      <div class="modal-detail-grid">
        <div class="modal-detail-item"><div class="modal-detail-label">Name</div><div class="modal-detail-value">${escapeHtml(f.name)}</div></div>
        <div class="modal-detail-item"><div class="modal-detail-label">Type</div><div class="modal-detail-value">Folder</div></div>
        <div class="modal-detail-item"><div class="modal-detail-label">Created</div><div class="modal-detail-value">${formatDate(f.createdAt)}</div></div>
        <div class="modal-detail-item"><div class="modal-detail-label">Modified</div><div class="modal-detail-value">${formatDate(f.updatedAt)}</div></div>
      </div>`,
    footer: `<button class="btn-ghost" data-modal-close>Close</button>`,
  });
}

function showMoveModal(id, type) {
  showModal({
    title: "Move to folder",
    body: `<div id="moveTree" class="modal-text">Loading folders...</div>`,
    footer: `<button class="btn-ghost" data-modal-close>Cancel</button>`,
  });
  api("/api/folders?parentId=root").then((rootFolders) => {
    const tree = $("#moveTree");
    tree.innerHTML = `<div style="display:flex;flex-direction:column;gap:4px">
      <button class="dropdown-item" data-move="root">Home</button>
      ${rootFolders.map((f) => `<button class="dropdown-item" data-move="${f.id}">📁 ${escapeHtml(f.name)}</button>`).join("")}
    </div>`;
    tree.querySelectorAll("[data-move]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const folderId = btn.dataset.move;
        if (type === "file") await moveFile(id, folderId);
        else
          await api(`/api/folders/${id}`, {
            method: "PATCH",
            body: JSON.stringify({ parentId: folderId }),
          });
        closeModal();
        loadView();
      });
    });
  });
}

function showShareModal(fileId) {
  showModal({
    title: "Create Share Link",
    body: `
      <div style="display:flex;flex-direction:column;gap:14px">
        <div>
          <div class="modal-detail-label" style="margin-bottom:6px">Expiration</div>
          <select class="sort-select" id="shareExpiry" style="width:100%">
            <option value="1">1 hour</option>
            <option value="6">6 hours</option>
            <option value="24" selected>24 hours</option>
            <option value="168">7 days</option>
          </select>
        </div>
        <div>
          <div class="modal-detail-label" style="margin-bottom:6px">Password (optional)</div>
          <input class="modal-input" id="sharePassword" type="text" placeholder="No password" />
        </div>
      </div>`,
    footer: `<button class="btn-ghost" data-modal-close>Cancel</button><button class="btn-primary" id="createShareBtn">Create Link</button>`,
  });
  setTimeout(() => {
    $("#createShareBtn").addEventListener("click", async () => {
      const hours = $("#shareExpiry").value;
      const password = $("#sharePassword").value.trim() || undefined;
      const link = await createShareLink(fileId, hours, password);
      const url = `${window.location.origin}/api/share/${link.token}/download`;
      closeModal();
      showModal({
        title: "Share Link Created",
        body: `<p class="modal-text" style="margin-bottom:12px">Your link is ready:</p>
          <input class="modal-input" value="${url}" readonly id="shareUrl" />
          <p class="modal-text" style="margin-top:10px;font-size:12px">Expires in ${hours}h${password ? " · Password protected" : ""}</p>`,
        footer: `<button class="btn-ghost" data-modal-close>Close</button><button class="btn-primary" id="copyShareBtn">Copy Link</button>`,
      });
      setTimeout(() => {
        $("#copyShareBtn").addEventListener("click", () => {
          const input = $("#shareUrl");
          input.select();
          navigator.clipboard.writeText(input.value).then(() => {
            toast("Link copied", "success");
            closeModal();
          });
        });
      }, 0);
    });
  }, 0);
}

function renderSharedLinks(links) {
  const area = $("#fileArea");
  if (!links.length) {
    area.innerHTML = renderEmptyState();
    return;
  }
  area.innerHTML = links
    .map(
      (link) => `
    <div class="share-link-item">
      <div class="share-link-info">
        <div class="share-link-name">${escapeHtml(link.fileName)}</div>
        <div class="share-link-expiry">Expires ${formatTime(link.expires)}${link.password ? " · Password protected" : ""}</div>
      </div>
      <div class="share-link-actions">
        <button class="sel-btn" data-copy="${link.token}">Copy</button>
        <button class="sel-btn" data-revoke="${link.token}">Revoke</button>
      </div>
    </div>
  `,
    )
    .join("");
  area.querySelectorAll("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigator.clipboard
        .writeText(
          `${window.location.origin}/api/share/${btn.dataset.copy}/download`,
        )
        .then(() => toast("Link copied", "success"));
    });
  });
  area.querySelectorAll("[data-revoke]").forEach((btn) => {
    btn.addEventListener("click", () => revokeShare(btn.dataset.revoke));
  });
}

async function renderStorage() {
  const data = await api("/api/storage");
  const area = $("#fileArea");
  const pct =
    data.limit > 0 ? Math.min(100, (data.used / data.limit) * 100) : 0;
  const cats = [
    { key: "documents", label: "Documents", color: "#4f7cff" },
    { key: "images", label: "Images", color: "#34d399" },
    { key: "videos", label: "Videos", color: "#fbbf24" },
    { key: "audio", label: "Audio", color: "#a855f7" },
    { key: "archives", label: "Archives", color: "#94a3b8" },
    { key: "other", label: "Other", color: "#2dd4bf" },
  ];
  area.innerHTML = `
    <div class="settings-section">
      <h3>Storage Used</h3>
      <div style="font-size:28px;font-weight:700;margin-bottom:8px">${formatBytes(data.used)} / ${formatBytes(data.limit)}</div>
      <div class="storage-bar">
        ${cats
          .map((c) => {
            const val = data.breakdown[c.key] || 0;
            const w = data.limit > 0 ? (val / data.limit) * 100 : 0;
            return w > 0
              ? `<div class="storage-segment ${c.key}" style="width:${w}%" title="${c.label}: ${formatBytes(val)}"></div>`
              : "";
          })
          .join("")}
      </div>
      <div class="storage-legend">
        ${cats.map((c) => `<div class="storage-legend-item"><div class="storage-legend-dot" style="background:${c.color}"></div>${c.label}: ${formatBytes(data.breakdown[c.key] || 0)}</div>`).join("")}
      </div>
    </div>`;
}

async function renderActivity() {
  const data = await api("/api/activity");
  const area = $("#fileArea");
  if (!data.length) {
    area.innerHTML = `<div class="empty-state"><h3>No activity yet</h3><p>Your recent actions will appear here.</p></div>`;
    return;
  }
  area.innerHTML = `<div class="activity-list">${data
    .map(
      (a) => `
    <div class="activity-item">
      <div class="activity-icon">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
      </div>
      <div class="activity-text">You <strong>${escapeHtml(a.action)}</strong>: ${escapeHtml(a.name)}</div>
      <div class="activity-time">${formatTime(a.ts)}</div>
    </div>
  `,
    )
    .join("")}</div>`;
}

function renderSettings() {
  const area = $("#fileArea");
  const theme = localStorage.getItem("mv-theme") || "dark";
  area.innerHTML = `
    <div class="settings-section">
      <h3>Appearance</h3>
      <div class="settings-row">
        <div>
          <div class="settings-row-label">Theme</div>
          <div class="settings-row-desc">Choose your preferred color scheme</div>
        </div>
        <div class="theme-options">
          <button class="theme-btn ${theme === "dark" ? "active" : ""}" data-theme="dark">Dark</button>
          <button class="theme-btn ${theme === "light" ? "active" : ""}" data-theme="light">Light</button>
          <button class="theme-btn ${theme === "system" ? "active" : ""}" data-theme="system">System</button>
        </div>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-row-label">Default View</div>
          <div class="settings-row-desc">Grid or list layout</div>
        </div>
        <div class="theme-options">
          <button class="theme-btn ${State.viewMode === "grid" ? "active" : ""}" data-view-mode="grid">Grid</button>
          <button class="theme-btn ${State.viewMode === "list" ? "active" : ""}" data-view-mode="list">List</button>
        </div>
      </div>
      <div class="settings-row">
        <div>
          <div class="settings-row-label">Default Sort</div>
        </div>
        <select class="sort-select" id="defaultSort">
          <option value="name-asc">Name A-Z</option>
          <option value="name-desc">Name Z-A</option>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="largest">Largest</option>
          <option value="smallest">Smallest</option>
          <option value="type">File type</option>
        </select>
      </div>
    </div>
    <div class="settings-section">
      <h3>Security</h3>
      <div class="settings-row">
        <div><div class="settings-row-label">Session</div><div class="settings-row-desc">24-hour secure session</div></div>
        <button class="btn-ghost" id="settingsLogout">Logout</button>
      </div>
    </div>
    <div class="settings-section">
      <h3>About</h3>
      <div class="settings-row">
        <div><div class="settings-row-label">MyVault</div><div class="settings-row-desc">Your Personal File Space</div></div>
      </div>
      <div class="settings-row">
        <div><div class="settings-row-label">Version</div><div class="settings-row-desc">1.0.0</div></div>
      </div>
      <div class="settings-row">
        <div><div class="settings-row-label">Developer</div><div class="settings-row-desc">Made with ❤️ by <a href="https://sanchitbuilds.com" target="_blank" rel="noopener noreferrer">sanchitbuilds.com</a></div></div>
      </div>
    </div>`;
  $("#defaultSort").value = State.sortBy;
  area.querySelectorAll("[data-theme]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.dataset.theme;
      if (t === "system") {
        const prefersDark = window.matchMedia(
          "(prefers-color-scheme: dark)",
        ).matches;
        applyTheme(prefersDark ? "dark" : "light");
        localStorage.setItem("mv-theme", "system");
      } else {
        applyTheme(t);
      }
    });
  });
  area.querySelectorAll("[data-view-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      State.viewMode = btn.dataset.viewMode;
      localStorage.setItem("mv-view", State.viewMode);
      $$("#gridViewBtn, #listViewBtn").forEach((b) =>
        b.classList.remove("active"),
      );
      (State.viewMode === "grid"
        ? $("#gridViewBtn")
        : $("#listViewBtn")
      ).classList.add("active");
      renderFiles();
      renderSettings();
    });
  });
  $("#defaultSort").addEventListener("change", (e) => {
    State.sortBy = e.target.value;
    localStorage.setItem("mv-sort", State.sortBy);
    $("#sortSelect").value = State.sortBy;
    renderFiles();
  });
  $("#settingsLogout").addEventListener("click", logout);
}

function renderMore() {
  const area = $("#fileArea");
  area.innerHTML = `
    <div class="settings-section">
      <h3>Quick Actions</h3>
      <div class="settings-row"><div class="settings-row-label">Upload Files</div><button class="btn-primary" onclick="$('#fileInput').click()">Upload</button></div>
      <div class="settings-row"><div class="settings-row-label">New Folder</div><button class="btn-primary" id="moreNewFolder">New Folder</button></div>
    </div>
    <div class="settings-section">
      <h3>Navigation</h3>
      <div class="settings-row"><div class="settings-row-label">Storage</div><button class="btn-ghost" data-goto="storage">View</button></div>
      <div class="settings-row"><div class="settings-row-label">Activity</div><button class="btn-ghost" data-goto="activity">View</button></div>
      <div class="settings-row"><div class="settings-row-label">Shared Links</div><button class="btn-ghost" data-goto="shared">View</button></div>
      <div class="settings-row"><div class="settings-row-label">Trash</div><button class="btn-ghost" data-goto="trash">View</button></div>
      <div class="settings-row"><div class="settings-row-label">Settings</div><button class="btn-ghost" data-goto="settings">View</button></div>
    </div>`;
  $("#moreNewFolder").addEventListener("click", () => {
    promptModal({
      title: "New Folder",
      label: "Folder name",
      value: "New Folder",
      confirmText: "Create",
      onConfirm: (name) => createFolder(name),
    });
  });
  area.querySelectorAll("[data-goto]").forEach((btn) => {
    btn.addEventListener("click", () => {
      State.view = btn.dataset.goto;
      loadView();
    });
  });
}

async function loadStats() {
  try {
    const data = await api("/api/stats");
    const bar = $("#statsBar");
    bar.innerHTML = `
      <div class="stat-card">
        <div class="stat-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
        <div class="stat-label">Files</div><div class="stat-value">${data.files}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 7v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-6l-2-3H5a2 2 0 0 0-2 2z"/></svg></div>
        <div class="stat-label">Folders</div><div class="stat-value">${data.folders}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="12 2 15 9 22 9 17 14 19 21 12 17 5 21 7 14 2 9 9 9 12 2"/></svg></div>
        <div class="stat-label">Favorites</div><div class="stat-value">${data.favorites}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/></svg></div>
        <div class="stat-label">Storage</div><div class="stat-value">${formatBytes(data.storage)}</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg></div>
        <div class="stat-label">Recent</div><div class="stat-value">${data.recent}</div>
      </div>`;
  } catch {}
}

// ===============================
// SELECTION
// ===============================
function toggleSelection(id) {
  if (State.selectedIds.has(id)) State.selectedIds.delete(id);
  else State.selectedIds.add(id);
  updateSelectionBar();
  renderFiles();
}

function updateSelectionBar() {
  const bar = $("#selectionBar");
  if (State.selectedIds.size > 0) {
    bar.classList.remove("hidden");
    $("#selectionCount").textContent = `${State.selectedIds.size} selected`;
  } else {
    bar.classList.add("hidden");
  }
}

async function bulkAction(action) {
  const ids = Array.from(State.selectedIds);
  if (action === "download") {
    const res = await fetch("/api/files/bulk-download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ ids }),
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "myvault-download.zip";
    a.click();
    URL.revokeObjectURL(url);
    toast("Download started", "success");
  } else if (action === "delete") {
    confirmModal({
      title: `Delete ${ids.length} items?`,
      message: "These items will be moved to Trash.",
      confirmText: "Move to Trash",
      confirmClass: "btn-danger",
      onConfirm: async () => {
        await api("/api/files/bulk", {
          method: "POST",
          body: JSON.stringify({ ids, action: "trash" }),
        });
        State.selectedIds.clear();
        toast("Items deleted", "success");
        loadView();
      },
    });
  } else if (action === "favorite") {
    await api("/api/files/bulk", {
      method: "POST",
      body: JSON.stringify({ ids, action: "favorite" }),
    });
    toast("Favorites updated", "success");
    loadView();
  } else if (action === "move") {
    const firstId = ids[0];
    showMoveModal(firstId, "file");
  } else if (action === "clear") {
    State.selectedIds.clear();
    updateSelectionBar();
    renderFiles();
  }
}

// ===============================
// MOBILE
// ===============================
function setupMobile() {
  $("#menuToggle").addEventListener("click", () => {
    $("#sidebar").classList.add("open");
    $("#sidebarOverlay").classList.add("show");
  });
  $("#sidebarOverlay").addEventListener("click", () => {
    $("#sidebar").classList.remove("open");
    $("#sidebarOverlay").classList.remove("show");
  });
  $$(".mnav-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.view;
      if (view === "search") {
        $("#searchInput").focus();
      } else {
        State.view = view;
        State.currentFolderId = "root";
        State.folderPath = [{ id: "root", name: "Home" }];
        loadView();
      }
      $$(".mnav-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
    });
  });
}

// ===============================
// KEYBOARD SHORTCUTS
// ===============================
function setupKeyboard() {
  document.addEventListener("keydown", (e) => {
    if (
      e.target.tagName === "INPUT" ||
      e.target.tagName === "TEXTAREA" ||
      e.target.tagName === "SELECT"
    ) {
      if (e.key === "Escape") e.target.blur();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "k") {
      e.preventDefault();
      $("#searchInput").focus();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "u") {
      e.preventDefault();
      $("#fileInput").click();
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "N") {
      e.preventDefault();
      promptModal({
        title: "New Folder",
        label: "Folder name",
        value: "New Folder",
        confirmText: "Create",
        onConfirm: (name) => createFolder(name),
      });
    }
    if (e.key === "Delete" && State.selectedIds.size > 0) {
      bulkAction("delete");
    }
    if (e.key === "Escape") {
      closeModal();
      closeContextMenu();
    }
  });
}

// ===============================
// NAVIGATION SETUP
// ===============================
function setupNav() {
  $$(".nav-item[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      State.view = btn.dataset.view;
      State.currentFolderId = "root";
      State.folderPath = [{ id: "root", name: "Home" }];
      $("#sidebar").classList.remove("open");
      $("#sidebarOverlay").classList.remove("show");
      loadView();
    });
  });

  $("#logoutBtn").addEventListener("click", logout);
  $("#userMenuLogout").addEventListener("click", logout);
  $("#userMenuBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    $("#userMenuDropdown").classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#userMenu"))
      $("#userMenuDropdown").classList.add("hidden");
  });

  $("#sessionIndicator").addEventListener("click", () => {
    State.view = "settings";
    loadView();
  });

  $("#newFolderBtn").addEventListener("click", () => {
    promptModal({
      title: "New Folder",
      label: "Folder name",
      value: "New Folder",
      confirmText: "Create",
      onConfirm: (name) => createFolder(name),
    });
  });

  // View toggle
  $("#gridViewBtn").addEventListener("click", () => {
    State.viewMode = "grid";
    localStorage.setItem("mv-view", "grid");
    $("#gridViewBtn").classList.add("active");
    $("#listViewBtn").classList.remove("active");
    renderFiles();
  });
  $("#listViewBtn").addEventListener("click", () => {
    State.viewMode = "list";
    localStorage.setItem("mv-view", "list");
    $("#listViewBtn").classList.add("active");
    $("#gridViewBtn").classList.remove("active");
    renderFiles();
  });

  // Sort
  $("#sortSelect").value = State.sortBy;
  $("#sortSelect").addEventListener("change", (e) => {
    State.sortBy = e.target.value;
    localStorage.setItem("mv-sort", State.sortBy);
    renderFiles();
  });

  // Filters
  $$(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      State.filter = btn.dataset.filter;
      renderFiles();
    });
  });

  // Selection bar
  $$(".sel-btn").forEach((btn) => {
    btn.addEventListener("click", () => bulkAction(btn.dataset.selAction));
  });
}

// ===============================
// INIT
// ===============================
async function init() {
  setupTheme();
  setupUpload();
  setupSearch();
  setupMobile();
  setupKeyboard();
  setupNav();

  // Set view mode buttons
  if (State.viewMode === "list") {
    $("#gridViewBtn").classList.remove("active");
    $("#listViewBtn").classList.add("active");
  }

  // Login form
  $("#loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#loginBtn");
    const err = $("#loginError");
    const password = $("#passwordInput").value;
    btn.classList.add("loading");
    err.hidden = true;
    try {
      await login(password);
      showApp();
    } catch (ex) {
      err.hidden = false;
      $("#passwordInput").select();
    } finally {
      btn.classList.remove("loading");
    }
  });

  $("#togglePassword").addEventListener("click", () => {
    const input = $("#passwordInput");
    input.type = input.type === "password" ? "text" : "password";
  });

  // Check existing session
  const hasSession = await checkSession();
  if (!hasSession) showLogin();
}

document.addEventListener("DOMContentLoaded", init);

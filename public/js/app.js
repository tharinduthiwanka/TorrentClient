// ==========================================
// TorrentFlow — High-Speed Client Application
// ==========================================

const socket = io();
const torrents = new Map();

// File Explorer state
let systemDefaultPath = '';
let currentExplorerPath = '';
let currentParentPath = null;
let selectedSavePath = '';

// Pending download state
let pendingTorrent = null; // { type: 'magnet'|'file', magnetURI, tempFileName, ... }

// DOM Elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const magnetInput = document.getElementById('magnetInput');
const addMagnetBtn = document.getElementById('addMagnetBtn');
const torrentList = document.getElementById('torrentList');
const emptyState = document.getElementById('emptyState');
const torrentCount = document.getElementById('torrentCount');
const globalDown = document.getElementById('globalDown');
const globalUp = document.getElementById('globalUp');
const activeTorrents = document.getElementById('activeTorrents');
const toastContainer = document.getElementById('toastContainer');

// Folder Picker Modal Elements
const saveLocationModal = document.getElementById('saveLocationModal');
const modalTorrentName = document.getElementById('modalTorrentName');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const modalCancelBtn = document.getElementById('modalCancelBtn');
const modalConfirmBtn = document.getElementById('modalConfirmBtn');
const navUpBtn = document.getElementById('navUpBtn');
const navNewFolderBtn = document.getElementById('navNewFolderBtn');
const newFolderBar = document.getElementById('newFolderBar');
const newFolderNameInput = document.getElementById('newFolderNameInput');
const newFolderCreateBtn = document.getElementById('newFolderCreateBtn');
const newFolderCancelBtn = document.getElementById('newFolderCancelBtn');
const explorerBreadcrumbs = document.getElementById('explorerBreadcrumbs');
const sidebarPlaces = document.getElementById('sidebarPlaces');
const sidebarDrives = document.getElementById('sidebarDrives');
const folderItemsGrid = document.getElementById('folderItemsGrid');
const explorerEmpty = document.getElementById('explorerEmpty');
const activeSelectedPathDisplay = document.getElementById('activeSelectedPathDisplay');

// Initialize Places & Drives
fetch('/api/fs/places')
  .then(res => res.json())
  .then(data => {
    if (data.defaultPath) {
      systemDefaultPath = data.defaultPath;
    }
    renderSidebarPlaces(data.places || [], data.drives || []);
  })
  .catch(() => { });



// ==========================================
// In-App PC Folder Browser Logic
// ==========================================

function renderSidebarPlaces(places, drives) {
  sidebarPlaces.innerHTML = '';
  places.forEach(p => {
    const item = document.createElement('div');
    item.className = 'sidebar-item';
    item.dataset.path = p.path;
    item.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      <span>${escapeHtml(p.name)}</span>
    `;
    item.addEventListener('click', () => navigateToFolder(p.path));
    sidebarPlaces.appendChild(item);
  });

  sidebarDrives.innerHTML = '';
  drives.forEach(d => {
    const item = document.createElement('div');
    item.className = 'sidebar-item drive-item';
    item.dataset.path = d;
    item.innerHTML = `
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="12" x2="17" y2="12"/><line x1="17" y1="8" x2="17" y2="8"/></svg>
      <span>Local Disk (${escapeHtml(d)})</span>
    `;
    item.addEventListener('click', () => navigateToFolder(d));
    sidebarDrives.appendChild(item);
  });
}

function navigateToFolder(targetPath) {
  folderItemsGrid.innerHTML = '<div class="explorer-loading">Scanning folder...</div>';
  explorerEmpty.style.display = 'none';

  fetch('/api/fs/list', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetPath })
  })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        showToast(data.error, 'error');
        return;
      }

      currentExplorerPath = data.currentPath;
      currentParentPath = data.parentPath;
      selectedSavePath = data.currentPath;

      // Update path display
      activeSelectedPathDisplay.textContent = selectedSavePath;
      activeSelectedPathDisplay.title = selectedSavePath;

      // Update Up button state
      navUpBtn.disabled = !data.parentPath;
      navUpBtn.classList.toggle('disabled', !data.parentPath);

      // Render Breadcrumbs
      renderBreadcrumbs(data.currentPath);

      // Highlight active sidebar item
      document.querySelectorAll('.sidebar-item').forEach(el => {
        el.classList.toggle('active', el.dataset.path?.toLowerCase() === data.currentPath.toLowerCase());
      });

      // Render Folder Items
      renderFolderGrid(data.folders || []);
    })
    .catch(err => {
      showToast('Cannot access folder: ' + err.message, 'error');
    });
}

function renderBreadcrumbs(fullPath) {
  explorerBreadcrumbs.innerHTML = '';

  // Parse path into segments
  const parts = fullPath.split('\\').filter(Boolean);
  let accum = '';

  parts.forEach((part, index) => {
    if (index === 0) {
      accum = part + '\\';
    } else {
      accum = accum + (accum.endsWith('\\') ? '' : '\\') + part;
    }

    const currentSegmentPath = accum;
    const isLast = index === parts.length - 1;

    const segment = document.createElement('button');
    segment.className = `breadcrumb-segment ${isLast ? 'active' : ''}`;
    segment.textContent = part;
    segment.title = currentSegmentPath;

    if (!isLast) {
      segment.addEventListener('click', () => navigateToFolder(currentSegmentPath));
    }

    explorerBreadcrumbs.appendChild(segment);

    if (!isLast) {
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = '›';
      explorerBreadcrumbs.appendChild(sep);
    }
  });

  // Auto-scroll breadcrumbs to the right
  explorerBreadcrumbs.scrollLeft = explorerBreadcrumbs.scrollWidth;
}

function renderFolderGrid(folders) {
  folderItemsGrid.innerHTML = '';

  if (folders.length === 0) {
    explorerEmpty.style.display = 'flex';
    return;
  }

  explorerEmpty.style.display = 'none';

  folders.forEach(f => {
    const card = document.createElement('div');
    card.className = 'folder-grid-item';
    card.title = f.name;
    card.innerHTML = `
      <div class="folder-grid-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
      </div>
      <span class="folder-grid-name">${escapeHtml(f.name)}</span>
    `;

    // Click: select & navigate into folder
    card.addEventListener('click', () => {
      navigateToFolder(f.fullPath);
    });

    folderItemsGrid.appendChild(card);
  });
}

// Nav Up Button
navUpBtn.addEventListener('click', () => {
  if (currentParentPath) {
    navigateToFolder(currentParentPath);
  }
});

// In-App New Folder Creation UI
navNewFolderBtn.addEventListener('click', () => {
  const isHidden = newFolderBar.style.display === 'none';
  if (isHidden) {
    newFolderBar.style.display = 'flex';
    newFolderNameInput.value = '';
    newFolderNameInput.focus();
  } else {
    newFolderBar.style.display = 'none';
  }
});

newFolderCancelBtn.addEventListener('click', () => {
  newFolderBar.style.display = 'none';
});

function submitNewFolder() {
  const folderName = newFolderNameInput.value.trim();
  if (!folderName) {
    showToast('Please enter a folder name', 'error');
    newFolderNameInput.focus();
    return;
  }

  fetch('/api/fs/create-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentPath: currentExplorerPath, folderName })
  })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        showToast(data.error, 'error');
      } else {
        showToast(`Created folder "${folderName}"`, 'success');
        newFolderBar.style.display = 'none';
        navigateToFolder(data.createdPath);
      }
    })
    .catch(err => showToast('Failed to create folder: ' + err.message, 'error'));
}

newFolderCreateBtn.addEventListener('click', submitNewFolder);
newFolderNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitNewFolder();
  if (e.key === 'Escape') newFolderBar.style.display = 'none';
});

// ==========================================
// Modal Open & Confirm Handlers
// ==========================================
function openSaveModal(info) {
  pendingTorrent = info;
  modalTorrentName.textContent = info.name || 'Torrent Download';

  // Always default to the OS Downloads directory (Windows: C:\Users\<user>\Downloads, Mac: /Users/<user>/Downloads)
  let startPath = info.defaultPath || systemDefaultPath;
  const savedPref = localStorage.getItem('torrentflow_last_path');
  if (savedPref && savedPref !== startPath && !savedPref.includes('Project\\Torrent') && !savedPref.includes('Project/Torrent') && !savedPref.includes('Subs')) {
    startPath = savedPref;
  }

  saveLocationModal.classList.add('active');
  navigateToFolder(startPath);
}

function closeSaveModal() {
  saveLocationModal.classList.remove('active');
  pendingTorrent = null;
}

modalCloseBtn.addEventListener('click', closeSaveModal);
modalCancelBtn.addEventListener('click', closeSaveModal);

modalConfirmBtn.addEventListener('click', () => {
  if (!pendingTorrent) return;

  const chosenPath = selectedSavePath || systemDefaultPath;
  localStorage.setItem('torrentflow_last_path', chosenPath);

  if (pendingTorrent.type === 'magnet') {
    startMagnetDownload(pendingTorrent.magnetURI, chosenPath);
  } else if (pendingTorrent.type === 'file') {
    startFileDownload(pendingTorrent.tempFileName, chosenPath);
  }

  closeSaveModal();
});

// ==========================================
// Delete Confirmation Modal
// ==========================================
let pendingDeleteInfoHash = null;

const deleteModal = document.getElementById('deleteModal');
const deleteModalCloseBtn = document.getElementById('deleteModalCloseBtn');
const deleteModalCancelBtn = document.getElementById('deleteModalCancelBtn');
const deleteModalConfirmBtn = document.getElementById('deleteModalConfirmBtn');
const deleteTorrentName = document.getElementById('deleteTorrentName');
const deleteTorrentMeta = document.getElementById('deleteTorrentMeta');
const deleteFilesCheckbox = document.getElementById('deleteFilesCheckbox');

function openDeleteModal(infoHash) {
  pendingDeleteInfoHash = infoHash;
  const t = torrents.get(infoHash);
  const name = t?.name || 'Torrent Download';
  const size = t?.totalSize ? formatBytes(t.totalSize) : '--';
  const progress = t?.progress !== undefined ? `${t.progress}%` : '--';

  if (deleteTorrentName) deleteTorrentName.textContent = name;
  if (deleteTorrentMeta) deleteTorrentMeta.textContent = `Size: ${size} • Completed: ${progress}`;
  if (deleteFilesCheckbox) deleteFilesCheckbox.checked = false;

  if (deleteModal) deleteModal.classList.add('active');
}

function closeDeleteModal() {
  pendingDeleteInfoHash = null;
  if (deleteModal) deleteModal.classList.remove('active');
}

if (deleteModalCloseBtn) deleteModalCloseBtn.addEventListener('click', closeDeleteModal);
if (deleteModalCancelBtn) deleteModalCancelBtn.addEventListener('click', closeDeleteModal);
if (deleteModal) {
  deleteModal.addEventListener('click', (e) => {
    if (e.target === deleteModal) closeDeleteModal();
  });
}

if (deleteModalConfirmBtn) {
  deleteModalConfirmBtn.addEventListener('click', () => {
    if (!pendingDeleteInfoHash) return;
    const infoHash = pendingDeleteInfoHash;
    const deleteFiles = deleteFilesCheckbox ? deleteFilesCheckbox.checked : false;

    fetch(`/api/torrents/${infoHash}?deleteFiles=${deleteFiles}`, { method: 'DELETE' })
      .then(res => res.json())
      .then(() => {
        showToast(deleteFiles ? 'Torrent and downloaded files removed' : 'Torrent removed from list', 'info');
      })
      .catch(() => showToast('Failed to remove torrent', 'error'));

    const card = document.querySelector(`.torrent-card[data-infohash="${infoHash}"]`);
    if (card) {
      card.style.animation = 'toastOut 0.3s ease forwards';
      setTimeout(() => card.remove(), 300);
    }
    torrents.delete(infoHash);
    updateUI();
    closeDeleteModal();
  });
}

// ==========================================
// Files & Storage Modal
// ==========================================
const filesModal = document.getElementById('filesModal');
const filesModalCloseBtn = document.getElementById('filesModalCloseBtn');
const filesModalDoneBtn = document.getElementById('filesModalDoneBtn');
const filesModalTitle = document.getElementById('filesModalTitle');
const filesModalSubtitle = document.getElementById('filesModalSubtitle');
const storagePathDisplay = document.getElementById('storagePathDisplay');
const btnCopyPCPath = document.getElementById('btnCopyPCPath');
const filesModalCount = document.getElementById('filesModalCount');
const filesModalTotalSize = document.getElementById('filesModalTotalSize');
const filesModalList = document.getElementById('filesModalList');
const btnOpenInExplorerDirect = document.getElementById('btnOpenInExplorerDirect');

let activeFilesTorrent = null;

function openFilesModal(infoHash) {
  const t = torrents.get(infoHash);
  if (!t) return;
  activeFilesTorrent = t;

  const fullPath = t.savePath || systemDefaultPath;
  if (filesModalTitle) filesModalTitle.textContent = t.name || 'Torrent Storage';
  if (filesModalSubtitle) filesModalSubtitle.textContent = `${t.progress}% downloaded • ${t.files ? t.files.length : 0} items`;
  if (storagePathDisplay) storagePathDisplay.textContent = fullPath;

  // Auto-copy path to clipboard
  try {
    navigator.clipboard.writeText(fullPath).catch(() => { });
  } catch { }

  const files = t.files || [];
  if (filesModalCount) filesModalCount.textContent = files.length;
  if (filesModalTotalSize) filesModalTotalSize.textContent = formatBytes(t.totalSize || 0);

  if (filesModalList) {
    filesModalList.innerHTML = '';
    if (files.length === 0) {
      const li = document.createElement('li');
      li.className = 'files-modal-item';
      li.style.color = 'var(--text-muted)';
      li.textContent = 'Resolving file list from peers...';
      filesModalList.appendChild(li);
    } else {
      files.forEach(f => {
        const li = document.createElement('li');
        li.className = 'files-modal-item';
        li.innerHTML = `
          <div class="files-modal-name" title="${escapeHtml(f.name)}">📄 ${escapeHtml(f.name)}</div>
          <div class="files-modal-size">${formatBytes(f.length)}</div>
          <div class="files-modal-actions">
            <a class="btn-file-action" href="${f.downloadUrl}" download="${escapeHtml(f.name)}" target="_blank" title="Save file to PC">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              <span>Download</span>
            </a>
          </div>
        `;
        filesModalList.appendChild(li);
      });
    }
  }

  if (filesModal) filesModal.classList.add('active');
  showToast('Storage details opened & path copied!', 'info');

  // Also trigger OS shell launch in background
  fetch('/api/open-folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath: t.savePath, torrentName: t.name, infoHash })
  }).catch(() => { });
}

function closeFilesModal() {
  if (filesModal) filesModal.classList.remove('active');
  activeFilesTorrent = null;
}

if (filesModalCloseBtn) filesModalCloseBtn.addEventListener('click', closeFilesModal);
if (filesModalDoneBtn) filesModalDoneBtn.addEventListener('click', closeFilesModal);
if (filesModal) {
  filesModal.addEventListener('click', (e) => {
    if (e.target === filesModal) closeFilesModal();
  });
}

if (btnCopyPCPath) {
  btnCopyPCPath.addEventListener('click', () => {
    const p = storagePathDisplay ? storagePathDisplay.textContent : '';
    if (p) {
      navigator.clipboard.writeText(p).then(() => {
        showToast('Local PC path copied to clipboard!', 'success');
      });
    }
  });
}

if (btnOpenInExplorerDirect) {
  btnOpenInExplorerDirect.addEventListener('click', () => {
    if (!activeFilesTorrent) return;
    const t = activeFilesTorrent;
    fetch('/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath: t.savePath, torrentName: t.name, infoHash: t.infoHash })
    })
      .then(r => r.json())
      .then(d => {
        if (d.success) showToast('Triggered Windows Explorer launch', 'info');
      });
  });
}

// Global keydown handler
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (filesModal && filesModal.classList.contains('active')) {
      closeFilesModal();
    } else if (deleteModal && deleteModal.classList.contains('active')) {
      closeDeleteModal();
    } else if (saveLocationModal && saveLocationModal.classList.contains('active')) {
      closeSaveModal();
    }
  }
});

// ==========================================
// Drag & Drop
// ==========================================
dropZone.addEventListener('click', () => fileInput.click());

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.add('drag-over');
});

dropZone.addEventListener('dragleave', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove('drag-over');
});

dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  e.stopPropagation();
  dropZone.classList.remove('drag-over');

  const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.torrent'));
  if (files.length === 0) {
    showToast('Please drop .torrent files only', 'error');
    return;
  }
  inspectTorrentFile(files[0]);
});

fileInput.addEventListener('change', (e) => {
  const files = Array.from(e.target.files);
  if (files.length > 0) {
    inspectTorrentFile(files[0]);
  }
  fileInput.value = '';
});

// ==========================================
// Magnet Link Flow
// ==========================================
addMagnetBtn.addEventListener('click', () => {
  const magnetURI = magnetInput.value.trim();
  if (!magnetURI) {
    showToast('Please enter a magnet link', 'error');
    return;
  }
  initiateMagnetDownload(magnetURI);
});

magnetInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const magnetURI = magnetInput.value.trim();
    if (!magnetURI) return;
    initiateMagnetDownload(magnetURI);
  }
});

// Auto-paste detection
document.addEventListener('paste', (e) => {
  if (document.activeElement !== magnetInput) {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (text && text.trim().startsWith('magnet:')) {
      e.preventDefault();
      magnetInput.value = text.trim();
      magnetInput.focus();
      showToast('Magnet link detected from clipboard!', 'info');
      initiateMagnetDownload(text.trim());
    }
  }
});

function initiateMagnetDownload(magnetURI) {
  if (!magnetURI.startsWith('magnet:')) {
    showToast('Invalid magnet link (must start with "magnet:")', 'error');
    return;
  }

  showToast('Reading magnet details...', 'info');

  fetch('/api/torrents/inspect-magnet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ magnetURI })
  })
    .then(res => res.json())
    .then(data => {
      openSaveModal({
        type: 'magnet',
        magnetURI,
        name: data.name || 'Magnet Torrent',
        infoHash: data.infoHash
      });
      magnetInput.value = '';
    })
    .catch(() => {
      openSaveModal({
        type: 'magnet',
        magnetURI,
        name: 'Magnet Download'
      });
      magnetInput.value = '';
    });
}

function startMagnetDownload(magnetURI, saveLocation) {
  fetch('/api/torrents/magnet', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ magnetURI, saveLocation })
  })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        showToast(data.error, 'error');
      } else {
        const folderName = saveLocation.split('\\').filter(Boolean).pop() || 'selected folder';
        showToast(`Download started! Saving to "${folderName}"`, 'success');
      }
    })
    .catch(err => {
      showToast('Failed to add torrent: ' + err.message, 'error');
    });
}

// ==========================================
// File Upload Flow
// ==========================================
function inspectTorrentFile(file) {
  const formData = new FormData();
  formData.append('torrent', file);

  showToast('Reading .torrent file...', 'info');

  fetch('/api/torrents/inspect-file', {
    method: 'POST',
    body: formData
  })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        showToast(data.error, 'error');
      } else {
        openSaveModal({
          type: 'file',
          tempFileName: data.tempFileName,
          name: data.name || file.name,
          totalLength: data.totalLength,
          fileCount: data.fileCount
        });
      }
    })
    .catch(err => {
      showToast('Upload failed: ' + err.message, 'error');
    });
}

function startFileDownload(tempFileName, saveLocation) {
  fetch('/api/torrents/confirm-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tempFileName, saveLocation })
  })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        showToast(data.error, 'error');
      } else {
        const folderName = saveLocation.split('\\').filter(Boolean).pop() || 'selected folder';
        showToast(`Download started! Saving to "${folderName}"`, 'success');
      }
    })
    .catch(err => {
      showToast('Failed to start torrent: ' + err.message, 'error');
    });
}

// ==========================================
// Socket Events
// ==========================================
socket.on('torrents:list', (list) => {
  if (Array.isArray(list)) {
    list.forEach(t => upsertTorrentCard(t));
    updateUI();
  }
});

socket.on('torrent:added', (t) => {
  upsertTorrentCard(t);
  updateUI();
});

socket.on('torrents:update', (list) => {
  if (!Array.isArray(list)) return;

  let totalDown = 0;
  let totalUp = 0;

  list.forEach(t => {
    upsertTorrentCard(t);
    totalDown += t.downloadSpeed || 0;
    totalUp += t.uploadSpeed || 0;
  });

  globalDown.textContent = formatSpeed(totalDown);
  globalUp.textContent = formatSpeed(totalUp);
  activeTorrents.textContent = list.filter(t => !t.done && !t.paused).length;
  updateUI();
});

socket.on('torrent:metadata', (t) => {
  upsertTorrentCard(t);
  showToast(`Connected: ${t.name}`, 'info');
});

socket.on('torrent:ready', (t) => {
  upsertTorrentCard(t);
});

socket.on('torrent:done', (t) => {
  upsertTorrentCard(t);
  showToast(`🎉 Complete: ${t.name}`, 'success');
});

socket.on('torrent:removed', (infoHash) => {
  const card = document.querySelector(`.torrent-card[data-infohash="${infoHash}"]`);
  if (card) {
    card.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => card.remove(), 300);
  }
  torrents.delete(infoHash);
  updateUI();
});

socket.on('torrent:error', (data) => {
  if (data.error) showToast(`Error: ${data.error}`, 'error');
});

// ==========================================
// UI Updates & Card Controls
// ==========================================
function upsertTorrentCard(torrent) {
  if (!torrent || !torrent.infoHash) return;

  torrents.set(torrent.infoHash, torrent);

  let card = document.querySelector(`.torrent-card[data-infohash="${torrent.infoHash}"]`);

  if (!card) {
    card = createTorrentCard(torrent);
    torrentList.prepend(card);
  }

  updateTorrentCard(card, torrent);
}

function createTorrentCard(torrent) {
  const template = document.getElementById('torrentCardTemplate');
  const card = template.content.cloneNode(true).querySelector('.torrent-card');
  card.dataset.infohash = torrent.infoHash;

  // Open this torrent's folder directly in Windows Explorer
  const openFolderBtn = card.querySelector('.btn-open-card-folder');
  openFolderBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const t = torrents.get(torrent.infoHash);
    const folderPath = t?.savePath || systemDefaultPath;
    const torrentName = t?.name;

    showToast('Opening folder in Windows Explorer...', 'info');

    fetch('/api/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath, torrentName, infoHash: torrent.infoHash })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          const folderName = data.opened.split(/[\\/]/).filter(Boolean).pop() || 'folder';
          showToast(`Opened in File Explorer: ${folderName}`, 'success');
        } else {
          showToast('Could not open folder in File Explorer', 'error');
        }
      })
      .catch(() => {
        showToast('Could not open folder in File Explorer', 'error');
      });
  });

  // Copy Magnet button
  const copyBtn = card.querySelector('.btn-copy-magnet');
  copyBtn.addEventListener('click', () => {
    const t = torrents.get(torrent.infoHash);
    const magnet = t?.magnetURI || `magnet:?xt=urn:btih:${torrent.infoHash}`;
    navigator.clipboard.writeText(magnet).then(() => {
      showToast('Magnet link copied to clipboard!', 'success');
    }).catch(() => {
      showToast('Could not copy link', 'error');
    });
  });

  // Pause / Resume button
  const pauseBtn = card.querySelector('.btn-pause');
  pauseBtn.addEventListener('click', () => {
    const t = torrents.get(torrent.infoHash);
    if (!t) return;

    if (t.paused) {
      t.paused = false;
      renderPauseState(card, false);
      showToast('Resuming download...', 'info');

      fetch(`/api/torrents/${torrent.infoHash}/resume`, { method: 'POST' })
        .then(res => res.json())
        .then(data => {
          t.paused = !!data.paused;
          renderPauseState(card, t.paused);
        })
        .catch(() => {
          t.paused = true;
          renderPauseState(card, true);
        });
    } else {
      t.paused = true;
      renderPauseState(card, true);
      showToast('Download paused', 'info');

      fetch(`/api/torrents/${torrent.infoHash}/pause`, { method: 'POST' })
        .then(res => res.json())
        .then(data => {
          t.paused = !!data.paused;
          renderPauseState(card, t.paused);
        })
        .catch(() => {
          t.paused = false;
          renderPauseState(card, false);
        });
    }
  });

  // Remove button
  const removeBtn = card.querySelector('.btn-remove');
  removeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openDeleteModal(torrent.infoHash);
  });

  // Toggle files list
  const toggleBtn = card.querySelector('.btn-toggle-files');
  const filesDiv = card.querySelector('.torrent-files');
  toggleBtn.addEventListener('click', () => {
    const isHidden = filesDiv.style.display === 'none';
    filesDiv.style.display = isHidden ? 'block' : 'none';
    toggleBtn.classList.toggle('open', isHidden);
  });

  return card;
}

function renderPauseState(card, isPaused) {
  const pauseBtn = card.querySelector('.btn-pause');
  const statusPill = card.querySelector('.status-pill');
  const statDown = card.querySelector('.stat-down');
  const progressFill = card.querySelector('.progress-fill');

  if (isPaused) {
    pauseBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
    pauseBtn.title = 'Resume Download';
    pauseBtn.classList.add('paused');
    if (statusPill) {
      statusPill.textContent = 'Paused';
      statusPill.className = 'status-pill status-paused';
    }
    if (statDown) statDown.textContent = '0 B/s';
    if (progressFill) progressFill.classList.add('paused-bar');
  } else {
    pauseBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
    pauseBtn.title = 'Pause Download';
    pauseBtn.classList.remove('paused');
    if (progressFill) progressFill.classList.remove('paused-bar');
  }
}

function updateTorrentCard(card, torrent) {
  const nameEl = card.querySelector('.torrent-name');
  nameEl.textContent = torrent.name || 'Fetching metadata...';

  const sizeEl = card.querySelector('.torrent-size');
  sizeEl.textContent = torrent.totalSize
    ? `${formatBytes(torrent.downloaded)} of ${formatBytes(torrent.totalSize)}`
    : 'Resolving torrent info from trackers...';

  const pathEl = card.querySelector('.card-save-path');
  if (pathEl) {
    const p = torrent.savePath || systemDefaultPath;
    pathEl.textContent = p.length > 35 ? '...' + p.slice(-32) : p;
    pathEl.parentElement.title = `Saved in: ${p}`;
  }

  const progressFill = card.querySelector('.progress-fill');
  const progressText = card.querySelector('.progress-text');
  const pct = Math.min(100, Math.max(0, torrent.progress || 0));
  progressFill.style.width = `${pct}%`;
  progressText.textContent = `${pct}%`;

  card.querySelector('.stat-down').textContent = torrent.paused ? '0 B/s' : formatSpeed(torrent.downloadSpeed);
  card.querySelector('.stat-up').textContent = torrent.paused ? '0 B/s' : formatSpeed(torrent.uploadSpeed);
  card.querySelector('.stat-peers').textContent = `${torrent.numPeers || 0} peers`;
  card.querySelector('.stat-eta').textContent = torrent.done ? 'Complete' : (torrent.paused ? 'Paused' : formatETA(torrent.timeRemaining));

  // Status pill
  const statusPill = card.querySelector('.status-pill');
  if (statusPill) {
    if (torrent.done) {
      statusPill.textContent = 'Completed';
      statusPill.className = 'status-pill status-completed';
    } else if (torrent.paused) {
      statusPill.textContent = 'Paused';
      statusPill.className = 'status-pill status-paused';
    } else if (torrent.downloadSpeed > 0) {
      statusPill.textContent = 'Downloading';
      statusPill.className = 'status-pill status-downloading';
    } else if (torrent.numPeers > 0) {
      statusPill.textContent = 'Connecting';
      statusPill.className = 'status-pill status-connecting';
    } else {
      statusPill.textContent = 'Searching Peers';
      statusPill.className = 'status-pill status-loading';
    }
  }

  // Card classes & pause button icon
  card.classList.toggle('completed', !!torrent.done);
  card.classList.toggle('loading', !torrent.name || torrent.name === 'Fetching metadata...');
  renderPauseState(card, !!torrent.paused);

  // File list: render once
  const filesCountEl = card.querySelector('.files-count');
  const fileList = card.querySelector('.file-list');
  const fileCount = torrent.files ? torrent.files.length : 0;
  filesCountEl.textContent = fileCount;

  if (fileCount > 0 && fileList.dataset.renderedCount !== fileCount.toString()) {
    fileList.dataset.renderedCount = fileCount.toString();
    fileList.innerHTML = '';
    torrent.files.forEach(f => {
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="file-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
        <span class="file-size">${formatBytes(f.length)}</span>
        <a class="file-download-link" href="${f.downloadUrl}" download="${escapeHtml(f.name)}" target="_blank" title="Download to PC">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        </a>
      `;
      fileList.appendChild(li);
    });
  }
}

function updateUI() {
  const count = torrents.size;
  torrentCount.textContent = count;
  emptyState.style.display = count === 0 ? 'block' : 'none';
}

// ==========================================
// Utilities
// ==========================================
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || bytesPerSec === 0) return '0 B/s';
  return formatBytes(bytesPerSec) + '/s';
}

function formatETA(ms) {
  if (!ms || ms === Infinity || ms <= 0) return '—';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return `${hours}h ${mins}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Toast Notifications
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icons = {
    success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
  };

  toast.innerHTML = `${icons[type] || icons.info}<span>${escapeHtml(message)}</span>`;
  toastContainer.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'toastOut 0.3s ease forwards';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Global drag prevention
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => {
  if (!dropZone.contains(e.target)) {
    e.preventDefault();
  }
});

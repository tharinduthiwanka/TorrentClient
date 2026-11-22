import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import WebTorrent from 'webtorrent';
import parseTorrent from 'parse-torrent';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { fileURLToPath } from 'url';
import { exec, spawn, execFile } from 'child_process';
import open from 'open';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Cross-platform user Downloads directory (Windows: C:\Users\<user>\Downloads, macOS: /Users/<user>/Downloads, Linux: /home/<user>/Downloads)
function getUserDownloadsPath() {
  const home = os.homedir();
  const userDownloads = path.join(home, 'Downloads');
  if (fs.existsSync(userDownloads)) {
    return userDownloads;
  }
  // If not found, try to create it or fall back to local project downloads
  try {
    fs.mkdirSync(userDownloads, { recursive: true });
    return userDownloads;
  } catch {
    const fallback = path.join(__dirname, 'downloads');
    if (!fs.existsSync(fallback)) {
      try { fs.mkdirSync(fallback, { recursive: true }); } catch { }
    }
    return fallback;
  }
}

const DEFAULT_DOWNLOADS_PATH = getUserDownloadsPath();

// Temp directory for uploaded .torrent files
const TEMP_PATH = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_PATH)) {
  fs.mkdirSync(TEMP_PATH, { recursive: true });
}

// Map of infoHash -> chosen save path
const torrentPaths = new Map();

// Helper to list all valid Windows drive letters
function listDrives() {
  const drives = [];
  for (let i = 65; i <= 90; i++) {
    const driveLetter = String.fromCharCode(i) + ':\\';
    try {
      if (fs.existsSync(driveLetter)) {
        drives.push(driveLetter);
      }
    } catch { }
  }
  return drives.length > 0 ? drives : ['C:\\'];
}

// High-speed Tier-1 public trackers (Aggregated from top global tracker lists)
const HIGH_SPEED_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.tracker.cl:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://explodie.org:6969/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'udp://tracker.moeking.me:6969/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://tracker.bittor.pw:1337/announce',
  'udp://tracker1.bt.moack.co.kr:80/announce',
  'udp://p4p.arenabg.com:1337/announce',
  'udp://tracker.theoks.net:6969/announce',
  'udp://bt1.archive.org:6969/announce',
  'udp://bt2.archive.org:6969/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://tracker.zerobytes.xyz:1337/announce',
  'udp://retracker.lanta-net.ru:2710/announce',
  'udp://tracker.dump.cl:6969/announce',
  'udp://opentracker.i2p.rocks:6969/announce',
  'udp://tracker.srv00.com:6969/announce',
  'http://tracker.opentrackr.org:1337/announce',
  'http://open.acgnxtracker.com:80/announce',
  'http://tracker.files.fm:6969/announce',
  'wss://tracker.openwebtorrent.com',
  'wss://tracker.btorrent.xyz',
  'wss://tracker.webtorrent.dev',
  'wss://tracker.files.fm:7073/announce'
];

// Multer config for .torrent uploads
const storage = multer.diskStorage({
  destination: TEMP_PATH,
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.torrent') || file.mimetype === 'application/x-bittorrent') {
      cb(null, true);
    } else {
      cb(new Error('Only .torrent files are allowed'), false);
    }
  },
  limits: { fileSize: 30 * 1024 * 1024 }
});

// High-speed WebTorrent client
const client = new WebTorrent({
  maxConns: 500,        // Maximize global peer concurrency
  dht: true,
  tracker: true,
  utp: true,
  lsd: true
});

client.on('error', (err) => {
  console.warn('⚠️ WebTorrent warning/error:', err.message);
});

// Middleware - disable browser caching for instant script and UI updates
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));
app.use(express.json());

// ==========================================
// In-App PC File System Browser API
// ==========================================

// Get system shortcuts and drives
app.get('/api/fs/places', (req, res) => {
  const home = os.homedir();
  const places = [
    { name: 'Downloads (Default)', path: DEFAULT_DOWNLOADS_PATH, icon: 'downloads' },
    { name: 'Desktop', path: path.join(home, 'Desktop'), icon: 'desktop' },
    { name: 'Documents', path: path.join(home, 'Documents'), icon: 'documents' },
    { name: 'Project Folder', path: path.join(__dirname, 'downloads'), icon: 'default' }
  ];

  // Filter to only existing directories
  const validPlaces = places.filter(p => {
    try { return fs.existsSync(p.path); } catch { return false; }
  });

  const drives = listDrives();

  res.json({
    places: validPlaces,
    drives,
    defaultPath: DEFAULT_DOWNLOADS_PATH
  });
});

// List directories inside a path
app.post('/api/fs/list', (req, res) => {
  let targetPath = req.body.targetPath;
  if (!targetPath || typeof targetPath !== 'string') {
    targetPath = DEFAULT_DOWNLOADS_PATH;
  }

  targetPath = path.resolve(targetPath);

  if (!fs.existsSync(targetPath)) {
    return res.status(404).json({ error: 'Directory does not exist' });
  }

  try {
    const entries = fs.readdirSync(targetPath, { withFileTypes: true });
    const folders = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        // Skip hidden or system folders like $Recycle.Bin, System Volume Information
        if (!entry.name.startsWith('$') && !entry.name.startsWith('.')) {
          folders.push({
            name: entry.name,
            fullPath: path.join(targetPath, entry.name)
          });
        }
      }
    }

    // Sort folders alphabetically
    folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));

    const parsed = path.parse(targetPath);
    const isRoot = parsed.root.toLowerCase() === targetPath.toLowerCase();
    const parentPath = isRoot ? null : path.dirname(targetPath);

    res.json({
      currentPath: targetPath,
      parentPath,
      isRoot,
      folders
    });
  } catch (err) {
    res.status(500).json({ error: 'Cannot access folder: ' + err.message });
  }
});

// Create a new folder
app.post('/api/fs/create-folder', (req, res) => {
  const { parentPath, folderName } = req.body;
  if (!parentPath || !folderName) {
    return res.status(400).json({ error: 'parentPath and folderName are required' });
  }

  // Sanitize folder name
  const cleanName = folderName.replace(/[<>:"/\\|?*]/g, '').trim();
  if (!cleanName) {
    return res.status(400).json({ error: 'Invalid folder name' });
  }

  const newPath = path.join(parentPath, cleanName);

  try {
    if (!fs.existsSync(newPath)) {
      fs.mkdirSync(newPath, { recursive: true });
    }
    res.json({ success: true, createdPath: newPath });
  } catch (err) {
    res.status(500).json({ error: 'Failed to create folder: ' + err.message });
  }
});

// ==========================================
// Torrent Management APIs
// ==========================================

// Dynamic file downloader
app.get('/download-file', (req, res) => {
  const { infoHash, fileIndex } = req.query;
  const torrent = client.torrents.find(t => t.infoHash === infoHash);
  if (!torrent || !torrent.files) {
    return res.status(404).send('Torrent not found');
  }

  const idx = parseInt(fileIndex, 10);
  const file = torrent.files[idx];
  if (!file) {
    return res.status(404).send('File not found');
  }

  const targetPath = path.join(torrent.path || DEFAULT_DOWNLOADS_PATH, file.path);
  if (fs.existsSync(targetPath)) {
    return res.download(targetPath, file.name);
  }

  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.name)}"`);
  file.createReadStream().pipe(res);
});

// Robust folder opener that works with special characters, brackets [1080p], and opens File Explorer directly on PC
function openFolderInExplorer(folderPath) {
  return new Promise((resolve) => {
    let cleanPath = path.resolve(folderPath).replace(/[\\/]+$/, '');

    // Windows MAX_PATH protection: If path is longer than 240 chars, resolve to closest parent directory
    while (cleanPath.length > 240 && path.dirname(cleanPath) !== cleanPath) {
      cleanPath = path.dirname(cleanPath);
    }

    // If path points to a file, get its containing folder
    try {
      if (fs.existsSync(cleanPath) && fs.statSync(cleanPath).isFile()) {
        cleanPath = path.dirname(cleanPath);
      }
    } catch { }

    // Fall back to default downloads directory if path doesn't exist
    if (!fs.existsSync(cleanPath)) {
      cleanPath = DEFAULT_DOWNLOADS_PATH;
    }

    if (!fs.existsSync(cleanPath)) {
      try { fs.mkdirSync(cleanPath, { recursive: true }); } catch { }
    }

    console.log(`[Explorer] Opening folder in Windows Explorer: "${cleanPath}"`);

    if (process.platform === 'win32') {
      exec(`cmd.exe /c start "" "${cleanPath}"`, (err) => {
        if (err) console.warn('[Explorer] cmd start error:', err.message);
      });
    } else if (process.platform === 'darwin') {
      exec(`open "${cleanPath}"`, () => { });
    } else {
      exec(`xdg-open "${cleanPath}"`, () => { });
    }

    resolve(cleanPath);
  });
}

// Open folder in File Explorer reliably using native desktop shell
app.post('/api/open-folder', async (req, res) => {
  let { folderPath, torrentName, infoHash } = req.body;
  let targetDir = null;

  // 1. Look up active torrent in WebTorrent client to locate exact files on disk
  const torrent = client.torrents.find(t =>
    (infoHash && t.infoHash === infoHash) ||
    (torrentName && t.name === torrentName)
  );

  if (torrent) {
    const saveRoot = torrent.path || DEFAULT_DOWNLOADS_PATH;
    // For multi-file torrents or folder-based downloads, check torrent subfolder
    if (torrent.name) {
      const sub = path.join(saveRoot, torrent.name);
      if (fs.existsSync(sub)) {
        targetDir = sub;
      }
    }
    if (!targetDir && fs.existsSync(saveRoot)) {
      targetDir = saveRoot;
    }
  }

  // 2. If not found via active torrent, check folderPath and torrentName
  if (!targetDir && folderPath) {
    let p = path.resolve(folderPath.trim());
    if (torrentName) {
      const cleanName = torrentName.trim();
      const sub = path.join(p, cleanName);
      if (fs.existsSync(sub)) {
        p = sub;
      }
    }
    if (fs.existsSync(p)) targetDir = p;
  }

  // 3. Fallback to default downloads path
  if (!targetDir || !fs.existsSync(targetDir)) {
    targetDir = DEFAULT_DOWNLOADS_PATH;
  }

  try {
    const openedPath = await openFolderInExplorer(targetDir);
    res.json({ success: true, opened: openedPath });
  } catch (err) {
    console.error('Failed to open folder:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all active torrents
app.get('/api/torrents', (req, res) => {
  const torrents = client.torrents
    .filter(t => t.infoHash)
    .map(t => formatTorrent(t));
  res.json(torrents);
});

// Inspect magnet metadata before download
app.post('/api/torrents/inspect-magnet', async (req, res) => {
  const { magnetURI } = req.body;
  if (!magnetURI || typeof magnetURI !== 'string') {
    return res.status(400).json({ error: 'Valid magnet link required' });
  }

  try {
    const parsed = await parseTorrent(magnetURI.trim());
    res.json({
      name: parsed.name || 'Unknown Torrent',
      infoHash: parsed.infoHash,
      defaultPath: DEFAULT_DOWNLOADS_PATH
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to inspect magnet: ' + err.message });
  }
});

// Inspect uploaded .torrent file
app.post('/api/torrents/inspect-file', upload.single('torrent'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const filePath = req.file.path;
    const torrentBuf = fs.readFileSync(filePath);
    const parsed = await parseTorrent(torrentBuf);

    res.json({
      name: parsed.name || req.file.originalname,
      infoHash: parsed.infoHash,
      tempFileName: path.basename(filePath),
      totalLength: parsed.length || 0,
      fileCount: parsed.files ? parsed.files.length : 1,
      defaultPath: DEFAULT_DOWNLOADS_PATH
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to inspect file: ' + err.message });
  }
});

// Add torrent via magnet URL with selected save location
app.post('/api/torrents/magnet', async (req, res) => {
  const { magnetURI, saveLocation } = req.body;
  if (!magnetURI || typeof magnetURI !== 'string') {
    return res.status(400).json({ error: 'Valid Magnet URI is required' });
  }

  const trimmed = magnetURI.trim();
  if (!trimmed.startsWith('magnet:')) {
    return res.status(400).json({ error: 'Invalid magnet link format (must start with magnet:)' });
  }

  const chosenPath = (saveLocation && typeof saveLocation === 'string' && saveLocation.trim())
    ? path.resolve(saveLocation.trim())
    : DEFAULT_DOWNLOADS_PATH;

  try {
    if (!fs.existsSync(chosenPath)) {
      fs.mkdirSync(chosenPath, { recursive: true });
    }

    const parsed = await parseTorrent(trimmed);
    const infoHash = parsed.infoHash;

    const existing = client.torrents.find(t => t.infoHash === infoHash);
    if (existing) {
      return res.status(409).json({ error: 'Torrent already in download list', torrent: formatTorrent(existing) });
    }

    if (!parsed.announce) parsed.announce = [];
    for (const tr of HIGH_SPEED_TRACKERS) {
      if (!parsed.announce.includes(tr)) parsed.announce.push(tr);
    }

    addTorrent(parsed, chosenPath);
    res.json({ success: true, message: 'Torrent added successfully', infoHash, savePath: chosenPath });
  } catch (err) {
    console.error('❌ Magnet parse error:', err.message);
    res.status(500).json({ error: 'Failed to parse magnet link: ' + err.message });
  }
});

// Confirm and start download for uploaded .torrent file
app.post('/api/torrents/confirm-file', async (req, res) => {
  const { tempFileName, saveLocation } = req.body;
  if (!tempFileName) {
    return res.status(400).json({ error: 'tempFileName is required' });
  }

  const tempFilePath = path.join(TEMP_PATH, path.basename(tempFileName));
  if (!fs.existsSync(tempFilePath)) {
    return res.status(404).json({ error: 'Temp torrent file expired or not found' });
  }

  const chosenPath = (saveLocation && typeof saveLocation === 'string' && saveLocation.trim())
    ? path.resolve(saveLocation.trim())
    : DEFAULT_DOWNLOADS_PATH;

  try {
    if (!fs.existsSync(chosenPath)) {
      fs.mkdirSync(chosenPath, { recursive: true });
    }

    const torrentBuf = fs.readFileSync(tempFilePath);
    const parsed = await parseTorrent(torrentBuf);
    const infoHash = parsed.infoHash;

    const existing = client.torrents.find(t => t.infoHash === infoHash);
    if (existing) {
      try { fs.unlinkSync(tempFilePath); } catch { }
      return res.status(409).json({ error: 'Torrent already added', torrent: formatTorrent(existing) });
    }

    if (!parsed.announce) parsed.announce = [];
    for (const tr of HIGH_SPEED_TRACKERS) {
      if (!parsed.announce.includes(tr)) parsed.announce.push(tr);
    }

    addTorrent(parsed, chosenPath);
    try { fs.unlinkSync(tempFilePath); } catch { }
    res.json({ success: true, message: 'Download started', infoHash, savePath: chosenPath });
  } catch (err) {
    res.status(500).json({ error: 'Failed to start torrent: ' + err.message });
  }
});

// Pause torrent
function pauseTorrent(torrent) {
  torrent.paused = true;
  if (torrent.pieces) {
    try { torrent.deselect(0, torrent.pieces.length - 1, false); } catch { }
  }
  if (torrent.wires) {
    for (const wire of torrent.wires) {
      try { wire.uninterested(); } catch { }
      // Cancel all in-flight piece requests on this wire
      if (wire.requests && wire.requests.length > 0) {
        for (const req of [...wire.requests]) {
          try { wire.cancel(req.piece, req.offset, req.length); } catch { }
        }
      }
      // Pause raw TCP socket reception
      try {
        if (wire._socket && typeof wire._socket.pause === 'function' && !wire._socket.isPaused()) {
          wire._socket.pause();
        }
      } catch { }
    }
  }
}

// Resume torrent
function resumeTorrent(torrent) {
  torrent.paused = false;
  if (torrent.wires) {
    for (const wire of torrent.wires) {
      // Resume raw TCP socket reception
      try {
        if (wire._socket && typeof wire._socket.resume === 'function' && wire._socket.isPaused()) {
          wire._socket.resume();
        }
      } catch { }
      try { wire.interested(); } catch { }
    }
  }
  if (torrent.pieces) {
    try { torrent.select(0, torrent.pieces.length - 1, false); } catch { }
  }
  try { torrent._updateSelections(); } catch { }
  try { torrent._update(); } catch { }
}

app.post('/api/torrents/:infoHash/pause', (req, res) => {
  const torrent = client.torrents.find(t => t.infoHash === req.params.infoHash);
  if (!torrent) return res.status(404).json({ error: 'Torrent not found' });

  pauseTorrent(torrent);
  io.emit('torrents:update', client.torrents.filter(t => t.infoHash).map(formatTorrent));
  res.json({ success: true, paused: true });
});

app.post('/api/torrents/:infoHash/resume', (req, res) => {
  const torrent = client.torrents.find(t => t.infoHash === req.params.infoHash);
  if (!torrent) return res.status(404).json({ error: 'Torrent not found' });

  resumeTorrent(torrent);
  io.emit('torrents:update', client.torrents.filter(t => t.infoHash).map(formatTorrent));
  res.json({ success: true, paused: false });
});

app.delete('/api/torrents/:infoHash', (req, res) => {
  const torrent = client.torrents.find(t => t.infoHash === req.params.infoHash);
  if (!torrent) return res.status(404).json({ error: 'Torrent not found' });

  const deleteFiles = req.query.deleteFiles === 'true' || req.body?.deleteFiles === true;

  torrent.destroy({ destroyStore: deleteFiles }, () => {
    torrentPaths.delete(req.params.infoHash);
    io.emit('torrent:removed', req.params.infoHash);
    res.json({ success: true, filesDeleted: deleteFiles });
  });
});

// Format torrent data
function formatTorrent(t) {
  const isPaused = !!t.paused;
  const savePath = torrentPaths.get(t.infoHash) || t.path || DEFAULT_DOWNLOADS_PATH;

  return {
    infoHash: t.infoHash || '',
    magnetURI: t.magnetURI || `magnet:?xt=urn:btih:${t.infoHash}&dn=${encodeURIComponent(t.name || 'torrent')}`,
    name: t.name || 'Fetching metadata...',
    savePath,
    progress: Math.round((t.progress || 0) * 10000) / 100,
    downloadSpeed: isPaused ? 0 : (t.downloadSpeed || 0),
    uploadSpeed: isPaused ? 0 : (t.uploadSpeed || 0),
    numPeers: t.numPeers || 0,
    downloaded: t.downloaded || 0,
    uploaded: t.uploaded || 0,
    totalSize: t.length || 0,
    timeRemaining: isPaused ? 0 : (t.timeRemaining || 0),
    done: !!t.done,
    paused: isPaused,
    files: t.files ? t.files.map((f, idx) => ({
      name: f.name,
      length: f.length,
      progress: Math.round((f.progress || 0) * 100),
      path: (f.path || f.name).replace(/\\/g, '/'),
      downloadUrl: `/download-file?infoHash=${t.infoHash}&fileIndex=${idx}`
    })) : []
  };
}

// Add torrent with explicit save directory
function addTorrent(parsedTorrent, targetPath) {
  let torrent;
  try {
    torrent = client.add(parsedTorrent, {
      path: targetPath,
      announce: HIGH_SPEED_TRACKERS,
      maxConns: 300,      // Maximize per-torrent peer concurrency
      strategy: 'rarest'
    });

    if (!torrent.infoHash && parsedTorrent.infoHash) {
      torrent.infoHash = parsedTorrent.infoHash;
    }

    torrentPaths.set(torrent.infoHash, targetPath);
  } catch (err) {
    console.error('❌ Failed to add torrent:', err.message);
    io.emit('torrent:error', { infoHash: null, error: 'Failed to add torrent: ' + err.message });
    return;
  }

  // Optimize peer sockets immediately when wires connect
  torrent.on('wire', (wire) => {
    if (wire._socket) {
      try { wire._socket.setNoDelay(true); } catch { }
      try { wire._socket.setKeepAlive(true, 5000); } catch { }
    }
  });

  io.emit('torrent:added', formatTorrent(torrent));

  torrent.on('metadata', () => {
    console.log(`📋 Metadata received: ${torrent.name} in ${targetPath}`);
    io.emit('torrent:metadata', formatTorrent(torrent));
  });

  torrent.on('ready', () => {
    console.log(`✅ Ready: ${torrent.name}`);
    io.emit('torrent:ready', formatTorrent(torrent));
  });

  torrent.on('done', () => {
    console.log(`🎉 Download complete: ${torrent.name}`);
    io.emit('torrent:done', formatTorrent(torrent));
  });

  torrent.on('error', (err) => {
    console.error(`❌ Torrent error (${torrent.infoHash}):`, err.message);
    io.emit('torrent:error', { infoHash: torrent.infoHash, error: err.message });
  });
}

// Socket.IO
io.on('connection', (socket) => {
  socket.emit('torrents:list', client.torrents.filter(t => t.infoHash).map(formatTorrent));
});

// Periodic progress update
setInterval(() => {
  const active = client.torrents.filter(t => t.infoHash);
  if (active.length > 0) {
    io.emit('torrents:update', active.map(formatTorrent));
  }
}, 500);

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║                                          ║');
  console.log('  ║   🌊 TorrentFlow High-Speed Online!      ║');
  console.log(`  ║   🔗 http://localhost:${PORT}               ║`);
  console.log('  ║                                          ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
});

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason instanceof Error ? reason.message : reason);
});

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down TorrentFlow...');
  client.destroy(() => {
    process.exit(0);
  });
});

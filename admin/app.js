// ============================================
// Bravo License Admin — Application Logic
// ============================================

// --- Configuration ---
const GITHUB_OWNER = 'nvtptest';
const GITHUB_REPO = 'AutomationLicense';
const GITHUB_API = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`;

// AES-256-CBC key (must match the Electron app's key)
const ENCRYPTION_KEY_HEX = 'b8a9f2e1c3d4567890abcdef12345678fedcba0987654321abcdef1234567890';

// --- State ---
let githubPat = '';
let licenses = [];
let pending = [];
let versionConfig = null;
let licensesSha = null;
let pendingSha = null;
let versionSha = null;

// =============================================
// Encryption (Web Crypto API)
// =============================================

async function hexToKey(hexString) {
  const keyBytes = new Uint8Array(hexString.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
  return await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt', 'decrypt']);
}

async function encrypt(text) {
  const key = await hexToKey(ENCRYPTION_KEY_HEX);
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const data = encoder.encode(text);

  const encrypted = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, data);

  const ivBase64 = btoa(String.fromCharCode(...iv));
  const encBase64 = btoa(String.fromCharCode(...new Uint8Array(encrypted)));

  return ivBase64 + ':' + encBase64;
}

async function decrypt(encryptedText) {
  const parts = encryptedText.split(':');
  if (parts.length < 2) throw new Error('Invalid encrypted format');

  const iv = Uint8Array.from(atob(parts[0]), c => c.charCodeAt(0));
  const encrypted = Uint8Array.from(atob(parts.slice(1).join(':')), c => c.charCodeAt(0));

  const key = await hexToKey(ENCRYPTION_KEY_HEX);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, encrypted);

  return new TextDecoder().decode(decrypted);
}

// =============================================
// GitHub API
// =============================================

async function githubFetch(path, options = {}) {
  const url = path.startsWith('http') ? path : `${GITHUB_API}${path}`;
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'BravoLicenseAdmin',
    ...options.headers,
  };
  if (githubPat) {
    headers['Authorization'] = `Bearer ${githubPat}`;
  }
  const response = await fetch(url, { ...options, headers });
  return response;
}

async function fetchFile(filePath) {
  const response = await githubFetch(`/contents/${filePath}`);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub API: ${response.status}`);

  const data = await response.json();
  const content = atob(data.content.replace(/\n/g, ''));
  return { content, sha: data.sha };
}

async function writeFile(filePath, content, message, sha) {
  const body = {
    message,
    content: btoa(unescape(encodeURIComponent(content))),
  };
  if (sha) body.sha = sha;

  const response = await githubFetch(`/contents/${filePath}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Write failed: ${response.status} — ${errText}`);
  }

  const data = await response.json();
  return data.content.sha;
}

// =============================================
// Authentication
// =============================================

async function authenticate() {
  const input = document.getElementById('pat-input');
  const errorEl = document.getElementById('auth-error');
  const pat = input.value.trim();

  if (!pat) {
    errorEl.textContent = 'Vui lòng nhập GitHub PAT';
    errorEl.style.display = 'block';
    return;
  }

  // Validate PAT by trying to access the repo
  try {
    const response = await fetch(`${GITHUB_API}`, {
      headers: {
        'Authorization': `Bearer ${pat}`,
        'User-Agent': 'BravoLicenseAdmin',
      },
    });

    if (!response.ok) {
      errorEl.textContent = 'Token không hợp lệ hoặc không có quyền truy cập repo';
      errorEl.style.display = 'block';
      return;
    }

    githubPat = pat;
    sessionStorage.setItem('github_pat', pat);

    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('main-app').style.display = 'flex';

    await refreshData();
  } catch (err) {
    errorEl.textContent = `Lỗi kết nối: ${err.message}`;
    errorEl.style.display = 'block';
  }
}

function logout() {
  githubPat = '';
  sessionStorage.removeItem('github_pat');
  document.getElementById('auth-screen').style.display = 'flex';
  document.getElementById('main-app').style.display = 'none';
  document.getElementById('pat-input').value = '';
}

// Auto-restore session
(function autoRestore() {
  const savedPat = sessionStorage.getItem('github_pat');
  if (savedPat) {
    githubPat = savedPat;
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('main-app').style.display = 'flex';
    refreshData();
  }
})();

// Handle Enter key on PAT input
document.getElementById('pat-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') authenticate();
});

// =============================================
// Data Operations
// =============================================

async function refreshData() {
  try {
    // Fetch licenses
    const licensesFile = await fetchFile('data/licenses.enc');
    if (licensesFile) {
      const decrypted = await decrypt(licensesFile.content.trim());
      licenses = JSON.parse(decrypted);
      licensesSha = licensesFile.sha;
    } else {
      licenses = [];
      licensesSha = null;
    }

    // Fetch pending
    const pendingFile = await fetchFile('data/pending.enc');
    if (pendingFile) {
      const decrypted = await decrypt(pendingFile.content.trim());
      pending = JSON.parse(decrypted);
      pendingSha = pendingFile.sha;
    } else {
      pending = [];
      pendingSha = null;
    }

    // Fetch version
    const versionFile = await fetchFile('data/version.json');
    if (versionFile) {
      versionConfig = JSON.parse(versionFile.content);
      versionSha = versionFile.sha;
    }

    renderAll();
    showToast('Dữ liệu đã cập nhật', 'success');
  } catch (err) {
    console.error('Refresh error:', err);
    showToast(`Lỗi: ${err.message}`, 'error');
  }
}

function renderAll() {
  renderPendingList();
  renderLicensedList();
  renderVersionForm();

  // Update badges
  document.getElementById('pending-count').textContent = pending.filter(p => p.status === 'pending').length;
  document.getElementById('licensed-count').textContent = licenses.length;
}

// =============================================
// Pending List
// =============================================

function renderPendingList() {
  const container = document.getElementById('pending-list');
  const pendingItems = pending.filter(p => p.status === 'pending');

  if (pendingItems.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>Không có yêu cầu nào đang chờ</p></div>';
    return;
  }

  container.innerHTML = pendingItems.map((item, index) => `
    <div class="item-card">
      <div class="item-card-header">
        <span class="item-machine-name">🖥️ ${escapeHtml(item.machineName)}</span>
        <div class="item-card-actions">
          <button class="admin-btn success" onclick="approveLicense(${index})">✅ Duyệt</button>
          <button class="admin-btn danger" onclick="rejectLicense(${index})">❌ Từ chối</button>
        </div>
      </div>
      <div class="item-details">
        <div class="item-detail">
          <span class="item-detail-label">Hash</span>
          <span class="item-detail-value">${item.machineHash}</span>
        </div>
        <div class="item-detail">
          <span class="item-detail-label">Yêu cầu lúc</span>
          <span class="item-detail-value">${formatDate(item.requestedAt)}</span>
        </div>
        <div class="item-detail">
          <span class="item-detail-label">App Version</span>
          <span class="item-detail-value">${item.appVersion || 'N/A'}</span>
        </div>
      </div>
      <input class="item-note-input" id="note-${index}" placeholder="Ghi chú (tùy chọn)...">
    </div>
  `).join('');
}

async function approveLicense(index) {
  const pendingItems = pending.filter(p => p.status === 'pending');
  const item = pendingItems[index];
  if (!item) return;

  const noteInput = document.getElementById(`note-${index}`);
  const note = noteInput ? noteInput.value.trim() : '';

  try {
    // Add to licenses
    const newLicense = {
      machineHash: item.machineHash,
      machineName: item.machineName,
      approvedAt: new Date().toISOString(),
      approvedBy: 'admin',
      note: note || undefined,
    };

    // Check if already exists (same machineHash)
    const existingIndex = licenses.findIndex(l => l.machineHash === item.machineHash);
    if (existingIndex >= 0) {
      licenses[existingIndex] = newLicense;
    } else {
      licenses.push(newLicense);
    }

    // Remove from pending
    const pendingIndex = pending.findIndex(p => p.machineHash === item.machineHash && p.status === 'pending');
    if (pendingIndex >= 0) {
      pending.splice(pendingIndex, 1);
    }

    // Save both files
    const encLicenses = await encrypt(JSON.stringify(licenses, null, 2));
    const encPending = await encrypt(JSON.stringify(pending, null, 2));

    licensesSha = await writeFile('data/licenses.enc', encLicenses, `Approve license: ${item.machineName}`, licensesSha);
    pendingSha = await writeFile('data/pending.enc', encPending, `Remove pending: ${item.machineName}`, pendingSha);

    renderAll();
    showToast(`✅ Đã duyệt: ${item.machineName}`, 'success');
  } catch (err) {
    console.error('Approve error:', err);
    showToast(`Lỗi: ${err.message}`, 'error');
  }
}

async function rejectLicense(index) {
  const pendingItems = pending.filter(p => p.status === 'pending');
  const item = pendingItems[index];
  if (!item) return;

  if (!confirm(`Từ chối yêu cầu từ ${item.machineName}?`)) return;

  try {
    // Mark as rejected
    const pendingIndex = pending.findIndex(p => p.machineHash === item.machineHash && p.status === 'pending');
    if (pendingIndex >= 0) {
      pending[pendingIndex].status = 'rejected';
    }

    const encPending = await encrypt(JSON.stringify(pending, null, 2));
    pendingSha = await writeFile('data/pending.enc', encPending, `Reject: ${item.machineName}`, pendingSha);

    renderAll();
    showToast(`❌ Đã từ chối: ${item.machineName}`, 'info');
  } catch (err) {
    console.error('Reject error:', err);
    showToast(`Lỗi: ${err.message}`, 'error');
  }
}

// =============================================
// Licensed List
// =============================================

function renderLicensedList() {
  const container = document.getElementById('licensed-list');

  if (licenses.length === 0) {
    container.innerHTML = '<div class="empty-state"><p>Chưa có máy nào được cấp phép</p></div>';
    return;
  }

  container.innerHTML = licenses.map((item, index) => `
    <div class="item-card">
      <div class="item-card-header">
        <span class="item-machine-name">🖥️ ${escapeHtml(item.machineName)}</span>
        <div class="item-card-actions">
          <button class="admin-btn danger" onclick="revokeLicense(${index})">🗑️ Thu hồi</button>
        </div>
      </div>
      <div class="item-details">
        <div class="item-detail">
          <span class="item-detail-label">Hash</span>
          <span class="item-detail-value">${item.machineHash}</span>
        </div>
        <div class="item-detail">
          <span class="item-detail-label">Duyệt lúc</span>
          <span class="item-detail-value">${formatDate(item.approvedAt)}</span>
        </div>
        <div class="item-detail">
          <span class="item-detail-label">Duyệt bởi</span>
          <span class="item-detail-value">${item.approvedBy || 'N/A'}</span>
        </div>
        ${item.note ? `
        <div class="item-detail">
          <span class="item-detail-label">Ghi chú</span>
          <span class="item-detail-value">${escapeHtml(item.note)}</span>
        </div>
        ` : ''}
      </div>
    </div>
  `).join('');
}

async function revokeLicense(index) {
  const item = licenses[index];
  if (!item) return;

  if (!confirm(`Thu hồi license của ${item.machineName}?`)) return;

  try {
    licenses.splice(index, 1);

    const encLicenses = await encrypt(JSON.stringify(licenses, null, 2));
    licensesSha = await writeFile('data/licenses.enc', encLicenses, `Revoke: ${item.machineName}`, licensesSha);

    renderAll();
    showToast(`🗑️ Đã thu hồi: ${item.machineName}`, 'info');
  } catch (err) {
    console.error('Revoke error:', err);
    showToast(`Lỗi: ${err.message}`, 'error');
  }
}

// =============================================
// Version Management
// =============================================

function renderVersionForm() {
  if (versionConfig) {
    document.getElementById('current-version').value = versionConfig.version;
    document.getElementById('current-release-date').value = versionConfig.releaseDate;
  }

  // Render changelog
  const changelogContainer = document.getElementById('changelog-list');
  if (versionConfig && versionConfig.changelog && versionConfig.changelog.length > 0) {
    changelogContainer.innerHTML = versionConfig.changelog.map(entry => `
      <div class="changelog-entry">
        <div class="changelog-version">v${escapeHtml(entry.version)}</div>
        <div class="changelog-date">${entry.date}</div>
        <ul class="changelog-changes">
          ${entry.changes.map(c => `<li>${escapeHtml(c)}</li>`).join('')}
        </ul>
      </div>
    `).join('');
  } else {
    changelogContainer.innerHTML = '<p class="empty-text">Chưa có lịch sử</p>';
  }
}

async function updateVersion() {
  const newVersion = document.getElementById('new-version').value.trim();
  const downloadUrl = document.getElementById('new-download-url').value.trim();
  const description = document.getElementById('new-description').value.trim();

  if (!newVersion) {
    showToast('Vui lòng nhập phiên bản mới', 'error');
    return;
  }

  try {
    // Build new version config
    const changes = description.split('\n').filter(l => l.trim()).map(l => l.replace(/^-\s*/, '').trim());

    const newChangelog = {
      version: newVersion,
      date: new Date().toISOString().slice(0, 10),
      changes,
    };

    const config = {
      version: newVersion,
      releaseDate: newChangelog.date,
      description: description || `Update to v${newVersion}`,
      downloadUrl: downloadUrl,
      minVersion: versionConfig?.minVersion || '4.0.0',
      changelog: [newChangelog, ...(versionConfig?.changelog || [])],
    };

    const content = JSON.stringify(config, null, 2);
    versionSha = await writeFile('data/version.json', content, `Release v${newVersion}`, versionSha);
    versionConfig = config;

    // Clear form
    document.getElementById('new-version').value = '';
    document.getElementById('new-download-url').value = '';
    document.getElementById('new-description').value = '';

    renderVersionForm();
    showToast(`📦 Đã phát hành v${newVersion}`, 'success');
  } catch (err) {
    console.error('Update version error:', err);
    showToast(`Lỗi: ${err.message}`, 'error');
  }
}

// =============================================
// UI Helpers
// =============================================

function switchTab(tabName) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `tab-${tabName}`);
  });
}

function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 3000);
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatDate(isoString) {
  if (!isoString) return 'N/A';
  try {
    const d = new Date(isoString);
    return d.toLocaleString('vi-VN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

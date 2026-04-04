/* Global variables for GAPI and GIS */
let tokenClient;
let gapiInited = false;
let gisInited = false;
let spreadsheetId = null;
let userProfile = null; // Store user ID for stable encryption key

const CLIENT_ID = '77769588193-jkh79cchp467cpf649b9ho3h3np1ka5b.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.profile';
const SHEET_NAME = 'Gemini Workspace Sync (Node.js)';
const ENTITIES = ['Ilze', 'Biedrība', 'IK Rīgas Taksis', 'Nils'];
const COLUMNS = ['id', 'date', 'amount', 'cash', 'comment', 'cat a', 'cat ab', 'cat abc', 'cat abcd', 'personal', 'fradulent', 'non-reimbursable', 'vendor'];

/* UI Elements - initialized in DOMContentLoaded */
let signinBtn, signoutBtn, authStatus, logsEl, formSection, setupSection, entitySection, initBtn, txForm, recentTbody, tableStatus;
let ghSetupModal, ghTokenInput, saveGhTokenBtn, checkConnBtn;

document.addEventListener('DOMContentLoaded', () => {
    signinBtn = document.getElementById('signin-btn');
    signoutBtn = document.getElementById('signout-btn');
    authStatus = document.getElementById('auth-status');
    logsEl = document.getElementById('logs');
    formSection = document.getElementById('form-section');
    setupSection = document.getElementById('setup-section');
    entitySection = document.getElementById('entity-section');
    initBtn = document.getElementById('init-btn');
    txForm = document.getElementById('tx-form');
    recentTbody = document.getElementById('recent-tbody');
    tableStatus = document.getElementById('table-status');
    ghSetupModal = document.getElementById('github-setup-modal');
    ghTokenInput = document.getElementById('gh-token-input');
    saveGhTokenBtn = document.getElementById('save-gh-token-btn');
    checkConnBtn = document.getElementById('check-conn-btn');

    /* Event Listeners */
    if (signinBtn) signinBtn.onclick = handleAuthClick;
    if (signoutBtn) signoutBtn.onclick = handleSignoutClick;
    if (initBtn) initBtn.onclick = resetSpreadsheet;
    if (checkConnBtn) checkConnBtn.onclick = testConnection;
    if (saveGhTokenBtn) {
        saveGhTokenBtn.onclick = () => {
            const token = ghTokenInput.value.trim();
            if (token) {
                localStorage.setItem('gh_token', token);
                ghSetupModal.style.display = 'none';
                addLog('GitHub token saved.');
                performEncryptedBackup();
            }
        };
    }

    if (txForm) {
        txForm.addEventListener('submit', handleFormSubmit);
        txForm.addEventListener('input', saveDraft);
    }

    document.querySelectorAll('input[name="entity"]').forEach(radio => {
        radio.addEventListener('change', () => {
            saveDraft();
            refreshDataView();
        });
    });

    document.getElementById('date').valueAsDate = new Date();
    
    // Check initialization
    checkBeforeStart();
});

function addLog(msg) {
    if (!logsEl) {
        console.log(`[LOG-early] ${msg}`);
        return;
    }
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logsEl.prepend(entry);
    console.log(`[LOG] ${msg}`);
}

/* Redundancy: Draft Persistence */
function saveDraft() {
    if (!txForm) return;
    const draft = {
        date: document.getElementById('date').value,
        amount: document.getElementById('amount').value,
        cash: document.getElementById('cash').value,
        comment: document.getElementById('comment').value,
        catA: document.getElementById('cat-a').value,
        catAB: document.getElementById('cat-ab').value,
        catABC: document.getElementById('cat-abc').value,
        catABCD: document.getElementById('cat-abcd').value,
        personal: document.getElementById('personal').checked,
        fradulent: document.getElementById('fradulent').checked,
        nonReimbursable: document.getElementById('non-reimbursable').checked,
        vendor: document.getElementById('vendor').value,
        entity: document.querySelector('input[name="entity"]:checked')?.value
    };
    localStorage.setItem('tx_draft', JSON.stringify(draft));
}

function loadDraft() {
    const draftStr = localStorage.getItem('tx_draft');
    if (!draftStr) return;
    try {
        const draft = JSON.parse(draftStr);
        if (draft.date) document.getElementById('date').value = draft.date;
        if (draft.amount) document.getElementById('amount').value = draft.amount;
        if (draft.cash) document.getElementById('cash').value = draft.cash;
        if (draft.comment) document.getElementById('comment').value = draft.comment;
        if (draft.catA) document.getElementById('cat-a').value = draft.catA;
        if (draft.catAB) document.getElementById('cat-ab').value = draft.catAB;
        if (draft.catABC) document.getElementById('cat-abc').value = draft.catABC;
        if (draft.catABCD) document.getElementById('cat-abcd').value = draft.catABCD;
        if (draft.personal !== undefined) document.getElementById('personal').checked = draft.personal;
        if (draft.fradulent !== undefined) document.getElementById('fradulent').checked = draft.fradulent;
        if (draft.nonReimbursable !== undefined) document.getElementById('non-reimbursable').checked = draft.nonReimbursable;
        if (draft.vendor) document.getElementById('vendor').value = draft.vendor;
        if (draft.entity) {
            const radio = document.querySelector(`input[name="entity"][value="${draft.entity}"]`);
            if (radio) radio.checked = true;
        }
    } catch (e) {
        console.error('Failed to load draft', e);
    }
}

function clearDraft() {
    localStorage.removeItem('tx_draft');
}

/* Encryption & Backup System */
async function fetchUserProfile() {
    try {
        const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { 'Authorization': `Bearer ${gapi.client.getToken().access_token}` }
        });
        userProfile = await response.json();
        addLog(`User identified: ${userProfile.name}`);
        return userProfile;
    } catch (err) {
        console.error('Failed to fetch user profile', err);
        return null;
    }
}

async function performEncryptedBackup() {
    if (!spreadsheetId || !userProfile) return;
    
    addLog('Starting encrypted backup...');
    try {
        const allData = {};
        for (const title of ENTITIES) {
            const response = await gapi.client.sheets.spreadsheets.values.get({
                spreadsheetId: spreadsheetId,
                range: `${title}!A:M`,
            });
            allData[title] = response.result.values || [];
        }

        const jsonData = JSON.stringify(allData);
        const password = userProfile.sub; 
        const encrypted = await window.CryptoManager.encrypt(jsonData, password);

        localStorage.setItem(`backup_local_${userProfile.sub}`, encrypted);
        addLog('Local encrypted backup saved.');

        await backupToGitHub(encrypted);
    } catch (err) {
        addLog('Backup Error: ' + err.message);
        console.error(err);
    }
}

async function backupToGitHub(encryptedData) {
    const ghToken = localStorage.getItem('gh_token');
    if (!ghToken) return;

    const repo = 'nilsriga/gemini-transactions';
    const path = `backups/${userProfile.sub}.enc`;
    const message = `Automated backup for user ${userProfile.name}`;

    try {
        let sha = null;
        const checkResp = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
            headers: { 'Authorization': `token ${ghToken}` }
        });
        if (checkResp.ok) {
            const fileData = await checkResp.json();
            sha = fileData.sha;
        }

        const putResp = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${ghToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message,
                content: btoa(encryptedData),
                sha: sha
            })
        });

        if (putResp.ok) {
            addLog('GitHub backup successful!');
        }
    } catch (err) {
        console.error('GitHub Backup Failed:', err);
    }
}

/* Data View: Fetch Last 20 rows */
async function refreshDataView() {
    if (!spreadsheetId) return;
    const selectedEntity = document.querySelector('input[name="entity"]:checked')?.value;
    if (!selectedEntity) return;

    if (tableStatus) tableStatus.textContent = `Loading ${selectedEntity} data...`;
    try {
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: `${selectedEntity}!A:M`,
        });

        const allRows = response.result.values || [];
        const dataRows = allRows.length > 0 && allRows[0][0] === 'id' ? allRows.slice(1) : allRows;
        const last20 = dataRows.slice(-20).reverse();

        if (recentTbody) {
            recentTbody.innerHTML = '';
            if (last20.length === 0) {
                if (tableStatus) tableStatus.textContent = 'No data found.';
            } else {
                last20.forEach(row => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                        <td>${row[1] || ''}</td>
                        <td>${row[2] || ''}</td>
                        <td>${row[12] || ''}</td>
                        <td>${row[4] || ''}</td>
                    `;
                    recentTbody.appendChild(tr);
                });
                if (tableStatus) tableStatus.textContent = `Showing last ${last20.length} entries for ${selectedEntity}`;
            }
        }
    } catch (err) {
        if (tableStatus) tableStatus.textContent = 'Error loading data.';
        console.error('Data View Error:', err);
    }
}

/* Callback for gapiLoaded */
window.gapiLoaded = function() {
    gapi.load('client', initializeGapiClient);
}

async function initializeGapiClient() {
    await gapi.client.init({
        discoveryDocs: [
            'https://sheets.googleapis.com/$discovery/rest?version=v4',
            'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest'
        ],
    });
    gapiInited = true;
    checkBeforeStart();
}

/* Callback for gisLoaded */
window.gisLoaded = function() {
    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: (resp) => {
            if (resp.error !== undefined) {
                addLog('GIS Error: ' + resp.error);
                throw (resp);
            }
            saveToken(resp);
            onAuthSuccess();
        },
    });
    gisInited = true;
    checkBeforeStart();
}

function saveToken(tokenResp) {
    const expiration = Date.now() + (tokenResp.expires_in * 1000);
    localStorage.setItem('google_token', JSON.stringify({
        ...tokenResp,
        expiration
    }));
}

async function loadPersistedToken() {
    const stored = localStorage.getItem('google_token');
    if (!stored) return false;

    try {
        const tokenData = JSON.parse(stored);
        if (Date.now() > (tokenData.expiration - 60000)) {
            localStorage.removeItem('google_token');
            return false;
        }
        gapi.client.setToken(tokenData);
        return true;
    } catch (e) {
        return false;
    }
}

async function checkBeforeStart() {
    if (gapiInited && gisInited) {
        const hasToken = await loadPersistedToken();
        if (hasToken) {
            addLog('Session restored');
            onAuthSuccess();
        } else {
            if (signinBtn) signinBtn.style.display = 'block';
            if (authStatus) authStatus.textContent = 'Ready to sign in';
        }
    }
}

async function onAuthSuccess() {
    if (signinBtn) signinBtn.style.display = 'none';
    if (signoutBtn) signoutBtn.style.display = 'block';
    if (authStatus) authStatus.textContent = 'Authenticating...';
    
    await findSpreadsheet();
    await fetchUserProfile();
    if (userProfile) {
        await tryDecryptLocalBackup();
    }
    loadDraft();
}

async function tryDecryptLocalBackup() {
    if (!userProfile) return;
    const backupKey = `backup_local_${userProfile.sub}`;
    const encrypted = localStorage.getItem(backupKey);
    if (encrypted) {
        try {
            const decrypted = await window.CryptoManager.decrypt(encrypted, userProfile.sub);
            const data = JSON.parse(decrypted);
            addLog(`Local backup decrypted.`);
        } catch (err) {
            console.error('Backup decryption failed', err);
        }
    }
}

async function handleAuthClick() {
    const token = gapi.client.getToken();
    if (token === null) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        tokenClient.requestAccessToken({ prompt: '' });
    }
}

function handleSignoutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token);
        gapi.client.setToken('');
        localStorage.removeItem('google_token');
        if (signinBtn) signinBtn.style.display = 'block';
        if (signoutBtn) signoutBtn.style.display = 'none';
        if (formSection) formSection.style.display = 'none';
        if (setupSection) setupSection.style.display = 'none';
        if (entitySection) entitySection.style.display = 'none';
        if (authStatus) authStatus.textContent = 'Signed out';
        addLog('Signed out');
    }
}

async function findSpreadsheet() {
    try {
        addLog(`Searching for "${SHEET_NAME}"...`);
        const response = await gapi.client.drive.files.list({
            q: `name = '${SHEET_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet'`,
            fields: 'files(id, name)',
            spaces: 'drive'
        });
        const files = response.result.files;
        if (files && files.length > 0) {
            spreadsheetId = files[0].id;
            addLog(`Connected to Sheet!`);
            if (formSection) formSection.style.display = 'block';
            if (setupSection) setupSection.style.display = 'block';
            if (entitySection) entitySection.style.display = 'block';
            if (authStatus) authStatus.textContent = `Syncing: ${SHEET_NAME}`;
            await refreshDataView();
        } else {
            addLog('Spreadsheet not found!');
            if (authStatus) authStatus.textContent = 'Error: Sheet Missing';
        }
    } catch (err) {
        addLog('Error: ' + (err.result?.error?.message || err.message));
        if (err.status === 401) handleSignoutClick();
    }
}

async function resetSpreadsheet() {
    if (!spreadsheetId) return;
    if (!confirm('Delete all contents?')) return;

    try {
        addLog('Resetting...');
        const spreadsheet = await gapi.client.sheets.spreadsheets.get({ spreadsheetId: spreadsheetId });
        const currentSheetTitles = spreadsheet.result.sheets.map(s => s.properties.title);
        const sheetsToAdd = ENTITIES.filter(title => !currentSheetTitles.includes(title));

        if (sheetsToAdd.length > 0) {
            await gapi.client.sheets.spreadsheets.batchUpdate({
                spreadsheetId: spreadsheetId,
                resource: {
                    requests: sheetsToAdd.map(title => ({ addSheet: { properties: { title } } }))
                }
            });
        }

        for (const title of ENTITIES) {
            await gapi.client.sheets.spreadsheets.values.clear({ spreadsheetId: spreadsheetId, range: `${title}!A:Z` });
            await gapi.client.sheets.spreadsheets.values.update({
                spreadsheetId: spreadsheetId,
                range: `${title}!A1`,
                valueInputOption: 'RAW',
                resource: { values: [COLUMNS] }
            });
        }

        addLog('Reset success!');
        await refreshDataView();
        await performEncryptedBackup();
    } catch (err) {
        addLog('Reset Error: ' + err.message);
    }
}

async function testConnection() {
    if (!spreadsheetId) return;
    addLog('Testing...');
    try {
        const response = await gapi.client.sheets.spreadsheets.get({ spreadsheetId: spreadsheetId });
        addLog(`Healthy: ${response.result.properties.title}`);
        alert(`Connected to: ${response.result.properties.title}`);
    } catch (err) {
        addLog('Test Failed: ' + err.message);
    }
}

async function handleFormSubmit(e) {
    e.preventDefault();
    if (!spreadsheetId) return;

    if (!navigator.onLine) {
        addLog('Offline: saved draft.');
        alert('Offline. Saved as draft.');
        return;
    }

    try {
        const selectedEntity = document.querySelector('input[name="entity"]:checked').value;
        const submitBtn = document.getElementById('submit-btn');
        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = `Syncing...`;
        }

        const row = [
            Date.now().toString().slice(-6),
            document.getElementById('date').value,
            document.getElementById('amount').value,
            document.getElementById('cash').value,
            document.getElementById('comment').value,
            document.getElementById('cat-a').value,
            document.getElementById('cat-ab').value,
            document.getElementById('cat-abc').value,
            document.getElementById('cat-abcd').value,
            document.getElementById('personal').checked ? 'TRUE' : 'FALSE',
            document.getElementById('fradulent').checked ? 'TRUE' : 'FALSE',
            document.getElementById('non-reimbursable').checked ? 'TRUE' : 'FALSE',
            document.getElementById('vendor').value
        ];

        await gapi.client.sheets.spreadsheets.values.append({
            spreadsheetId: spreadsheetId,
            range: `${selectedEntity}!A1`,
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: [row] }
        });

        addLog(`Added to ${selectedEntity}`);
        txForm.reset();
        clearDraft();
        document.getElementById('date').valueAsDate = new Date();
        await refreshDataView();
        await performEncryptedBackup();
    } catch (err) {
        addLog('Error: ' + err.message);
    } finally {
        const submitBtn = document.getElementById('submit-btn');
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Add to Spreadsheet';
        }
    }
}

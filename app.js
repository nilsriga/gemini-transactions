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

/* UI Elements */
const signinBtn = document.getElementById('signin-btn');
const signoutBtn = document.getElementById('signout-btn');
const authStatus = document.getElementById('auth-status');
const logsEl = document.getElementById('logs');
const formSection = document.getElementById('form-section');
const setupSection = document.getElementById('setup-section');
const entitySection = document.getElementById('entity-section');
const initBtn = document.getElementById('init-btn');
const txForm = document.getElementById('tx-form');
const recentTbody = document.getElementById('recent-tbody');
const tableStatus = document.getElementById('table-status');

/* GitHub Setup UI */
const ghSetupModal = document.getElementById('github-setup-modal');
const ghTokenInput = document.getElementById('gh-token-input');
const saveGhTokenBtn = document.getElementById('save-gh-token-btn');

function addLog(msg) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logsEl.prepend(entry);
    console.log(`[LOG] ${msg}`);
}

/* Redundancy: Draft Persistence */
function saveDraft() {
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
        // Fetch ALL data from ALL entities for full backup
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

saveGhTokenBtn.onclick = () => {
    const token = ghTokenInput.value.trim();
    if (token) {
        localStorage.setItem('gh_token', token);
        ghSetupModal.style.display = 'none';
        addLog('GitHub token saved.');
        performEncryptedBackup();
    }
};

/* Data View: Fetch Last 20 rows */
async function refreshDataView() {
    if (!spreadsheetId) return;
    const selectedEntity = document.querySelector('input[name="entity"]:checked')?.value;
    if (!selectedEntity) return;

    if (tableStatus) tableStatus.textContent = `Loading ${selectedEntity} data...`;
    try {
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: spreadsheetId,
            range: `${selectedEntity}!A:M`, // Fetch from A1 to include headers for verification
        });

        const allRows = response.result.values || [];
        // Filter out the header row if it exists
        const dataRows = allRows.length > 0 && allRows[0][0] === 'id' ? allRows.slice(1) : allRows;
        
        const last20 = dataRows.slice(-20).reverse(); // Newest first

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
function gapiLoaded() {
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
function gisLoaded() {
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

/**
 * Persists token to localStorage
 */
function saveToken(tokenResp) {
    const expiration = Date.now() + (tokenResp.expires_in * 1000);
    localStorage.setItem('google_token', JSON.stringify({
        ...tokenResp,
        expiration
    }));
}

/**
 * Checks for a valid token in localStorage and sets it in GAPI
 */
async function loadPersistedToken() {
    const stored = localStorage.getItem('google_token');
    if (!stored) return false;

    try {
        const tokenData = JSON.parse(stored);
        if (Date.now() > (tokenData.expiration - 60000)) { // 1 min buffer
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
            addLog('Session restored from storage');
            onAuthSuccess();
        } else {
            signinBtn.style.display = 'block';
            authStatus.textContent = 'Ready to sign in';
        }
    }
}

async function onAuthSuccess() {
    signinBtn.style.display = 'none';
    signoutBtn.style.display = 'block';
    authStatus.textContent = 'Authenticating...';
    
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
            addLog(`Local backup decrypted (Data for ${Object.keys(data).length} entities).`);
        } catch (err) {
            console.error('Backup decryption failed', err);
        }
    }
}

async function handleAuthClick() {
    // Check if we already have a token first
    const token = gapi.client.getToken();
    if (token === null) {
        // Request token with a popup (crucial for mobile/PWA)
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        // Silent request if already granted
        tokenClient.requestAccessToken({ prompt: '' });
    }
}

function handleSignoutClick() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token);
        gapi.client.setToken('');
        localStorage.removeItem('google_token');
        signinBtn.style.display = 'block';
        signoutBtn.style.display = 'none';
        formSection.style.display = 'none';
        setupSection.style.display = 'none';
        entitySection.style.display = 'none';
        authStatus.textContent = 'Signed out';
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
            formSection.style.display = 'block';
            setupSection.style.display = 'block';
            entitySection.style.display = 'block';
            authStatus.textContent = `Syncing: ${SHEET_NAME}`;
            await refreshDataView();
        } else {
            addLog('Spreadsheet not found! Create it first.');
            authStatus.textContent = 'Error: Sheet Missing';
        }
    } catch (err) {
        addLog('Error: ' + (err.result?.error?.message || err.message));
        if (err.status === 401) handleSignoutClick();
    }
}

async function resetSpreadsheet() {
    if (!spreadsheetId) return;
    if (!confirm('Do you really want to delete all the contents and reset headers for ALL entities?')) return;

    try {
        addLog('Resetting sheets...');
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

        addLog('Reset successful!');
        await refreshDataView();
        await performEncryptedBackup();
    } catch (err) {
        addLog('Reset Error: ' + err.message);
    }
}

async function testConnection() {
    if (!spreadsheetId) return;
    addLog('Testing connection...');
    try {
        const response = await gapi.client.sheets.spreadsheets.get({ spreadsheetId: spreadsheetId });
        addLog(`Healthy: ${response.result.properties.title}`);
        alert(`Connected to: ${response.result.properties.title}`);
    } catch (err) {
        addLog('Test Failed: ' + err.message);
    }
}

txForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!spreadsheetId) return;

    if (!navigator.onLine) {
        addLog('Offline: Transaction saved to draft.');
        alert('You are offline. Transaction saved as draft.');
        return;
    }

    try {
        const selectedEntity = document.querySelector('input[name="entity"]:checked').value;
        const submitBtn = document.getElementById('submit-btn');
        submitBtn.disabled = true;
        submitBtn.textContent = `Syncing...`;

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

        addLog(`Success! Added to ${selectedEntity}`);
        txForm.reset();
        clearDraft();
        document.getElementById('date').valueAsDate = new Date();
        await refreshDataView();
        await performEncryptedBackup();
    } catch (err) {
        addLog('Error: ' + err.message);
    } finally {
        const submitBtn = document.getElementById('submit-btn');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add to Spreadsheet';
    }
});

/* Event Listeners for Draft Persistence */
txForm.addEventListener('input', saveDraft);
document.querySelectorAll('input[name="entity"]').forEach(radio => {
    radio.addEventListener('change', () => {
        saveDraft();
        refreshDataView();
    });
});

signinBtn.onclick = handleAuthClick;
signoutBtn.onclick = handleSignoutClick;
initBtn.onclick = resetSpreadsheet;

const checkConnBtn = document.getElementById('check-conn-btn');
if (checkConnBtn) checkConnBtn.onclick = testConnection;

document.getElementById('date').valueAsDate = new Date();
refreshDataView(); // Initial call

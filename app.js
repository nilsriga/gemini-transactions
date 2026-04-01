/* Global variables for GAPI and GIS */
let tokenClient;
let gapiInited = false;
let gisInited = false;
let spreadsheetId = null;

const CLIENT_ID = '77769588193-jkh79cchp467cpf649b9ho3h3np1ka5b.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly';
const SHEET_NAME = 'Gemini Workspace Sync (Node.js)';
const COLUMNS = ['id', 'date', 'amount', 'cash', 'comment', 'cat a', 'cat ab', 'cat abc', 'cat abcd', 'personal', 'fradulent', 'non-reimbursable', 'vendor'];

/* UI Elements */
const signinBtn = document.getElementById('signin-btn');
const signoutBtn = document.getElementById('signout-btn');
const authStatus = document.getElementById('auth-status');
const logsEl = document.getElementById('logs');
const formSection = document.getElementById('form-section');
const setupSection = document.getElementById('setup-section');
const initBtn = document.getElementById('init-btn');
const txForm = document.getElementById('tx-form');

function addLog(msg) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    logsEl.prepend(entry);
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
        callback: '', // defined later in handleAuthClick
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

    const tokenData = JSON.parse(stored);
    if (Date.now() > tokenData.expiration) {
        localStorage.removeItem('google_token');
        return false;
    }

    gapi.client.setToken(tokenData);
    return true;
}

async function checkBeforeStart() {
    if (gapiInited && gisInited) {
        const hasToken = await loadPersistedToken();
        if (hasToken) {
            signinBtn.style.display = 'none';
            signoutBtn.style.display = 'block';
            authStatus.textContent = 'Restored Session';
            addLog('Session restored from storage');
            await findSpreadsheet();
        } else {
            signinBtn.style.display = 'block';
            authStatus.textContent = 'Ready to sign in';
        }
    }
}

async function handleAuthClick() {
    tokenClient.callback = async (resp) => {
        if (resp.error !== undefined) {
            throw (resp);
        }
        saveToken(resp);
        signinBtn.style.display = 'none';
        signoutBtn.style.display = 'block';
        authStatus.textContent = 'Authenticated';
        addLog('Successfully authenticated');
        await findSpreadsheet();
    };

    if (gapi.client.getToken() === null) {
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
        signinBtn.style.display = 'block';
        signoutBtn.style.display = 'none';
        formSection.style.display = 'none';
        setupSection.style.display = 'none';
        authStatus.textContent = 'Signed out';
        addLog('Signed out and cleared storage');
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
            authStatus.textContent = `Syncing: ${SHEET_NAME}`;
        } else {
            addLog('Spreadsheet not found! Create it first.');
            authStatus.textContent = 'Error: Sheet Missing';
        }
    } catch (err) {
        addLog('Error: ' + (err.result?.error?.message || err.message));
        if (err.status === 401) {
            handleSignoutClick(); // Token probably expired
        }
    }
}

async function resetSpreadsheet() {
    if (!spreadsheetId) return;
    if (!confirm('Are you sure you want to delete ALL data and reset headers?')) return;

    try {
        addLog('Resetting...');
        await gapi.client.sheets.spreadsheets.values.clear({
            spreadsheetId: spreadsheetId,
            range: 'Sheet1',
        });

        await gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId: spreadsheetId,
            range: 'Sheet1!A1',
            valueInputOption: 'RAW',
            resource: {
                values: [COLUMNS]
            }
        });

        addLog('Reset successful!');
    } catch (err) {
        addLog('Reset Error: ' + err.message);
    }
}

txForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!spreadsheetId) return;

    try {
        const submitBtn = document.getElementById('submit-btn');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Syncing...';

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
            range: 'Sheet1!A1',
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            resource: {
                values: [row]
            }
        });

        addLog('Success!');
        txForm.reset();
        document.getElementById('date').valueAsDate = new Date();
    } catch (err) {
        addLog('Error: ' + err.message);
    } finally {
        const submitBtn = document.getElementById('submit-btn');
        submitBtn.disabled = false;
        submitBtn.textContent = 'Add to Spreadsheet';
    }
});

signinBtn.onclick = handleAuthClick;
signoutBtn.onclick = handleSignoutClick;
initBtn.onclick = resetSpreadsheet;

document.getElementById('date').valueAsDate = new Date();

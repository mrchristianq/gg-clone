/***** CONFIG *****/
const IGDB_BASE = "https://api.igdb.com/v4";
const SCRIPT_PROPS = PropertiesService.getScriptProperties();

// Property keys
const CLIENT_ID_KEY = "TWITCH_CLIENT_ID";
const CLIENT_SECRET_KEY = "TWITCH_CLIENT_SECRET";
const TOKEN_KEY = "IGDB_TOKEN";
const TOKEN_EXP_KEY = "IGDB_TOKEN_EXP";

// Your setup
const SHEET_NAME = "database";
const FOLDER_ID = "1WetCEEJG9PJAkBRmfkLSrI2W3CuspKDv";

// Sheet + headers
const TITLE_HEADER = "Title";
const HEADER_MAP = {
  id: "IGDB_ID",
  name: "Name",
  releaseDate: "ReleaseDate",
  genres: "Genres",
  platforms: "Platforms",
  coverUrl: "CoverURL",
  rating: "Rating",
  idOverride: "IGDB_ID_Override",

  // local caching targets
  localCoverUrl: "LocalCoverURL",
  coverCachedAt: "CoverCachedAt",

  // ✅ IMPORTANT: must match your existing header EXACTLY
  dateAdded: "Date Added",
};

// Pacing (fine even for 1–2 rows)
const RATE_SLEEP_MS = 150;
const COVER_SIZE = "t_cover_big";

/***** MENU *****/
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("IGDB")
    .addItem("Set Credentials", "igdbPromptCreds")
    .addSeparator()
    .addItem("Process Single Row…", "igdbPromptSingleRow")
    .addItem("Process Active Row", "igdbProcessActiveRow")
    .addToUi();
}

/***** CREDENTIALS *****/
function igdbPromptCreds() {
  const ui = SpreadsheetApp.getUi();
  const idResp = ui.prompt(
    "IGDB / Twitch Client ID",
    "Enter your Twitch Client ID:",
    ui.ButtonSet.OK_CANCEL
  );
  if (idResp.getSelectedButton() !== ui.Button.OK) return;

  const secretResp = ui.prompt(
    "IGDB / Twitch Client Secret",
    "Enter your Twitch Client Secret:",
    ui.ButtonSet.OK_CANCEL
  );
  if (secretResp.getSelectedButton() !== ui.Button.OK) return;

  SCRIPT_PROPS.setProperty(CLIENT_ID_KEY, idResp.getResponseText().trim());
  SCRIPT_PROPS.setProperty(CLIENT_SECRET_KEY, secretResp.getResponseText().trim());
  SCRIPT_PROPS.deleteProperty(TOKEN_KEY);
  SCRIPT_PROPS.deleteProperty(TOKEN_EXP_KEY);

  ui.alert("Saved. You’re ready to run IGDB → Process Active Row.");
}

/***** TOKEN MGMT *****/
function getIgdbToken_() {
  const now = Math.floor(Date.now() / 1000);
  const cached = SCRIPT_PROPS.getProperty(TOKEN_KEY);
  const expStr = SCRIPT_PROPS.getProperty(TOKEN_EXP_KEY);
  if (cached && expStr && Number(expStr) - 60 > now) return cached;

  const client_id = SCRIPT_PROPS.getProperty(CLIENT_ID_KEY);
  const client_secret = SCRIPT_PROPS.getProperty(CLIENT_SECRET_KEY);
  if (!client_id || !client_secret) {
    throw new Error("Missing Twitch Client ID/Secret. Use IGDB → Set Credentials.");
  }

  const res = UrlFetchApp.fetch("https://id.twitch.tv/oauth2/token", {
    method: "post",
    payload: { client_id, client_secret, grant_type: "client_credentials" },
    muteHttpExceptions: true,
  });

  const json = JSON.parse(res.getContentText());
  if (!json.access_token) throw new Error("Failed to obtain IGDB token: " + res.getContentText());

  const expiresAt = now + Number(json.expires_in || 0);
  SCRIPT_PROPS.setProperty(TOKEN_KEY, json.access_token);
  SCRIPT_PROPS.setProperty(TOKEN_EXP_KEY, String(expiresAt));
  return json.access_token;
}

/***** CORE FETCH WITH LIGHT BACKOFF *****/
function igdbPost_(endpoint, bodyText) {
  const token = getIgdbToken_();
  const clientId = SCRIPT_PROPS.getProperty(CLIENT_ID_KEY);
  const url = `${IGDB_BASE}/${endpoint}`;

  const res = UrlFetchApp.fetch(url, {
    method: "post",
    payload: bodyText,
    contentType: "text/plain",
    headers: {
      "Client-ID": clientId,
      Authorization: `Bearer ${token}`,
    },
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  if (code === 429) {
    Utilities.sleep(1200);
    return igdbPost_(endpoint, bodyText);
  }
  if (code < 200 || code >= 300) {
    throw new Error(`IGDB error ${code}: ${res.getContentText()}`);
  }
  return JSON.parse(res.getContentText());
}

/***** HELPERS *****/
function unixToISO_(sec) {
  if (!sec) return "";
  const d = new Date(sec * 1000);
  return Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM-dd");
}

function safeJoin_(arr, key) {
  if (!Array.isArray(arr)) return "";
  if (key) return arr.map((o) => (o && o[key]) || "").filter(Boolean).join(", ");
  return arr.filter(Boolean).join(", ");
}

function normalizeCoverUrl_(coverObj, size) {
  if (!coverObj || !coverObj.url) return "";
  const raw = coverObj.url.startsWith("http") ? coverObj.url : "https:" + coverObj.url;
  return size ? raw.replace(/t_[a-z0-9_]+/i, size) : raw;
}

function toast_(msg) {
  SpreadsheetApp.getActiveSpreadsheet().toast(msg, "IGDB", 5);
}

function sanitizeFileName_(name) {
  return String(name || "game")
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * Downloads coverUrl and stores in Drive folder.
 * Returns a link that works in <img src="...">:
 * https://drive.google.com/uc?export=view&id=FILE_ID
 */
function cacheCoverToDrive_(folder, title, coverUrl) {
  if (!coverUrl) return "";

  const resp = UrlFetchApp.fetch(coverUrl, {
    muteHttpExceptions: true,
    followRedirects: true,
  });

  const code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(`Cover fetch failed (${code})`);
  }

  const contentType = String(resp.getHeaders()["Content-Type"] || "").toLowerCase();
  let ext = "jpg";
  if (contentType.includes("png")) ext = "png";
  else if (contentType.includes("webp")) ext = "webp";

  const safeName = sanitizeFileName_(title);
  const blob = resp.getBlob().setName(`${safeName}.${ext}`);

  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // ✅ FIX: no stray fileId variable
  return `https://drive.google.com/uc?export=view&id=${file.getId()}`;
}

/***** HEADER / COLUMN MANAGEMENT *****/
function ensureHeadersAndGetIndexes_(sh) {
  const headerRow = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  let headers = headerRow.map(String);

  function ensureHeader(name) {
    let idx = headers.indexOf(name);
    if (idx === -1) {
      headers.push(name);
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      idx = headers.length - 1;
    }
    return idx + 1; // 1-based
  }

  const titleCol = ensureHeader(TITLE_HEADER);
  const idCol = ensureHeader(HEADER_MAP.id);
  const nameCol = ensureHeader(HEADER_MAP.name);
  const releaseCol = ensureHeader(HEADER_MAP.releaseDate);
  const genresCol = ensureHeader(HEADER_MAP.genres);
  const platsCol = ensureHeader(HEADER_MAP.platforms);
  const coverCol = ensureHeader(HEADER_MAP.coverUrl);
  const ratingCol = ensureHeader(HEADER_MAP.rating);
  const idOverrideCol = ensureHeader(HEADER_MAP.idOverride);

  const localCoverCol = ensureHeader(HEADER_MAP.localCoverUrl);
  const cachedAtCol = ensureHeader(HEADER_MAP.coverCachedAt);

  // ✅ uses your existing "Date Added" header (and if it somehow didn’t exist, it will create it with the correct name)
  const dateAddedCol = ensureHeader(HEADER_MAP.dateAdded);

  return {
    titleCol,
    idCol,
    nameCol,
    releaseCol,
    genresCol,
    platsCol,
    coverCol,
    ratingCol,
    idOverrideCol,
    localCoverCol,
    cachedAtCol,
    dateAddedCol,
  };
}

/***** PROCESS ACTIVE / SINGLE ROW *****/
function igdbProcessActiveRow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) throw new Error(`Sheet not found: ${SHEET_NAME}`);

  const rowNum = sh.getActiveRange().getRow();
  if (rowNum < 2) {
    SpreadsheetApp.getUi().alert("Select a data row (row 2 or below).");
    return;
  }

  igdbProcessOneRow_(sh, rowNum);
}

function igdbPromptSingleRow() {
  const ui = SpreadsheetApp.getUi();
  const resp = ui.prompt("Enter row number to process", "", ui.ButtonSet.OK_CANCEL);
  if (resp.getSelectedButton() !== ui.Button.OK) return;

  const rowNum = parseInt(resp.getResponseText(), 10);
  if (isNaN(rowNum)) {
    ui.alert("Invalid number.");
    return;
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) throw new Error(`Sheet not found: ${SHEET_NAME}`);

  igdbProcessOneRow_(sh, rowNum);
}

function igdbProcessOneRow_(sh, rowIndex) {
  const cols = ensureHeadersAndGetIndexes_(sh);
  const folder = DriveApp.getFolderById(FOLDER_ID);

  const row = sh.getRange(rowIndex, 1, 1, sh.getLastColumn()).getValues()[0];

  const title = String(row[cols.titleCol - 1] || "").trim();
  const idOverride = String(row[cols.idOverrideCol - 1] || "").trim();

  if (!idOverride && !title) {
    toast_(`Row ${rowIndex}: needs Title or IGDB_ID_Override.`);
    return;
  }

  toast_(`Processing row ${rowIndex}...`);

  // Build IGDB query
  let body;
  if (idOverride) {
    body = [
      "fields id,name,first_release_date,genres.name,platforms.name,cover.url,rating;",
      `where id = ${Number(idOverride)};`,
      "limit 1;",
    ].join("\n");
  } else {
    body = [
      "fields id,name,first_release_date,genres.name,platforms.name,cover.url,rating;",
      `search "${title.replace(/"/g, '\\"')}";`,
      "limit 1;",
    ].join("\n");
  }

  let g = null;
  try {
    const data = igdbPost_("games", body);
    g = (data && data[0]) || null;
  } catch (err) {
    sh.getRange(rowIndex, cols.coverCol).setValue("ERR: " + String(err).slice(0, 200));
    return;
  }
  if (!g) {
    toast_(`Row ${rowIndex}: no match found.`);
    return;
  }

  const id = g.id || "";
  const name = g.name || "";
  const rel = unixToISO_(g.first_release_date);
  const genres = safeJoin_(g.genres, "name");
  const plats = safeJoin_(g.platforms, "name");
  const cover = normalizeCoverUrl_(g.cover, COVER_SIZE);
  const igdbRating = g.rating != null ? Number(g.rating) : "";

  // Write IGDB fields
  sh.getRange(rowIndex, cols.idCol).setValue(id);
  sh.getRange(rowIndex, cols.nameCol).setValue(name);
  sh.getRange(rowIndex, cols.releaseCol).setValue(rel);
  sh.getRange(rowIndex, cols.genresCol).setValue(genres);
  sh.getRange(rowIndex, cols.platsCol).setValue(plats);
  sh.getRange(rowIndex, cols.coverCol).setValue(cover);
  sh.getRange(rowIndex, cols.ratingCol).setValue(igdbRating);

  Utilities.sleep(RATE_SLEEP_MS);

  // ✅ Date Added: set only if empty, and date only (no time)
  const existingDateAdded = row[cols.dateAddedCol - 1];
  if (!existingDateAdded) {
    const today = new Date();
    today.setHours(0, 0, 0, 0); // date-only
    sh.getRange(rowIndex, cols.dateAddedCol).setValue(today);
    // optional: force display as date
    sh.getRange(rowIndex, cols.dateAddedCol).setNumberFormat("yyyy-mm-dd");
  }

  // ✅ Cache cover to Drive if not already cached
  const existingLocal = String(row[cols.localCoverCol - 1] || "").trim();
  if (cover && !existingLocal) {
    try {
      const localUrl = cacheCoverToDrive_(folder, name || title, cover);
      if (localUrl) {
        sh.getRange(rowIndex, cols.localCoverCol).setValue(localUrl);
        sh.getRange(rowIndex, cols.cachedAtCol).setValue(new Date());
      }
    } catch (e) {
      sh.getRange(rowIndex, cols.localCoverCol).setValue("ERR: " + String(e).slice(0, 200));
    }
  }

  toast_(`Done: row ${rowIndex}.`);
}

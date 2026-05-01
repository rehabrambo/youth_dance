const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";
const PUBLIC_URL = trimTrailingSlash(process.env.PUBLIC_URL || "");
const MODERATOR_KEY = process.env.MODERATOR_KEY || "";

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT_DIR, "data");
const DATA_FILE = path.join(DATA_DIR, "messages.json");

const MAX_NAME_LENGTH = 40;
const MAX_MESSAGE_LENGTH = 240;
const DISPLAY_LIMIT = 24;
const MODERATION_LIMIT = 80;

const clients = {
  display: new Set(),
  moderator: new Set(),
};

let messages = loadMessages();

fs.mkdirSync(DATA_DIR, { recursive: true });

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => {
    console.error(error);
    sendJson(res, 500, { error: "Something went wrong on the server." });
  });
});

server.listen(PORT, HOST, () => {
  const info = getAppInfo();
  console.log("");
  console.log("Local Message Wall is running");
  console.log(`Submit:    ${info.submitUrl}`);
  console.log(`Moderate:  ${info.moderateUrl}${MODERATOR_KEY ? `?key=${encodeURIComponent(MODERATOR_KEY)}` : ""}`);
  console.log(`QR Code:   ${info.qrCodeUrl}`);
  console.log(`Display:   ${info.displayUrl}`);
  console.log("");
  console.log("Keep this window open while people are sending messages.");
});

async function handleRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === "GET" && pathname === "/") {
    return serveFile(res, path.join(PUBLIC_DIR, "index.html"));
  }

  if (req.method === "GET" && pathname === "/moderate") {
    return serveFile(res, path.join(PUBLIC_DIR, "moderate.html"));
  }

  if (req.method === "GET" && pathname === "/qr-code") {
    return serveFile(res, path.join(PUBLIC_DIR, "qr-code.html"));
  }

  if (req.method === "GET" && pathname === "/display") {
    return serveFile(res, path.join(PUBLIC_DIR, "display.html"));
  }

  if (req.method === "GET" && pathname === "/api/app-info") {
    return sendJson(res, 200, getAppInfo(req));
  }

  if (req.method === "GET" && pathname === "/api/messages") {
    const status = url.searchParams.get("status");
    if (status !== "approved" && !ensureModerator(req, res, url)) return;
    return sendJson(res, 200, getMessages(status));
  }

  if (req.method === "POST" && pathname === "/api/messages") {
    return createMessage(req, res);
  }

  const messageMatch = pathname.match(/^\/api\/messages\/([^/]+)$/);
  if (messageMatch && req.method === "PATCH") {
    if (!ensureModerator(req, res, url)) return;
    return updateMessage(req, res, messageMatch[1]);
  }

  if (messageMatch && req.method === "DELETE") {
    if (!ensureModerator(req, res, url)) return;
    return deleteMessage(res, messageMatch[1]);
  }

  if (req.method === "GET" && pathname === "/events/display") {
    return openEvents(req, res, "display", displaySnapshot);
  }

  if (req.method === "GET" && pathname === "/events/moderator") {
    if (!ensureModerator(req, res, url)) return;
    return openEvents(req, res, "moderator", moderatorSnapshot);
  }

  if (req.method === "GET" && pathname === "/qr.svg") {
    return serveQr(req, res, url);
  }

  if (req.method === "GET" && pathname.startsWith("/public/")) {
    return serveFile(res, path.join(ROOT_DIR, pathname));
  }

  if (req.method === "GET" && pathname === "/health") {
    return sendJson(res, 200, { ok: true });
  }

  sendJson(res, 404, { error: "Not found." });
}

async function createMessage(req, res) {
  const body = await readJson(req);
  const name = cleanText(body.name, MAX_NAME_LENGTH) || "Anonymous";
  const text = cleanText(body.text, MAX_MESSAGE_LENGTH);

  if (!text) {
    return sendJson(res, 400, { error: "Message is required." });
  }

  const now = new Date().toISOString();
  const message = {
    id: createId(),
    name,
    text,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };

  messages.unshift(message);
  saveMessages();
  broadcast("moderator", moderatorSnapshot());

  sendJson(res, 201, {
    ok: true,
    message: publicMessage(message),
  });
}

async function updateMessage(req, res, id) {
  const body = await readJson(req);
  const status = cleanText(body.status, 20);
  const allowed = new Set(["pending", "approved", "rejected"]);

  if (!allowed.has(status)) {
    return sendJson(res, 400, { error: "Status must be pending, approved, or rejected." });
  }

  const message = messages.find((item) => item.id === id);
  if (!message) {
    return sendJson(res, 404, { error: "Message not found." });
  }

  message.status = status;
  message.updatedAt = new Date().toISOString();
  saveMessages();

  broadcast("moderator", moderatorSnapshot());
  broadcast("display", displaySnapshot());

  sendJson(res, 200, {
    ok: true,
    message: publicMessage(message),
  });
}

function deleteMessage(res, id) {
  const index = messages.findIndex((item) => item.id === id);
  if (index === -1) {
    return sendJson(res, 404, { error: "Message not found." });
  }

  messages.splice(index, 1);
  saveMessages();

  broadcast("moderator", moderatorSnapshot());
  broadcast("display", displaySnapshot());

  sendJson(res, 200, { ok: true });
}

function getMessages(status) {
  const filtered = status ? messages.filter((message) => message.status === status) : messages;
  return filtered.slice(0, MODERATION_LIMIT).map(publicMessage);
}

function moderatorSnapshot() {
  return {
    pending: messages.filter((message) => message.status === "pending").slice(0, MODERATION_LIMIT).map(publicMessage),
    approved: messages.filter((message) => message.status === "approved").slice(0, MODERATION_LIMIT).map(publicMessage),
    rejected: messages.filter((message) => message.status === "rejected").slice(0, MODERATION_LIMIT).map(publicMessage),
    counts: {
      pending: messages.filter((message) => message.status === "pending").length,
      approved: messages.filter((message) => message.status === "approved").length,
      rejected: messages.filter((message) => message.status === "rejected").length,
    },
  };
}

function displaySnapshot() {
  return {
    approved: messages
      .filter((message) => message.status === "approved")
      .slice(0, DISPLAY_LIMIT)
      .map(publicMessage),
  };
}

function openEvents(req, res, channel, snapshotFactory) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const client = { res };
  clients[channel].add(client);
  sendEvent(res, "snapshot", snapshotFactory());

  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    clients[channel].delete(client);
  });
}

function broadcast(channel, payload) {
  for (const client of clients[channel]) {
    sendEvent(client.res, "snapshot", payload);
  }
}

function sendEvent(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function ensureModerator(req, res, url) {
  if (!MODERATOR_KEY) return true;

  const headerKey = req.headers["x-moderator-key"];
  const queryKey = url.searchParams.get("key");
  if (headerKey === MODERATOR_KEY || queryKey === MODERATOR_KEY) return true;

  sendJson(res, 401, { error: "Moderator key required." });
  return false;
}

function serveQr(req, res, url) {
  const info = getAppInfo(req);
  const data = url.searchParams.get("data") || info.submitUrl;

  try {
    const svg = createQrSvg(data);
    res.writeHead(200, {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(svg);
  } catch (error) {
    sendJson(res, 400, { error: error.message });
  }
}

function serveFile(res, filePath) {
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(ROOT_DIR)) {
    return sendJson(res, 403, { error: "Forbidden." });
  }

  fs.readFile(normalized, (error, content) => {
    if (error) {
      return sendJson(res, 404, { error: "Not found." });
    }

    res.writeHead(200, {
      "Content-Type": mimeType(normalized),
      "Cache-Control": "no-store",
    });
    res.end(content);
  });
}

function sendJson(res, status, payload) {
  if (res.headersSent) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) {
        reject(new Error("Payload too large."));
        req.destroy();
      }
    });

    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Invalid JSON."));
      }
    });

    req.on("error", reject);
  });
}

function publicMessage(message) {
  return {
    id: message.id,
    name: message.name,
    text: message.text,
    status: message.status,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function createId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function loadMessages() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch (error) {
    return [];
  }
}

function saveMessages() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tempFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(messages, null, 2));
  fs.renameSync(tempFile, DATA_FILE);
}

function getAppInfo(req) {
  const port = getRequestPort(req) || PORT;
  const ips = getLocalIps();
  const preferredHost = ips[0] || "localhost";
  const requestBaseUrl = getRequestBaseUrl(req);
  const baseUrl = PUBLIC_URL || requestBaseUrl || `http://${preferredHost}:${port}`;
  const localUrls = ips.map((ip) => `http://${ip}:${port}`);

  return {
    baseUrl,
    submitUrl: `${baseUrl}/`,
    moderateUrl: `${baseUrl}/moderate`,
    qrCodeUrl: `${baseUrl}/qr-code`,
    displayUrl: `${baseUrl}/display`,
    localUrls,
    maxMessageLength: MAX_MESSAGE_LENGTH,
    moderatorKeyEnabled: Boolean(MODERATOR_KEY),
  };
}

function getRequestBaseUrl(req) {
  if (!req || !req.headers.host) return "";
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim();
  const proto = forwardedProto || (req.socket.encrypted ? "https" : "http");
  return `${proto}://${req.headers.host}`;
}

function getRequestPort(req) {
  if (!req || !req.headers.host) return null;
  const host = req.headers.host;
  const match = host.match(/:(\d+)$/);
  return match ? Number(match[1]) : null;
}

function getLocalIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];

  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        ips.push(entry.address);
      }
    }
  }

  return ips;
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml; charset=utf-8",
  };
  return types[ext] || "application/octet-stream";
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function createQrSvg(text) {
  const modules = createQrModules(text);
  const quiet = 4;
  const size = modules.length + quiet * 2;
  const rects = [];

  for (let y = 0; y < modules.length; y += 1) {
    for (let x = 0; x < modules.length; x += 1) {
      if (modules[y][x]) {
        rects.push(`<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1"/>`);
      }
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR code">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    `<g fill="#111111">${rects.join("")}</g>`,
    `</svg>`,
  ].join("");
}

function createQrModules(text) {
  const version = 5;
  const size = 21 + (version - 1) * 4;
  const dataCodewords = 108;
  const errorCorrectionCodewords = 26;
  const bytes = Array.from(Buffer.from(text, "utf8"));

  if (bytes.length > 100) {
    throw new Error("QR data is too long. Set PUBLIC_URL to a shorter local address.");
  }

  const modules = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () => Array(size).fill(false));

  drawFunctionPatterns(modules, isFunction, version);

  const data = makeDataCodewords(bytes, dataCodewords);
  const divisor = reedSolomonDivisor(errorCorrectionCodewords);
  const ecc = reedSolomonRemainder(data, divisor);
  drawCodewords(modules, isFunction, data.concat(ecc));

  let bestMask = 0;
  let bestPenalty = Infinity;
  let bestModules = modules;

  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = modules.map((row) => row.slice());
    applyMask(candidate, isFunction, mask);
    drawFormatBits(candidate, isFunction, mask);
    const penalty = getPenaltyScore(candidate);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMask = mask;
      bestModules = candidate;
    }
  }

  drawFormatBits(bestModules, isFunction, bestMask);
  return bestModules;
}

function makeDataCodewords(bytes, capacity) {
  const bits = [];
  appendBits(bits, 0x4, 4);
  appendBits(bits, bytes.length, 8);
  for (const byte of bytes) appendBits(bits, byte, 8);

  const capacityBits = capacity * 8;
  appendBits(bits, 0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) value = (value << 1) | bits[i + j];
    data.push(value);
  }

  const pads = [0xec, 0x11];
  for (let i = 0; data.length < capacity; i += 1) {
    data.push(pads[i % 2]);
  }

  return data;
}

function appendBits(bits, value, length) {
  for (let i = length - 1; i >= 0; i -= 1) {
    bits.push((value >>> i) & 1);
  }
}

function drawFunctionPatterns(modules, isFunction, version) {
  const size = modules.length;
  drawFinder(modules, isFunction, 0, 0);
  drawFinder(modules, isFunction, size - 7, 0);
  drawFinder(modules, isFunction, 0, size - 7);

  for (let i = 8; i < size - 8; i += 1) {
    setFunction(modules, isFunction, i, 6, i % 2 === 0);
    setFunction(modules, isFunction, 6, i, i % 2 === 0);
  }

  drawAlignment(modules, isFunction, size - 7, size - 7);
  setFunction(modules, isFunction, 8, 4 * version + 9, true);
  reserveFormatAreas(modules, isFunction);
}

function drawFinder(modules, isFunction, left, top) {
  for (let dy = -1; dy <= 7; dy += 1) {
    for (let dx = -1; dx <= 7; dx += 1) {
      const x = left + dx;
      const y = top + dy;
      if (!inBounds(modules, x, y)) continue;

      const inFinder = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
      const dark =
        inFinder &&
        (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
      setFunction(modules, isFunction, x, y, dark);
    }
  }
}

function drawAlignment(modules, isFunction, centerX, centerY) {
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) {
      const distance = Math.max(Math.abs(dx), Math.abs(dy));
      setFunction(modules, isFunction, centerX + dx, centerY + dy, distance === 0 || distance === 2);
    }
  }
}

function reserveFormatAreas(modules, isFunction) {
  const size = modules.length;
  const positions = [
    ...Array.from({ length: 6 }, (_, i) => [8, i]),
    [8, 7],
    [8, 8],
    [7, 8],
    ...Array.from({ length: 6 }, (_, i) => [i, 8]),
    ...Array.from({ length: 8 }, (_, i) => [size - 1 - i, 8]),
    ...Array.from({ length: 7 }, (_, i) => [8, size - 7 + i]),
  ];

  for (const [x, y] of positions) {
    setFunction(modules, isFunction, x, y, false);
  }
}

function drawCodewords(modules, isFunction, codewords) {
  const size = modules.length;
  let bitIndex = 0;
  let upward = true;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right -= 1;

    for (let vertical = 0; vertical < size; vertical += 1) {
      const y = upward ? size - 1 - vertical : vertical;

      for (let column = 0; column < 2; column += 1) {
        const x = right - column;
        if (isFunction[y][x]) continue;

        let dark = false;
        if (bitIndex < codewords.length * 8) {
          const codeword = codewords[Math.floor(bitIndex / 8)];
          dark = ((codeword >>> (7 - (bitIndex % 8))) & 1) === 1;
          bitIndex += 1;
        }
        modules[y][x] = dark;
      }
    }

    upward = !upward;
  }
}

function applyMask(modules, isFunction, mask) {
  for (let y = 0; y < modules.length; y += 1) {
    for (let x = 0; x < modules.length; x += 1) {
      if (!isFunction[y][x] && maskApplies(mask, x, y)) {
        modules[y][x] = !modules[y][x];
      }
    }
  }
}

function maskApplies(mask, x, y) {
  switch (mask) {
    case 0:
      return (x + y) % 2 === 0;
    case 1:
      return y % 2 === 0;
    case 2:
      return x % 3 === 0;
    case 3:
      return (x + y) % 3 === 0;
    case 4:
      return (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0;
    case 5:
      return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6:
      return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    case 7:
      return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
    default:
      return false;
  }
}

function drawFormatBits(modules, isFunction, mask) {
  const size = modules.length;
  const data = (1 << 3) | mask;
  let bits = data << 10;
  const generator = 0x537;

  for (let i = 14; i >= 10; i -= 1) {
    if (((bits >>> i) & 1) !== 0) {
      bits ^= generator << (i - 10);
    }
  }

  bits = ((data << 10) | bits) ^ 0x5412;

  for (let i = 0; i <= 5; i += 1) setFunction(modules, isFunction, 8, i, getBit(bits, i));
  setFunction(modules, isFunction, 8, 7, getBit(bits, 6));
  setFunction(modules, isFunction, 8, 8, getBit(bits, 7));
  setFunction(modules, isFunction, 7, 8, getBit(bits, 8));
  for (let i = 9; i < 15; i += 1) setFunction(modules, isFunction, 14 - i, 8, getBit(bits, i));

  for (let i = 0; i < 8; i += 1) setFunction(modules, isFunction, size - 1 - i, 8, getBit(bits, i));
  for (let i = 8; i < 15; i += 1) setFunction(modules, isFunction, 8, size - 15 + i, getBit(bits, i));
  setFunction(modules, isFunction, 8, size - 8, true);
}

function getBit(value, index) {
  return ((value >>> index) & 1) !== 0;
}

function getPenaltyScore(modules) {
  const size = modules.length;
  let penalty = 0;

  for (let y = 0; y < size; y += 1) penalty += runPenalty(modules[y]);
  for (let x = 0; x < size; x += 1) penalty += runPenalty(modules.map((row) => row[x]));

  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const color = modules[y][x];
      if (modules[y][x + 1] === color && modules[y + 1][x] === color && modules[y + 1][x + 1] === color) {
        penalty += 3;
      }
    }
  }

  for (let y = 0; y < size; y += 1) penalty += finderPenalty(modules[y]);
  for (let x = 0; x < size; x += 1) penalty += finderPenalty(modules.map((row) => row[x]));

  const dark = modules.flat().filter(Boolean).length;
  const total = size * size;
  penalty += Math.floor(Math.abs(dark * 20 - total * 10) / total) * 10;

  return penalty;
}

function runPenalty(line) {
  let penalty = 0;
  let runColor = line[0];
  let runLength = 1;

  for (let i = 1; i < line.length; i += 1) {
    if (line[i] === runColor) {
      runLength += 1;
    } else {
      if (runLength >= 5) penalty += 3 + runLength - 5;
      runColor = line[i];
      runLength = 1;
    }
  }

  if (runLength >= 5) penalty += 3 + runLength - 5;
  return penalty;
}

function finderPenalty(line) {
  let penalty = 0;
  const pattern = [true, false, true, true, true, false, true];

  for (let i = 0; i <= line.length - 7; i += 1) {
    const matches = pattern.every((value, offset) => line[i + offset] === value);
    if (!matches) continue;

    const before = i >= 4 && line.slice(i - 4, i).every((value) => !value);
    const after = i + 11 <= line.length && line.slice(i + 7, i + 11).every((value) => !value);
    if (before || after) penalty += 40;
  }

  return penalty;
}

function reedSolomonDivisor(degree) {
  let result = [1];

  for (let i = 0; i < degree; i += 1) {
    const next = Array(result.length + 1).fill(0);
    for (let j = 0; j < result.length; j += 1) {
      next[j] ^= gfMultiply(result[j], 1);
      next[j + 1] ^= gfMultiply(result[j], gfPow(2, i));
    }
    result = next;
  }

  return result.slice(1);
}

function reedSolomonRemainder(data, divisor) {
  const result = Array(divisor.length).fill(0);

  for (const byte of data) {
    const factor = byte ^ result.shift();
    result.push(0);
    for (let i = 0; i < divisor.length; i += 1) {
      result[i] ^= gfMultiply(divisor[i], factor);
    }
  }

  return result;
}

function gfPow(value, power) {
  let result = 1;
  for (let i = 0; i < power; i += 1) result = gfMultiply(result, value);
  return result;
}

function gfMultiply(left, right) {
  let result = 0;
  let a = left;
  let b = right;

  while (b > 0) {
    if ((b & 1) !== 0) result ^= a;
    b >>>= 1;
    a <<= 1;
    if ((a & 0x100) !== 0) a ^= 0x11d;
  }

  return result & 0xff;
}

function setFunction(modules, isFunction, x, y, dark) {
  if (!inBounds(modules, x, y)) return;
  modules[y][x] = dark;
  isFunction[y][x] = true;
}

function inBounds(modules, x, y) {
  return y >= 0 && y < modules.length && x >= 0 && x < modules.length;
}

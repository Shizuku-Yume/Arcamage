import { hashText } from './crypto_utils.js';

const STORAGE_KEY = 'arcamage_tool_logs';
const MAX_LOGS = 5000;

let cache = null;
const warnedKeys = new Set();

function warnOnce(key, message, error) {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(message, error);
}

function loadLogs() {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? JSON.parse(raw) : [];
  } catch (error) {
    warnOnce('tool_logger_load', '[tool_logger] Failed to load logs from localStorage:', error);
    cache = [];
  }
  return cache;
}

function saveLogs(logs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
  } catch (error) {
    warnOnce('tool_logger_save', '[tool_logger] Failed to save logs to localStorage:', error);
  }
}

function measureBytes(value) {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    return new TextEncoder().encode(text || '').length;
  } catch (error) {
    warnOnce('tool_logger_measure', '[tool_logger] Failed to measure payload size:', error);
    return null;
  }
}

export async function recordToolEvent(event) {
  const logs = loadLogs();
  const payload = { ...event };
  payload.timestamp = payload.timestamp || Date.now();

  if (payload.query && !payload.query_hash) {
    try {
      payload.query_hash = await hashText(String(payload.query).trim());
    } catch (error) {
      warnOnce('tool_logger_hash', '[tool_logger] Failed to hash query payload:', error);
      payload.query_hash = null;
    }
  }

  if (payload.bytes_in === undefined) {
    payload.bytes_in = measureBytes(payload.args || null);
  }
  if (payload.bytes_out === undefined) {
    payload.bytes_out = measureBytes(payload.result || null);
  }

  logs.push(payload);
  if (logs.length > MAX_LOGS) {
    logs.splice(0, logs.length - MAX_LOGS);
  }
  saveLogs(logs);
  return payload;
}

export function getToolLogs() {
  return loadLogs().slice();
}

export default {
  recordToolEvent,
  getToolLogs,
};

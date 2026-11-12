const crypto = require('node:crypto');

const GREEN = 0x22c55e;
const MAX_OPTIONS = 10;
const MAX_LOGS = 400;
const DEFAULT_TITLE = 'Tickets';
const DEFAULT_DESCRIPTION = 'Vælg en kategori nedenfor, så åbner jeg en privat kanal til dig og staff.';
const DEFAULT_TICKET_TEXT = 'Beskriv hvad du har brug for hjælp til. Staff svarer i den her kanal.';
const DEFAULT_FOOTER = 'Support';

function nid(bytes = 4) {
  return crypto.randomBytes(bytes).toString('hex');
}

function clamp(value, min, max, fallback) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function clip(text, max = 1500) {
  const value = String(text || '');
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

function redact(text) {
  if (!text) return '';
  return String(text)
    .replace(/[\w-]{24,}\.[\w-]{6}\.[\w-]{27,}/g, '[token skjult]')
    .replace(/mfa\.[\w-]{20,}/g, '[token skjult]');
}

function normalizeBanner(raw) {
  const url = String(raw || '').trim();
  if (!url) return { url: '' };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { error: 'Banner-linket er ikke et gyldigt link.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { error: 'Banner-linket skal starte med http:// eller https://' };
  }
  if (url.length > 500) return { error: 'Banner-linket er for langt.' };
  return { url };
}

function parseEmoji(input) {
  if (!input) return null;
  const trimmed = String(input).trim();
  if (!trimmed) return null;
  const custom = trimmed.match(/^<a?:([a-zA-Z0-9_]{2,32}):(\d{17,20})>$/);
  if (custom) {
    return { id: custom[2], name: custom[1], animated: trimmed.startsWith('<a:') };
  }
  if (/^[a-z0-9]+$/i.test(trimmed)) return null;
  if (trimmed.length > 16) return null;
  return trimmed;
}

function selectOption(option) {
  const data = {
    label: String(option.name || 'Valg').slice(0, 100),
    value: String(option.id).slice(0, 100),
  };
  if (option.description) data.description = String(option.description).slice(0, 100);
  const emoji = parseEmoji(option.emoji);
  if (!emoji) return data;
  data.emoji = typeof emoji === 'string' ? { name: emoji } : emoji;
  return data;
}

function addOption(options, option) {
  const list = Array.isArray(options) ? options.slice(0, MAX_OPTIONS) : [];
  if (list.length >= MAX_OPTIONS) {
    return { error: 'Du kan højst have 10 valg på et panel.', options: list };
  }
  return { options: [...list, option] };
}

function capOptions(options) {
  return (Array.isArray(options) ? options : []).slice(0, MAX_OPTIONS);
}

function ticketChannelName(username) {
  const base = String(username || 'bruger').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'bruger';
  return `ticket-${base}`;
}

function checkSpam(timestamps, now, max, windowMs) {
  const fresh = (timestamps || []).filter((stamp) => now - stamp < windowMs);
  fresh.push(now);
  return { hit: fresh.length > max, timestamps: fresh };
}

function checkRaid(timestamps, now, max, windowMs) {
  const fresh = (timestamps || []).filter((stamp) => now - stamp <= windowMs);
  fresh.push(now);
  return { triggered: fresh.length >= max, timestamps: fresh };
}

function isYoungAccount(createdTimestamp, now, minAgeDays) {
  return now - createdTimestamp < minAgeDays * 24 * 60 * 60 * 1000;
}

function filterLogs(entries, { userId, type, text, limit = 10 } = {}) {
  const query = String(text || '').toLowerCase();
  const matched = [];
  const list = Array.isArray(entries) ? entries : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const entry = list[i];
    if (userId && entry.userId !== userId) continue;
    if (type && entry.type !== type) continue;
    if (query && !`${entry.summary || ''} ${entry.type || ''}`.toLowerCase().includes(query)) continue;
    matched.push(entry);
    if (matched.length >= limit) break;
  }
  return matched;
}

function bannerFor(panel, option) {
  return (option && option.bannerUrl) || (panel && panel.bannerUrl) || '';
}

module.exports = {
  GREEN,
  MAX_OPTIONS,
  MAX_LOGS,
  DEFAULT_TITLE,
  DEFAULT_DESCRIPTION,
  DEFAULT_TICKET_TEXT,
  DEFAULT_FOOTER,
  nid,
  clamp,
  clip,
  redact,
  normalizeBanner,
  parseEmoji,
  selectOption,
  addOption,
  capOptions,
  ticketChannelName,
  checkSpam,
  checkRaid,
  isYoungAccount,
  filterLogs,
  bannerFor,
};

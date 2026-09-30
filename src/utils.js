'use strict';

const crypto = require('node:crypto');

function id(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function isoDay(value = Date.now()) {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

function localDay(value = Date.now()) {
  const d = value instanceof Date ? value : new Date(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthKey(value = Date.now()) {
  return localDay(value).slice(0, 7);
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, Number(n) || 0));
}

function safeJsonParse(s, fallback = null) {
  try { return JSON.parse(s); } catch { return fallback; }
}

function oneLine(text, max = 180) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function summarizePrompt(text) {
  const clean = oneLine(text, 220);
  if (!clean) return '';
  return clean;
}

function summarizeResponse(text) {
  const clean = String(text || '')
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/[#>*_`~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return oneLine(clean, 260);
}

function workspaceLabel(vscode) {
  const folders = vscode.workspace.workspaceFolders || [];
  if (!folders.length) return 'No workspace';
  if (folders.length === 1) return folders[0].name;
  return vscode.workspace.name || `${folders.length} workspaces`;
}

function daysAgo(day, count) {
  const base = new Date(`${day}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() - count);
  return base.toISOString().slice(0, 10);
}

function dateRangeInclusive(startDay, endDay) {
  const out = [];
  const d = new Date(`${startDay}T12:00:00Z`);
  const end = new Date(`${endDay}T12:00:00Z`);
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

module.exports = {
  id, isoDay, localDay, monthKey, clamp, safeJsonParse, oneLine,
  summarizePrompt, summarizeResponse, workspaceLabel, daysAgo,
  dateRangeInclusive, asNumber
};

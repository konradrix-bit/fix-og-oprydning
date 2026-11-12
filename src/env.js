const fs = require('node:fs');
const path = require('node:path');

function applyEnv(text) {
  for (const line of text.split('\n')) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('export ')) trimmed = trimmed.slice(7).trim();
    const splitAt = trimmed.indexOf('=');
    if (splitAt === -1) continue;
    const key = trimmed.slice(0, splitAt).trim();
    let value = trimmed.slice(splitAt + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] == null) process.env[key] = value;
  }
}

function loadEnv(file) {
  const files = file
    ? [file]
    : [
        path.join(__dirname, '..', '.env'),
        path.join(process.cwd(), '.env'),
        '/home/container/.env',
        '/.env',
      ];
  for (const candidate of files) {
    try {
      applyEnv(fs.readFileSync(candidate, 'utf8'));
    } catch {
      // Filen findes ikke på den her placering.
    }
  }
}

module.exports = { loadEnv };

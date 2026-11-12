const fs = require('node:fs');
const path = require('node:path');
const { MAX_LOGS } = require('./logic');

const defaultFile = path.join(__dirname, '..', 'data', 'store.json');
let cache = null;

function storePath() {
  return process.env.STORE_PATH || defaultFile;
}

function defaultGuild() {
  return {
    protect: {
      antispam: { on: false, max: 5, seconds: 5, timeout: 5 },
      antiraid: { on: false, joins: 6, seconds: 10, minAgeDays: 7, handling: 'log' },
      antilink: { on: false },
      antiinvite: { on: false },
      mentions: { on: false, max: 5 },
      lockdown: { on: false, saved: [] },
      ignoredChannels: [],
      staffRoleId: null,
    },
    logs: { channelId: null, entries: [] },
    panels: {},
    tickets: {},
    verify: { roleId: null, members: {} },
  };
}

function load() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
    cache = parsed && typeof parsed === 'object' ? parsed : { guilds: {} };
  } catch {
    cache = { guilds: {} };
  }
  if (!cache.guilds || typeof cache.guilds !== 'object') cache.guilds = {};
  return cache;
}

function save() {
  const data = load();
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
  return data;
}

function getGuild(guildId) {
  const data = load();
  if (!data.guilds[guildId]) {
    data.guilds[guildId] = defaultGuild();
    save();
  }
  const guild = data.guilds[guildId];
  if (!guild.verify) guild.verify = { roleId: null, members: {} };
  if (!guild.verify.members) guild.verify.members = {};
  return guild;
}

function pushLog(guildId, entry) {
  const guild = getGuild(guildId);
  guild.logs.entries.push(entry);
  if (guild.logs.entries.length > MAX_LOGS) {
    guild.logs.entries.splice(0, guild.logs.entries.length - MAX_LOGS);
  }
  save();
  return entry;
}

function resetForTests() {
  cache = null;
}

module.exports = {
  defaultGuild,
  load,
  save,
  getGuild,
  pushLog,
  resetForTests,
  storePath,
};

function parseDpull(content) {
  const match = String(content || '').trim().match(/^!dpull(?:\s+(\d{17,20}))?$/i);
  if (!match) return null;
  return { guildId: match[1] || null };
}

function eligibleIds(storedMembers, roleHolderIds) {
  const holders = new Set(roleHolderIds || []);
  return Object.keys(storedMembers || {}).filter((id) => holders.has(id));
}

function oauthUrl({ clientId, redirectUri, state }) {
  const url = new URL('https://discord.com/api/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'identify guilds.join');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'consent');
  return url.toString();
}

async function pullMembers(userIds, add, wait = async () => {}) {
  const result = { added: 0, already: 0, failed: 0 };
  for (let index = 0; index < userIds.length; index += 1) {
    try {
      const status = await add(userIds[index]);
      if (status === 201) result.added += 1;
      else if (status === 204) result.already += 1;
      else result.failed += 1;
    } catch {
      result.failed += 1;
    }
    if (index < userIds.length - 1) await wait();
  }
  return result;
}

module.exports = {
  parseDpull,
  eligibleIds,
  oauthUrl,
  pullMembers,
};

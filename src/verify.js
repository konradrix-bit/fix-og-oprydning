const http = require('node:http');
const crypto = require('node:crypto');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const { isManager } = require('./access');
const { GREEN } = require('./logic');
const { eligibleIds, oauthUrl, parseDpull, pullMembers } = require('./pull');
const { openSeal, seal } = require('./seal');
const { getGuild, save } = require('./store');
const { record } = require('./logger');

const states = new Map();
const running = new Set();

function oauthSettings() {
  const secret = (process.env.DISCORD_CLIENT_SECRET || process.env.CLIENT_SECRET || '').trim();
  const redirectUri = (process.env.REDIRECT_URI || '').trim();
  const port = Number(process.env.PORT || process.env.VERIFY_PORT || 3000);
  let redirectOk = false;
  try {
    const url = new URL(redirectUri);
    redirectOk = url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    redirectOk = false;
  }
  return {
    secret,
    redirectUri,
    port: Number.isInteger(port) && port > 0 ? port : 3000,
    ready: Boolean(secret && redirectOk),
  };
}

function page(title, text) {
  return `<!DOCTYPE html><html lang="da"><head><meta charset="utf-8"><title>${title}</title></head><body style="margin:0;font-family:sans-serif;background:#07140e;color:#e7f6ec;padding:48px"><h1 style="color:#22c55e">${title}</h1><p>${text}</p></body></html>`;
}

function createState(guildId, userId) {
  const state = crypto.randomBytes(18).toString('hex');
  const timer = setTimeout(() => states.delete(state), 10 * 60 * 1000);
  timer.unref?.();
  states.set(state, { guildId, userId, timer });
  return state;
}

function takeState(state) {
  const saved = states.get(state);
  if (!saved) return null;
  clearTimeout(saved.timer);
  states.delete(state);
  return saved;
}

async function tokenRequest(body) {
  const response = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) return null;
  return response.json();
}

async function exchangeCode(config, clientId, code) {
  return tokenRequest(new URLSearchParams({
    client_id: clientId,
    client_secret: config.secret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
  }));
}

async function refreshAccess(config, clientId, refreshToken) {
  return tokenRequest(new URLSearchParams({
    client_id: clientId,
    client_secret: config.secret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  }));
}

async function identify(accessToken) {
  const response = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) return null;
  return response.json();
}

function saveGrant(guildId, userId, grant, botToken) {
  const settings = getGuild(guildId);
  settings.verify.members[userId] = {
    sealed: seal({
      accessToken: grant.access_token,
      refreshToken: grant.refresh_token,
    }, botToken),
    expiresAt: Date.now() + (Number(grant.expires_in) || 604800) * 1000,
  };
  save();
}

function verifyEmbed(guild, roleId) {
  const role = roleId ? `<@&${roleId}>` : 'ikke valgt';
  return new EmbedBuilder()
    .setColor(GREEN)
    .setTitle('Verificer')
    .setDescription([
      'Tryk på knappen og godkend botten.',
      `Derefter får du rollen ${role}.`,
      'Når du har rollen, kan en manager flytte dig med til en anden server, botten er på, med !dpull.',
    ].join('\n\n'))
    .setFooter({ text: 'Du kan kun flyttes, hvis du selv har godkendt det.' });
}

function verifyRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('verify:go').setLabel('Verificer').setStyle(ButtonStyle.Success),
  );
}

function canAssign(guild, role) {
  const me = guild.members.me;
  if (!role || !me || role.managed || role.id === guild.id) return false;
  return me.permissions.has(PermissionFlagsBits.ManageRoles) && me.roles.highest.comparePositionTo(role) > 0;
}

async function handleVerify(interaction) {
  if (!isManager(interaction)) {
    await interaction.reply({ content: 'Du skal have Manage Server for at sætte verificering op.', flags: MessageFlags.Ephemeral });
    return;
  }
  const settings = getGuild(interaction.guildId);
  const sub = interaction.options.getSubcommand();
  if (sub === 'rolle') {
    const role = interaction.options.getRole('rolle', true);
    if (!canAssign(interaction.guild, role)) {
      await interaction.reply({
        content: 'Den rolle kan jeg ikke give. Vælg en rolle under botten, som ikke er styret af Discord.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    settings.verify.roleId = role.id;
    save();
    await interaction.reply({ content: `Verify-rollen er nu ${role}.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (sub === 'status') {
    const holders = interaction.guild.members.cache.filter((member) => (
      settings.verify.roleId && member.roles.cache.has(settings.verify.roleId)
    ));
    const ready = eligibleIds(settings.verify.members, [...holders.keys()]);
    const role = settings.verify.roleId ? `<@&${settings.verify.roleId}>` : 'ikke valgt';
    const config = oauthSettings();
    await interaction.reply({
      content: `Rolle: ${role}\nMed rollen i cachen: ${holders.size}\nKan flyttes med !dpull: ${ready.length}\nOAuth: ${config.ready ? 'sat' : 'mangler DISCORD_CLIENT_SECRET og REDIRECT_URI'}`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  if (!settings.verify.roleId) {
    await interaction.reply({ content: 'Vælg først en rolle med `/verify rolle`.', flags: MessageFlags.Ephemeral });
    return;
  }
  const channel = interaction.options.getChannel('kanal') || interaction.channel;
  if (!channel?.isTextBased?.()) {
    await interaction.reply({ content: 'Vælg en tekstkanal.', flags: MessageFlags.Ephemeral });
    return;
  }
  await channel.send({
    embeds: [verifyEmbed(interaction.guild, settings.verify.roleId)],
    components: [verifyRow()],
  });
  await interaction.reply({ content: `Verify-panelet er sendt i ${channel}.`, flags: MessageFlags.Ephemeral });
}

async function handleVerifyButton(interaction) {
  const settings = getGuild(interaction.guildId);
  if (!settings.verify.roleId) {
    await interaction.reply({ content: 'Verify-rollen er ikke valgt endnu.', flags: MessageFlags.Ephemeral });
    return;
  }
  const config = oauthSettings();
  if (!config.ready) {
    const content = isManager(interaction)
      ? 'Sæt DISCORD_CLIENT_SECRET og REDIRECT_URI på hosten. Redirect-adressen skal slutte på /callback og være tilføjet under OAuth2 i Developer Portal.'
      : 'Verificering er ikke klar endnu. Sig det til en admin.';
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    return;
  }
  const state = createState(interaction.guildId, interaction.user.id);
  const url = oauthUrl({
    clientId: interaction.client.user.id,
    redirectUri: config.redirectUri,
    state,
  });
  await interaction.reply({
    content: 'Godkend botten. Bagefter får du verify-rollen, og en manager kan flytte dig med `!dpull`.',
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Godkend').setURL(url),
    )],
    flags: MessageFlags.Ephemeral,
  });
}

async function completeVerify(client, code, state) {
  const pending = takeState(state);
  if (!pending || !code) return page('Linket virker ikke', 'Tryk Verificer i Discord igen.');
  const config = oauthSettings();
  const grant = await exchangeCode(config, client.user.id, code);
  if (!grant?.access_token || !grant.refresh_token) {
    return page('Verificering fejlede', 'Prøv knappen i Discord igen.');
  }
  const user = await identify(grant.access_token);
  if (!user || user.id !== pending.userId) {
    return page('Forkert konto', 'Åbn linket med den Discord-konto, du trykkede med.');
  }
  const guild = client.guilds.cache.get(pending.guildId) || await client.guilds.fetch(pending.guildId).catch(() => null);
  const settings = guild ? getGuild(guild.id) : null;
  if (!guild || !settings?.verify.roleId) return page('Serveren blev ikke fundet', 'Bed en admin om at sætte verify-rollen igen.');
  saveGrant(guild.id, user.id, grant, client.token);
  try {
    const member = await guild.members.fetch(user.id);
    await member.roles.add(settings.verify.roleId, 'Verificeret');
  } catch {
    return page('Godkendt', 'Din godkendelse er gemt, men jeg kunne ikke give rollen. Bot-rollen skal stå over verify-rollen.');
  }
  await record(guild, {
    type: 'protect',
    userId: user.id,
    channelId: null,
    summary: `${user.username} verificerede og fik verify-rollen.`,
  }).catch(() => {});
  return page('Du er verificeret', 'Du har fået rollen. Du kan lukke siden.');
}

async function accessFor(client, guildId, userId) {
  const config = oauthSettings();
  const record = getGuild(guildId).verify.members[userId];
  if (!record || !config.ready) return null;
  let saved;
  try {
    saved = openSeal(record.sealed, client.token);
  } catch {
    return null;
  }
  if (record.expiresAt > Date.now() + 60_000 && saved.accessToken) return saved.accessToken;
  const grant = await refreshAccess(config, client.user.id, saved.refreshToken);
  if (!grant?.access_token) return null;
  saveGrant(guildId, userId, {
    access_token: grant.access_token,
    refresh_token: grant.refresh_token || saved.refreshToken,
    expires_in: grant.expires_in,
  }, client.token);
  return grant.access_token;
}

async function addMember(client, guildId, userId, accessToken) {
  const send = () => fetch(`https://discord.com/api/v10/guilds/${guildId}/members/${userId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${client.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ access_token: accessToken }),
  });
  let response = await send();
  if (response.status === 429) {
    const data = await response.json().catch(() => ({}));
    const waitMs = Math.min(Number(data.retry_after) || 1, 10) * 1000;
    await new Promise((resolve) => {
      setTimeout(resolve, waitMs);
    });
    response = await send();
  }
  return response.status;
}

async function handleDpull(message) {
  const parsed = parseDpull(message.content);
  if (!parsed || !message.guild || message.author?.bot) return;
  if (!message.member?.permissions?.has(PermissionFlagsBits.ManageGuild)) {
    await message.reply('Du skal have Manage Server for at bruge !dpull.');
    return;
  }
  if (!parsed.guildId) {
    await message.reply('Skriv server-id efter kommandoen. Eksempel: `!dpull 123456789012345678`');
    return;
  }
  if (parsed.guildId === message.guild.id) {
    await message.reply('Vælg en anden server end den, du står i.');
    return;
  }
  const settings = getGuild(message.guild.id);
  if (!settings.verify.roleId) {
    await message.reply('Vælg først rollen med `/verify rolle`.');
    return;
  }
  if (!oauthSettings().ready) {
    await message.reply('Pull kræver DISCORD_CLIENT_SECRET og REDIRECT_URI, så folk kan godkende flytningen under Verificer.');
    return;
  }
  if (running.has(message.guild.id)) {
    await message.reply('Der kører allerede et pull fra den her server.');
    return;
  }
  const target = message.client.guilds.cache.get(parsed.guildId) || await message.client.guilds.fetch(parsed.guildId).catch(() => null);
  if (!target) {
    await message.reply('Jeg er ikke på den server. Invit botten derind først, og prøv igen.');
    return;
  }
  const me = target.members.me || await target.members.fetchMe().catch(() => null);
  if (!me?.permissions.has(PermissionFlagsBits.CreateInstantInvite)) {
    await message.reply('Jeg mangler Create Invite på den server, medlemmerne skal flyttes til.');
    return;
  }
  const fetched = await message.guild.members.fetch().then(() => true).catch(() => false);
  if (!fetched) {
    await message.reply('Jeg kunne ikke hente medlemmerne. Slå Server Members Intent til i Developer Portal.');
    return;
  }
  const holders = message.guild.members.cache
    .filter((member) => !member.user.bot && member.roles.cache.has(settings.verify.roleId))
    .map((member) => member.id);
  const ids = eligibleIds(settings.verify.members, holders);
  if (!ids.length) {
    await message.reply('Ingen med verify-rollen har godkendt flytningen endnu. De skal trykke Verificer.');
    return;
  }
  running.add(message.guild.id);
  try {
    const status = await message.reply(`Flytter ${ids.length} verificerede medlemmer til **${target.name}**...`);
    const result = await pullMembers(ids, async (userId) => {
      const accessToken = await accessFor(message.client, message.guild.id, userId);
      if (!accessToken) return 0;
      return addMember(message.client, target.id, userId, accessToken);
    }, () => new Promise((resolve) => {
      const timer = setTimeout(resolve, 1100);
      timer.unref?.();
    }));
    await status.edit(`Færdig mod **${target.name}**. ${result.added} tilføjet, ${result.already} var der allerede, ${result.failed} fejlede.`);
    await record(message.guild, {
      type: 'protect',
      userId: message.author.id,
      channelId: message.channel.id,
      summary: `${message.author.tag} flyttede verificerede medlemmer til ${target.name}: ${result.added} nye, ${result.already} fandtes, ${result.failed} fejlede.`,
    }).catch(() => {});
  } finally {
    running.delete(message.guild.id);
  }
}

function startVerifyServer(client) {
  const config = oauthSettings();
  if (!config.ready) {
    console.log('Verify-pull venter på DISCORD_CLIENT_SECRET og REDIRECT_URI.');
    return null;
  }
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.method !== 'GET' || url.pathname !== '/callback') {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }
      if (url.searchParams.get('error')) {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(page('Ikke godkendt', 'Du afviste verificeringen. Tryk Verificer igen, hvis det var en fejl.'));
        return;
      }
      const html = await completeVerify(client, url.searchParams.get('code'), url.searchParams.get('state'));
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(html);
    } catch (err) {
      console.error(`Verify-callback: ${err.message}`);
      response.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(page('Noget gik galt', 'Tryk Verificer i Discord igen.'));
    }
  });
  server.on('error', (err) => {
    console.error(`Verify-server kunne ikke starte på port ${config.port}: ${err.message}`);
  });
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`Verify-callback lytter på port ${config.port}. Redirect: ${config.redirectUri}`);
  });
  return server;
}

module.exports = {
  handleVerify,
  handleVerifyButton,
  handleDpull,
  startVerifyServer,
  oauthSettings,
};

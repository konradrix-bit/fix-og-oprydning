const { ChannelType, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { humanError, isExempt, isManager } = require('./access');
const { checkRaid, checkSpam, clamp, isYoungAccount } = require('./logic');
const { getGuild, save } = require('./store');
const { statusEmbed } = require('./theme');
const { record } = require('./logger');

const spamState = new Map();
const raidJoins = new Map();
const raidAlertUntil = new Map();

const LINK = /https?:\/\/|www\./i;
const INVITE = /(discord\.gg|discord(?:app)?\.com\/invite)\//i;

async function note(message, summary) {
  await record(message.guild, {
    type: 'protect',
    userId: message.author.id,
    channelId: message.channel.id,
    summary,
  });
}

function sendState(overwrite) {
  if (!overwrite) return 'absent';
  if (overwrite.deny.has(PermissionFlagsBits.SendMessages)) return 'deny';
  if (overwrite.allow.has(PermissionFlagsBits.SendMessages)) return 'allow';
  return 'neutral';
}

function sendValue(state) {
  if (state === 'deny') return false;
  if (state === 'allow') return true;
  return null;
}

async function setLockdown(guild, enabled) {
  const settings = getGuild(guild.id);
  const textChannels = [...guild.channels.cache.values()].filter((channel) => (
    channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement
  ));
  if (enabled) {
    if (settings.protect.lockdown.on) return { already: true };
    const staffRoleId = settings.protect.staffRoleId;
    const openTickets = new Set(Object.keys(settings.tickets));
    const saved = [];
    for (const channel of textChannels) {
      if (channel.id === settings.logs.channelId || openTickets.has(channel.id)) continue;
      const previous = sendState(channel.permissionOverwrites.cache.get(guild.id));
      const staffPrevious = staffRoleId
        ? sendState(channel.permissionOverwrites.cache.get(staffRoleId))
        : null;
      saved.push({ id: channel.id, previous, staffPrevious });
      await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false }).catch(() => {});
      if (staffRoleId) {
        await channel.permissionOverwrites.edit(staffRoleId, { SendMessages: true }).catch(() => {});
      }
    }
    settings.protect.lockdown = { on: true, saved, staffRoleId };
    save();
    return { locked: saved.length };
  }
  const staffRoleId = settings.protect.lockdown.staffRoleId;
  for (const item of settings.protect.lockdown.saved || []) {
    const channel = guild.channels.cache.get(item.id);
    if (!channel) continue;
    await channel.permissionOverwrites.edit(guild.roles.everyone, {
      SendMessages: sendValue(item.previous === 'absent' ? 'neutral' : item.previous),
    }).catch(() => {});
    if (staffRoleId && item.staffPrevious) {
      await channel.permissionOverwrites.edit(staffRoleId, {
        SendMessages: sendValue(item.staffPrevious),
      }).catch(() => {});
    }
  }
  settings.protect.lockdown = { on: false, saved: [], staffRoleId: null };
  save();
  return { unlocked: true };
}

async function onMessage(message) {
  if (!message.guild || message.author?.bot || message.system) return;
  if (!message.member) return;
  const settings = getGuild(message.guild.id);
  if (settings.protect.ignoredChannels.includes(message.channel.id)) return;
  if (isExempt(message.member, settings)) return;

  const spam = settings.protect.antispam;
  if (spam.on) {
    const key = `${message.guild.id}:${message.author.id}`;
    const state = spamState.get(key) || { times: [], punishedUntil: 0 };
    const now = Date.now();
    if (state.punishedUntil > now) {
      spamState.set(key, state);
      await message.delete().catch(() => {});
      return;
    }
    const result = checkSpam(state.times, now, spam.max, spam.seconds * 1000);
    state.times = result.timestamps;
    spamState.set(key, state);
    if (result.hit) {
      state.punishedUntil = now + spam.timeout * 60 * 1000;
      await message.delete().catch(() => {});
      await message.member.timeout(spam.timeout * 60 * 1000, 'Anti-spam').catch(() => {});
      await note(message, `${message.author.tag} ramte anti-spam i <#${message.channel.id}> og fik timeout i ${spam.timeout} min.`);
      return;
    }
  }

  const ticketChannel = Boolean(settings.tickets[message.channel.id]);
  if (!ticketChannel && settings.protect.antiinvite.on && INVITE.test(message.content || '')) {
    await message.delete().catch(() => {});
    await note(message, `${message.author.tag} fik slettet en Discord-invite i <#${message.channel.id}>.`);
    return;
  }
  if (!ticketChannel && settings.protect.antilink.on && LINK.test(message.content || '')) {
    await message.delete().catch(() => {});
    await note(message, `${message.author.tag} fik slettet et link i <#${message.channel.id}>.`);
    return;
  }
  if (settings.protect.mentions.on) {
    const count = message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 1 : 0);
    if (count > settings.protect.mentions.max) {
      await message.delete().catch(() => {});
      await note(message, `${message.author.tag} nævnte ${count} i <#${message.channel.id}>. Beskeden blev slettet.`);
    }
  }
}

async function onMemberAdd(member) {
  if (!member.guild || member.user?.bot) return;
  const settings = getGuild(member.guild.id);
  const raid = settings.protect.antiraid;
  if (!raid.on) return;
  const now = Date.now();
  const current = raidJoins.get(member.guild.id) || [];
  const result = checkRaid(current, now, raid.joins, raid.seconds * 1000);
  raidJoins.set(member.guild.id, result.timestamps);
  const alerting = (raidAlertUntil.get(member.guild.id) || 0) > now;
  if (result.triggered && !alerting) {
    raidAlertUntil.set(member.guild.id, now + 60 * 1000);
    await record(member.guild, {
      type: 'protect',
      userId: member.id,
      channelId: null,
      summary: `Muligt raid: ${result.timestamps.length} joins på ${raid.seconds} sekunder. Handling: ${raid.handling}.`,
    });
    if (raid.handling === 'lockdown') {
      const locked = await setLockdown(member.guild, true);
      await record(member.guild, {
        type: 'protect',
        userId: member.id,
        channelId: null,
        summary: locked.already
          ? 'Lockdown var allerede slået til.'
          : `Lockdown slået til på ${locked.locked} kanaler.`,
      });
    }
  }
  const duringRaid = result.triggered || alerting;
  if (duringRaid && raid.handling === 'kick' && isYoungAccount(member.user.createdTimestamp, now, raid.minAgeDays)) {
    await member.kick('Anti-raid: kontoen er for ny under et raid').catch(() => {});
    await record(member.guild, {
      type: 'protect',
      userId: member.id,
      channelId: null,
      summary: `${member.user.tag} blev kicked af anti-raid, fordi kontoen er under ${raid.minAgeDays} dage.`,
    });
  }
}

async function handleProtect(interaction) {
  if (!isManager(interaction)) {
    await interaction.reply({ content: 'Du skal have Manage Server for at bruge /protect.', flags: MessageFlags.Ephemeral });
    return;
  }
  const settings = getGuild(interaction.guildId);
  const sub = interaction.options.getSubcommand();
  if (sub === 'status') {
    await interaction.reply({ embeds: [statusEmbed(settings)], flags: MessageFlags.Ephemeral });
    return;
  }
  if (sub === 'antispam') {
    const spam = settings.protect.antispam;
    spam.on = interaction.options.getBoolean('aktiv');
    const max = interaction.options.getInteger('maks');
    const seconds = interaction.options.getInteger('sekunder');
    const timeout = interaction.options.getInteger('timeout');
    if (max != null) spam.max = clamp(max, 3, 20, spam.max);
    if (seconds != null) spam.seconds = clamp(seconds, 2, 30, spam.seconds);
    if (timeout != null) spam.timeout = clamp(timeout, 1, 60, spam.timeout);
    save();
  } else if (sub === 'antiraid') {
    const raid = settings.protect.antiraid;
    raid.on = interaction.options.getBoolean('aktiv');
    const joins = interaction.options.getInteger('joins');
    const seconds = interaction.options.getInteger('sekunder');
    const age = interaction.options.getInteger('alder');
    const handling = interaction.options.getString('handling');
    if (joins != null) raid.joins = clamp(joins, 3, 25, raid.joins);
    if (seconds != null) raid.seconds = clamp(seconds, 3, 60, raid.seconds);
    if (age != null) raid.minAgeDays = clamp(age, 0, 30, raid.minAgeDays);
    if (handling && ['log', 'lockdown', 'kick'].includes(handling)) raid.handling = handling;
    save();
  } else if (sub === 'antilink') {
    settings.protect.antilink.on = interaction.options.getBoolean('aktiv');
    save();
  } else if (sub === 'antiinvite') {
    settings.protect.antiinvite.on = interaction.options.getBoolean('aktiv');
    save();
  } else if (sub === 'mentions') {
    settings.protect.mentions.on = interaction.options.getBoolean('aktiv');
    const max = interaction.options.getInteger('maks');
    if (max != null) settings.protect.mentions.max = clamp(max, 2, 20, settings.protect.mentions.max);
    save();
  } else if (sub === 'lockdown') {
    try {
      const result = await setLockdown(interaction.guild, interaction.options.getBoolean('aktiv'));
      const text = result.already
        ? 'Lockdown er allerede slået til.'
        : result.unlocked
          ? 'Lockdown er slået fra. Kanalerne er sat tilbage.'
          : `Lockdown er slået til på ${result.locked} kanaler. Log, åbne tickets og staff kan stadig skrive.`;
      await record(interaction.guild, {
        type: 'protect',
        userId: interaction.user.id,
        channelId: interaction.channelId,
        summary: `${interaction.user.tag}: ${text}`,
      });
      await interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
    } catch (err) {
      await interaction.reply({ content: humanError(err), flags: MessageFlags.Ephemeral });
    }
    return;
  } else if (sub === 'log') {
    settings.logs.channelId = interaction.options.getChannel('kanal').id;
    save();
  } else if (sub === 'staff') {
    settings.protect.staffRoleId = interaction.options.getRole('rolle').id;
    save();
  } else if (sub === 'ignorer') {
    const channel = interaction.options.getChannel('kanal');
    const active = interaction.options.getBoolean('aktiv');
    const list = settings.protect.ignoredChannels;
    const has = list.includes(channel.id);
    if (active && !has) list.push(channel.id);
    if (!active && has) settings.protect.ignoredChannels = list.filter((id) => id !== channel.id);
    save();
  }
  await interaction.reply({ embeds: [statusEmbed(getGuild(interaction.guildId))], flags: MessageFlags.Ephemeral });
}

module.exports = {
  onMessage,
  onMemberAdd,
  handleProtect,
  setLockdown,
};

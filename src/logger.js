const { AuditLogEvent, EmbedBuilder, MessageFlags } = require('discord.js');
const { isManager, logErr } = require('./access');
const { isClosing } = require('./closing');
const { GREEN, clip, filterLogs, nid, redact } = require('./logic');
const { getGuild, pushLog, save } = require('./store');
const { logEmbed, logListEmbed } = require('./theme');

const AUDIT = {
  ban: AuditLogEvent.MemberBanAdd,
  unban: AuditLogEvent.MemberBanRemove,
  kick: AuditLogEvent.MemberKick,
  kanal: AuditLogEvent.ChannelCreate,
  rolle: AuditLogEvent.RoleCreate,
  besked: AuditLogEvent.MessageDelete,
};

async function record(guild, entry) {
  if (!guild) return null;
  const saved = pushLog(guild.id, {
    id: nid(4),
    at: Date.now(),
    type: entry.type,
    userId: entry.userId || null,
    channelId: entry.channelId || null,
    summary: clip(redact(entry.summary), 1500),
  });
  const channelId = getGuild(guild.id).logs.channelId;
  if (!channelId) return saved;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased()) return saved;
  await channel.send({ embeds: [logEmbed(saved)] }).catch((err) => {
    console.error(`Logkanal: ${err.message}`);
  });
  return saved;
}

function attachLogger(client) {
  client.on('messageDelete', async (message) => {
    if (!message.guild || message.author?.bot) return;
    const settings = getGuild(message.guild.id);
    if (message.channelId === settings.logs.channelId) return;
    const content = message.content ? clip(redact(message.content), 500) : 'indhold var ikke i cachen';
    const where = message.channel?.name ? `#${message.channel.name}` : 'en kanal';
    await record(message.guild, {
      type: 'besked_slettet',
      userId: message.author?.id || null,
      channelId: message.channelId,
      summary: `${message.author?.tag || 'Ukendt'} i ${where}: ${content}`,
    });
  });

  client.on('messageDeleteBulk', async (messages) => {
    const first = messages.first();
    if (!first?.guild) return;
    await record(first.guild, {
      type: 'besked_slettet',
      userId: null,
      channelId: first.channelId,
      summary: `${messages.size} beskeder blev slettet i #${first.channel?.name || 'kanal'}.`,
    });
  });

  client.on('messageUpdate', async (oldMessage, newMessage) => {
    if (!newMessage.guild || newMessage.author?.bot) return;
    if (oldMessage.content == null || newMessage.content == null) return;
    if (oldMessage.content === newMessage.content) return;
    const settings = getGuild(newMessage.guild.id);
    if (newMessage.channelId === settings.logs.channelId) return;
    const before = oldMessage.content ? clip(redact(oldMessage.content), 300) : 'ukendt';
    const after = newMessage.content ? clip(redact(newMessage.content), 300) : 'tom';
    await record(newMessage.guild, {
      type: 'besked_redigeret',
      userId: newMessage.author?.id || null,
      channelId: newMessage.channelId,
      summary: `${newMessage.author?.tag || 'Ukendt'} i #${newMessage.channel?.name || 'kanal'}.\nFør: ${before}\nEfter: ${after}`,
    });
  });

  client.on('guildMemberAdd', async (member) => {
    const ageDays = Math.floor((Date.now() - member.user.createdTimestamp) / 86400000);
    await record(member.guild, {
      type: 'medlem_join',
      userId: member.id,
      channelId: null,
      summary: `${member.user.tag} joinede. Kontoen er ${ageDays} dage gammel.`,
    });
  });

  client.on('guildMemberRemove', async (member) => {
    let kicked = false;
    let banned = false;
    try {
      const kickLogs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 1 });
      const kick = kickLogs.entries.first();
      if (kick && kick.target?.id === member.id && Date.now() - kick.createdTimestamp < 15000) {
        kicked = true;
        await record(member.guild, {
          type: 'kick',
          userId: member.id,
          channelId: null,
          summary: `${member.user?.tag || member.id} blev kicked af ${kick.executor?.tag || 'ukendt'}${kick.reason ? ` (${kick.reason})` : ''}.`,
        });
      }
      const banLogs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberBanAdd, limit: 1 });
      const ban = banLogs.entries.first();
      if (ban && ban.target?.id === member.id && Date.now() - ban.createdTimestamp < 15000) banned = true;
    } catch {
      // Mangler View Audit Log. Så logger vi bare at medlemmet forlod.
    }
    if (kicked || banned) return;
    await record(member.guild, {
      type: 'medlem_forlod',
      userId: member.id,
      channelId: null,
      summary: `${member.user?.tag || member.id} forlod serveren.`,
    });
  });

  client.on('guildBanAdd', async (ban) => {
    await record(ban.guild, {
      type: 'ban',
      userId: ban.user?.id || null,
      channelId: null,
      summary: `${ban.user?.tag || 'Ukendt'} blev banned${ban.reason ? `: ${ban.reason}` : '.'}`,
    });
  });

  client.on('guildBanRemove', async (ban) => {
    await record(ban.guild, {
      type: 'unban',
      userId: ban.user?.id || null,
      channelId: null,
      summary: `${ban.user?.tag || 'Ukendt'} fik ophævet sit ban.`,
    });
  });

  client.on('channelCreate', async (channel) => {
    if (!channel.guild) return;
    await record(channel.guild, {
      type: 'kanal',
      userId: null,
      channelId: channel.id,
      summary: `Kanalen #${channel.name} blev oprettet.`,
    });
  });

  client.on('channelDelete', async (channel) => {
    if (!channel.guild || isClosing(channel.id)) return;
    const data = getGuild(channel.guild.id);
    const ticket = data.tickets[channel.id];
    if (ticket) {
      delete data.tickets[channel.id];
      save();
      await record(channel.guild, {
        type: 'ticket',
        userId: ticket.ownerId,
        channelId: channel.id,
        summary: `Ticket-kanalen ${channel.name} blev slettet.`,
      });
      return;
    }
    await record(channel.guild, {
      type: 'kanal',
      userId: null,
      channelId: channel.id,
      summary: `Kanalen #${channel.name} blev slettet.`,
    });
  });

  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (!oldMember || !newMember || oldMember.partial || !oldMember.roles?.cache || !newMember.roles?.cache) return;
    try {
    if (oldMember.nickname !== newMember.nickname) {
      await record(newMember.guild, {
        type: 'nick',
        userId: newMember.id,
        channelId: null,
        summary: `${newMember.user.tag} skiftede kaldenavn fra ${oldMember.nickname || 'intet'} til ${newMember.nickname || 'intet'}.`,
      });
    }
    const added = newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id));
    const removed = oldMember.roles.cache.filter((role) => !newMember.roles.cache.has(role.id));
    if (added.size || removed.size) {
      const parts = [];
      if (added.size) parts.push(`fik ${added.map((role) => role.name).join(', ')}`);
      if (removed.size) parts.push(`mistede ${removed.map((role) => role.name).join(', ')}`);
      await record(newMember.guild, {
        type: 'rolle',
        userId: newMember.id,
        channelId: null,
        summary: `${newMember.user.tag} ${parts.join(' og ')}.`,
      });
    }
    } catch (err) {
      logErr(err);
    }
  });

  client.on('voiceStateUpdate', async (oldState, newState) => {
    if (oldState.channelId === newState.channelId) return;
    const guild = newState.guild || oldState.guild;
    if (!guild) return;
    const member = newState.member || oldState.member;
    const tag = member?.user?.tag || 'Ukendt';
    let summary = `${tag} skiftede stemmekanal.`;
    if (!oldState.channelId && newState.channel) summary = `${tag} joinede stemme ${newState.channel.name}.`;
    else if (oldState.channel && !newState.channelId) summary = `${tag} forlod stemme ${oldState.channel.name}.`;
    else if (oldState.channel && newState.channel) summary = `${tag} gik fra ${oldState.channel.name} til ${newState.channel.name}.`;
    await record(guild, {
      type: 'stemme',
      userId: member?.id || null,
      channelId: newState.channelId || oldState.channelId,
      summary,
    });
  });
}

async function handleLogs(interaction) {
  if (!isManager(interaction)) {
    await interaction.reply({ content: 'Du skal have Manage Server for at slå logs op.', flags: MessageFlags.Ephemeral });
    return;
  }
  const settings = getGuild(interaction.guildId);
  const sub = interaction.options.getSubcommand();
  if (sub === 'opsaet') {
    settings.logs.channelId = interaction.options.getChannel('kanal').id;
    save();
    await interaction.reply({ content: `Logs sendes nu til <#${settings.logs.channelId}>.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (sub === 'audit') {
    const choice = interaction.options.getString('type') || 'ban';
    try {
      const logs = await interaction.guild.fetchAuditLogs({ type: AUDIT[choice], limit: 10 });
      const lines = [...logs.entries.values()].map((entry) => {
        const when = `<t:${Math.floor(entry.createdTimestamp / 1000)}:R>`;
        const actor = entry.executor?.tag || 'ukendt';
        const target = entry.target?.tag || entry.target?.name || entry.target?.id || 'ukendt';
        const reason = entry.reason ? ` — ${redact(entry.reason)}` : '';
        return `${when} **${actor}** → ${target}${reason}`;
      });
      const embed = new EmbedBuilder()
        .setColor(GREEN)
        .setTitle(`Audit · ${choice}`)
        .setDescription(lines.join('\n').slice(0, 4096) || 'Ingen audit-logs af den type.')
        .setTimestamp();
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    } catch {
      await interaction.reply({
        content: 'Jeg kunne ikke læse audit log. Giv botten View Audit Log.',
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }
  const user = interaction.options.getUser('bruger');
  const entries = filterLogs(settings.logs.entries, {
    userId: sub === 'bruger' ? user.id : null,
    type: sub === 'seneste' ? interaction.options.getString('type') : null,
    text: sub === 'soeg' ? interaction.options.getString('tekst') : '',
    limit: 10,
  });
  const title = sub === 'bruger' ? `Logs · ${user.tag}` : sub === 'soeg' ? 'Søgning' : 'Seneste logs';
  await interaction.reply({ embeds: [logListEmbed(title, entries)], flags: MessageFlags.Ephemeral });
}

async function handleInfo(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'server') {
    const guild = interaction.guild;
    const owner = await guild.fetchOwner().catch(() => null);
    const embed = new EmbedBuilder()
      .setColor(GREEN)
      .setTitle(guild.name)
      .setThumbnail(guild.iconURL({ size: 256 }))
      .addFields(
        { name: 'ID', value: guild.id, inline: true },
        { name: 'Ejer', value: owner ? owner.user.tag : 'Ukendt', inline: true },
        { name: 'Medlemmer', value: `${guild.memberCount}`, inline: true },
        { name: 'Kanaler', value: `${guild.channels.cache.size}`, inline: true },
        { name: 'Roller', value: `${guild.roles.cache.size}`, inline: true },
        { name: 'Oprettet', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
      )
      .setTimestamp();
    const banner = guild.bannerURL({ size: 1024 });
    if (banner) embed.setImage(banner);
    await interaction.reply({ embeds: [embed] });
    return;
  }
  const user = interaction.options.getUser('bruger') || interaction.user;
  const fetched = await user.fetch(true).catch(() => user);
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  const roles = member
    ? member.roles.cache.filter((role) => role.id !== interaction.guildId).map((role) => role.toString()).slice(0, 20)
    : [];
  const embed = new EmbedBuilder()
    .setColor(GREEN)
    .setAuthor({ name: fetched.tag, iconURL: fetched.displayAvatarURL() })
    .setThumbnail(fetched.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: 'ID', value: fetched.id, inline: true },
      { name: 'Oprettet', value: `<t:${Math.floor(fetched.createdTimestamp / 1000)}:R>`, inline: true },
      { name: 'Joinede', value: member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Ikke på serveren', inline: true },
      { name: 'Roller', value: roles.join(' ').slice(0, 1000) || 'Ingen' },
    )
    .setTimestamp();
  const banner = typeof fetched.bannerURL === 'function' ? fetched.bannerURL({ size: 1024 }) : null;
  if (banner) embed.setImage(banner);
  await interaction.reply({ embeds: [embed] });
}

module.exports = {
  record,
  attachLogger,
  handleLogs,
  handleInfo,
};

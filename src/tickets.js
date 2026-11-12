const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const { canStaff, humanError, isManager } = require('./access');
const { markClosing } = require('./closing');
const {
  addModal,
  applyAddModal,
  applyTextModal,
  createState,
  forget,
  getWizard,
  panelSelect,
  render,
  textModal,
} = require('./builder');
const { clip, nid, redact, ticketChannelName } = require('./logic');
const { getGuild, save } = require('./store');
const { panelEmbed, ticketEmbed } = require('./theme');
const { record } = require('./logger');

const ticketAllow = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];

function ticketButtons(channelId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tclaim:${channelId}`).setLabel('Overtag').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`tscript:${channelId}`).setLabel('Transskript').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`tclose:${channelId}`).setLabel('Luk').setStyle(ButtonStyle.Danger),
  );
}

function staffRoleFor(guildId, panel) {
  return (panel && panel.staffRoleId) || getGuild(guildId).protect.staffRoleId || null;
}

function viewOf(ticket) {
  return {
    name: ticket.optionName,
    message: ticket.optionMessage,
    bannerUrl: ticket.bannerUrl,
  };
}

async function refresh(interaction, payload) {
  const next = { ...payload };
  delete next.ephemeral;
  delete next.fetchReply;
  if (interaction.deferred || interaction.replied) return interaction.editReply(next);
  if (interaction.isMessageComponent() || interaction.isModalSubmit()) return interaction.update(next);
  return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
}

async function ephemeral(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral };
  if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

async function handleTicketMake(interaction) {
  if (!isManager(interaction)) {
    await ephemeral(interaction, 'Du skal have Manage Server for at bygge et panel.');
    return;
  }
  const destination = interaction.options.getChannel('kanal') || interaction.channel;
  if (!destination?.isTextBased?.()) {
    await ephemeral(interaction, 'Vælg en tekstkanal til panelet.');
    return;
  }
  const staff = interaction.options.getRole('staff');
  const parent = interaction.options.getChannel('kategori');
  const saved = getGuild(interaction.guildId);
  const state = createState({
    guildId: interaction.guildId,
    userId: interaction.user.id,
    destinationId: destination.id,
    staffRoleId: staff?.id || saved.protect.staffRoleId,
    parentId: parent?.id || null,
  });
  const message = await interaction.reply({
    ...render(state),
    flags: MessageFlags.Ephemeral,
    fetchReply: true,
  });
  state.messageId = message.id;
}

async function publishPanel(guild, state) {
  if (!state.options.length) return { error: 'Tilføj mindst ét valg før du sender panelet.' };
  if (state.options.length > 10) return { error: 'Du kan højst have 10 valg.' };
  const dest = await guild.channels.fetch(state.destinationId).catch(() => null);
  if (!dest || !dest.isTextBased()) return { error: 'Jeg kan ikke finde kanalen panelet skal stå i.' };
  const me = guild.members.me || await guild.members.fetchMe();
  const perms = dest.permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.EmbedLinks)) {
    return { error: 'Jeg mangler Send Messages og Embed Links i den kanal.' };
  }
  const panel = {
    id: nid(4),
    guildId: guild.id,
    channelId: dest.id,
    messageId: null,
    staffRoleId: state.staffRoleId,
    parentId: state.parentId,
    title: state.title,
    description: state.description,
    bannerUrl: state.bannerUrl,
    footer: state.footer,
    options: state.options.map((option) => ({ ...option })),
  };
  const send = async () => dest.send({
    embeds: [panelEmbed(panel)],
    components: [new ActionRowBuilder().addComponents(panelSelect(panel))],
  });
  let message;
  try {
    message = await send();
  } catch (err) {
    if (err && err.code === 50035 && panel.options.some((option) => option.emoji)) {
      panel.options.forEach((option) => { option.emoji = ''; });
      try {
        message = await send();
      } catch (next) {
        if (next && next.code === 50035 && panel.bannerUrl) {
          return { error: 'Discord afviste banneret. Brug et direkte billedlink (png, jpg, gif eller webp).' };
        }
        throw next;
      }
    } else if (err && err.code === 50035 && panel.bannerUrl) {
      return { error: 'Discord afviste banneret. Brug et direkte billedlink (png, jpg, gif eller webp).' };
    } else {
      throw err;
    }
  }
  panel.messageId = message.id;
  const data = getGuild(guild.id);
  data.panels[panel.id] = panel;
  if (state.staffRoleId && !data.protect.staffRoleId) data.protect.staffRoleId = state.staffRoleId;
  save();
  return { panel, message };
}

function uniqueTicketName(guild, username) {
  let name = ticketChannelName(username);
  if (guild.channels.cache.some((channel) => channel.name === name)) {
    name = `${name}-${nid(2)}`.slice(0, 100);
  }
  return name;
}

async function createTicketChannel(guild, payload) {
  try {
    return await guild.channels.create(payload);
  } catch (err) {
    if (payload.parent) {
      const next = { ...payload };
      delete next.parent;
      return guild.channels.create(next);
    }
    throw err;
  }
}

async function openTicket(interaction, panel, option) {
  const guild = interaction.guild;
  const data = getGuild(guild.id);
  const existing = Object.values(data.tickets).find((ticket) => ticket.ownerId === interaction.user.id);
  if (existing) {
    const channel = guild.channels.cache.get(existing.channelId);
    if (channel) return { error: `Du har allerede en åben ticket: ${channel}` };
    delete data.tickets[existing.channelId];
    save();
  }
  const staffRoleId = staffRoleFor(guild.id, panel);
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: ticketAllow },
    {
      id: guild.client.user.id,
      allow: [...ticketAllow, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages],
    },
  ];
  if (staffRoleId) {
    overwrites.push({
      id: staffRoleId,
      allow: [...ticketAllow, PermissionFlagsBits.ManageMessages],
    });
  }
  const channel = await createTicketChannel(guild, {
    name: uniqueTicketName(guild, interaction.user.username),
    type: ChannelType.GuildText,
    parent: panel.parentId || undefined,
    topic: `Ticket · ${option.name} · ${interaction.user.tag}`.slice(0, 1024),
    permissionOverwrites: overwrites,
  });
  const bannerUrl = option.bannerUrl || panel.bannerUrl || '';
  const ticket = {
    channelId: channel.id,
    ownerId: interaction.user.id,
    panelId: panel.id,
    optionId: option.id,
    optionName: option.name,
    optionMessage: option.message,
    bannerUrl,
    footer: panel.footer || '',
    staffRoleId,
    claimedBy: null,
    welcomeMessageId: null,
    createdAt: Date.now(),
  };
  const payload = {
    content: staffRoleId ? `<@${interaction.user.id}> <@&${staffRoleId}>` : `<@${interaction.user.id}>`,
    embeds: [ticketEmbed({
      panel,
      option,
      ownerId: interaction.user.id,
      claimerId: null,
      footer: panel.footer,
      bannerUrl,
    })],
    components: [ticketButtons(channel.id)],
    allowedMentions: { users: [interaction.user.id], roles: staffRoleId ? [staffRoleId] : [] },
  };
  let welcome;
  try {
    welcome = await channel.send(payload);
  } catch (err) {
    if (err && err.code === 50035 && bannerUrl) {
      ticket.bannerUrl = '';
      payload.embeds = [ticketEmbed({
        panel,
        option,
        ownerId: interaction.user.id,
        claimerId: null,
        footer: panel.footer,
        bannerUrl: '',
      })];
      try {
        welcome = await channel.send(payload);
      } catch (retryErr) {
        await channel.delete('Ticket kunne ikke åbnes').catch(() => {});
        throw retryErr;
      }
      await channel.send('Banner-linket kunne ikke vises. Brug et direkte billedlink (png, jpg, gif eller webp).').catch(() => {});
    } else {
      await channel.delete('Ticket kunne ikke åbnes').catch(() => {});
      throw err;
    }
  }
  ticket.welcomeMessageId = welcome.id;
  data.tickets[channel.id] = ticket;
  save();
  await record(guild, {
    type: 'ticket',
    userId: interaction.user.id,
    channelId: channel.id,
    summary: `${interaction.user.tag} åbnede en ticket: ${option.name}.`,
  });
  return { channel };
}

async function collectMessages(channel) {
  const all = [];
  let before;
  while (all.length < 100) {
    const batch = await channel.messages.fetch({ limit: Math.min(100, 100 - all.length), before });
    if (!batch.size) break;
    all.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  return all;
}

function transcriptText(messages) {
  const lines = messages.map((message) => {
    const time = new Date(message.createdTimestamp).toISOString().replace('T', ' ').slice(0, 16);
    const content = redact(message.content || '');
    const files = [...message.attachments.values()].map((file) => file.url).join(' ');
    const text = [content, files].filter(Boolean).join(' ') || '[tom]';
    return `[${time}] ${message.author?.tag || 'ukendt'}: ${clip(text, 500)}`;
  });
  return lines.join('\n').slice(0, 1_000_000) || 'Ingen beskeder.';
}

function transcriptFile(channel, text) {
  return new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `transskript-${channel.name}.txt` });
}

async function deliverTranscript(guild, channel, ticket, text, closerTag) {
  const logId = getGuild(guild.id).logs.channelId;
  if (logId) {
    const logChannel = await guild.channels.fetch(logId).catch(() => null);
    if (logChannel) {
      await logChannel.send({
        content: `Transskript · ${channel.name} · lukket af ${closerTag}`,
        files: [transcriptFile(channel, text)],
      }).catch(() => {});
    }
  }
  const owner = await guild.client.users.fetch(ticket.ownerId).catch(() => null);
  if (owner) {
    await owner.send({
      content: `Din ticket ${channel.name} er lukket.`,
      files: [transcriptFile(channel, text)],
    }).catch(() => {});
  }
}

async function closeTicket(interaction, channelId) {
  const channel = interaction.guild.channels.cache.get(channelId) || interaction.channel;
  const data = getGuild(interaction.guildId);
  const ticket = data.tickets[channelId];
  if (!ticket || !channel) {
    await ephemeral(interaction, 'Den ticket findes ikke længere.');
    return;
  }
  const owner = interaction.user.id === ticket.ownerId;
  if (!owner && !canStaff(interaction, data, ticket.staffRoleId)) {
    await ephemeral(interaction, 'Kun den der åbnede ticketen, staff eller en manager kan lukke den.');
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let removed = false;
  try {
    const messages = await collectMessages(channel);
    const text = transcriptText(messages);
    await deliverTranscript(interaction.guild, channel, ticket, text, interaction.user.tag);
    await record(interaction.guild, {
      type: 'ticket',
      userId: interaction.user.id,
      channelId: channel.id,
      summary: `${interaction.user.tag} lukkede ticketen ${channel.name} (${ticket.optionName}).`,
    });
    delete data.tickets[channel.id];
    save();
    removed = true;
    markClosing(channel.id);
    await channel.delete('Ticket lukket');
  } catch (err) {
    if (removed) {
      data.tickets[channel.id] = ticket;
      save();
    }
    await interaction.editReply({ content: humanError(err) });
    return;
  }
  await interaction.editReply({ content: 'Ticketen er lukket, og transskriptet er sendt til loggen.' });
}

async function claimTicket(interaction, channelId) {
  const data = getGuild(interaction.guildId);
  const ticket = data.tickets[channelId];
  if (!ticket) {
    await ephemeral(interaction, 'Den ticket findes ikke længere.');
    return;
  }
  if (!canStaff(interaction, data, ticket.staffRoleId)) {
    await ephemeral(interaction, 'Kun staff kan overtage en ticket.');
    return;
  }
  ticket.claimedBy = interaction.user.id;
  save();
  const embed = ticketEmbed({
    option: viewOf(ticket),
    ownerId: ticket.ownerId,
    claimerId: ticket.claimedBy,
    footer: ticket.footer,
    bannerUrl: ticket.bannerUrl,
  });
  await interaction.update({ embeds: [embed], components: [ticketButtons(channelId)] });
  await record(interaction.guild, {
    type: 'ticket',
    userId: interaction.user.id,
    channelId,
    summary: `${interaction.user.tag} overtog ticketen ${ticket.optionName}.`,
  });
}

async function sendTranscript(interaction, channelId) {
  const channel = interaction.guild.channels.cache.get(channelId) || interaction.channel;
  const ticket = getGuild(interaction.guildId).tickets[channelId];
  if (!ticket || !channel) {
    await ephemeral(interaction, 'Den ticket findes ikke længere.');
    return;
  }
  const data = getGuild(interaction.guildId);
  const owner = interaction.user.id === ticket.ownerId;
  if (!owner && !canStaff(interaction, data, ticket.staffRoleId)) {
    await ephemeral(interaction, 'Kun folk i ticketen kan hente transskriptet.');
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const text = transcriptText(await collectMessages(channel));
  await interaction.editReply({
    content: 'Her er transskriptet.',
    files: [transcriptFile(channel, text)],
  });
}

async function handleTicketCommand(interaction) {
  const sub = interaction.options.getSubcommand();
  const ticket = getGuild(interaction.guildId).tickets[interaction.channelId];
  if (!ticket) {
    await ephemeral(interaction, 'Brug kommandoen inde i en ticket.');
    return;
  }
  if (sub === 'luk') {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: 'Luk ticketen? Kanalen slettes, og et transskript gemmes i loggen.',
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tclose-yes:${interaction.channelId}`).setLabel('Ja, luk').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('tclose-no').setLabel('Nej').setStyle(ButtonStyle.Secondary),
      )],
    });
    return;
  }
  const data = getGuild(interaction.guildId);
  if (!canStaff(interaction, data, ticket.staffRoleId)) {
    await ephemeral(interaction, 'Kun staff kan tilføje eller fjerne folk.');
    return;
  }
  const user = interaction.options.getUser('bruger', true);
  if (sub === 'tilfoej') {
    await interaction.channel.permissionOverwrites.edit(user.id, {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true,
    });
    await interaction.reply({ content: `${user} er tilføjet af ${interaction.user}.`, allowedMentions: { users: [user.id] } });
    return;
  }
  if (user.id === ticket.ownerId) {
    await ephemeral(interaction, 'Du kan ikke fjerne den der åbnede ticketen.');
    return;
  }
  await interaction.channel.permissionOverwrites.delete(user.id).catch(() => {});
  await interaction.reply({ content: `${user} er fjernet fra ticketen.`, allowedMentions: { users: [] } });
}

async function handleTicketComponent(interaction) {
  const { customId } = interaction;
  if (customId === 'tclose-no') {
    await interaction.update({ content: 'Ticketen er stadig åben.', components: [] });
    return;
  }
  if (customId.startsWith('tclose-yes:')) {
    await closeTicket(interaction, customId.split(':')[1]);
    return;
  }
  if (customId.startsWith('tclose:')) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: 'Luk ticketen? Kanalen slettes, og et transskript gemmes i loggen.',
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`tclose-yes:${customId.split(':')[1]}`).setLabel('Ja, luk').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('tclose-no').setLabel('Nej').setStyle(ButtonStyle.Secondary),
      )],
    });
    return;
  }
  if (customId.startsWith('tclaim:')) {
    await claimTicket(interaction, customId.split(':')[1]);
    return;
  }
  if (customId.startsWith('tscript:')) {
    await sendTranscript(interaction, customId.split(':')[1]);
    return;
  }
  if (customId.startsWith('ticketopen:')) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const panelId = customId.split(':')[1];
    const panel = getGuild(interaction.guildId).panels[panelId];
    if (!panel) {
      await interaction.editReply({ content: 'Det panel findes ikke længere. Lav et nyt med /ticketmake.' });
      return;
    }
    const option = panel.options.find((item) => item.id === interaction.values[0]);
    if (!option) {
      await interaction.editReply({ content: 'Det valg findes ikke længere.' });
      return;
    }
    try {
      const opened = await openTicket(interaction, panel, option);
      if (opened.error) {
        await interaction.editReply({ content: opened.error });
      } else {
        await interaction.editReply({ content: `Ticket åbnet: ${opened.channel}` });
      }
      await interaction.message.edit({
        embeds: [panelEmbed(panel)],
        components: [new ActionRowBuilder().addComponents(panelSelect(panel))],
      }).catch(() => {});
    } catch (err) {
      await interaction.editReply({ content: humanError(err) });
    }
    return;
  }

  const state = getWizard(interaction);
  if (!state) {
    await ephemeral(interaction, 'Builderen er udløbet. Kør /ticketmake igen.');
    return;
  }
  if (customId === 'tb:text') {
    await interaction.showModal(textModal(state));
    return;
  }
  if (customId === 'tb:add') {
    if (state.options.length >= 10) {
      await ephemeral(interaction, 'Du kan højst have 10 valg.');
      return;
    }
    await interaction.showModal(addModal());
    return;
  }
  if (customId === 'tb:cancel') {
    forget(state);
    await interaction.update({ content: 'Panel-builderen er annulleret.', embeds: [], components: [] });
    return;
  }
  if (customId === 'tb:send') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const posted = await publishPanel(interaction.guild, state);
      if (posted.error) {
        await interaction.editReply({ content: posted.error });
        return;
      }
      forget(state);
      await interaction.editReply({ content: `Panelet er sendt i <#${posted.panel.channelId}>.` });
      if (interaction.message) {
        await interaction.message.edit({ content: 'Panelet er sendt.', embeds: [], components: [] }).catch(() => {});
      }
    } catch (err) {
      await interaction.editReply({ content: humanError(err) });
    }
    return;
  }
  if (customId === 'tb:modal:text' || customId === 'tb:modal:add') {
    const result = customId.endsWith('text')
      ? applyTextModal(state, interaction.fields)
      : applyAddModal(state, interaction.fields);
    if (result.error) {
      await ephemeral(interaction, result.error);
      return;
    }
    await refresh(interaction, render(state));
    return;
  }
  if (customId === 'tb:remove' && interaction.isStringSelectMenu()) {
    state.options = state.options.filter((option) => option.id !== interaction.values[0]);
    state.notice = '';
    await refresh(interaction, render(state));
    return;
  }
  if (customId === 'tb:staff' && interaction.isRoleSelectMenu()) {
    state.staffRoleId = interaction.values[0];
    state.notice = 'Staff-rollen kan se nye tickets og er undtaget fra beskyttelse.';
    await refresh(interaction, render(state));
    return;
  }
  if (customId === 'tb:parent' && interaction.isChannelSelectMenu()) {
    state.parentId = interaction.values[0];
    state.notice = '';
    await refresh(interaction, render(state));
  }
}

module.exports = {
  handleTicketMake,
  handleTicketCommand,
  handleTicketComponent,
};

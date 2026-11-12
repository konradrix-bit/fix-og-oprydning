const { EmbedBuilder } = require('discord.js');
const {
  GREEN,
  DEFAULT_DESCRIPTION,
  DEFAULT_FOOTER,
  DEFAULT_TICKET_TEXT,
  bannerFor,
  parseEmoji,
} = require('./logic');

const TITLES = {
  besked_slettet: 'Besked slettet',
  besked_redigeret: 'Besked redigeret',
  medlem_join: 'Medlem joinede',
  medlem_forlod: 'Medlem forlod',
  kick: 'Kick',
  ban: 'Ban',
  unban: 'Unban',
  kanal: 'Kanal',
  rolle: 'Rolle',
  nick: 'Kaldenavn',
  stemme: 'Stemme',
  protect: 'Beskyttelse',
  ticket: 'Ticket',
};

function applyBanner(embed, url) {
  if (url) embed.setImage(url);
  return embed;
}

function optionLines(options) {
  return (options || []).map((option) => {
    const emoji = parseEmoji(option.emoji);
    const prefix = emoji ? String(option.emoji).trim() : '•';
    const description = option.description ? ` — ${option.description}` : '';
    return `${prefix} **${option.name}**${description}`;
  }).join('\n');
}

function panelEmbed(panel) {
  const lines = optionLines(panel.options);
  const body = [panel.description || DEFAULT_DESCRIPTION, lines].filter(Boolean).join('\n\n');
  const embed = new EmbedBuilder()
    .setColor(GREEN)
    .setTitle(panel.title || 'Tickets')
    .setDescription(body.slice(0, 4096));
  if (panel.footer) embed.setFooter({ text: String(panel.footer).slice(0, 2048) });
  return applyBanner(embed, panel.bannerUrl);
}

function builderEmbed(state) {
  const embed = panelEmbed({
    title: state.title,
    description: state.description,
    bannerUrl: state.bannerUrl,
    footer: state.footer || DEFAULT_FOOTER,
    options: state.options,
  });
  embed.addFields(
    { name: 'Valg', value: `${state.options.length}/10`, inline: true },
    { name: 'Staff', value: state.staffRoleId ? `<@&${state.staffRoleId}>` : 'Kun administratorer', inline: true },
    { name: 'Kategori', value: state.parentId ? `<#${state.parentId}>` : 'Ingen (øverst)', inline: true },
    { name: 'Kanal', value: state.destinationId ? `<#${state.destinationId}>` : 'Her', inline: true },
  );
  if (!state.staffRoleId) {
    embed.addFields({
      name: 'Staff-rolle',
      value: 'Vælg en staff-rolle, hvis almindelige staff skal kunne se tickets. Administratorer kan altid se dem.',
    });
  }
  if (state.notice) embed.addFields({ name: 'Note', value: String(state.notice).slice(0, 1024) });
  return embed;
}

function ticketEmbed({ panel, option, ownerId, claimerId, footer, bannerUrl }) {
  const embed = new EmbedBuilder()
    .setColor(GREEN)
    .setTitle((option && option.name) || 'Ticket')
    .setDescription((option && option.message) || DEFAULT_TICKET_TEXT)
    .addFields(
      { name: 'Åbnet af', value: `<@${ownerId}>`, inline: true },
      { name: 'Overtaget af', value: claimerId ? `<@${claimerId}>` : 'Ingen endnu', inline: true },
    )
    .setTimestamp();
  const foot = footer || (panel && panel.footer) || '';
  if (foot) embed.setFooter({ text: String(foot).slice(0, 2048) });
  return applyBanner(embed, bannerUrl || bannerFor(panel, option));
}

function logEmbed(entry) {
  return new EmbedBuilder()
    .setColor(GREEN)
    .setTitle(TITLES[entry.type] || 'Log')
    .setDescription(String(entry.summary || 'Ingen detaljer').slice(0, 4096))
    .setFooter({ text: entry.type || 'log' })
    .setTimestamp(entry.at || Date.now());
}

function formatLogLine(entry) {
  const stamp = `<t:${Math.floor((entry.at || Date.now()) / 1000)}:R>`;
  return `${stamp} **${TITLES[entry.type] || entry.type}** — ${entry.summary || ''}`.slice(0, 350);
}

function logListEmbed(title, entries) {
  const embed = new EmbedBuilder().setColor(GREEN).setTitle(title).setTimestamp();
  if (!entries.length) {
    embed.setDescription('Ingen logs matchede.');
    return embed;
  }
  embed.setDescription(entries.map(formatLogLine).join('\n').slice(0, 4096));
  return embed;
}

function onOff(value) {
  return value ? 'Til' : 'Fra';
}

function statusEmbed(settings) {
  const spam = settings.protect.antispam;
  const raid = settings.protect.antiraid;
  const handling = { log: 'kun log', lockdown: 'lås serveren', kick: 'kick nye konti' }[raid.handling] || raid.handling;
  const log = settings.logs.channelId ? `<#${settings.logs.channelId}>` : 'Ikke sat';
  const staff = settings.protect.staffRoleId ? `<@&${settings.protect.staffRoleId}>` : 'Ikke sat';
  const ignored = settings.protect.ignoredChannels.length
    ? settings.protect.ignoredChannels.map((id) => `<#${id}>`).join(', ').slice(0, 1000)
    : 'Ingen';
  return new EmbedBuilder()
    .setColor(GREEN)
    .setTitle('Beskyttelse')
    .addFields(
      { name: 'Anti-spam', value: `${onOff(spam.on)} · straf over ${spam.max} beskeder på ${spam.seconds}s · timeout ${spam.timeout} min`, inline: false },
      { name: 'Anti-raid', value: `${onOff(raid.on)} · ${raid.joins} joins / ${raid.seconds}s · ${handling}`, inline: false },
      { name: 'Anti-link', value: onOff(settings.protect.antilink.on), inline: true },
      { name: 'Anti-invite', value: onOff(settings.protect.antiinvite.on), inline: true },
      { name: 'Masse-mention', value: `${onOff(settings.protect.mentions.on)} · maks ${settings.protect.mentions.max}`, inline: true },
      { name: 'Lockdown', value: onOff(settings.protect.lockdown.on), inline: true },
      { name: 'Logkanal', value: log, inline: true },
      { name: 'Staff', value: staff, inline: true },
      { name: 'Ignorerede kanaler', value: ignored, inline: false },
    )
    .setTimestamp();
}

module.exports = {
  TITLES,
  panelEmbed,
  builderEmbed,
  ticketEmbed,
  logEmbed,
  logListEmbed,
  statusEmbed,
};

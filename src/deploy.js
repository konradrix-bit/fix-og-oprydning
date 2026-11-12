const { PermissionFlagsBits, REST, Routes } = require('discord.js');
const { commands } = require('./commands');

function inviteUrl(clientId) {
  const names = [
    'ViewChannel',
    'SendMessages',
    'ManageMessages',
    'EmbedLinks',
    'AttachFiles',
    'ReadMessageHistory',
    'ManageChannels',
    'ModerateMembers',
    'KickMembers',
    'ViewAuditLog',
  ];
  const permissions = names.reduce((sum, name) => sum | PermissionFlagsBits[name], 0n);
  return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${permissions}&scope=bot%20applications.commands`;
}

async function registerCommands(token, clientId, guildId) {
  const rest = new REST({ version: '10' }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: commands.map((command) => command.toJSON()),
  });
}

module.exports = { inviteUrl, registerCommands };

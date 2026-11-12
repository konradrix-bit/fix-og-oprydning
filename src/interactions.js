const { MessageFlags } = require('discord.js');
const { handleLogs, handleInfo } = require('./logger');
const { handleProtect } = require('./protect');
const { handleTicketCommand, handleTicketComponent, handleTicketMake } = require('./tickets');
const { handleVerify, handleVerifyButton } = require('./verify');

function isSelect(interaction) {
  if (typeof interaction.isAnySelectMenu === 'function') return interaction.isAnySelectMenu();
  return Boolean(
    interaction.isStringSelectMenu?.()
    || interaction.isRoleSelectMenu?.()
    || interaction.isChannelSelectMenu?.()
  );
}

function isTicketUi(customId) {
  return customId.startsWith('tb:')
    || customId.startsWith('ticketopen:')
    || customId.startsWith('tclose')
    || customId.startsWith('tclaim:')
    || customId.startsWith('tscript:');
}

async function onInteraction(interaction) {
  if (!interaction.guild) {
    await interaction.reply({ content: 'Den her bot virker kun på en server.', flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'ticketmake') return handleTicketMake(interaction);
    if (interaction.commandName === 'ticket') return handleTicketCommand(interaction);
    if (interaction.commandName === 'protect') return handleProtect(interaction);
    if (interaction.commandName === 'logs') return handleLogs(interaction);
    if (interaction.commandName === 'info') return handleInfo(interaction);
    if (interaction.commandName === 'verify') return handleVerify(interaction);
    return;
  }
  if (interaction.isButton() && interaction.customId === 'verify:go') {
    await handleVerifyButton(interaction);
    return;
  }
  if ((interaction.isModalSubmit() || interaction.isButton() || isSelect(interaction)) && isTicketUi(interaction.customId)) {
    await handleTicketComponent(interaction);
  }
}

module.exports = { onInteraction };

const { PermissionFlagsBits } = require('discord.js');

function logErr(err) {
  const raw = String(err && (err.stack || err.message) ? err.stack || err.message : err);
  console.error(raw.replace(/[\w-]{24,}\.[\w-]{6}\.[\w-]{27,}/g, '[skjult]'));
}

function humanError(err) {
  const code = err && (err.code || err.message);
  if (code === 'banner' || (err && err.banner)) {
    return 'Discord afviste banneret. Brug et direkte billedlink (png, jpg, gif eller webp).';
  }
  if (err && err.code === 50013) {
    return 'Jeg mangler rettigheder. Giv bot-rollen Manage Channels, Send Messages, Moderate Members og View Audit Log, og læg rollen over de roller den skal kunne styre.';
  }
  if (err && (err.code === 30013 || err.code === 30011)) {
    return 'Serveren har ikke plads til flere kanaler.';
  }
  if (err && err.code === 50035) {
    return 'Discord afviste indholdet. Tjek teksten, emoji og at banneret er et direkte billedlink.';
  }
  logErr(err);
  return 'Det lykkedes ikke. Tjek at botten kan se kanalen, og prøv igen.';
}

function memberHasRole(member, roleId) {
  if (!member || !roleId) return false;
  if (member.roles && member.roles.cache) return member.roles.cache.has(roleId);
  if (Array.isArray(member.roles)) return member.roles.includes(roleId);
  return false;
}

function isManager(interaction) {
  const perms = interaction.memberPermissions;
  if (!perms) return false;
  return perms.has(PermissionFlagsBits.ManageGuild) || perms.has(PermissionFlagsBits.Administrator);
}

function isExempt(member, settings) {
  if (!member) return true;
  const perms = member.permissions;
  if (perms?.has(PermissionFlagsBits.Administrator) || perms?.has(PermissionFlagsBits.ManageGuild)) return true;
  return memberHasRole(member, settings.protect.staffRoleId);
}

function canStaff(interaction, settings, staffRoleId) {
  if (isManager(interaction)) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) return true;
  const roleId = staffRoleId || settings.protect.staffRoleId;
  return memberHasRole(interaction.member, roleId);
}

module.exports = {
  logErr,
  humanError,
  memberHasRole,
  isManager,
  isExempt,
  canStaff,
};

const {
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const LOG_TYPES = [
  { name: 'Besked slettet', value: 'besked_slettet' },
  { name: 'Besked redigeret', value: 'besked_redigeret' },
  { name: 'Medlem joinede', value: 'medlem_join' },
  { name: 'Medlem forlod', value: 'medlem_forlod' },
  { name: 'Kick', value: 'kick' },
  { name: 'Ban', value: 'ban' },
  { name: 'Unban', value: 'unban' },
  { name: 'Kanal', value: 'kanal' },
  { name: 'Rolle', value: 'rolle' },
  { name: 'Kaldenavn', value: 'nick' },
  { name: 'Stemme', value: 'stemme' },
  { name: 'Beskyttelse', value: 'protect' },
  { name: 'Ticket', value: 'ticket' },
];

const AUDIT_TYPES = [
  { name: 'Ban', value: 'ban' },
  { name: 'Unban', value: 'unban' },
  { name: 'Kick', value: 'kick' },
  { name: 'Kanal oprettet', value: 'kanal' },
  { name: 'Rolle oprettet', value: 'rolle' },
  { name: 'Besked slettet', value: 'besked' },
];

const manage = PermissionFlagsBits.ManageGuild;

const commands = [
  new SlashCommandBuilder()
    .setName('ticketmake')
    .setDescription('Byg et grønt ticket-panel med op til 10 valg')
    .setDMPermission(false)
    .setDefaultMemberPermissions(manage)
    .addChannelOption((option) => option
      .setName('kanal')
      .setDescription('Kanalen panelet skal stå i')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
    .addRoleOption((option) => option
      .setName('staff')
      .setDescription('Rolle der kan se de nye tickets'))
    .addChannelOption((option) => option
      .setName('kategori')
      .setDescription('Kategori som ticket-kanaler lægges i')
      .addChannelTypes(ChannelType.GuildCategory)),
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Luk, tilføj eller fjern nogen i en ticket')
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('luk').setDescription('Luk den ticket du står i'))
    .addSubcommand((sub) => sub
      .setName('tilfoej')
      .setDescription('Giv en person adgang til ticketen')
      .addUserOption((option) => option.setName('bruger').setDescription('Hvem der skal med').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('fjern')
      .setDescription('Fjern en person fra ticketen')
      .addUserOption((option) => option.setName('bruger').setDescription('Hvem der fjernes').setRequired(true))),
  new SlashCommandBuilder()
    .setName('protect')
    .setDescription('Slå beskyttelse til og fra')
    .setDMPermission(false)
    .setDefaultMemberPermissions(manage)
    .addSubcommand((sub) => sub.setName('status').setDescription('Vis hvad der er slået til'))
    .addSubcommand((sub) => sub
      .setName('antispam')
      .setDescription('Slet spam og giv timeout')
      .addBooleanOption((option) => option.setName('aktiv').setDescription('Slå til eller fra').setRequired(true))
      .addIntegerOption((option) => option.setName('maks').setDescription('Maks beskeder i vinduet').setMinValue(3).setMaxValue(20))
      .addIntegerOption((option) => option.setName('sekunder').setDescription('Tidsvindue i sekunder').setMinValue(2).setMaxValue(30))
      .addIntegerOption((option) => option.setName('timeout').setDescription('Timeout i minutter').setMinValue(1).setMaxValue(60)))
    .addSubcommand((sub) => sub
      .setName('antiraid')
      .setDescription('Reager når mange joiner på én gang')
      .addBooleanOption((option) => option.setName('aktiv').setDescription('Slå til eller fra').setRequired(true))
      .addIntegerOption((option) => option.setName('joins').setDescription('Antal joins der udløser det').setMinValue(3).setMaxValue(25))
      .addIntegerOption((option) => option.setName('sekunder').setDescription('Tidsvindue i sekunder').setMinValue(3).setMaxValue(60))
      .addIntegerOption((option) => option.setName('alder').setDescription('Konti yngre end så mange dage').setMinValue(0).setMaxValue(30))
      .addStringOption((option) => option
        .setName('handling')
        .setDescription('Hvad der sker ved et raid')
        .addChoices(
          { name: 'Kun log', value: 'log' },
          { name: 'Lås serveren', value: 'lockdown' },
          { name: 'Kick nye konti', value: 'kick' },
        )))
    .addSubcommand((sub) => sub
      .setName('antilink')
      .setDescription('Slet links fra folk uden staff-rolle')
      .addBooleanOption((option) => option.setName('aktiv').setDescription('Slå til eller fra').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('antiinvite')
      .setDescription('Slet Discord-invites')
      .addBooleanOption((option) => option.setName('aktiv').setDescription('Slå til eller fra').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('mentions')
      .setDescription('Slet beskeder med for mange mentions')
      .addBooleanOption((option) => option.setName('aktiv').setDescription('Slå til eller fra').setRequired(true))
      .addIntegerOption((option) => option.setName('maks').setDescription('Maks mentions i én besked').setMinValue(2).setMaxValue(20)))
    .addSubcommand((sub) => sub
      .setName('lockdown')
      .setDescription('Luk eller åbn for at alle kan skrive')
      .addBooleanOption((option) => option.setName('aktiv').setDescription('Til låser serveren, fra åbner den').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('log')
      .setDescription('Kanal som beskyttelse og logs skrives til')
      .addChannelOption((option) => option
        .setName('kanal')
        .setDescription('Logkanal')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((sub) => sub
      .setName('staff')
      .setDescription('Rolle der er undtaget fra beskyttelse')
      .addRoleOption((option) => option.setName('rolle').setDescription('Staff-rolle').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('ignorer')
      .setDescription('Spring beskyttelse over i en kanal')
      .addChannelOption((option) => option
        .setName('kanal')
        .setDescription('Kanalen der skal ignoreres eller medtages')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addBooleanOption((option) => option.setName('aktiv').setDescription('Til ignorerer kanalen').setRequired(true))),
  new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Slå op i Discord-loggene')
    .setDMPermission(false)
    .setDefaultMemberPermissions(manage)
    .addSubcommand((sub) => sub
      .setName('opsaet')
      .setDescription('Vælg kanalen logs sendes til')
      .addChannelOption((option) => option
        .setName('kanal')
        .setDescription('Logkanal')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
    .addSubcommand((sub) => sub
      .setName('seneste')
      .setDescription('Vis de seneste logs')
      .addStringOption((option) => option
        .setName('type')
        .setDescription('Filtrér på en type')
        .addChoices(...LOG_TYPES)))
    .addSubcommand((sub) => sub
      .setName('bruger')
      .setDescription('Vis logs for en bruger')
      .addUserOption((option) => option.setName('bruger').setDescription('Hvem der slås op').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('soeg')
      .setDescription('Søg i loggene')
      .addStringOption((option) => option
        .setName('tekst')
        .setDescription('Tekst der skal findes')
        .setRequired(true)
        .setMinLength(2)
        .setMaxLength(80)))
    .addSubcommand((sub) => sub
      .setName('audit')
      .setDescription('Slå op i Discords audit log')
      .addStringOption((option) => option
        .setName('type')
        .setDescription('Hvilken audit-type')
        .addChoices(...AUDIT_TYPES))),
  new SlashCommandBuilder()
    .setName('info')
    .setDescription('Slå en bruger eller serveren op')
    .setDMPermission(false)
    .addSubcommand((sub) => sub
      .setName('bruger')
      .setDescription('Vis konto, roller og banner')
      .addUserOption((option) => option.setName('bruger').setDescription('Hvem der slås op')))
    .addSubcommand((sub) => sub.setName('server').setDescription('Vis serverens tal')),
];

module.exports = { commands, LOG_TYPES, AUDIT_TYPES };

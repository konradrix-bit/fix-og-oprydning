const { loadEnv } = require('./src/env');

loadEnv();

const { Client, GatewayIntentBits, MessageFlags, Options, Partials } = require('discord.js');
const { logErr } = require('./src/access');
const { inviteUrl, registerCommands } = require('./src/deploy');
const { onInteraction } = require('./src/interactions');
const { attachLogger } = require('./src/logger');
const { onMemberAdd, onMessage } = require('./src/protect');
const { handleDpull, startVerifyServer } = require('./src/verify');

// Wispbyte: startup-kommando `node index.js`
// Miljøvariabel: DISCORD_TOKEN
const token = (process.env.DISCORD_TOKEN || process.env.TOKEN || process.env.BOT_TOKEN || '').trim();

if (!token) {
  console.error('Mangler DISCORD_TOKEN. Læg den i .env ved siden af index.js, eller under Startup → Environment Variables på Wispbyte.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User],
  makeCache: Options.cacheWithLimits({
    MessageManager: 100,
    PresenceManager: 0,
  }),
  sweepers: {
    messages: { interval: 180, lifetime: 1800 },
  },
});

client.once('clientReady', async () => {
  console.log(`Logget ind som ${client.user.tag}`);
  console.log(`Invite: ${inviteUrl(client.user.id)}`);
  startVerifyServer(client);
  for (const guild of client.guilds.cache.values()) {
    try {
      await registerCommands(token, client.user.id, guild.id);
      console.log(`Kommandoer registreret i ${guild.name}`);
    } catch (err) {
      console.error(`Kunne ikke registrere kommandoer i ${guild.name}: ${err.message}`);
    }
  }
});

client.on('guildCreate', async (guild) => {
  try {
    await registerCommands(token, client.user.id, guild.id);
    console.log(`Kommandoer registreret i ${guild.name}`);
  } catch (err) {
    console.error(`Kunne ikke registrere kommandoer i ${guild.name}: ${err.message}`);
  }
});

client.on('interactionCreate', (interaction) => {
  onInteraction(interaction).catch(async (err) => {
    logErr(err);
    const payload = { content: 'Der opstod en fejl. Prøv igen.', flags: MessageFlags.Ephemeral };
    try {
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch (replyErr) {
      logErr(replyErr);
    }
  });
});

client.on('messageCreate', (message) => {
  handleDpull(message).catch(logErr);
  onMessage(message).catch(logErr);
});

client.on('guildMemberAdd', (member) => {
  onMemberAdd(member).catch(logErr);
});

attachLogger(client);

client.on('error', logErr);
process.on('unhandledRejection', logErr);

client.login(token).catch((err) => {
  console.error('Login fejlede. Tjek DISCORD_TOKEN, og slå Message Content plus Server Members til i Developer Portal.');
  console.error(String(err.message || err).replace(/[\w-]{24,}\.[\w-]{6}\.[\w-]{27,}/g, '[skjult]'));
  process.exit(1);
});

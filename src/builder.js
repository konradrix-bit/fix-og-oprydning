const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { builderEmbed } = require('./theme');
const {
  DEFAULT_DESCRIPTION,
  DEFAULT_FOOTER,
  DEFAULT_TITLE,
  addOption,
  nid,
  normalizeBanner,
  parseEmoji,
  selectOption,
} = require('./logic');

const wizards = new Map();

function wizardKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function remember(state) {
  const key = wizardKey(state.guildId, state.userId);
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => wizards.delete(key), 30 * 60 * 1000);
  state.timer.unref?.();
  wizards.set(key, state);
  return state;
}

function getWizard(interaction) {
  return wizards.get(wizardKey(interaction.guildId, interaction.user.id)) || null;
}

function forget(state) {
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  wizards.delete(wizardKey(state.guildId, state.userId));
}

function createState(partial) {
  return remember({
    guildId: partial.guildId,
    userId: partial.userId,
    destinationId: partial.destinationId,
    staffRoleId: partial.staffRoleId || null,
    parentId: partial.parentId || null,
    title: partial.title || DEFAULT_TITLE,
    description: partial.description || DEFAULT_DESCRIPTION,
    bannerUrl: partial.bannerUrl || '',
    footer: partial.footer ?? DEFAULT_FOOTER,
    options: [],
    notice: '',
    messageId: null,
    timer: null,
  });
}

function input(customId, label, style, { required = false, max = 100, value = '', paragraph = false, placeholder = '' } = {}) {
  const field = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(paragraph ? TextInputStyle.Paragraph : style)
    .setRequired(required)
    .setMaxLength(max);
  if (placeholder) field.setPlaceholder(placeholder);
  if (value) field.setValue(String(value).slice(0, max));
  return new ActionRowBuilder().addComponents(field);
}

function textModal(state) {
  return new ModalBuilder()
    .setCustomId('tb:modal:text')
    .setTitle('Tekst og banner')
    .addComponents(
      input('titel', 'Titel', TextInputStyle.Short, { required: true, max: 100, value: state.title }),
      input('beskrivelse', 'Tekst på panelet', TextInputStyle.Paragraph, {
        required: true,
        max: 2000,
        value: state.description,
        paragraph: true,
      }),
      input('banner', 'Banner-link (nederst)', TextInputStyle.Short, {
        max: 400,
        value: state.bannerUrl,
        placeholder: 'https://eksempel.dk/banner.png',
      }),
      input('footer', 'Footer', TextInputStyle.Short, { max: 200, value: state.footer }),
    );
}

function addModal() {
  return new ModalBuilder()
    .setCustomId('tb:modal:add')
    .setTitle('Nyt ticket-valg')
    .addComponents(
      input('navn', 'Navn på valget', TextInputStyle.Short, { required: true, max: 80, placeholder: 'Support' }),
      input('emoji', 'Emoji (valgfri)', TextInputStyle.Short, { max: 40, placeholder: '🎫' }),
      input('beskrivelse', 'Kort beskrivelse', TextInputStyle.Short, { max: 100, placeholder: 'Vises i menuen' }),
      input('besked', 'Tekst inde i ticketen', TextInputStyle.Paragraph, {
        max: 1000,
        paragraph: true,
        placeholder: 'Det medlemmet ser, når ticketen åbner',
      }),
      input('banner', 'Banner-link til denne ticket', TextInputStyle.Short, {
        max: 400,
        placeholder: 'Tom = panelets banner',
      }),
    );
}

function applyTextModal(state, fields) {
  const title = fields.getTextInputValue('titel').trim();
  const description = fields.getTextInputValue('beskrivelse').trim();
  const banner = normalizeBanner(fields.getTextInputValue('banner'));
  const footer = fields.getTextInputValue('footer').trim();
  if (!title || !description) return { error: 'Titel og tekst skal udfyldes.' };
  if (banner.error) return { error: banner.error };
  state.title = title.slice(0, 100);
  state.description = description.slice(0, 2000);
  state.bannerUrl = banner.url;
  state.footer = footer.slice(0, 200);
  state.notice = banner.url
    ? 'Banneret ligger nederst på panelet og i tickets, medmindre et valg har sit eget link.'
    : '';
  return { ok: true };
}

function applyAddModal(state, fields) {
  const name = fields.getTextInputValue('navn').trim();
  if (!name) return { error: 'Valget skal have et navn.' };
  const emojiRaw = fields.getTextInputValue('emoji').trim();
  const description = fields.getTextInputValue('beskrivelse').trim();
  const message = fields.getTextInputValue('besked').trim();
  const banner = normalizeBanner(fields.getTextInputValue('banner'));
  if (banner.error) return { error: banner.error };
  const emoji = parseEmoji(emojiRaw);
  const added = addOption(state.options, {
    id: nid(3),
    name: name.slice(0, 80),
    emoji: emoji ? emojiRaw : '',
    description: description.slice(0, 100),
    message: message.slice(0, 1000),
    bannerUrl: banner.url,
  });
  if (added.error) return added;
  state.options = added.options;
  state.notice = emojiRaw && !emoji ? 'Emoji blev ikke genkendt, så valget blev gemt uden.' : '';
  return { ok: true };
}

function render(state) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tb:text').setLabel('Tekst og banner').setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('tb:add')
      .setLabel(`Tilføj valg (${state.options.length}/10)`)
      .setStyle(ButtonStyle.Success)
      .setDisabled(state.options.length >= 10),
    new ButtonBuilder()
      .setCustomId('tb:send')
      .setLabel('Send panel')
      .setStyle(ButtonStyle.Success)
      .setDisabled(state.options.length === 0),
    new ButtonBuilder().setCustomId('tb:cancel').setLabel('Annuller').setStyle(ButtonStyle.Secondary),
  );
  const components = [row];
  if (state.options.length) {
    components.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('tb:remove')
        .setPlaceholder('Fjern et valg')
        .addOptions(state.options.map((option) => {
          const data = { label: option.name.slice(0, 100), value: option.id };
          if (option.description) data.description = option.description.slice(0, 100);
          return data;
        })),
    ));
  }
  components.push(new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('tb:staff')
      .setPlaceholder('Staff-rolle der kan se tickets')
      .setMinValues(1)
      .setMaxValues(1),
  ));
  components.push(new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('tb:parent')
      .setPlaceholder('Kategori som tickets oprettes i')
      .setChannelTypes(ChannelType.GuildCategory)
      .setMinValues(1)
      .setMaxValues(1),
  ));
  return { embeds: [builderEmbed(state)], components };
}

function panelSelect(panel) {
  return new StringSelectMenuBuilder()
    .setCustomId(`ticketopen:${panel.id}`)
    .setPlaceholder('Vælg en ticket')
    .addOptions(panel.options.slice(0, 10).map(selectOption));
}

module.exports = {
  wizards,
  createState,
  getWizard,
  forget,
  remember,
  textModal,
  addModal,
  applyTextModal,
  applyAddModal,
  render,
  panelSelect,
};

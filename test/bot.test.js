const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const storeFile = path.join(os.tmpdir(), `fix-og-oprydning-${process.pid}.json`);
process.env.STORE_PATH = storeFile;

const {
  GREEN,
  MAX_OPTIONS,
  addOption,
  checkRaid,
  checkSpam,
  filterLogs,
  isYoungAccount,
  normalizeBanner,
  parseEmoji,
  redact,
  selectOption,
  ticketChannelName,
} = require('../src/logic');
const { getGuild, pushLog, resetForTests } = require('../src/store');
const { commands } = require('../src/commands');
const { inviteUrl } = require('../src/deploy');
const { applyAddModal, applyTextModal, createState, forget, panelSelect, render } = require('../src/builder');
const { panelEmbed, ticketEmbed } = require('../src/theme');
const { eligibleIds, oauthUrl, parseDpull, pullMembers } = require('../src/pull');
const { openSeal, seal } = require('../src/seal');

function fields(map) {
  return { getTextInputValue: (id) => map[id] ?? '' };
}

test('banner accepterer http(s) og afviser andre skemaer', () => {
  assert.equal(normalizeBanner('').url, '');
  assert.equal(normalizeBanner(' https://cdn.example/banner.png ').url, 'https://cdn.example/banner.png');
  assert.equal(normalizeBanner('http://example.com/a.jpg').url, 'http://example.com/a.jpg');
  assert.ok(normalizeBanner('javascript:alert(1)').error);
  assert.ok(normalizeBanner('ikke et link').error);
});

test('emoji parses som unicode eller custom, ikke som almindelig tekst', () => {
  assert.equal(parseEmoji('🎫'), '🎫');
  assert.deepEqual(parseEmoji('<a:navn:12345678901234567>'), {
    id: '12345678901234567',
    name: 'navn',
    animated: true,
  });
  assert.equal(parseEmoji('support'), null);
  assert.equal(parseEmoji(''), null);
});

test('et panel kan højst få 10 valg', () => {
  let options = [];
  for (let i = 0; i < MAX_OPTIONS; i += 1) {
    const added = addOption(options, { id: `v${i}`, name: `Valg ${i}` });
    assert.equal(added.error, undefined);
    options = added.options;
  }
  const blocked = addOption(options, { id: 'for-mange', name: 'Elve' });
  assert.match(blocked.error, /10/);
  assert.equal(blocked.options.length, 10);
});

test('select-valg har label, value og banner-emoji', () => {
  const data = selectOption({ id: 'abc', name: 'Support', description: 'Hjælp', emoji: '🎫' });
  assert.equal(data.label, 'Support');
  assert.equal(data.value, 'abc');
  assert.equal(data.description, 'Hjælp');
  assert.deepEqual(data.emoji, { name: '🎫' });
});

test('spam og raid tæller kun inde i vinduet', () => {
  const first = checkSpam([], 1_000, 2, 5_000);
  assert.equal(first.hit, false);
  const second = checkSpam(first.timestamps, 2_000, 2, 5_000);
  assert.equal(second.hit, false);
  const third = checkSpam(second.timestamps, 3_000, 2, 5_000);
  assert.equal(third.hit, true);
  const later = checkSpam(third.timestamps, 20_000, 2, 5_000);
  assert.equal(later.hit, false);

  const raid = checkRaid([0, 1_000], 2_000, 3, 10_000);
  assert.equal(raid.triggered, true);
  assert.equal(isYoungAccount(Date.now() - 86_400_000, Date.now(), 7), true);
  assert.equal(isYoungAccount(Date.now() - 10 * 86_400_000, Date.now(), 7), false);
});

test('ticket-kanalen får et sikkert navn', () => {
  assert.equal(ticketChannelName('Konrad!'), 'ticket-konrad');
  assert.equal(ticketChannelName('***'), 'ticket-bruger');
});

test('tokens bliver skjult og logs kan slås op', () => {
  const token = `${'a'.repeat(24)}.${'b'.repeat(6)}.${'c'.repeat(27)}`;
  assert.equal(redact(`her er ${token}`), 'her er [token skjult]');
  const entries = [
    { type: 'ticket', userId: '1', summary: 'Konrad åbnede Support' },
    { type: 'protect', userId: '2', summary: 'link slettet' },
    { type: 'ticket', userId: '1', summary: 'Konrad lukkede Support' },
  ];
  assert.equal(filterLogs(entries, { userId: '1' }).length, 2);
  assert.equal(filterLogs(entries, { text: 'link' })[0].type, 'protect');
  assert.equal(filterLogs(entries, { type: 'ticket', limit: 1 }).length, 1);
});

test('store gemmer logs og paneler på disken', () => {
  resetForTests();
  fs.rmSync(storeFile, { force: true });
  const guild = getGuild('g1');
  guild.panels.abc = { id: 'abc', title: 'Tickets' };
  pushLog('g1', { id: 'log1', at: 1, type: 'ticket', userId: 'u', summary: 'åbnet' });
  resetForTests();
  const again = getGuild('g1');
  assert.equal(again.panels.abc.title, 'Tickets');
  assert.equal(again.logs.entries.length, 1);
  assert.equal(again.protect.antispam.on, false);
  fs.rmSync(storeFile, { force: true });
});

test('kommandoerne har ticketmake, protect og logs med gyldige navne', () => {
  const names = commands.map((command) => command.name);
  assert.deepEqual(names, ['ticketmake', 'ticket', 'protect', 'logs', 'info', 'verify']);
  const walk = (option, trail) => {
    assert.match(option.name, /^[a-z0-9-]{1,32}$/, trail);
    assert.ok(option.description.length > 0 && option.description.length <= 100, trail);
    for (const child of option.options || []) walk(child, `${trail} ${child.name}`);
  };
  for (const command of commands) {
    const json = command.toJSON();
    walk(json, json.name);
    assert.equal(json.dm_permission, false);
  }
  assert.match(inviteUrl('123'), /client_id=123/);
  assert.match(inviteUrl('123'), /applications\.commands/);
});

test('builderen er grøn, har banner nederst og stopper ved 10 valg', () => {
  const state = createState({ guildId: 'g', userId: 'u', destinationId: 'c' });
  const text = applyTextModal(state, fields({
    titel: 'Support',
    beskrivelse: 'Vælg herunder',
    banner: 'https://cdn.example/bund.png',
    footer: 'Grøn support',
  }));
  assert.equal(text.ok, true);
  for (let i = 0; i < 10; i += 1) {
    const added = applyAddModal(state, fields({
      navn: `Valg ${i}`,
      emoji: '🎫',
      beskrivelse: 'Kort tekst',
      besked: `Teksten i ticket ${i}`,
      banner: i === 0 ? 'https://cdn.example/valg.png' : '',
    }));
    assert.equal(added.ok, true, added.error);
  }
  const blocked = applyAddModal(state, fields({ navn: 'For mange', emoji: '', beskrivelse: '', besked: '', banner: '' }));
  assert.match(blocked.error, /10/);

  const view = render(state);
  const embed = view.embeds[0].toJSON();
  assert.equal(embed.color, GREEN);
  assert.equal(embed.image.url, 'https://cdn.example/bund.png');
  assert.match(embed.description, /Vælg herunder/);
  const buttons = view.components[0].toJSON().components;
  assert.equal(buttons.find((button) => button.custom_id === 'tb:add').disabled, true);
  assert.equal(buttons.find((button) => button.custom_id === 'tb:send').disabled, false);
  assert.equal(view.components.length, 4);

  const empty = createState({ guildId: 'g', userId: 'u2', destinationId: 'c' });
  const emptyButtons = render(empty).components[0].toJSON().components;
  assert.equal(emptyButtons.find((button) => button.custom_id === 'tb:send').disabled, true);

  const menu = panelSelect({
    id: 'panel1',
    options: state.options,
  }).toJSON();
  assert.equal(menu.custom_id, 'ticketopen:panel1');
  assert.equal(menu.options.length, 10);
  assert.equal(menu.options[0].emoji.name, '🎫');

  const opened = ticketEmbed({
    option: state.options[0],
    ownerId: '42',
    bannerUrl: state.options[0].bannerUrl,
    footer: 'Grøn support',
  }).toJSON();
  assert.equal(opened.color, GREEN);
  assert.equal(opened.image.url, 'https://cdn.example/valg.png');
  assert.match(opened.description, /Teksten i ticket 0/);

  const posted = panelEmbed(state).toJSON();
  assert.equal(posted.image.url, 'https://cdn.example/bund.png');
  forget(state);
  forget(empty);
});

test('!dpull læser server-id og flytter kun folk med rollen', async () => {
  assert.equal(parseDpull('hej'), null);
  assert.deepEqual(parseDpull('!dpull'), { guildId: null });
  assert.deepEqual(parseDpull('!Dpull 123456789012345678'), { guildId: '123456789012345678' });
  assert.equal(parseDpull('!dpull 123'), null);
  const ids = eligibleIds(
    { a: { sealed: 'x' }, b: { sealed: 'y' }, c: { sealed: 'z' } },
    ['b', 'c', 'mangler'],
  );
  assert.deepEqual(ids, ['b', 'c']);
  const result = await pullMembers(['a', 'b', 'c'], async (id) => {
    if (id === 'a') return 201;
    if (id === 'b') return 204;
    throw new Error('nej');
  });
  assert.deepEqual(result, { added: 1, already: 1, failed: 1 });
});

test('verify-linket beder om guilds.join og godkendelsen kan pakkes ind', () => {
  const url = new URL(oauthUrl({
    clientId: '99',
    redirectUri: 'https://bot.example/callback',
    state: 'abc',
  }));
  assert.equal(url.searchParams.get('scope'), 'identify guilds.join');
  assert.equal(url.searchParams.get('state'), 'abc');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://bot.example/callback');
  const packed = seal({ accessToken: 'hemmelig', refreshToken: 'ogsaa' }, 'noegle');
  assert.equal(packed.includes('hemmelig'), false);
  assert.deepEqual(openSeal(packed, 'noegle'), { accessToken: 'hemmelig', refreshToken: 'ogsaa' });
  assert.throws(() => openSeal(packed, 'forkert'));
});

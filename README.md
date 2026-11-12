# Fix og oprydning

Grøn Discord-bot med ticket-builder, beskyttelse og logs. Den er lavet til at køre på [Wispbytes gratis Discord-hosting](https://wispbyte.com/free-discord-bot-hosting).

`index.js` ligger i roden. Startup-kommandoen er `node index.js`. Tokenet læses fra miljøvariablen `DISCORD_TOKEN`.

## Download og host

1. Hent `site/bot.zip`. Filen er pakket så `index.js` ligger i roden af zip-filen.
2. Åbn [https://wispbyte.com/free-discord-bot-hosting](https://wispbyte.com/free-discord-bot-hosting) og opret en Node.js-server.
3. Gå til **Files**, upload `bot.zip` og vælg **Unarchive**. `index.js`, `package.json` og mappen `src` skal ligge direkte i serverens rod, ikke inde i en ekstra mappe.
4. Under **Startup**:
   - Startup command: `node index.js`
   - Additional Node Packages: `discord.js`
   - Environment variable: `DISCORD_TOKEN` = tokenet fra [Discord Developer Portal](https://discord.com/developers/applications)
5. Tryk **Start**. Konsollen printer et invite-link, når botten er online.

Slå **Message Content Intent** og **Server Members Intent** til under Bot i Developer Portal, før du starter. Uden dem kan login fejle, og link-filter plus join-logs virker ikke.

Kør én bot pr. Wispbyte-server.

## Ticket-panel

`/ticketmake` åbner en grøn builder, kun for folk med Manage Server.

- **Tekst og banner** sætter titel, paneltekst, footer og et billedlink. Billedet vises nederst som banner på panelet og i ticketen.
- **Tilføj valg** laver op til 10 punkter i menuen. Hvert valg har navn, emoji, kort beskrivelse, teksten inde i ticketen og et valgfrit eget banner.
- Vælg en **staff-rolle** og en **kategori**, som nye ticket-kanaler lægges i.
- **Send panel** poster menuen i kanalen.

Et medlem vælger i menuen og får en privat kanal. Staff kan overtage, hente transskript og lukke. `/ticket luk`, `/ticket tilfoej` og `/ticket fjern` virker inde i ticketen.

Banneret skal være et direkte billedlink (`png`, `jpg`, `gif` eller `webp`).

## Beskyttelse

Alt er slået fra, indtil du tænder det med `/protect`. Staff-rollen og folk med Manage Server er undtaget. Tickets er undtaget fra link- og invite-filteret, så folk kan sende links i en sag.

| Kommando | Hvad den gør |
| --- | --- |
| `/protect status` | Viser det grønne overblik |
| `/protect antispam` | Sletter spam og giver timeout |
| `/protect antiraid` | Reagerer på mange joins. Vælg kun log, lockdown eller kick af nye konti |
| `/protect antilink` | Sletter links |
| `/protect antiinvite` | Sletter Discord-invites |
| `/protect mentions` | Sletter beskeder med for mange mentions |
| `/protect lockdown` | Lukker for at alle kan skrive. Logkanalen, åbne tickets, administratorer og staff-rollen kan stadig skrive |
| `/protect staff` | Rolle der er undtaget |
| `/protect ignorer` | Springer en kanal over |
| `/protect log` | Sætter logkanalen |

## Logs

`/logs opsaet` vælger kanalen, hvor hændelser også postes. Opslagene ligger derudover i `data/store.json`, så du kan søge selv om kanalen er tom. Slet ikke den fil, hvis paneler og logs skal blive ved med at virke.

| Kommando | Hvad den gør |
| --- | --- |
| `/logs seneste` | Seneste logs, med valgfri type |
| `/logs bruger` | Logs for ét medlem |
| `/logs soeg` | Søg i teksten |
| `/logs audit` | Slår op i Discords audit log |
| `/info bruger` | Konto, roller og banner |
| `/info server` | Servertallene |

Botten skal have View Audit Log, Manage Channels, Manage Messages, Moderate Members og Kick Members. Invite-linket i konsollen har de rettigheder med.

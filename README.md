# Fortnite Makro

Lokal makro til hurtige edits, reset og byggeskift. Alt kan ændres i vinduet: taster, tempo, profiler og genveje.

Den sender kun tastetryk. Den læser ikke spillet, og den kan ikke omgå anti-cheat. Hvis Fortnite ignorerer tastetryk fra andre programmer, virker den ikke.

Epic kan udelukke konti, der bruger makroer. Brug den på eget ansvar.

## Start på Windows

1. Installer Python 3 fra [python.org](https://www.python.org/downloads/) og sæt flueben i **Add python.exe to PATH**.
2. Dobbeltklik `start.bat`.

Første gang laver den et virtuelt miljø og installerer pakkerne. Bagefter åbner vinduet.

Makroen starter **slået fra**. Tryk **Slå til**, eller tryk **F8**.

Hvis genvejene ikke sker, mens Fortnite er i fokus, så brug **Start som administrator** under Ekstra.

## Det den kan

- **Ved slip.** Hold edit, vælg felter, slip for at bekræfte. Sæt Edit on Release til i Fortnite.
- **Samme tast.** Slå Edit on Release fra. Hurtig reset trykker edit, reset og edit igen.
- **To taster.** Edit og bekræft er to forskellige taster.
- **Hurtig reset** på musens sideknap. Åbner, resetter og bekræfter.
- **Scroll-reset.** Scroll bliver til reset, mens makroen er tændt. Hold edit nede, så sender scroll kun reset.
- **Skift edit-tast** med F6. Listen bestemmer rækkefølgen.
- **Profiler** med F7. En profil gemmer edit-tilstand og edit-, reset- og bekræft-tasten.
- **Byggeskift** mellem væg, gulv, rampe og kegle, plus replace-genveje der også placerer.
- **Turbo-reset** og **saml op**, når du holder en genvej nede.
- **Våben-slots** med egne genveje.
- Tempo fra stabil til instant, med en lille tilfældig pause.
- Overlay, log og en test der sender tasterne efter tre sekunder.

Klik på en knap med et tastnavn, og tryk den nye tast. **Delete** rydder den. **Escape** annullerer.

## I Fortnite

Sæt de samme taster som i makroen:

| I makroen | Forslag | I Fortnite |
| --- | --- | --- |
| Edit | F | Edit |
| Reset | G | Reset Building Edit |
| Væg, gulv, rampe, kegle | Q, X, C, V | de samme byggetaster |
| Placer | venstreklik | Build / Place |

Ved **Ved slip** skal Edit on Release være tændt. Ved **Samme tast** og **To taster** skal den være slukket.

## Tjek sekvensen uden at åbne vinduet

```bash
python main.py --check
```

Opsætningen gemmes i `config.json` ved siden af programmet.

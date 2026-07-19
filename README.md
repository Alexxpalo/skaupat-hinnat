# skaupat-hinnat

Claude Code -plugin, joka hakee **S-kaupat-tuotteiden reaaliaikaiset hinnat** valitusta
kaupasta (esim. Raksilan Prisma) ja kokoaa reseptin raaka-aineista ostoslistan
yhteishintoineen. Sisältää valmiin MCP-palvelimen + `ostoslista`-taidon.

## Mitä saat

| Työkalu | Tekee |
|---|---|
| `etsi_tuote` | Tuotteet + reaaliaikaiset hinnat valitusta kaupasta |
| `reseptin_ostoslista` | Raaka-ainelista → parhaat osumat + yhteishinta |
| `tallenna_ostoslista` | Tallenna sovittu lista markdown-tiedostoksi |
| `jaa_ostoslista` | Jaa valmis lista **QR-koodina** — luo listan S-ostoslista-palveluun oikeina tuoteriveinä (kuva + hinta appissa) ja antaa jakolinkin, jonka vastaanottaja avaa S-ostoslista-sovelluksessa |
| `raaka_pyynto` | Aja mielivaltainen GraphQL-kysely AppSync-rajapintaan (vianetsintä / introspektio) |
| `etsi_kauppa` | Kauppahaku nimellä tai paikkakunnalla → kaupan id (esim. "Prisma Raksila") |

Lisäksi **ostoslista**-taito opastaa: kerro mitä tekisi mieli syödä → sovitaan
raaka-aineet → haetaan oikeat hinnat → tallennetaan lista.

## Vaatimukset

- **Node.js 18+** asennettuna koneelle (palvelin ajetaan `node`-komennolla).
  Tarkista: `node -v`. Asennus: https://nodejs.org

Palvelin ja sen riippuvuudet tulevat pluginin mukana — erillistä `npm install`:ia
ei tarvita.

## Asennus (Claude Code)

Tämä repo on samalla Claude Code -*marketplace*, eli asennus on kaksivaiheinen:
ensin lisätään marketplace (kertoo Claude Codelle mistä plugin löytyy), sitten
asennetaan itse plugin.

Aja Claude Codessa:

```
/plugin marketplace add Alexxpalo/skaupat-hinnat
/plugin install skaupat-hinnat@skaupat-hinnat
```

Aktivoi ilman uudelleenkäynnistystä:

```
/reload-plugins
```

Asennuksen yhteydessä Claude Code kysyy asennuslaajuuden — **User scope**
(oletus) on oikea valinta: plugin on käytössä kaikissa projekteissasi.

Vaihtoehtoisesti terminaalista (ilman interaktiivista vaihetta):

```bash
claude plugin install skaupat-hinnat@skaupat-hinnat
```

> Jos `/plugin`-komentoa ei löydy, päivitä Claude Code:
> `npm install -g @anthropic-ai/claude-code@latest` (tai `brew upgrade claude-code`).

### Kaupan id + oletuskaupan kiinnittäminen

Hinnat haetaan aina jonkin **kaupan id:n** perusteella. Helpoin tapa: sano
Claudelle *"etsi kauppa Prisma Raksila"* — `etsi_kauppa` palauttaa id:n suoraan.
Kauppahaku ymmärtää myös taivutetut muodot (*"Raksilan Prisma"*, *"Kallion
Alepa"*), ja kattavuus on laaja (esim. Prisma Raksila = `516528759`).

Voit kiinnittää oletuskaupan pluginin asetusten muuttujaan
`SKAUPAT_DEFAULT_STORE_ID`, jolloin sitä käytetään automaattisesti. Repossa
oletus on tyhjä, joten jokainen asettaa oman kauppansa. Ilman oletuskauppaa
kerro id Claudelle hakukohtaisesti (*"…Prisman kaupasta 516528759"*).

### Päivitys

```
/plugin marketplace update skaupat-hinnat
```

Päivitykset tulevat jakoon kun repossa `version`-kenttä nousee.

### Poisto

```
/plugin uninstall skaupat-hinnat@skaupat-hinnat
```

## Käyttö

Plugin tuo skillin `/skaupat-hinnat:ostoslista` sekä MCP-työkalut, jotka Claude
ottaa käyttöön automaattisesti kun puhut ruoasta ja hinnoista. Kokeile:

- "Etsi kauppa Prisma Raksila" → kaupan id talteen
- "Hae maidon hinta Prismasta (kauppa 516528759)"
- "Tekisi mieli kotitekoista pizzaa halvalla — kasaa ostoslista Prisman hinnoilla"
- "Paljonko jauheliha, tortillat ja juusto maksaa yhteensä?"
- "Jaa tämä ostoslista QR-koodina" → linkki + QR, jonka voi avata S-ostoslista-sovelluksessa

Valmis ostoslista tallentuu markdown-tiedostona `~/Downloads`-kansioon
(muutettavissa, ks. Asetukset).

## Vianetsintä

| Ongelma | Ratkaisu |
|---|---|
| Plugin ei näy asennuksen jälkeen | Aja `/reload-plugins` tai käynnistä Claude Code uudelleen |
| "plugin not found in any marketplace" | Aja ensin `/plugin marketplace add Alexxpalo/skaupat-hinnat` |
| MCP-palvelin ei käynnisty | Tarkista `node -v` — vaatii Node.js 18+ |
| Skillit eivät ilmesty | Tyhjennä välimuisti: `rm -rf ~/.claude/plugins/cache`, käynnistä uudelleen ja asenna plugin uudestaan |
| Tuotehaku palauttaa `401 UnauthorizedException` | AppSyncin API-avain on vanhentunut: nappaa uusi `da2-…`-avain S-ostoslista-mobiiliapin bundlesta ja aseta `SKAUPAT_API_KEY` |
| Latausvirheet | Katso `/plugin` → **Errors**-välilehti |

## Asetukset

Kaikki valinnaisia — oletukset toimivat sellaisenaan.

| Muuttuja | Oletus | Selitys |
|---|---|---|
| `SKAUPAT_DEFAULT_STORE_ID` | – | Oletuskaupan id (repossa tyhjä) |
| `SKAUPAT_LISTA_DIR` | `~/Downloads` | Mihin `tallenna_ostoslista` kirjoittaa |
| `SKAUPAT_ENDPOINT` | `https://api.s-ostoslista.fi/graphql` | AppSync GraphQL-osoite |
| `SKAUPAT_API_KEY` | *(koodissa, `da2-…`)* | AppSync API-avain (`x-api-key`); ohita jos avain vaihtuu |
| `SKAUPAT_CLIENT_NAME` | `s-ostoslista` | `apollographql-client-name`-otsake (ei pakollinen) |
| `SKAUPAT_CLIENT_VERSION` | `3.9.25` | `apollographql-client-version`-otsake (ei pakollinen) |
| `SKAUPAT_SHARE_URL_TEMPLATE` | `https://s-ostoslista.fi/liity/{linkId}` | `jaa_ostoslista`:n jakolinkin URL-malli |

## Kehitys

Palvelin ja sen riippuvuudet on **niputettu valmiiksi** tiedostoon
`server/index.cjs` (esbuild-bundle), joten loppukäyttäjä ei tarvitse
`npm install`:ia. Lähdekoodi on `server/src/`:ssä.

Rakenna bundle uudelleen lähteestä:

```bash
cd server
npm install          # kehitysriippuvuudet (esbuild, typescript, @types/node)
npm run typecheck    # tsc --noEmit
npm run build        # src/index.ts -> index.cjs
```

Nopea savutesti että palvelin käynnistyy ja listaa työkalut (stdio-MCP):

```bash
printf '%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"0"}}}' \
'{"jsonrpc":"2.0","method":"notifications/initialized"}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | node index.cjs
```

Kokeile pluginia asentamatta suoraan reposta:

```bash
git clone https://github.com/Alexxpalo/skaupat-hinnat.git
claude --plugin-dir ./skaupat-hinnat
```

> Käyttää S-ostoslista-mobiiliapin epävirallista AppSync-rajapintaa
> henkilökohtaiseen käyttöön. Noudata S-ryhmän käyttöehtoja. Jos tuotehaku
> lakkaa toimimasta (esim. `401 UnauthorizedException`), nappaa uusi `da2-…`
> API-avain appin bundlesta ja aseta se `SKAUPAT_API_KEY`-muuttujaan tai korjaa
> `server/src/skaupat.ts`:ään ja aja `npm run build`.

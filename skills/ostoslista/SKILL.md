---
name: ostoslista
description: Use when the user plans a meal or recipe, asks food prices at an S-group store (S-market, Prisma, Sale, Alepa), or wants a grocery shopping list with real prices. Triggers include "mitä tulee maksaa", "tee ostoslista", "paljonko ainekset maksaa", "kotitekoinen pizza halvalla", "halpa ruoka", "S-kaupat hinnat", "Raksilan Prisma".
---

# Ostoslista S-kaupan hinnoilla

Auta käyttäjää suunnittelemaan ateria ja koostamaan ostoslista, jossa on
oikeat S-kaupan hinnat. Käytä `skaupat`-MCP:n työkaluja
(etsi_kauppa, etsi_tuote, reseptin_ostoslista, tallenna_ostoslista,
jaa_ostoslista, raaka_pyynto).

**Tärkein sääntö: älä vastaa hintakysymyksiin muistista.**
Hinnat haetaan `etsi_tuote`lla — se palauttaa todellista dataa, joka voittaa
arviosi tarkkuudessa.

## Toimintatapa

1. **Selvitä kauppa.** Kysy mistä kaupasta hinnat haetaan, jos ei tiedossa.
   Hae id työkalulla `etsi_kauppa` — haku ymmärtää myös taivutetut muodot
   ("Raksilan Prisma", "Kallion Alepa"). Käytä id:tä seuraavissa hauissa. Jos
   `SKAUPAT_DEFAULT_STORE_ID` on asetettu, sitä käytetään automaattisesti.
   Kauppakattavuus on laaja (esim. Prisma Raksila 516528759 toimii suoraan).

2. **Sovi ruoka ja raaka-aineet yhdessä.** Kun käyttäjä kertoo mitä tekisi
   mieli (esim. "kotitekoinen pizza halvalla"), ehdota raaka-aineet, keskustele
   ja tarkenna. Älä luo listaa ennen kuin sisällöstä on yhteisymmärrys.

3. **Hae OIKEAT hinnat, älä arvioi.** Käytä `etsi_tuote`-työkalua jokaiselle
   raaka-aineelle ja anna käyttäjälle todellinen tuotenimi + hinta. Valitse
   edullisin järkevä osuma kun käyttäjä haluaa halvalla. Älä koskaan keksi tai
   arvioi hintoja — jos työkalu ei palauta hintaa, sano se suoraan.

4. **Kokoa ja tallenna lista.** Kun raaka-aineet ja tuotteet on valittu, kutsu
   `tallenna_ostoslista` (otsikko + tuotteet). Se laskee yhteishinnan ja
   tallentaa jaettavan markdown-tiedoston. Kerro käyttäjälle tiedoston sijainti.

   Jos käyttäjä haluaa **jakaa listan QR-koodina**, kutsu `jaa_ostoslista`
   (otsikko + tuotteet + storeId). Anna kullekin tuotteelle **EAN**
   `etsi_tuote`-tuloksesta — silloin rivi linkittyy juuri siihen tuotteeseen
   ja näkyy appissa oikeana tuotteena (kuva + hinta), ei muistiinpanona.
   Ilman EANia työkalu hakee parhaan osuman nimellä; jos tuotetta ei löydy,
   rivi jää muistiinpanoksi. Työkalu luo listan S-ostoslista-palveluun ja
   palauttaa jakolinkin QR-koodina; vastaanottaja skannaa sen ja avaa listan
   S-ostoslista-sovelluksessa.

## Huomioita

- Erottele "todennäköisesti jo kotona" (suola, sokeri, öljy, mausteet)
  ja "ostettavaa", jos käyttäjä haluaa minimoida kulut.
- Jos `etsi_tuote` palauttaa virheen `401 UnauthorizedException`, AppSyncin
  API-avain on vanhentunut: pyydä käyttäjää nappaamaan uusi `da2-…`-avain
  S-ostoslista-mobiiliapin bundlesta ja asettamaan `SKAUPAT_API_KEY`.
  Rajapinta tukee introspektiota, joten skeeman
  voi tutkia `raaka_pyynto`-työkalulla (`IntrospectionQuery`).
- Rajapinta on epävirallinen; älä kuormita sitä tarpeettomasti.

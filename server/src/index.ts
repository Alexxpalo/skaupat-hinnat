#!/usr/bin/env node
/**
 * skaupat-mcp — MCP-palvelin S-kaupat-tuotteiden reaaliaikaisille hinnoille.
 *
 * Tyokalut:
 *   - etsi_kauppa          : hae kauppa nimella (esim. "Raksila Prisma") -> store id
 *   - etsi_tuote           : hae tuotteita kaupasta + reaaliaikainen hinta
 *   - reseptin_ostoslista  : laske reseptin raaka-aineiden hinta valitusta kaupasta
 *   - tallenna_ostoslista  : tallenna sovittu ostoslista markdown-tiedostoksi
 *   - raaka_pyynto         : aja mielivaltainen GraphQL-kysely (debug / introspektio)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";
import QRCode from "qrcode";
import {
  searchStores,
  searchProducts,
  productByEan,
  shareShoppingList,
  gqlPost,
  SkaupatError,
  type Product,
  type ShareItem,
} from "./skaupat.js";

const DEFAULT_STORE_ID = process.env.SKAUPAT_DEFAULT_STORE_ID;

const server = new McpServer({ name: "skaupat-mcp", version: "1.0.0" });

function eur(n?: number | null): string {
  return typeof n === "number" ? `${n.toFixed(2).replace(".", ",")} EUR` : "-";
}

function fmtProduct(p: Product): string {
  const cmp =
    p.comparisonPrice != null
      ? ` (${eur(p.comparisonPrice)}/${p.comparisonUnit ?? "yks"})`
      : "";
  return `${p.name} - ${eur(p.price)}${cmp}${p.ean ? ` [EAN ${p.ean}]` : ""}`;
}

function resolveStoreId(arg?: string): string {
  const id = arg ?? DEFAULT_STORE_ID;
  if (!id) {
    throw new SkaupatError(
      "Kaupan id puuttuu. Anna storeId tai aseta SKAUPAT_DEFAULT_STORE_ID. " +
        "Hae id tyokalulla etsi_kauppa."
    );
  }
  return id;
}

function errText(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  return {
    content: [{ type: "text" as const, text: `Virhe: ${msg}` }],
    isError: true,
  };
}

/* --------------------------- etsi_kauppa -------------------------- */
server.tool(
  "etsi_kauppa",
  "Hae S-ryhman kauppoja nimella tai paikkakunnalla (esim. 'Raksila Prisma'). Palauttaa kauppojen id:t, joita tarvitaan hintojen hakuun.",
  { haku: z.string().describe("Kaupan nimi tai paikkakunta") },
  async ({ haku }) => {
    try {
      const stores = await searchStores(haku);
      if (!stores.length) {
        return { content: [{ type: "text", text: `Ei kauppoja haulle "${haku}".` }] };
      }
      const CAP = 25;
      const shown = stores.slice(0, CAP);
      const lines = shown
        .map(
          (s) =>
            `- ${s.name}${s.city ? `, ${s.city}` : ""}${
              s.brand ? ` (${s.brand})` : ""
            } - id: ${s.id}`
        )
        .join("\n");
      const head =
        stores.length > CAP
          ? `Loytyi ${stores.length} kauppaa (naytetaan ${CAP} osuvinta):`
          : `Loytyi ${stores.length} kauppaa:`;
      return { content: [{ type: "text", text: `${head}\n${lines}` }] };
    } catch (e) {
      return errText(e);
    }
  }
);

/* ---------------------------- etsi_tuote -------------------------- */
server.tool(
  "etsi_tuote",
  "Hae tuotteita valitusta kaupasta ja palauta reaaliaikaiset hinnat. Anna storeId tai kayta oletuskauppaa.",
  {
    tuote: z.string().describe("Hakusana, esim. 'maito'"),
    storeId: z.string().optional().describe("Kaupan id; jata pois kayttaaksesi oletuskauppaa"),
    maara: z.number().int().min(1).max(50).optional().describe("Montako tulosta (oletus 10)"),
  },
  async ({ tuote, storeId, maara }) => {
    try {
      const id = resolveStoreId(storeId);
      const { storeName, total, items } = await searchProducts(id, tuote, maara ?? 10);
      if (!items.length) {
        return { content: [{ type: "text", text: `Ei tuotteita haulle "${tuote}".` }] };
      }
      const head = `${storeName ?? "Kauppa"} - "${tuote}" (${total} osumaa):`;
      const lines = items.map((p) => `- ${fmtProduct(p)}`).join("\n");
      return { content: [{ type: "text", text: `${head}\n${lines}` }] };
    } catch (e) {
      return errText(e);
    }
  }
);

/* ----------------------- reseptin_ostoslista ---------------------- */
server.tool(
  "reseptin_ostoslista",
  "Laske reseptin raaka-aineiden ostoslistan hinta valitusta kaupasta. Hakee kullekin raaka-aineelle parhaan osuman ja laskee yhteishinnan.",
  {
    raaka_aineet: z
      .array(z.string())
      .min(1)
      .describe("Lista raaka-aineista, esim. ['maito', 'jauheliha']"),
    storeId: z.string().optional().describe("Kaupan id; jata pois kayttaaksesi oletuskauppaa"),
  },
  async ({ raaka_aineet, storeId }) => {
    try {
      const id = resolveStoreId(storeId);
      const rows: string[] = [];
      let summa = 0;
      let storeName: string | undefined;

      for (const aine of raaka_aineet) {
        const { storeName: sn, items } = await searchProducts(id, aine, 1);
        storeName ??= sn;
        const best = items[0];
        if (best && typeof best.price === "number") {
          summa += best.price;
          rows.push(`- ${aine} -> ${fmtProduct(best)}`);
        } else if (best) {
          rows.push(`- ${aine} -> ${best.name} (hinta ei saatavilla)`);
        } else {
          rows.push(`- ${aine} -> ei osumaa`);
        }
      }

      const out =
        `Ostoslista - ${storeName ?? "kauppa"}:\n` +
        rows.join("\n") +
        `\n\nArvioitu yhteishinta (yksi pakkaus / raaka-aine): ${eur(summa)}`;
      return { content: [{ type: "text", text: out }] };
    } catch (e) {
      return errText(e);
    }
  }
);

/* ------------------------ tallenna_ostoslista --------------------- */
server.tool(
  "tallenna_ostoslista",
  "Tallenna SOVITTU ostoslista tiedostoksi (markdown). Kayta vasta kun raaka-aineista on yhdessa sovittu. Hakee halutessaan reaaliaikaiset hinnat ja laskee yhteishinnan.",
  {
    otsikko: z.string().describe("Listan otsikko"),
    tuotteet: z
      .array(
        z.object({
          nimi: z.string().describe("Raaka-aineen nimi"),
          maara: z.string().optional().describe("Maara tekstina, esim. '400 g'"),
        })
      )
      .min(1)
      .describe("Sovitut tuotteet"),
    hae_hinnat: z.boolean().optional().describe("Hae reaaliaikaiset hinnat (oletus true)"),
    storeId: z.string().optional().describe("Kaupan id hintoja varten; muuten oletuskauppa"),
  },
  async ({ otsikko, tuotteet, hae_hinnat, storeId }) => {
    try {
      const haePrices = hae_hinnat !== false;
      let storeName: string | undefined;
      let summa = 0;
      const rows: string[] = [];

      for (const t of tuotteet) {
        const maaraStr = t.maara ? ` _(${t.maara})_` : "";
        if (haePrices) {
          const id = resolveStoreId(storeId);
          const { storeName: sn, items } = await searchProducts(id, t.nimi, 1);
          storeName ??= sn;
          const best = items[0];
          if (best && typeof best.price === "number") {
            summa += best.price;
            rows.push(`- [ ] **${t.nimi}**${maaraStr} - ${best.name}, ${eur(best.price)}`);
          } else {
            rows.push(`- [ ] **${t.nimi}**${maaraStr} - _hinta ei saatavilla_`);
          }
        } else {
          rows.push(`- [ ] **${t.nimi}**${maaraStr}`);
        }
      }

      const pvm = new Date().toLocaleString("fi-FI");
      let md = `# ${otsikko}\n\n`;
      if (storeName) md += `Kauppa: **${storeName}**\n`;
      md += `Luotu: ${pvm}\n\n## Ostoslista\n\n${rows.join("\n")}\n`;
      if (haePrices) md += `\n**Arvioitu yhteishinta:** ${eur(summa)}\n`;

      const dir = process.env.SKAUPAT_LISTA_DIR ?? join(homedir(), "Downloads");
      mkdirSync(dir, { recursive: true });
      const safe = otsikko.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60) || "ostoslista";
      const fname = `ostoslista_${safe}_${Date.now()}.md`;
      const full = isAbsolute(fname) ? fname : join(dir, fname);
      writeFileSync(full, md, "utf8");

      return {
        content: [{ type: "text", text: `Ostoslista tallennettu:\n${full}\n\n${md}` }],
      };
    } catch (e) {
      return errText(e);
    }
  }
);

/* ------------------------- jaa_ostoslista ------------------------- */

// "2 kpl" -> quantity 2; muu maarateksti ("400 g") menee poimijan
// kommentiksi, koska tuoterivin quantity tarkoittaa PAKKAUSTEN maaraa.
function parseMaara(maara?: string): {
  quantity: number;
  quantityUnit: string;
  comment?: string;
} {
  const t = maara?.trim();
  if (!t) return { quantity: 1, quantityUnit: "kpl" };
  const m = t.match(/^(\d+(?:[.,]\d+)?)\s*kpl$/i);
  if (m) {
    const q = parseFloat(m[1].replace(",", "."));
    if (isFinite(q) && q > 0) return { quantity: q, quantityUnit: "kpl" };
  }
  return { quantity: 1, quantityUnit: "kpl", comment: t };
}

server.tool(
  "jaa_ostoslista",
  "Jaa valmis ostoslista QR-koodina: luo listan S-ostoslista-palveluun ja palauttaa jakolinkin QR-koodina, jonka vastaanottaja skannaa avatakseen listan S-ostoslista-sovelluksessa. Rivit linkitetaan oikeiksi tuotteiksi (kuva + hinta appissa) — anna kullekin tuotteelle EAN etsi_tuote-tuloksesta, tai tyokalu hakee parhaan osuman nimella. Kayta kun kayttaja haluaa jakaa/lahettaa kootun ostoslistan QR-koodilla.",
  {
    otsikko: z.string().describe("Listan otsikko"),
    tuotteet: z
      .array(
        z.object({
          nimi: z.string().describe("Tuotteen nimi"),
          maara: z.string().optional().describe("Maara tekstina, esim. '2 kpl' tai '400 g'"),
          ean: z
            .string()
            .optional()
            .describe("Tuotteen EAN (etsi_tuote-tuloksesta) — varmistaa etta rivi linkittyy juuri oikeaan tuotteeseen"),
        })
      )
      .min(1)
      .describe("Jaettavat tuotteet"),
    storeId: z
      .string()
      .optional()
      .describe("Kaupan id (listaan liitettava); muuten oletuskauppa"),
  },
  async ({ otsikko, tuotteet, storeId }) => {
    try {
      const id = resolveStoreId(storeId);

      // Linkita rivit oikeiksi tuotteiksi: EAN:lla suoraan, muuten nimihaun
      // parhaalla osumalla. Jos tuotetta ei loydy, rivi jaa muistiinpanoksi.
      const shareItems: ShareItem[] = [];
      for (const t of tuotteet) {
        let prod: Product | null = null;
        try {
          if (t.ean) prod = await productByEan(t.ean, id);
          if (!prod?.ean) {
            const { items } = await searchProducts(id, t.nimi, 1);
            prod = items[0] ?? null;
          }
        } catch {
          prod = null;
        }
        if (prod?.ean) {
          const { quantity, quantityUnit, comment } = parseMaara(t.maara);
          shareItems.push({
            name: prod.name,
            ean: prod.ean,
            sokId: prod.id,
            quantity,
            quantityUnit,
            comment,
          });
        } else {
          shareItems.push({ name: t.maara ? `${t.nimi} (${t.maara})` : t.nimi });
        }
      }

      const { url, linkId, itemCount, resolvedCount, noteCount } =
        await shareShoppingList(otsikko, id, shareItems);

      const qrOpts = { errorCorrectionLevel: "M" as const };
      const ascii = await QRCode.toString(url, { type: "utf8", ...qrOpts });
      const png = await QRCode.toBuffer(url, {
        type: "png",
        margin: 2,
        width: 480,
        ...qrOpts,
      });

      // Tallenna PNG best-effort: kuva palautetaan joka tapauksessa image-
      // blockina, joten tiedoston kirjoituksen epaonnistuminen (esim. Cowork-
      // kontissa jossa ~/Downloads ei ole kirjoitettava) ei saa kaataa tyokalua.
      const safe =
        otsikko.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 60) || "ostoslista";
      let savedNote = "";
      try {
        const dir = process.env.SKAUPAT_LISTA_DIR ?? join(homedir(), "Downloads");
        mkdirSync(dir, { recursive: true });
        const full = join(dir, `ostoslista_qr_${safe}_${Date.now()}.png`);
        writeFileSync(full, png);
        savedNote = `QR-kuva tallennettu:\n${full}\n\n`;
      } catch {
        /* ohita: kuva tulee silti image-blockina */
      }

      const linkitys =
        noteCount === 0
          ? `Kaikki ${resolvedCount} rivia linkitetty oikeiksi tuotteiksi.`
          : `${resolvedCount} rivia linkitetty tuotteiksi, ${noteCount} jai muistiinpanoiksi (tuotetta ei loytynyt kaupasta).`;
      // QR koodilohkoon (```), jotta se renderoityy monospace-fontilla ja on
      // skannattavissa nayto lta myos markdown-pohjaisessa kayttoliittymassa
      // (esim. Cowork) — suhteellisella fontilla half-block-QR vaaristyy.
      const qrBlock = "```\n" + ascii.replace(/\n+$/, "") + "\n```";
      const text =
        `Ostoslista "${otsikko}" (${itemCount} tuotetta) luotu ja jaettu. ${linkitys}\n\n` +
        `**Jakolinkki:** ${url}\n` +
        `(voit myos avata linkin suoraan puhelimella — S-ostoslista-sovellus avaa listan ilman skannausta)\n\n` +
        `Skannaa alla oleva QR-koodi S-ostoslista-sovelluksella:\n\n` +
        qrBlock +
        (savedNote ? `\n\n${savedNote}` : "");

      return {
        content: [
          {
            type: "image" as const,
            data: png.toString("base64"),
            mimeType: "image/png",
          },
          { type: "text" as const, text },
        ],
      };
    } catch (e) {
      return errText(e);
    }
  }
);

/* --------------------------- raaka_pyynto ------------------------- */
server.tool(
  "raaka_pyynto",
  "Aja mielivaltainen GraphQL-kysely S-ostoslistan AppSync-rajapintaan (api.s-ostoslista.fi). Kayta uusien operaatioiden/kenttien testaamiseen tai skeeman introspektioon.",
  {
    query: z
      .string()
      .describe("GraphQL-kysely, esim. 'query($id:ID){ product(id:$id){ name price } }'"),
    variables: z.record(z.any()).optional().describe("Kyselyn muuttujat"),
  },
  async ({ query, variables }) => {
    try {
      const data = await gqlPost(query, variables ?? {});
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return errText(e);
    }
  }
);

/* ------------------------------ start ----------------------------- */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("skaupat-mcp kaynnissa (stdio).");
}

main().catch((e) => {
  console.error("Fataali virhe:", e);
  process.exit(1);
});

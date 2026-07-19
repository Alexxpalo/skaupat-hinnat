/**
 * S-ostoslista (api.s-ostoslista.fi) -asiakas.
 *
 * S-ostoslista-mobiiliapin backend on AWS AppSync (GraphQL), alue eu-north-1.
 * Auth-tila API_KEY: pyynnot lahetetaan `x-api-key`-headerilla. Avain on
 * poimittu appin (fi.sok.s_ostoslista) React Native -bundlesta ja on kiintea
 * (ei hash-vanhenemista kuten s-kaupat.fi:n persisted-queryissa). Ohita
 * tarvittaessa ymparistomuuttujilla.
 *
 * Tuotteet ja kaupat kysellaan tavallisilla GraphQL-operaatioilla, jotka on
 * napattu appin bundlesta (GetProductsInStore, GetStoreBySearchText).
 * Etu s-kaupat.fi:hin nahden: laajempi kauppakattavuus — esim. Prisma Raksila
 * (id 516528759) palautuu suoraan, joten Limingantulli-proxya ei tarvita.
 */

export const ENDPOINT =
  process.env.SKAUPAT_ENDPOINT ?? "https://api.s-ostoslista.fi/graphql";
const API_KEY =
  process.env.SKAUPAT_API_KEY ?? "da2-ivqewtjq3re3nnctbhouukg37m";
const CLIENT_NAME = process.env.SKAUPAT_CLIENT_NAME ?? "s-ostoslista";
const CLIENT_VERSION = process.env.SKAUPAT_CLIENT_VERSION ?? "3.9.25";

// Jaetun listan URL. generateShoppingListShareLink palauttaa vain linkId:n;
// varsinainen linkki rakennetaan tasta. Muoto vahvistettu oikeasta jaosta:
// https://s-ostoslista.fi/liity/{linkId}. Appin App Link kattaa koko
// s-ostoslista.fi:n (autoVerify), joten linkki avaa appin ja liittaa listan.
const SHARE_URL_TEMPLATE =
  process.env.SKAUPAT_SHARE_URL_TEMPLATE ??
  "https://s-ostoslista.fi/liity/{linkId}";

export interface GqlError {
  message: string;
}

export class SkaupatError extends Error {
  constructor(message: string, public details?: unknown) {
    super(message);
    this.name = "SkaupatError";
  }
}

const COMMON_HEADERS = {
  accept: "*/*",
  "content-type": "application/json",
  "x-api-key": API_KEY,
  "apollographql-client-name": CLIENT_NAME,
  "apollographql-client-version": CLIENT_VERSION,
} as const;

/** Suorittaa GraphQL-POST:n annetuilla headereilla ja palauttaa data-osan. */
async function execGql<T>(
  query: string,
  variables: Record<string, unknown>,
  headers: Record<string, string>
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({ query, variables }),
    });
  } catch (e) {
    throw new SkaupatError(
      `Verkkovirhe yhteydessa ${ENDPOINT}: ${(e as Error).message}`
    );
  }
  const text = await res.text();
  if (!res.ok) {
    // AppSync palauttaa auth-virheet 401:na (UnauthorizedException)
    if (res.status === 401) {
      throw new SkaupatError(
        "AppSync 401 (UnauthorizedException): x-api-key tai token puuttuu tai on " +
          "vanhentunut. Aseta toimiva avain SKAUPAT_API_KEY:hin. Vastaus: " +
          text.slice(0, 300)
      );
    }
    throw new SkaupatError(
      `Rajapinta palautti HTTP ${res.status}. Vastaus: ${text.slice(0, 400)}`
    );
  }
  let json: { data?: T; errors?: GqlError[] };
  try {
    json = JSON.parse(text);
  } catch {
    throw new SkaupatError(`Vastaus ei ollut JSONia: ${text.slice(0, 400)}`);
  }
  if (json.errors?.length) {
    throw new SkaupatError(
      "GraphQL-virhe: " + json.errors.map((e) => e.message).join("; "),
      json.errors
    );
  }
  return json.data as T;
}

/**
 * Suorittaa julkisen GraphQL-kyselyn API_KEY-tilassa (`x-api-key`).
 * Tuote-/kauppahaut ja anonyymin tokenin haku eivat vaadi kayttajaa.
 */
export function gqlPost<T = any>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  return execGql<T>(query, variables, COMMON_HEADERS);
}

/**
 * Suorittaa kayttajakohtaisen GraphQL-kyselyn tokenilla (`Authorization`).
 * Ostoslistan luonti ja jako vaativat (anonyymin tai kirjautuneen) tokenin.
 */
export function gqlAuthPost<T = any>(
  query: string,
  variables: Record<string, unknown>,
  token: string
): Promise<T> {
  return execGql<T>(query, variables, {
    accept: "*/*",
    "content-type": "application/json",
    authorization: token,
    "apollographql-client-name": CLIENT_NAME,
    "apollographql-client-version": CLIENT_VERSION,
  });
}

/* ------------------------------- Tyypit --------------------------- */

export interface Store {
  id: string;
  name: string;
  brand?: string | null;
  city?: string | null;
  postalCode?: string | null;
}

export interface Product {
  id: string;
  ean?: string | null;
  name: string;
  price?: number | null;
  comparisonPrice?: number | null;
  comparisonUnit?: string | null;
  priceUnit?: string | null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace(",", "."));
    if (isFinite(n)) return n;
  }
  return null;
}

/* ------------------------------ Tuotteet -------------------------- */

/** ProductInStoreFragment-kentat (appin bundlesta). @connection on Apollon
 *  client-direktiivi, joten sita EI laheteta palvelimelle. */
const PRODUCTS_IN_STORE_QUERY = `
query GetProductsInStore($storeId: ID, $query: String, $from: Int, $pageSize: Int) {
  products(storeId: $storeId, query: $query, from: $from, pageSize: $pageSize) {
    maybeHasMore
    items {
      name ean id brandName price priceUnit comparisonPrice comparisonUnit approxPrice available
    }
  }
}`;

interface RawProduct {
  id: string;
  ean?: string | null;
  name: string;
  brandName?: string | null;
  price?: number | null;
  priceUnit?: string | null;
  comparisonPrice?: number | null;
  comparisonUnit?: string | null;
}

function mapProduct(p: RawProduct): Product {
  return {
    id: String(p.id),
    ean: p.ean ?? null,
    name: p.name,
    price: num(p.price),
    comparisonPrice: num(p.comparisonPrice),
    comparisonUnit: p.comparisonUnit ?? null,
    priceUnit: p.priceUnit ?? null,
  };
}

export async function searchProducts(
  storeId: string,
  query: string,
  limit = 10
): Promise<{ storeName?: string; total: number; items: Product[] }> {
  const data = await gqlPost<{
    products?: { maybeHasMore?: boolean; items?: RawProduct[] };
  }>(PRODUCTS_IN_STORE_QUERY, {
    storeId,
    query,
    from: 0,
    pageSize: limit,
  });
  const items = (data.products?.items ?? []).slice(0, limit).map(mapProduct);
  return { total: items.length, items };
}

/** Hakee yksittaisen tuotteen EAN:lla kaupasta (GetProductByEan, bundlesta). */
const PRODUCT_BY_EAN_QUERY = `
query GetProductByEan($ean: ID!, $storeId: ID) {
  productByEan(ean: $ean, storeId: $storeId) {
    name ean id brandName price priceUnit comparisonPrice comparisonUnit
  }
}`;

export async function productByEan(
  ean: string,
  storeId: string
): Promise<Product | null> {
  const data = await gqlPost<{ productByEan?: RawProduct | null }>(
    PRODUCT_BY_EAN_QUERY,
    { ean, storeId }
  );
  return data.productByEan ? mapProduct(data.productByEan) : null;
}

/* ------------------------------- Kaupat --------------------------- */

const STORE_SEARCH_QUERY = `
query GetStoreBySearchText($query: String) {
  stores(query: $query) {
    stores { id name postalCode city brand }
  }
}`;

// AppSyncin kauppahaku vaatii KOKONAISEN sanaosuman (prefix ei riita:
// "raksila" osuu, "raksil" ei) eika ymmarra taivutusta ("Raksilan" -> 0).
// Fallbackissa palautetaan sana nominatiiviin. Genetiivi on pelkka "-n"
// (edeltava vokaali kuuluu kantaan: "raksilan" -> "raksila"), joten vokaali+n
// -paatteita EI saa syoda. Monikirjaimiset paikallissijat sen sijaan
// palauttavat kokonaisen nominatiivin ("oulussa" -> "oulu"), ne karsitaan.
const CASE_ENDINGS = [
  "seen", "ksi", "ssa", "ssä", "sta", "stä", "lla", "llä", "lta", "ltä", "lle",
];

function stemWord(w: string): string {
  for (const e of CASE_ENDINGS) {
    if (w.length - e.length >= 3 && w.endsWith(e)) {
      return w.slice(0, w.length - e.length);
    }
  }
  // Genetiivi/illatiivi: karsi yksi loppu-"n" ("raksilan" -> "raksila").
  if (w.length >= 4 && w.endsWith("n")) return w.slice(0, -1);
  return w;
}

function stemQuery(query: string): string {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => stemWord(w.toLowerCase()))
    .join(" ");
}

async function storesByText(query: string): Promise<Store[]> {
  const data = await gqlPost<{ stores?: { stores?: Store[] } }>(
    STORE_SEARCH_QUERY,
    { query }
  );
  return (data.stores?.stores ?? []).map((s) => ({
    id: String(s.id),
    name: s.name,
    brand: s.brand ?? null,
    city: s.city ?? null,
    postalCode: s.postalCode ?? null,
  }));
}

/**
 * Hakee kaupat nimella / paikkakunnalla. AppSyncin haku on sumea ja palauttaa
 * taivutetulle haulle helposti VAARAN ei-tyhjan osuman ("Kallion Alepa" ->
 * Alepa Kulosaari), joten haetaan ENSIN nominatiivimuodolla (kanta antaa oikean
 * kokonaissanaosuman). Vain jos kanta on tyhja, kokeillaan alkuperaista.
 * Palauttaa enintaan 25 osumaa.
 */
export async function searchStores(query: string): Promise<Store[]> {
  const CAP = 25;
  const stemmed = stemQuery(query);
  let stores = await storesByText(stemmed);
  if (!stores.length && stemmed !== query.toLowerCase().trim()) {
    stores = await storesByText(query);
  }
  return stores.slice(0, CAP);
}

/* ---------------------- Ostoslistan jako (QR) --------------------- */

/**
 * Jaettavan listan rivi. Kun `ean` JA `sokId` on annettu, rivi luodaan
 * OIKEANA tuoterivina (productResolvedItems -> appi nayttaa kuvan ja hinnan);
 * muuten se jaa vapaatekstiriviksi, jonka appi nayttaa muistiinpanona.
 */
export interface ShareItem {
  name: string;
  ean?: string | null;
  sokId?: string | null;
  quantity?: number;
  quantityUnit?: string;
  comment?: string;
}

export interface ShareResult {
  listId: string;
  linkId: string;
  url: string;
  itemCount: number;
  resolvedCount: number;
  noteCount: number;
}

/**
 * Hakee anonyymin kayttajatokenin (API_KEY-tila). Token on KAYTTAJAKOHTAINEN
 * (jokainen haku luo uuden anonyymin kayttajan), joten listan luonti ja jako on
 * tehtava SAMALLA tokenilla.
 */
export async function getAnonymousToken(): Promise<string> {
  const data = await gqlPost<{ anonymousUserToken?: string }>(
    "query anonymousUserToken { anonymousUserToken }"
  );
  const t = data.anonymousUserToken;
  if (!t) throw new SkaupatError("Anonyymin tokenin haku epaonnistui.");
  return t;
}

const CREATE_LIST_MUTATION = `
mutation createShoppingList($name: String!, $storeId: String!) {
  createShoppingList(name: $name, storeId: $storeId) { id name storeId }
}`;

// Tuoterivit (productResolvedItems) ja vapaatekstirivit (items) samalla
// mutaatiolla. CreateProductResolvedShoppingListItemInput vaatii sokId:n
// (= tuotteen id GetProductsInStore/GetProductByEan-kyselyista) ja ean:n —
// nain rivi linkittyy oikeaksi tuotteeksi eika jaa muistiinpanoksi.
const BATCH_INSERT_ITEMS_MUTATION = `
mutation batchInsertShoppingListItem($shoppingListId: ID!, $productResolvedItems: [CreateProductResolvedShoppingListItemInput!], $items: [CreateShoppingListItemInput!]) {
  batchInsertShoppingListItem(shoppingListId: $shoppingListId, productResolvedItems: $productResolvedItems, items: $items) { id }
}`;

const SHARE_LINK_MUTATION = `
mutation generateShoppingListShareLink($id: ID!) {
  generateShoppingListShareLink(id: $id, permissions: [READ, WRITE, SHARE], validForHours: 8760) { id }
}`;

/**
 * Luo ostoslistan S-ostoslista-backendiin ja generoi sille jakolinkin.
 * Palauttaa jaettavan URL:n (QR-koodattavaksi). Luonti, rivien lisays ja jako
 * tehdaan yhdella anonyymilla tokenilla (sama kayttaja). `storeId` on
 * backendin vaatima. Rivit joilla on ean+sokId luodaan tuoterivina,
 * loput vapaatekstirivina (muistiinpano).
 */
export async function shareShoppingList(
  name: string,
  storeId: string,
  items: ShareItem[]
): Promise<ShareResult> {
  const token = await getAnonymousToken();

  const clean = items.filter((it) => it.name.trim());
  const resolvedInputs = clean
    .filter((it) => it.ean && it.sokId)
    .map((it) => ({
      name: it.name.trim(),
      sokId: String(it.sokId),
      ean: String(it.ean),
      quantity: it.quantity ?? 1,
      quantityUnit: it.quantityUnit ?? "kpl",
      isReplaceable: false,
      ...(it.comment?.trim() ? { commentForPicker: it.comment.trim() } : {}),
    }));
  const noteInputs = clean
    .filter((it) => !(it.ean && it.sokId))
    .map((it) => ({ name: it.name.trim() }));

  const created = await gqlAuthPost<{ createShoppingList?: { id: string } }>(
    CREATE_LIST_MUTATION,
    { name, storeId },
    token
  );
  const listId = created.createShoppingList?.id;
  if (!listId) throw new SkaupatError("Ostoslistan luonti epaonnistui.");

  if (resolvedInputs.length || noteInputs.length) {
    await gqlAuthPost(
      BATCH_INSERT_ITEMS_MUTATION,
      {
        shoppingListId: listId,
        productResolvedItems: resolvedInputs.length ? resolvedInputs : null,
        items: noteInputs.length ? noteInputs : null,
      },
      token
    );
  }

  const shared = await gqlAuthPost<{
    generateShoppingListShareLink?: { id: string };
  }>(SHARE_LINK_MUTATION, { id: listId }, token);
  const linkId = shared.generateShoppingListShareLink?.id;
  if (!linkId) throw new SkaupatError("Jakolinkin generointi epaonnistui.");

  const url = SHARE_URL_TEMPLATE.replace("{linkId}", encodeURIComponent(linkId));
  return {
    listId,
    linkId,
    url,
    itemCount: clean.length,
    resolvedCount: resolvedInputs.length,
    noteCount: noteInputs.length,
  };
}

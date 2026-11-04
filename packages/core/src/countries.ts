/**
 * Countries by ISO 3166-1 alpha-2 code, plus EU. Aliases are lowercase English and Finnish names, demonyms and
 * capitals, matched as whole words. An alias ending in `*` is a stem and matches any word that starts with it, for
 * Finnish inflection (Helsingin, Ruotsissa). A stem that would also start an English word (tamper, vantage) is
 * spelled out as its inflected forms instead.
 */
export const COUNTRIES: Record<string, { name: string; aliases: string[] }> = {
  FI: {
    name: "Finland",
    aliases: [
      ...["finland", "finnish", "finns", "suom*", "helsinki*", "helsingi*", "helsingfors", "espoo*", "vantaa*"],
      ...["tampere", "tampereen", "tampereella", "tampereelta", "tampereelle", "turku", "turu*", "oulu*", "jyväskyl*"],
      ...["kuopio*", "lahti", "lahden", "lahdessa", "pori", "porin", "porissa", "rovaniem*", "lapland", "lappi"],
      ...["lapin", "lapissa", "uusimaa", "uudenmaa*", "uudellamaalla", "vaasa*", "joensuu*", "åland", "ahvenanmaa*"],
    ],
  },
  SE: { name: "Sweden", aliases: ["sweden", "swedish", "swede", "swedes", "stockholm", "ruots*"] },
  NO: { name: "Norway", aliases: ["norway", "norwegian", "oslo", "norja*"] },
  DK: { name: "Denmark", aliases: ["denmark", "danish", "dane", "danes", "copenhagen", "tanska*"] },
  IS: { name: "Iceland", aliases: ["iceland", "icelandic", "reykjavik", "reykjavík", "islanti", "islannin"] },
  EE: { name: "Estonia", aliases: ["estonia", "estonian", "tallinn", "viro", "viron", "virossa", "virolai*"] },
  LV: { name: "Latvia", aliases: ["latvi*", "riga"] },
  LT: { name: "Lithuania", aliases: ["lithuania", "lithuanian", "vilnius", "liettua*"] },
  AT: { name: "Austria", aliases: ["austria", "austrian", "vienna", "itäval*"] },
  BE: { name: "Belgium", aliases: ["belgium", "belgia*", "brussels"] },
  BG: { name: "Bulgaria", aliases: ["bulgaria*", "sofia"] },
  HR: { name: "Croatia", aliases: ["croatia", "croatian", "zagreb", "kroatia*"] },
  CY: { name: "Cyprus", aliases: ["cyprus", "cypriot", "nicosia", "kypro*"] },
  CZ: { name: "Czechia", aliases: ["czech", "czechia", "prague", "tšek*", "tsek*"] },
  FR: { name: "France", aliases: ["france", "french", "paris", "ranska*"] },
  DE: { name: "Germany", aliases: ["germany", "german", "germans", "berlin", "saksa*"] },
  GR: { name: "Greece", aliases: ["greece", "greek", "athens", "kreik*"] },
  HU: { name: "Hungary", aliases: ["hungary", "hungarian", "budapest", "unkari*"] },
  IE: { name: "Ireland", aliases: ["ireland", "irish", "dublin", "irlan*"] },
  IT: { name: "Italy", aliases: ["italy", "italia*", "rome"] },
  LU: { name: "Luxembourg", aliases: ["luxembourg", "luxemburg*"] },
  MT: { name: "Malta", aliases: ["malta", "maltese", "valletta"] },
  NL: { name: "Netherlands", aliases: ["netherlands", "dutch", "holland", "amsterdam", "the hague", "alankoma*"] },
  PL: { name: "Poland", aliases: ["poland", "polish", "warsaw", "puola*"] },
  PT: { name: "Portugal", aliases: ["portugal*", "portuguese", "lisbon"] },
  RO: { name: "Romania", aliases: ["romania*", "bucharest"] },
  SK: { name: "Slovakia", aliases: ["slovakia*", "slovak", "bratislava"] },
  SI: { name: "Slovenia", aliases: ["slovenia*", "ljubljana"] },
  ES: { name: "Spain", aliases: ["spain", "spanish", "madrid", "espanja*"] },
  GB: {
    name: "United Kingdom",
    aliases: ["united kingdom", "uk", "britain", "british", "england", "scotland", "wales", "northern ireland"],
  },
  US: {
    name: "United States",
    aliases: ["united states", "usa", "u.s.", "american", "americans", "washington", "white house", "yhdysval*"],
  },
  CA: { name: "Canada", aliases: ["canada", "canadian", "ottawa", "kanada*"] },
  RU: { name: "Russia", aliases: ["russia", "russian", "russians", "moscow", "kremlin", "venäj*", "venäläi*"] },
  UA: { name: "Ukraine", aliases: ["ukrain*", "kyiv", "kiev"] },
  BY: { name: "Belarus", aliases: ["belarus", "belarusian", "minsk", "valko-venäj*"] },
  CN: { name: "China", aliases: ["china", "chinese", "beijing", "kiina*"] },
  TW: { name: "Taiwan", aliases: ["taiwan*", "taipei"] },
  JP: { name: "Japan", aliases: ["japan", "japanese", "tokyo", "japani*"] },
  KR: { name: "South Korea", aliases: ["south korea", "south korean", "seoul", "etelä-korea*"] },
  KP: { name: "North Korea", aliases: ["north korea", "north korean", "pyongyang", "pohjois-korea*"] },
  IN: { name: "India", aliases: ["india", "indian", "new delhi", "delhi", "intia*"] },
  IL: { name: "Israel", aliases: ["israel*", "jerusalem", "tel aviv"] },
  PS: { name: "Palestine", aliases: ["palestine", "palestinian", "palestinians", "gaza", "west bank", "palestiin*"] },
  IR: { name: "Iran", aliases: ["iran*", "tehran"] },
  TR: { name: "Turkey", aliases: ["turkey", "turkish", "türkiye", "ankara", "istanbul", "turkk*", "turkin"] },
  SA: { name: "Saudi Arabia", aliases: ["saudi arabia", "saudi", "saudis", "riyadh", "saudi-arabia*"] },
  AE: {
    name: "United Arab Emirates",
    aliases: ["united arab emirates", "uae", "emirati", "abu dhabi", "dubai", "arabiemiir*"],
  },
  AU: { name: "Australia", aliases: ["australia*", "canberra"] },
  BR: { name: "Brazil", aliases: ["brazil", "brazilian", "brasilia*", "brasília"] },
  MX: { name: "Mexico", aliases: ["mexico", "mexican", "meksiko*"] },
  VE: { name: "Venezuela", aliases: ["venezuela*", "caracas"] },
  EU: {
    name: "European Union",
    aliases: ["eu", "european union", "european commission", "european parliament", "euroopan unioni*"],
  },
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const alias = (a: string) => (a.endsWith("*") ? `${escapeRegex(a.slice(0, -1))}[\\p{L}\\p{N}]*` : escapeRegex(a))

/** One named group per country; letters or digits on either side mean the alias is only part of a word. */
const WORDS = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${Object.entries(COUNTRIES)
    .map(([code, c]) => `(?<${code}>${c.aliases.map(alias).join("|")})`)
    .join("|")})(?![\\p{L}\\p{N}])`,
  "giu",
)

/** ISO codes of the countries the texts name, in order of first appearance. */
export const countriesIn = (texts: (string | null | undefined)[]): string[] => {
  const found = new Set<string>()
  for (const text of texts) {
    for (const m of text?.matchAll(WORDS) ?? []) {
      const code = Object.entries(m.groups ?? {}).find(([, v]) => v !== undefined)?.[0]
      if (code) found.add(code)
    }
  }
  return [...found]
}

/** Own keys only, so `constructor` or `__proto__` is not a country. */
export const isCountry = (code: string) => Object.hasOwn(COUNTRIES, code)

export const countryName = (code: string) => (isCountry(code) ? (COUNTRIES[code]?.name ?? code) : code)

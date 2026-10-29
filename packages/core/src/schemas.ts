import { z } from "zod"

export const TOPICS = ["security", "tech", "world"] as const

export const FACT_TYPE_VALUES = [
  "severity",
  "scope",
  "attribution",
  "casualties",
  "patch_status",
  "exploitation",
  "other",
] as const

/** Sonnet's output for one story. Counts are computed in code and are not in here on purpose. */
export const Extraction = z.object({
  headline: z.string().describe("Neutral headline, at most 80 characters, English"),
  what_happened: z.string().describe("Exactly one sentence, at most 25 words, not repeating the headline"),
  why_matters: z.string().describe("One sentence on why a security- and tech-minded reader in Finland should care"),
  topic: z.enum(TOPICS),
  primary_entity: z.string().nullable().describe("The one organisation, product or place the story is about"),
  atomic_facts: z.array(
    z.object({
      text: z.string(),
      type: z.enum(FACT_TYPE_VALUES),
      salience: z.number().int().describe("0 to 3"),
      supporting_article_ids: z.array(z.number().int()),
    }),
  ),
  entities: z.array(z.string()),
  cves: z.array(z.string()),
  products: z.array(z.string()),
  exploited_claim: z.object({
    claimed: z.boolean(),
    by: z.string().nullable().describe("Who says it is exploited: vendor, CERT, researcher, press, or null"),
  }),
  emergency_patch: z.boolean().describe("An out-of-band or emergency fix is involved"),
  fi_nordic_eu_relevance: z.number().int().describe("0 none, 1 EU or Nordic, 2 Finland"),
  flags: z.object({
    promotional: z.boolean(),
    aggregator: z.boolean(),
    opinion: z.boolean(),
    evergreen: z.boolean(),
  }),
  rubric: z.object({
    severity: z.number().int(),
    specificity: z.number().int(),
    breadth: z.number().int(),
    actionability: z.number().int(),
    novelty: z.number().int(),
    credibility: z.number().int(),
  }),
  injection_suspect_article_ids: z.array(z.number().int()),
})

export type Extraction = z.infer<typeof Extraction>

/** Haiku's label for one new fact against the stored ones. */
export const FactLabels = z.object({
  labels: z.array(
    z.object({
      index: z.number().int().describe("Index of the new fact"),
      label: z.enum(["entailed", "new", "contradicting"]),
      contradicts_fact_id: z.number().int().nullable(),
    }),
  ),
})

export type FactLabels = z.infer<typeof FactLabels>

/**
 * A theme name word: letters and digits, full stops and hyphens inside, as in "Node.js" or "Zero-day", and a final
 * full stop only after a capital, as in "U.S.". Escapes keep the pattern ASCII, since the SDK shows it to the model.
 */
const NAME_WORD = String.raw`[\p{L}\p{N}](?:[\p{L}\p{N}'\u{2019}&+/]|[.\-](?=[\p{L}\p{N}]))*(?:(?<=\p{Lu})\.)?`

/** Two to four words; no dashes, bullets, other punctuation or trailing full stop. */
export const THEME_NAME = new RegExp(`^${NAME_WORD}(?: ${NAME_WORD}){1,3}$`, "u")

/** No line breaks, figure, en or em dashes, horizontal bars, bullets, middots or pipes. */
const THEME_DESCRIPTION = /^[^\n\u{2012}-\u{2015}\u{2022}\xB7\x7C]+$/u

/** A theme name as the model writes it and the dashboard's rename form accepts it. */
export const ThemeName = z
  .string()
  .min(2)
  .max(60)
  .regex(THEME_NAME, "Two to four words, with no dashes or trailing full stop")
  .describe("Two to four words in sentence case, no dashes, no trailing full stop")
const ThemeDescription = z
  .string()
  .min(1)
  .max(240)
  .regex(THEME_DESCRIPTION)
  .describe("One sentence on what the development is")

/** Haiku's choice for one story: join a candidate theme or propose a new one. */
export const ThemeDecision = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("join"),
    themeId: z.number().int().describe("id of the candidate the story joins"),
    confidence: z.number().min(0).max(1),
  }),
  z.object({
    decision: z.literal("new"),
    proposedName: ThemeName,
    proposedDescription: ThemeDescription,
  }),
])

export type ThemeDecision = z.infer<typeof ThemeDecision>

/** Sonnet's answer to a proposal: create the theme or merge it into a nearest one. */
export const ThemeCreate = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), name: ThemeName, description: ThemeDescription }),
  z.object({ action: z.literal("merge"), intoThemeId: z.number().int().describe("id of the candidate it duplicates") }),
])

export type ThemeCreate = z.infer<typeof ThemeCreate>

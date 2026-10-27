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
  headline: z.string().describe("Neutral headline, under 90 characters, English"),
  what_happened: z.string().describe("One or two sentences"),
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

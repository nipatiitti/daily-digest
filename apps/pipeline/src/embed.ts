import { EMBED } from "@digest/core"

/** bge-m3 vectors for the texts, in order. */
export const embed = async (ai: Ai, texts: string[]): Promise<number[][]> => {
  const out = (await ai.run(EMBED.model, { text: texts, truncate_inputs: true })) as { data?: number[][] }
  if (!out.data || out.data.length !== texts.length)
    throw new Error(`embedding returned ${out.data?.length ?? 0} vectors`)
  return out.data
}

/** One JSON log line. */
export const log = (event: string, data: Record<string, unknown>) => console.log(JSON.stringify({ event, ...data }))

/** Runs `run` over `items` with at most `size` in flight at once, keeping their order. */
export const inGroups = async <T, R>(items: T[], size: number, run: (item: T) => Promise<R>) => {
  const out: R[] = []
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(run))))
  return out
}

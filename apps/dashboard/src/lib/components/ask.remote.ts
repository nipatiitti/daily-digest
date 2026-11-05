import { HOME } from "@digest/core"
import { readAskTimeline } from "@digest/db"
import { z } from "zod"
import { db } from "#lib/server/db.ts"
import { query } from "$app/server"

/**
 * The events an answer cites, by id, as the timeline under it: first seen first, with the thread, independent outlet
 * count and outlet names from the database. Fresh and stored answers both fetch it once their text is complete.
 */
export const askTimeline = query(z.array(z.number().int().positive()).min(1).max(HOME.askEvents), (ids) =>
  readAskTimeline(db(), ids, HOME.askTimelineSources),
)

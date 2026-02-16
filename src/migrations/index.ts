import type { Database } from "bun:sqlite"
import * as m001 from "./001_initial"
import * as m002 from "./002_tags"
import * as m003 from "./003_decay"
import * as m004 from "./004_links"
import * as m005 from "./005_metadata"
import * as m006 from "./006_indexes"

export interface Migration {
  version: number
  description: string
  up: (db: Database) => void
  down?: (db: Database) => void
}

// Register all migrations in order
export const migrations: Migration[] = [m001, m002, m003, m004, m005, m006]

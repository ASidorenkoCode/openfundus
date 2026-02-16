import { initConfig } from "../src/config"
import { closeDb } from "../src/db"
import { tmpdir } from "os"
import { join } from "path"
import { mkdtempSync } from "fs"

let testDir: string

export function setupTestDb() {
  testDir = mkdtempSync(join(tmpdir(), "openrecall-test-"))
  initConfig({ dbPath: join(testDir, "test.db") })
}

export function teardownTestDb() {
  closeDb()
}

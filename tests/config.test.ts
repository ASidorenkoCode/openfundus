import { describe, test, expect } from "bun:test"
import { initConfig, getConfig } from "../src/config"

describe("config", () => {
  test("returns defaults when no config provided", () => {
    const config = initConfig()
    expect(config.autoRecall).toBe(true)
    expect(config.autoExtract).toBe(true)
    expect(config.searchLimit).toBe(10)
    expect(config.maxMemories).toBe(0)
    expect(config.globalMemories).toBe(false)
    expect(config.categories).toContain("general")
    expect(config.categories).toContain("decision")
  })

  test("overrides specific fields", () => {
    const config = initConfig({
      searchLimit: 25,
      autoRecall: false,
      globalMemories: true,
    })
    expect(config.searchLimit).toBe(25)
    expect(config.autoRecall).toBe(false)
    expect(config.globalMemories).toBe(true)
    // defaults preserved
    expect(config.autoExtract).toBe(true)
  })

  test("custom categories replace defaults", () => {
    const config = initConfig({
      categories: ["custom1", "custom2"],
    })
    expect(config.categories).toEqual(["custom1", "custom2"])
  })

  test("getConfig returns current config", () => {
    initConfig({ searchLimit: 42 })
    const config = getConfig()
    expect(config.searchLimit).toBe(42)
  })

  test("ignores invalid searchLimit", () => {
    const config = initConfig({ searchLimit: -5 })
    expect(config.searchLimit).toBe(10) // default
  })

  test("custom dbPath is respected", () => {
    const config = initConfig({ dbPath: "/tmp/custom.db" })
    expect(config.dbPath).toBe("/tmp/custom.db")
  })
})

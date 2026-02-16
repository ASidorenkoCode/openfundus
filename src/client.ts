import type { PluginInput } from "@opencode-ai/plugin"

type SdkClient = PluginInput["client"]

let sdkClient: SdkClient | null = null

export function initClient(client: SdkClient) {
  sdkClient = client
}

export function getClient(): SdkClient {
  if (!sdkClient) {
    throw new Error("OpenRecall: SDK client not initialized")
  }
  return sdkClient
}

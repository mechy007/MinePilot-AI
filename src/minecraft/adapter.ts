export interface MinecraftAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  observe(): Promise<{ position: { x: number; y: number; z: number }; health: number; hunger: number }>;
  moveToward(target: { x: number; y: number; z: number }, signal: AbortSignal): Promise<void>;
}
// The real Bedrock implementation is intentionally deferred until protocol 2225,
// NetherNet and same-phone world joining are validated on a physical device.

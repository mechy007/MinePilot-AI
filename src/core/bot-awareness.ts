type EntityId = bigint | number | string;

interface AttributeUpdate {
  runtime_entity_id?: EntityId;
  attributes?: { name?: string; current?: number }[];
}

const LOW_HEALTH = 6;
const LOW_HUNGER = 6;

/** Read-only assessment of the bot's own server-reported vitals. */
export class BotAwareness {
  private entityId?: string;
  private health?: number;
  private hunger?: number;

  start(packet?: { runtime_entity_id?: EntityId }): void {
    this.entityId = packet?.runtime_entity_id == null ? undefined : String(packet.runtime_entity_id);
    this.health = undefined;
    this.hunger = undefined;
  }

  update(packet?: AttributeUpdate): void {
    if (this.entityId === undefined || packet?.runtime_entity_id == null ||
        String(packet.runtime_entity_id) !== this.entityId || !Array.isArray(packet.attributes)) return;
    for (const attribute of packet.attributes) {
      const value = attribute?.current;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
      if (attribute.name === 'minecraft:health') this.health = value;
      if (attribute.name === 'minecraft:player.hunger' && value <= 20) this.hunger = value;
    }
  }

  snapshot() {
    const { health, hunger } = this;
    if (health === undefined && hunger === undefined) return undefined;
    let assessment = 'awaiting_vitals';
    if (health === 0) assessment = 'dead';
    else if (health !== undefined && health <= LOW_HEALTH) assessment = 'recover_health';
    else if (hunger !== undefined && hunger <= LOW_HUNGER) assessment = 'needs_food';
    else if (health !== undefined && hunger !== undefined) assessment = 'ready';
    return { health, hunger, assessment };
  }
}

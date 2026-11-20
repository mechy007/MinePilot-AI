export type GoalStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';
export interface WorldSnapshot { health: number; hunger: number; threat: number; timestamp: number }
export interface Goal { id: string; command: string; status: GoalStatus }
export interface SkillResult { ok: boolean; reason?: string }
export interface Skill { readonly name: string; run(snapshot: WorldSnapshot, signal: AbortSignal): Promise<SkillResult> }
export class MinePilotAgent {
  private controller?: AbortController;
  private active?: Goal;
  constructor(private readonly skills: Map<string, Skill>) {}
  get currentGoal(): Goal | undefined { return this.active && { ...this.active }; }
  stop(): void { this.controller?.abort(); if (this.active?.status === 'running') this.active.status = 'paused'; }
  async execute(goal: Goal, snapshot: WorldSnapshot): Promise<SkillResult> {
    if (this.active?.status === 'running') throw new Error('Agent busy');
    const skill = this.skills.get(goal.command);
    if (!skill) return { ok: false, reason: 'Unknown command' };
    if (snapshot.health <= 0 || snapshot.threat >= 90) return { ok: false, reason: 'Unsafe world state' };
    this.controller = new AbortController();
    this.active = { ...goal, status: 'running' };
    try {
      const result = await skill.run(snapshot, this.controller.signal);
      this.active.status = this.controller.signal.aborted ? 'paused' : result.ok ? 'completed' : 'failed';
      return this.controller.signal.aborted ? { ok: false, reason: 'Cancelled' } : result;
    } catch (error) {
      this.active.status = this.controller.signal.aborted ? 'paused' : 'failed';
      return { ok: false, reason: this.controller.signal.aborted ? 'Cancelled' : String(error) };
    } finally { this.controller = undefined; }
  }
}

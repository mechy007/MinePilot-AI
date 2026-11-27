'use strict';
const STOP = new Set(['stop','emergency_stop','manual_stop','stop_movement']);
const READ_ONLY = new Set(['status','inspect','observe','plan','plan_obtain']);
const MUTATING = new Set(['manual_move','navigate','inventory','mine','place','craft','combat','use_item','execute_skill']);
class ActionEnvelope {
  evaluate(action, context={}) {
    if (typeof action!=='string' || action.length>48) return {allowed:false,reason:'invalid_action_kind'};
    if (STOP.has(action)) return {allowed:true,reason:'stop_is_always_permitted',priority:1000};
    if (READ_ONLY.has(action)) return {allowed:true,reason:'read_only_action',priority:0};
    if (!MUTATING.has(action)) return {allowed:false,reason:'action_not_allowlisted'};
    if (context.confirmed!==true) return {allowed:false,reason:'confirmation_required'};
    if (context.sessionClosed===true || context.worldReady!==true) return {allowed:false,reason:'authenticated_world_not_ready'};
    if (context.freshPosition!==true || context.freshObservation!==true) return {allowed:false,reason:'fresh_server_observation_required'};
    if (context.safetyHold===true) return {allowed:false,reason:'safety_hold_active'};
    if (context.controllerBusy===true) return {allowed:false,reason:'another_controller_owns_actions'};
    if (context.executorAvailable!==true) return {allowed:false,reason:'validated_executor_unavailable'};
    if (context.capabilityAvailable===false) return {allowed:false,reason:'server_capability_not_negotiated'};
    return {allowed:true,reason:'bounded_action_preflight_passed',priority:10};
  }
  maskControls(proposal={}, permissions={}, previous={}) {
    const keys=['forward','back','left','right','jump','sprint','sneak','attack','use'];
    const controls={}, released=[];
    for (const key of keys) {
      const allowed=permissions[key]!==false;
      controls[key]=allowed && proposal[key]===true;
      if (!allowed && (proposal[key]===true || previous[key]===true)) released.push(key);
    }
    return {controls,released,masked:released.length>0};
  }
}
module.exports={ActionEnvelope,STOP,READ_ONLY,MUTATING};

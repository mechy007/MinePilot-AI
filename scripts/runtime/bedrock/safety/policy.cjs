'use strict';
function directive(action,reason,priority){return {action,reason,priority,emitsPackets:false,executable:false};}
class SurvivalPolicy {
  evaluate(o={}){
    const now=o.now??Date.now(),age=Number.isFinite(o.positionObservedAt)?now-o.positionObservedAt:Infinity;
    if(o.sessionClosed===true)return directive('stop','session_closed',100);
    if(o.spawned!==true||o.worldReady!==true)return directive('hold','world_not_ready',95);
    if(age<0||age>7000||o.positionSource!=='server')return directive('hold','server_position_not_fresh',90);
    if(o.healthKnown===true&&Number.isFinite(o.health)&&o.health<=0)return directive('hold','player_dead_or_zero_health',100);
    if(o.healthKnown===true&&Number.isFinite(o.health)&&Number.isFinite(o.maxHealth)&&o.maxHealth>0&&o.health/o.maxHealth<=.2)return directive('stop','critical_health_requires_validated_survival_executor',98);
    if(o.oxygenKnown===true&&Number.isFinite(o.oxygen)&&o.oxygen<=2&&o.inWater===true)return directive('stop','critical_oxygen_no_verified_escape_executor',99);
    if((o.hazards??[]).some(h=>h&&Number.isFinite(h.distance)&&h.distance<=2.5&&['lava','fire','cactus','void'].includes(h.kind)))return directive('stop','immediate_hazard_requires_verified_escape_route',97);
    return directive('allow_observation','no_critical_condition_detected',0);
  }
}
module.exports={SurvivalPolicy,directive};

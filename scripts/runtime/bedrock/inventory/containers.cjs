'use strict';
const WINDOW_IDS=Object.freeze({inventory:0,offhand:119,armor:120,creative:121,hotbar:122,fixed_inventory:123,ui:124,beacon:-24,trading_output:-23,trading_use_inputs:-22,trading_input_2:-21,trading_input_1:-20,enchant_output:-17,enchant_material:-16,enchant_input:-15,anvil_output:-13,anvil_result:-12,anvil_material:-11,container_input:-10,crafting_use_ingredient:-5,crafting_result:-4,crafting_remove_ingredient:-3,crafting_add_ingredient:-2,none:-1});
const SPECS=Object.freeze({
 chest:{containerId:'container',title:'Chest',variable:true},trapped_chest:{containerId:'container',title:'Trapped Chest',variable:true},ender_chest:{containerId:'container',title:'Ender Chest',variable:true},copper_chest:{containerId:'container',title:'Copper Chest',variable:true},
 barrel:{containerId:'barrel',title:'Barrel',slots:27},shulker_box:{containerId:'shulker',title:'Shulker Box',slots:27},
 furnace:{containerId:'furnace_ingredient',title:'Furnace',slots:3,slotContainers:['furnace_ingredient','furnace_fuel','furnace_output']},
 blast_furnace:{containerId:'blast_furnace_ingredient',title:'Blast Furnace',slots:3,slotContainers:['blast_furnace_ingredient','furnace_fuel','furnace_output']},
 smoker:{containerId:'smoker_ingredient',title:'Smoker',slots:3,slotContainers:['smoker_ingredient','furnace_fuel','furnace_output']},
 brewing_stand:{containerId:'brewing_input',title:'Brewing Stand',slots:5,slotContainers:['brewing_input','brewing_fuel','brewing_result','brewing_result','brewing_result']}
});
function windowIdOf(v){if(Number.isInteger(v)&&v>=-100&&v<=124)return v;if(typeof v==='string'&&Object.hasOwn(WINDOW_IDS,v))return WINDOW_IDS[v];const n=Number(v);return Number.isInteger(n)&&n>=-100&&n<=124?n:null;}
function resolveWindow(packet={},context={}){
  const id=windowIdOf(packet.window_id??packet.id);if(id===null||id<=0||id>=119)return {status:'unsupported',reason:'not_a_block_or_entity_container_window'};
  let type=String(packet.window_type??packet.type??'container').toLowerCase();
  if(type==='container'){const b=String(context.blockName??'').replace(/^minecraft:/,'');const e=String(context.entityName??'').replace(/^minecraft:/,'');type=SPECS[b]?b:SPECS[e]?e:'chest';}
  const spec=SPECS[type];if(!spec)return {status:'unsupported',reason:'unknown_container_type'};
  const count=Number.isInteger(packet.slot_count)?packet.slot_count:Number.isInteger(context.slotCount)?context.slotCount:spec.slots;
  if(!Number.isInteger(count)||count<1||count>128||(Number.isInteger(spec.slots)&&count!==spec.slots))return {status:'rejected',reason:'invalid_container_slot_count'};
  return {status:'resolved',windowId:id,windowType:type,title:spec.title,slotCount:count,slotMap:Array.from({length:count},(_,slot)=>({container_id:spec.slotContainers?.[slot]??spec.containerId,slot})),hasPlayerInventoryPart:true,source:'server_container_open_metadata'};
}
function validItem(i){return i&&typeof i.name==='string'&&/^minecraft:[a-z0-9_./-]{1,80}$/.test(i.name)&&Number.isInteger(i.count)&&i.count>0&&i.count<=999;}
function preview(steps,reason='pure_inventory_click_plan_requires_server_transaction_adapter'){return {status:'preview',steps,executable:false,reason};}
function planPickup(slots,cursor,slot,button=0,options={}){
  if(!Array.isArray(slots)||slots.length>128||!Number.isInteger(slot)||slot<0||slot>=slots.length||![0,1].includes(button))return {status:'rejected',reason:'invalid_click',steps:[],executable:false};
  const source=slots[slot]??null,limit=options.slotLimit?.(slot)??64;if(!Number.isInteger(limit)||limit<1||limit>999)return {status:'rejected',reason:'invalid_slot_limit',steps:[],executable:false};
  if(!cursor){if(!validItem(source))return {status:'noop',steps:[],executable:false};return preview([{type:'take',count:button===0?source.count:Math.ceil(source.count/2),sourceSlot:slot,destination:'cursor'}]);}
  if(!validItem(cursor))return {status:'rejected',reason:'invalid_cursor_stack',steps:[],executable:false};
  if(!source)return preview([{type:'place',count:button===0?cursor.count:1,source:'cursor',destinationSlot:slot}]);
  if(!validItem(source))return {status:'rejected',reason:'invalid_source_stack',steps:[],executable:false};
  if(source.name===cursor.name&&(source.metadata??0)===(cursor.metadata??0)){const n=Math.min(Math.max(0,limit-source.count),button===0?cursor.count:1);return n?preview([{type:'place',count:n,source:'cursor',destinationSlot:slot}]):{status:'noop',steps:[],executable:false};}
  if(button===0&&(options.mayPlace?.(slot,cursor)??true))return preview([{type:'swap',sourceSlot:slot,destination:'cursor'}]);
  return {status:'noop',steps:[],executable:false};
}
function planHotbarSwap(sourceSlot,hotbarIndex){if(!Number.isInteger(sourceSlot)||sourceSlot<0||sourceSlot>127||!Number.isInteger(hotbarIndex)||hotbarIndex<0||hotbarIndex>8)return {status:'rejected',reason:'invalid_hotbar_swap',steps:[],executable:false};return preview([{type:'swap',sourceSlot,hotbarSlot:hotbarIndex}]);}
function planQuickMove(slots,sourceSlot,targetSlots,options={}){
  if(!Array.isArray(slots)||!Number.isInteger(sourceSlot)||sourceSlot<0||sourceSlot>=slots.length||!Array.isArray(targetSlots)||targetSlots.length>128)return {status:'rejected',reason:'invalid_quick_move',steps:[],executable:false};
  const item=slots[sourceSlot];if(!validItem(item))return {status:'noop',steps:[],executable:false};
  const max=options.slotLimit??(()=>64),virtual=slots.map(v=>v?{...v}:null);let left=item.count;const steps=[];
  for(const ix of targetSlots){if(!Number.isInteger(ix)||ix<0||ix>=virtual.length||ix===sourceSlot)continue;const at=virtual[ix];if(!validItem(at)||at.name!==item.name||(at.metadata??0)!==(item.metadata??0))continue;const n=Math.min(Math.max(0,(max(ix)??64)-at.count),left);if(n){steps.push({type:'place',count:n,sourceSlot,destinationSlot:ix});at.count+=n;left-=n;}if(!left)break;}
  if(left)for(const ix of targetSlots){if(!Number.isInteger(ix)||ix<0||ix>=virtual.length||ix===sourceSlot||virtual[ix]!=null)continue;const n=Math.min(max(ix)??64,left);steps.push({type:'place',count:n,sourceSlot,destinationSlot:ix});virtual[ix]={...item,count:n};left-=n;if(!left)break;}
  return steps.length?{...preview(steps,'quick_move_preview'),remaining:left}:{status:'noop',steps:[],executable:false,remaining:left};
}
function inventoryCounts(inv){
  if(!inv||inv.known!==true||inv.fresh!==true||inv.registryKnown!==true||inv.unresolvedItemCount!==0||!Array.isArray(inv.items))return {known:false,reason:inv?.reason??'fresh_resolved_inventory_required',counts:{}};
  const counts=Object.create(null);for(const item of inv.items){if(!item||item.empty===true)continue;if(typeof item.itemName==='string'&&/^minecraft:[a-z0-9_./-]{1,80}$/.test(item.itemName)&&Number.isInteger(item.count)&&item.count>0)counts[item.itemName]=(counts[item.itemName]??0)+item.count;}
  return {known:true,reason:'server_inventory_snapshot',counts,revision:inv.revision??null,generation:inv.generation??null,observedAt:inv.observedAt??null,ageMs:inv.ageMs??null,slotCount:inv.slotCount??0};
}
function snapshotInventory(ledger,options={}){if(!ledger||typeof ledger.playerInventory!=='function')return {known:false,reason:'inventory_ledger_unavailable',counts:{}};return inventoryCounts(ledger.playerInventory({maxAgeMs:options.maxAgeMs??10000}));}
module.exports={WINDOW_IDS,SPECS,windowIdOf,resolveWindow,validItem,planPickup,planHotbarSwap,planQuickMove,inventoryCounts,snapshotInventory};

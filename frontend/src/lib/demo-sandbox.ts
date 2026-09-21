export type DemoLead = {id:string; name:string; city:string; asking:number; arv:number; repairs:number; stage:string; note:string};
export type DemoTask = {id:string; text:string; done:boolean};
export type DemoState = {leads:DemoLead[]; tasks:DemoTask[]; activity:string[]};
export const demoStages = ['Intake','Qualified','Analyzing','Buyer matching','Under contract','Closed'];
export function seedDemoState(): DemoState {
  return {
    leads:[{id:'example-property',name:'Sample property — Oak Lane',city:'Winston-Salem',asking:125000,arv:210000,repairs:30000,stage:'Intake',note:'Fictional training record. Edit the figures and run the pipeline.'}],
    tasks:[{id:'example-task',text:'Review the sample property and run its pipeline',done:false}],
    activity:['Workspace created with clearly labeled fictional training records.'],
  };
}
export function analyzeDemoDeal(lead:DemoLead){
  const mao=Math.round(lead.arv*.7-lead.repairs);
  return {mao,spread:mao-lead.asking};
}
function text(value:unknown,max=200){return typeof value==='string'?value.trim().slice(0,max):'';}
function amount(value:unknown){const n=Number(value);if(!Number.isFinite(n)||n<0||n>100000000)throw Error('Enter a valid amount between 0 and 100,000,000.');return n;}
export function applyDemoAction(current:DemoState,body:Record<string,unknown>,id:string):DemoState {
  const state=structuredClone(current);
  const log=(message:string)=>{state.activity=[message,...state.activity].slice(0,100);};
  if(body.action==='reset')return seedDemoState();
  if(body.action==='addLead'){
    if(state.leads.length>=100)throw Error('This demo supports up to 100 properties.');
    const name=text(body.name),city=text(body.city);if(!name||!city)throw Error('Property name and city are required.');
    state.leads.push({id,name,city,asking:amount(body.asking),arv:amount(body.arv),repairs:amount(body.repairs),stage:'Intake',note:''});log('Added '+name);
  }else if(body.action==='updateLead'||body.action==='runPipeline'||body.action==='deleteLead'){
    const lead=state.leads.find(x=>x.id===body.id);if(!lead)throw Error('Property not found in your workspace.');
    if(body.action==='deleteLead'){state.leads=state.leads.filter(x=>x.id!==lead.id);log('Removed '+lead.name);}
    else if(body.action==='runPipeline'){
      const analysis=analyzeDemoDeal(lead);lead.stage=analysis.spread>=0?'Buyer matching':'Analyzing';
      if(state.tasks.length>=100)throw Error('Complete or reset tasks before running more pipelines.');
      state.tasks.push({id,text:analysis.spread>=0?'Review buyer matches for '+lead.name:'Review price or repair assumptions for '+lead.name,done:false});
      log('Pipeline completed for '+lead.name+': calculated offer ceiling $'+analysis.mao.toLocaleString()+', set stage to '+lead.stage+', created follow-up. No external action was sent.');
    }else{
      if(!demoStages.includes(String(body.stage)))throw Error('Choose a valid stage.');
      lead.stage=String(body.stage);lead.note=text(body.note,2000);lead.asking=amount(body.asking);lead.arv=amount(body.arv);lead.repairs=amount(body.repairs);log('Updated '+lead.name);
    }
  }else if(body.action==='addTask'){
    const task=text(body.text,500);if(!task)throw Error('Enter a follow-up.');if(state.tasks.length>=100)throw Error('This demo supports up to 100 tasks.');state.tasks.push({id,text:task,done:false});log('Added follow-up');
  }else if(body.action==='toggleTask'){
    const task=state.tasks.find(x=>x.id===body.id);if(!task)throw Error('Follow-up not found.');task.done=!task.done;log(task.done?'Completed follow-up':'Reopened follow-up');
  }else throw Error('Unsupported demonstration action.');
  return state;
}

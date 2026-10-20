import {test,expect} from '@playwright/test';
const suite=process.env.PARKRIGHT_SUITE,stub=suite==='stub',a2=suite==='a2';
const provider=stub?'a0-test-stub':a2?'a2-fasterrcnn':'a0-nvidia-ssd300';
const detectorName=stub?'test stub':a2?'A2 Faster R-CNN':'A0 NVIDIA SSD300';
const api='http://127.0.0.1:8422';
const FACT_FIELDS=['available_spaces','distance_m','facility_id','is_simulated','name','observed_at','occupancy_percentage','status','total_spaces','traffic','walking_minutes'];
const parked=['A1','A3','B2','B5'];

test(`DEMO (${provider}): simulator → detector → calibrated occupancy → driver → state-grounded recommendation`,async({page,context,request})=>{
 await page.goto(`/#seed=4242&env=clear_day&occ=${parked.map(s=>`${s}.0`).join(',')}`);
 await page.waitForSelector('body[data-lab-ready="1"]');
 await expect.poll(async()=>(await (await request.get(`${api}/api/v1/health`)).json()).inference.inference_ready,{timeout:60_000}).toBe(true);
 const driver=await context.newPage();
 const clientFacts:string[]=[];
 driver.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/recommendation')) clientFacts.push(`${new URL(r.url()).pathname} ${r.postData()??''}`);});
 await driver.goto('http://127.0.0.1:5188');
 await driver.getByRole('button',{name:/ParkRight Virtual Garage/}).click();
 await expect(driver.getByTestId('detector-status')).toContainText(`detector: ${detectorName} · ready`);
 await expect(driver.getByTestId('detector-status')).toContainText('OPEN disabled');
 await expect(driver.getByTestId('recommender-status')).toContainText('nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B via nebius-token-factory');

 const sent=page.waitForResponse(r=>r.url().endsWith('/frames')&&r.request().method()==='POST');
 await page.getByTestId('send-frame').click();
 const frame=await sent;expect(frame.status()).toBe(202);
 const body=await frame.json();
 expect(body.model.provider).toBe(provider);
 expect(body.observations.some((o:any)=>o.state==='OPEN'),'OPEN is disabled').toBe(false);
 const occupied=body.observations.filter((o:any)=>o.state==='OCCUPIED').map((o:any)=>o.space_id).sort();
 if(a2) expect(occupied).toEqual(parked);
 if(stub) expect(occupied).toEqual(['A1']);
 for(const o of body.observations) {
   const state=o.state==='OCCUPIED'?'Occupied':'Uncertain';
   await expect(driver.locator('svg title').filter({hasText:new RegExp(`^${o.space_id}: ${state}`)})).toHaveCount(1);
 }
 await expect(driver.getByText('No space is confirmed available right now.')).toBeVisible();

 const advice=driver.waitForResponse(r=>r.url().endsWith('/facilities/garage-01/recommendation'));
 await driver.getByRole('button',{name:'Get recommendation'}).click();
 const reply=await advice;expect(reply.status()).toBe(200);
 const {facts,result}=await reply.json();
 // The browser sent no facts; the API assembled exactly these from its own state.
 expect(clientFacts).toEqual(['/api/v1/facilities/garage-01/recommendation ']);
 expect(facts.facilities).toHaveLength(1);
 const f=facts.facilities[0];
 expect(Object.keys(f).sort()).toEqual(FACT_FIELDS);
 expect(f).toMatchObject({facility_id:'garage-01',total_spaces:12,available_spaces:0,occupancy_percentage:null,walking_minutes:null,distance_m:null,traffic:'unknown',status:'unknown',is_simulated:true});
 expect(JSON.stringify(facts)).not.toMatch(/truth|ground|vehicle|nonce|seed/i);
 // No confirmed OPEN space exists, so no availability is fabricated and Nemotron is not asked.
 expect(result.facility_id).toBeNull();
 expect(result.provenance).toMatchObject({status:'fallback',attempted:false,fallback_reason:'no_confirmed_availability',model:'nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B'});
 await expect(driver.getByTestId('recommendation')).toContainText('No fresh, confirmed availability was provided.');
 await expect(driver.getByTestId('recommendation-source')).toContainText('Local fallback — not a Nemotron recommendation (no space is confirmed available, so Nemotron was not asked)');
 await driver.screenshot({path:`experiments/vertical-slice/runs/demo-${suite??'real'}-driver.png`,fullPage:true});
});

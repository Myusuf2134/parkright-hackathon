import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
const stub=process.env.PARKRIGHT_SUITE==='stub',a2=process.env.PARKRIGHT_SUITE==='a2';
const mode=stub?'STUB INTEGRATION':a2?'REAL A2 INTEGRATION':'REAL NVIDIA INTEGRATION';
const api='http://127.0.0.1:8422';
const headers={authorization:'Bearer integration-local-test-token'};

test(`${mode}: renderer → authenticated API → calibrated provider → WebSocket → driver`,async({page,context,request})=>{
 await page.goto('/#seed=4242&env=clear_day&occ=A1.0,A3.0,B2.0,B5.0');
 await page.waitForSelector('body[data-lab-ready="1"]');
 await expect.poll(async()=>{const h=await request.get(`${api}/api/v1/health`);return (await h.json()).inference.inference_ready;}).toBe(true);
 await expect(page.getByTestId('inference-readiness')).toContainText('ready');
 const driver=await context.newPage();await driver.goto('http://127.0.0.1:5188');
 await driver.getByRole('button',{name:/ParkRight Virtual Garage/}).click();
 const messages:any[]=[];
 driver.on('websocket',socket=>socket.on('framereceived',e=>{try{messages.push(JSON.parse(String(e.payload)));}catch{}}));
 await driver.reload();await driver.getByRole('button',{name:/ParkRight Virtual Garage/}).click();
 const response=page.waitForResponse(r=>r.url().endsWith('/frames')&&r.request().method()==='POST');
 await page.getByTestId('send-frame').click();
 const r=await response;expect(r.status()).toBe(202);
 const body=await r.json();expect(body.observations).toHaveLength(12);
 expect(body.model.provider).toBe(stub?'a0-test-stub':a2?'a2-fasterrcnn':'a0-nvidia-ssd300');
 expect(body.observations.every((o:any)=>['OPEN','OCCUPIED','UNCERTAIN'].includes(o.state))).toBe(true);
 await expect.poll(()=>messages.some(m=>m.type==='occupancy_update'&&m.frame.seq===body.seq)).toBe(true);
 await expect(driver.getByText(new RegExp(body.model.provider))).toBeVisible();
 for(const o of body.observations) {
   const state=o.state==='OCCUPIED'?'Occupied':o.state==='OPEN'?'Open':'Uncertain';
   await expect(driver.locator('svg title').filter({hasText:new RegExp(`^${o.space_id}: ${state}`)})).toHaveCount(1);
 }
 const d=await (await request.get(`${api}/api/v1/perception/status`,{headers})).json();
 expect(d.error).toBeNull();expect(d.timings.inference_ms).toBeGreaterThan(0);expect(d.model_loaded).toBe(true);expect(d.calibration.version).toBe('cam-01-fixed-v1');
 expect(d.thresholds.allow_open).toBe(false);
 const forbidden=await request.post(`${api}/api/v1/cameras/cam-01/calibration`,{data:{session_id:'unauthenticated',version:d.calibration.version,pose:d.calibration.pose}});
 expect(forbidden.status()).toBe(401);
 await expect(page.getByTestId('export-evaluation')).toContainText('1 frames');
 const data=await page.evaluate(()=> (window as any).__visionLab.streamer.dataset.snapshot());
 const folder=`experiments/vertical-slice/runs/${stub?'stub':a2?'real-a2':'real'}`;mkdirSync(folder,{recursive:true});
 writeFileSync(`${folder}/dataset.json`,JSON.stringify(data,null,2));
 writeFileSync(`${folder}/diagnostics.json`,JSON.stringify(d,null,2));
 await driver.screenshot({path:`${folder}/driver.png`});
 await page.screenshot({path:`${folder}/simulator.png`,fullPage:true});
 if(stub) expect(body.observations.find((o:any)=>o.space_id==='A1').state).toBe('OCCUPIED');
 // Transport succeeds independently of accuracy. The separate real-positive gate is strict.
});

test(`${mode}: positive vehicle and correct calibrated-space gate`,async({request,page})=>{
 test.skip(stub,'real-model gate never substitutes the stub');
 await page.goto('/#seed=4242&env=clear_day&occ=A1.0,A3.0,B2.0,B5.0');
 await page.waitForSelector('body[data-lab-ready="1"]');
 await expect(page.getByTestId('inference-readiness')).toContainText('ready');
 const frame=page.waitForResponse(r=>r.url().endsWith('/frames')&&r.request().method()==='POST');
 await page.getByTestId('send-frame').click();expect((await frame).status()).toBe(202);
 const d=await (await request.get(`${api}/api/v1/perception/status`,{headers})).json();
 const vehicles=d.detections.filter((v:any)=>['car','truck','bus'].includes(v.label)&&v.confidence>=.65);
 expect(vehicles.length,'REAL MODEL ACCURACY LIMITATION: no strong vehicle detection on controlled rendered scene').toBeGreaterThan(0);
 const occupancy=await (await request.get(`${api}/api/v1/facilities/garage-01/spaces`)).json();
 const occupied=occupancy.spaces.filter((s:any)=>s.current_state==='OCCUPIED').map((s:any)=>s.space_id);
 expect(occupied.length).toBeGreaterThan(0);
 expect(occupied.every((id:string)=>['A1','A3','B2','B5'].includes(id))).toBe(true);
});

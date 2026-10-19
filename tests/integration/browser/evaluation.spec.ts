import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
const api='http://127.0.0.1:8422',headers={authorization:'Bearer integration-local-test-token'};
const spaces=['A1','A2','A3','A4','A5','A6','B1','B2','B3','B4','B5','B6'];

test('REAL NVIDIA: export settled scenarios and sustained attempted capture rates',async({page,request})=>{
 test.skip(process.env.PARKRIGHT_SUITE==='stub','evaluation never uses stubs');
 test.setTimeout(300_000);
 const frameTimes=new Map<string,number>();let wsLatencies:number[]=[];
 page.on('request',r=>{if(r.url().endsWith('/frames')) {const text=r.postDataBuffer()?.toString('utf8')??'';const found=text.match(/\{"session_id"[^\r\n]+\}/);if(found){const m=JSON.parse(found[0]);frameTimes.set(`${m.session_id}:${m.seq}`,Date.parse(m.captured_at));}}});
 page.on('websocket',socket=>socket.on('framereceived',e=>{try{const m=JSON.parse(String(e.payload));if(m.type==='occupancy_update'&&m.frame){const t=frameTimes.get(`${m.frame.session_id}:${m.frame.seq}`);if(t) wsLatencies.push(Date.now()-t);}}catch{}}));
 await page.goto('/');await page.waitForSelector('body[data-lab-ready="1"]');
 await expect.poll(async()=> (await (await request.get(`${api}/api/v1/health`)).json()).inference.inference_ready).toBe(true);
 await expect(page.getByTestId('inference-readiness')).toContainText('ready');
 const manifest:any={run_started_at:new Date().toISOString(),mode:'REAL NVIDIA',settled:true,scenarios:[],performance:[],limitations:['small diagnostic set, not held-out accuracy validation']};
 for(const seed of [4242,777]) for(const preset of ['clear_day','night']) for(const count of [0,4,10,12]) {
   await page.evaluate(({seed,preset,count,spaces})=>{const {lab,streamer}=(window as any).__visionLab;
     lab.world.pause();lab.world.load({...lab.world.spec,seed,preset,occupancy:Object.fromEntries(spaces.slice(0,count).map(s=>[s,0]))});
     streamer.newSession();lab.sync();
   },{seed,preset,count,spaces});
   const entry=await page.evaluate(()=> (window as any).__visionLab.streamer.captureAndSend());
   expect(entry.status).toBe('accepted');
   manifest.scenarios.push({id:`seed-${seed}-${preset}-${count}`,session_id:entry.sessionId,seq:entry.seq,category:'settled'});
 }
 // A real opaque object is rendered in front of bays. Truth is unchanged.
 await page.evaluate(async()=>{const modulePath='/src/evaluation/scenarios.ts';const {occlude}=await import(modulePath);const v=(window as any).__visionLab;
   v.lab.world.setPreset('clear_day');v.streamer.newSession();v.removeOccluder=occlude(v.lab);});
 const occluded=await page.evaluate(()=> (window as any).__visionLab.streamer.captureAndSend());
 expect(occluded.status).toBe('accepted');
 manifest.scenarios.push({id:'occlusion-full-day',session_id:occluded.sessionId,seq:occluded.seq,category:'occlusion'});
 await page.evaluate(()=> (window as any).__visionLab.removeOccluder());
 // Deliberately changed mount must be rejected, not scored with old polygons.
 const mismatch=await page.evaluate(async()=>{const {lab,streamer}=(window as any).__visionLab;const original=structuredClone(lab.world.spec.camera);
   lab.world.setCamera({...original,yaw:original.yaw+15});const result=await streamer.captureAndSend();
   const detail=streamer.log[0].detail;lab.world.setCamera(original);return {result,detail};});
 expect(mismatch.result).toBeNull();expect(mismatch.detail).toContain('CALIBRATION MISMATCH');
 manifest.difficult_viewpoint={outcome:'rejected',detail:mismatch.detail,reason:'pose has no matching calibration; not an accuracy sample'};
 // Movement is a separate evaluation category.
 await page.evaluate(()=>{const {lab,streamer}=(window as any).__visionLab;lab.world.pause();lab.world.clearAll();lab.world.play();lab.world.park('A1');lab.world.step();lab.world.pause();streamer.newSession();});
 const moving=await page.evaluate(()=> (window as any).__visionLab.streamer.captureAndSend());
 expect(moving.status).toBe('accepted');
 manifest.scenarios.push({id:'arrival-transition',session_id:moving.sessionId,seq:moving.seq,category:'transition'});
 const evalData=await page.evaluate(()=> (window as any).__visionLab.streamer.dataset.snapshot());
 const folder='experiments/vertical-slice/runs/evaluation';mkdirSync(folder,{recursive:true});
 writeFileSync(`${folder}/dataset.json`,JSON.stringify(evalData));
 for(const rate of [1,2,5]) {
   await page.evaluate(()=>{const {lab,streamer}=(window as any).__visionLab;lab.world.pause();lab.world.fillAll();streamer.newSession();streamer.dataset.records=[];streamer.skippedTicks=0;});
   const responseTimes:number[]=[];let requests=0;
   const onRequest=(r:any)=>{if(r.url().endsWith('/frames')) requests++;};
   const onResponse=(r:any)=>{if(r.url().endsWith('/frames')&&r.status()===202) responseTimes.push(Date.now());};
   page.on('request',onRequest);page.on('response',onResponse);
   wsLatencies=[];
   const start=Date.now();await page.evaluate(rate=>(window as any).__visionLab.streamer.setRate(rate),rate);
   await page.waitForTimeout(30_000);await page.evaluate(()=>(window as any).__visionLab.streamer.setRate(0));
   await expect.poll(()=>page.evaluate(()=> (window as any).__visionLab.streamer.inFlight)).toBe(false);
   const elapsed=(Date.now()-start)/1000;
   page.off('request',onRequest);page.off('response',onResponse);
   const data=await page.evaluate(()=>({data:(window as any).__visionLab.streamer.dataset.snapshot(),skipped:(window as any).__visionLab.streamer.skippedTicks}));
   const latencies=data.data.records.map((r:any)=>r.latency_ms).sort((a:number,b:number)=>a-b);
   const diagnostics=await (await request.get(`${api}/api/v1/perception/status`,{headers})).json();
   wsLatencies.sort((a,b)=>a-b);
   manifest.performance.push({capture_to_browser_ws_mean_ms:wsLatencies.reduce((a,b)=>a+b,0)/wsLatencies.length,capture_to_browser_ws_p95_ms:wsLatencies[Math.ceil(wsLatencies.length*.95)-1],attempted_fps:rate,duration_s:elapsed,requests,accepted:responseTimes.length,
      accepted_fps:responseTimes.length/elapsed,skipped_ticks:data.skipped,failed_requests:requests-responseTimes.length,
      mean_pipeline_ms:latencies.reduce((a:number,b:number)=>a+b,0)/latencies.length,p95_pipeline_ms:latencies[Math.ceil(latencies.length*.95)-1],
      peak_api_rss_mb:diagnostics.process_peak_rss_mb,cold_warmup_ms:diagnostics.startup_ms});
   writeFileSync(`${folder}/rate-${rate}.json`,JSON.stringify(data.data));
 }
 writeFileSync(`${folder}/manifest.json`,JSON.stringify(manifest,null,2));
});

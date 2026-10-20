import {defineConfig} from '@playwright/test';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const stub=process.env.PARKRIGHT_SUITE==='stub';
export default defineConfig({
 testDir:resolve(root,'tests/integration/browser'),timeout:240_000,workers:1,
 outputDir:resolve(root,'experiments/vertical-slice/runs/browser-artifacts'),
 reporter:[['list']],
 use:{baseURL:'http://127.0.0.1:5198',viewport:{width:1600,height:1000},launchOptions:{args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']}},
 webServer:[
  {command:stub?'uv run --frozen --all-packages --all-extras python tests/integration/stub_api.py':'scripts/integration/api.sh',cwd:root,url:'http://127.0.0.1:8422/api/v1/health',env:{PARKRIGHT_PERCEPTION_PROVIDER:process.env.PARKRIGHT_SUITE==='a2'?'a2':'a0',PARKRIGHT_PORT:'8422',PARKRIGHT_INGEST_TOKEN:'integration-local-test-token',PARKRIGHT_EVALUATION_ENABLED:'true'},timeout:60_000,reuseExistingServer:false},
  {command:'npm run dev -w @parkright/simulator -- --port 5198',cwd:root,url:'http://127.0.0.1:5198',env:{PARKRIGHT_API_URL:'http://127.0.0.1:8422',PARKRIGHT_INGEST_TOKEN:'integration-local-test-token'},reuseExistingServer:false},
  {command:'npm run dev -w @parkright/web -- --host 127.0.0.1 --port 5188',cwd:root,url:'http://127.0.0.1:5188',env:{PARKRIGHT_API_URL:'http://127.0.0.1:8422'},reuseExistingServer:false}
 ]
});

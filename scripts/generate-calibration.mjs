// Static geometry only. Never import World, vehicles, labels, or evaluation state.
import { readFileSync, writeFileSync } from 'node:fs';
import { PerspectiveCamera, Vector3 } from 'three';
import { DEFAULT_POSE, poseEuler } from '../apps/simulator/src/camera/pose.ts';
const fixture = JSON.parse(readFileSync(new URL('../packages/shared/fixtures/mvp-facility.json', import.meta.url)));
const pose = DEFAULT_POSE;
const camera = new PerspectiveCamera(pose.fov, pose.width / pose.height, 0.1, 400);
camera.position.set(...pose.position);
camera.rotation.set(...poseEuler(pose), 'YXZ');
camera.updateProjectionMatrix(); camera.updateMatrixWorld();
const polygons = {};
const unobservable = [];
for (const space of fixture.spaces) {
  const {x,y,w,h} = space.plan;
  const projected = [[x,y],[x+w,y],[x+w,y+h],[x,y+h]].map(([px,py]) => new Vector3(px*20, 0.025, py*20).project(camera));
  if (projected.some(p => p.z < -1 || p.z > 1 || Math.abs(p.x)>1 || Math.abs(p.y)>1)) {
    unobservable.push(space.space_id);
  } else polygons[space.space_id] = projected.map(p => ({x: Number(((p.x+1)/2).toFixed(9)), y:Number(((1-p.y)/2).toFixed(9))}));
}
const calibration = {version:'cam-01-fixed-v1', camera_id:'cam-01', pose, projection:'Three.js PerspectiveCamera / YXZ / ground y=0.025m', polygons, unobservable};
const outputs = [
  ['../packages/shared/calibration/cam-01.json', calibration],
  ['../packages/shared/calibration/facility.json', {...fixture, cameras: fixture.cameras.map(c=>({...c,polygons}))}],
];
for (const [name,data] of outputs) {
  const path=new URL(name,import.meta.url), text=JSON.stringify(data,null,2)+'\n';
  if (process.argv.includes('--check')) { if(readFileSync(path,'utf8')!==text) throw Error(`calibration drift: ${name}`); }
  else writeFileSync(path,text);
}
console.log(`${Object.keys(polygons).length} observable calibrated spaces; unobservable: ${unobservable.join(',') || 'none'}`);

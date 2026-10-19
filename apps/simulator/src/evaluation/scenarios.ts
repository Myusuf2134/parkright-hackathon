/** Evaluation-only static occluder. Changes rendered pixels, never detector outputs. */
import {BoxGeometry,Mesh,MeshStandardMaterial} from 'three';
import type {Lab} from '../lab.ts';
export function occlude(lab:Lab) {
 const mesh=new Mesh(new BoxGeometry(5,3,1),new MeshStandardMaterial({color:'#676767'}));
 mesh.position.set(10,1.5,18);lab.root.add(mesh);lab.sync();
 return ()=>{lab.root.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();};
}

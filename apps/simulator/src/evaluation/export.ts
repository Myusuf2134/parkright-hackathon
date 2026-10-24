/** Evaluation-only artifact collector. Nothing here feeds the uploader or detector. */
import type { FrameMetadata, FrameIngestResult } from '@parkright/contracts';
import type { CapturedFrame } from '../lab.ts';
import { toGroundTruthRecord } from './groundTruth.ts';

export class DatasetExport {
  records: unknown[]=[];
  omitted=0;
  async add(frame: CapturedFrame, metadata: FrameMetadata, result: FrameIngestResult, scenario: object, diagnostics: unknown, latencyMs: number) {
    if(this.records.length>=200) { this.omitted++; return; }
    const bytes=new Uint8Array(await frame.jpeg.arrayBuffer());
    let binary=''; for(const byte of bytes) binary+=String.fromCharCode(byte);
    this.records.push({metadata,predictions:result.observations,outcome:result.outcome,
      ground_truth:toGroundTruthRecord(metadata,frame.truth),scenario,
      jpeg_base64:btoa(binary),diagnostics,latency_ms:latencyMs});
  }
  snapshot() { return {schema:'parkright-evaluation-v1',description:'EVALUATION ONLY — truth never supplied to perception',omitted:this.omitted,records:this.records}; }
  download() {
    const url=URL.createObjectURL(new Blob([JSON.stringify(this.snapshot())],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='parkright-evaluation.json';a.click();URL.revokeObjectURL(url);
  }
}

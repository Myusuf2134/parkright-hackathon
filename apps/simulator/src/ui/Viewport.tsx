import { OrbitControls } from '@react-three/drei';
import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { ACESFilmicToneMapping, PCFShadowMap, SRGBColorSpace, Vector3 } from 'three';
import { OPERATOR_LAYER } from '../scene/layers.ts';
import { BAYS, insideBay } from '../sim/facility.ts';
import { useLab, useTicker, useVersion } from './context.ts';

export interface OverlayToggles {
  labels: boolean;
  outlines: boolean;
  truth: boolean;
  frustum: boolean;
  stats: boolean;
}

function Engine({ overlays }: { overlays: OverlayToggles }) {
  const { lab } = useLab();
  const { scene, camera, gl } = useThree();

  useEffect(() => {
    camera.layers.enable(OPERATOR_LAYER);
    lab.attach(scene);
    document.body.dataset.labReady = '1';
  }, [lab, scene, camera]);

  useEffect(() => {
    lab.overlayOptions = { outlines: overlays.outlines, truth: overlays.truth, frustum: overlays.frustum };
  }, [lab, overlays]);

  useFrame((_, delta) => {
    gl.toneMappingExposure = lab.presetExposure;
    lab.tick(delta * 1000, performance.now());
  }, -1);

  return null;
}

/**
 * Bay labels are plain DOM buttons positioned by projecting each bay through the
 * operator camera every frame. They are never part of any WebGL scene.
 */
function LabelProjector({ labels, fps }: { labels: Map<string, HTMLElement>; fps: HTMLElement | null }) {
  const { camera, size } = useThree();
  const v = useRef(new Vector3());
  const counter = useRef({ frames: 0, since: performance.now() });
  useFrame(() => {
    for (const b of BAYS) {
      const el = labels.get(b.spaceId);
      if (!el) continue;
      v.current.set(b.x, 0.2, b.z + b.opensTo * (b.depth / 2 - 0.6)).project(camera);
      const visible = v.current.z < 1;
      el.style.display = visible ? '' : 'none';
      el.style.transform = `translate(-50%, -50%) translate(${((v.current.x + 1) / 2) * size.width}px, ${((1 - v.current.y) / 2) * size.height}px)`;
    }
    const c = counter.current;
    c.frames++;
    const now = performance.now();
    if (fps && now - c.since > 500) {
      fps.textContent = `${Math.round((c.frames * 1000) / (now - c.since))} FPS · operator view`;
      c.frames = 0;
      c.since = now;
    }
  });
  return null;
}

export function Viewport({ overlays }: { overlays: OverlayToggles }) {
  const { lab } = useLab();
  useVersion(lab.world);
  useTicker(300);
  const labels = useRef(new Map<string, HTMLElement>()).current;
  const [fps, setFps] = useState<HTMLElement | null>(null);
  const truth = new Map(lab.world.truth().spaces.map((s) => [s.space_id, s.truth]));
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    const bay = BAYS.find((b) => insideBay(b, e.point.x, e.point.z));
    if (bay) {
      e.stopPropagation();
      lab.world.select(bay.spaceId);
    }
  };
  return (
    <>
      <Canvas
        shadows={{ type: PCFShadowMap }}
        camera={{ position: [27, 17, 30], fov: 45, near: 0.1, far: 600 }}
        gl={{ antialias: true, outputColorSpace: SRGBColorSpace, toneMapping: ACESFilmicToneMapping }}
        onPointerMissed={() => lab.world.select(null)}
      >
        <Engine overlays={overlays} />
        <primitive object={lab.root} onClick={onClick} />
        <LabelProjector labels={labels} fps={fps} />
        <OrbitControls target={[10, 0, 11]} maxPolarAngle={Math.PI / 2.1} minDistance={6} maxDistance={110} enableDamping />
      </Canvas>
      <div className="label-layer" style={{ display: overlays.labels ? '' : 'none' }}>
        {BAYS.map((b) => (
          <button
            key={b.spaceId}
            ref={(el) => {
              if (el) labels.set(b.spaceId, el);
              else labels.delete(b.spaceId);
            }}
            className={`bay-label${lab.world.selected === b.spaceId ? ' selected' : ''}${overlays.truth ? ` truth-${truth.get(b.spaceId)}` : ''}`}
            onClick={() => lab.world.select(b.spaceId)}
            onDoubleClick={() => (b.spaceId in lab.world.spec.occupancy ? lab.world.remove(b.spaceId) : lab.world.park(b.spaceId))}
          >
            {b.spaceId}
          </button>
        ))}
      </div>
      {overlays.stats && <div className="fps" ref={setFps} />}
    </>
  );
}

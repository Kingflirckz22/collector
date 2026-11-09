import * as THREE from "three";
const C = { pending: 0xc9c3ff, active: 0x4f8cff, bad: 0xff8a5c, done: 0x35c78a };

export function initScene(canvas) {
  const r = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  r.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 50); cam.position.z = 8;
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9c6ff, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(3, 5, 6); scene.add(sun);

  const geos = [new THREE.IcosahedronGeometry(0.5, 1), new THREE.TorusGeometry(0.4, 0.15, 12, 32), new THREE.OctahedronGeometry(0.5)];
  const pal = [0xffd6e8, 0xd6e4ff, 0xd9f7e8, 0xfff0c9];
  const floaters = Array.from({ length: 14 }, (_, i) => {
    const m = new THREE.Mesh(geos[i % 3], new THREE.MeshStandardMaterial({ color: pal[i % 4], roughness: 0.35 }));
    m.position.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 9, -2 - Math.random() * 5);
    m.userData = { s: 0.2 + Math.random() * 0.4, p: Math.random() * 6 };
    scene.add(m); return m;
  });
  const orbs = [0, 1, 2].map(i => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.42, 32, 32), new THREE.MeshStandardMaterial({ color: C.pending, roughness: 0.25 }));
    m.position.set((i - 1) * 1.5, 2.9, 0); scene.add(m); return m;
  });

  let done = [false, false, false], active = -1, good = true;
  const tc = new THREE.Color(), clock = new THREE.Clock();

  function resize() { r.setSize(innerWidth, innerHeight, false); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); }
  addEventListener("resize", resize); resize();
  addEventListener("pointermove", e => { cam.position.x = (e.clientX / innerWidth - 0.5) * 1.2; cam.lookAt(0, 0, 0); });

  (function tick() {
    const t = clock.getElapsedTime();
    floaters.forEach(m => { m.rotation.x += 0.003; m.rotation.y += 0.004; m.position.y += Math.sin(t * m.userData.s + m.userData.p) * 0.002; });
    orbs.forEach((o, i) => {
      tc.setHex(done[i] ? C.done : i === active ? (good ? C.active : C.bad) : C.pending);
      o.material.color.lerp(tc, 0.1);
      const s = i === active ? 1.15 + Math.sin(t * 4) * 0.08 : 1;
      o.scale.setScalar(o.scale.x + (s - o.scale.x) * 0.1);
      o.rotation.y += 0.02;
    });
    r.render(scene, cam); requestAnimationFrame(tick);
  })();

  return { set(d, a) { done = d; active = a; }, mood(g) { good = g; } };
}
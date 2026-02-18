/**
 * SunSetter AQM+ — Landing Page Engine
 * Three.js (3D schema graph + particles) + GSAP (scroll animations)
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

// ─────────────────────────────────────────────────────────────────────────────
// THREE.JS SCENE
// ─────────────────────────────────────────────────────────────────────────────

const canvas = document.getElementById('bg-canvas');
const W = () => window.innerWidth;
const H = () => window.innerHeight;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(W(), H());
renderer.setClearColor(0x000000, 0);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(65, W() / H(), 0.1, 500);
camera.position.set(0, 0, 18);

// Post-processing: bloom pass for the neon glow
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(W(), H()),
  0.85,   // strength
  0.5,    // radius
  0.2     // threshold — low = more things glow
);
composer.addPass(bloomPass);

// ── Color palette ──
const COLORS = {
  orange: new THREE.Color(0xff6b35),
  pink:   new THREE.Color(0xff3864),
  purple: new THREE.Color(0x9b4dca),
  blue:   new THREE.Color(0x3b82f6),
  cyan:   new THREE.Color(0x06b6d4),
};

// ── Database schema graph ──
// Positions arranged as a rough ER diagram in 3D space
const TABLE_NODES = [
  { name: 'users',         pos: [0, 0, 0],      color: COLORS.orange },
  { name: 'organizations', pos: [4, 1.5, -1],   color: COLORS.blue },
  { name: 'products',      pos: [-4, 1, -1],    color: COLORS.cyan },
  { name: 'orders',        pos: [2.5, -2, 1],   color: COLORS.pink },
  { name: 'sessions',      pos: [-2, -1.8, 1],  color: COLORS.purple },
  { name: 'reviews',       pos: [0.5, 2.5, -2], color: COLORS.orange },
  { name: 'payments',      pos: [4, -1, 2],     color: COLORS.cyan },
  { name: 'categories',    pos: [-3.5, -2, -1.5],color: COLORS.blue },
  { name: 'tags',          pos: [-1, 3, 1],     color: COLORS.pink },
];

const EDGES = [
  [0, 1], [0, 2], [0, 3], [0, 4], [0, 5],
  [1, 3], [2, 3], [3, 6], [2, 7], [2, 8],
];

const graphGroup = new THREE.Group();
scene.add(graphGroup);

// Node meshes (icosahedra with inner glow sphere)
const nodeObjects = [];
const nodeGeo = new THREE.IcosahedronGeometry(0.22, 1);

for (const node of TABLE_NODES) {
  const mat = new THREE.MeshStandardMaterial({
    color: node.color,
    emissive: node.color,
    emissiveIntensity: 0.6,
    metalness: 0.8,
    roughness: 0.2,
  });
  const mesh = new THREE.Mesh(nodeGeo, mat);
  mesh.position.set(...node.pos);
  graphGroup.add(mesh);

  // Outer glow sphere (additive blending)
  const glowGeo = new THREE.SphereGeometry(0.45, 8, 8);
  const glowMat = new THREE.MeshBasicMaterial({
    color: node.color,
    transparent: true,
    opacity: 0.06,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const glow = new THREE.Mesh(glowGeo, glowMat);
  glow.position.copy(mesh.position);
  graphGroup.add(glow);

  nodeObjects.push({ mesh, glow, baseColor: node.color, baseIntensity: 0.6 });
}

// Edge lines
const edgeMat = new THREE.LineBasicMaterial({
  color: 0xff6b35,
  transparent: true,
  opacity: 0.18,
  blending: THREE.AdditiveBlending,
});

for (const [a, b] of EDGES) {
  const posA = new THREE.Vector3(...TABLE_NODES[a].pos);
  const posB = new THREE.Vector3(...TABLE_NODES[b].pos);
  const points = [];
  // Bezier curve for organic-looking edges
  const mid = posA.clone().lerp(posB, 0.5);
  mid.x += (Math.random() - 0.5) * 0.8;
  mid.y += (Math.random() - 0.5) * 0.8;
  mid.z += (Math.random() - 0.5) * 0.8;
  const curve = new THREE.QuadraticBezierCurve3(posA, mid, posB);
  const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(20));
  const line = new THREE.Line(geo, edgeMat.clone());
  graphGroup.add(line);
}

// ── Data particles (stream of tiny dots flowing in scene) ──
const PARTICLE_COUNT = 4000;
const particlePositions = new Float32Array(PARTICLE_COUNT * 3);
const particleColors    = new Float32Array(PARTICLE_COUNT * 3);
const particleVelocities = [];

const accentPalette = [COLORS.orange, COLORS.pink, COLORS.purple, COLORS.blue, COLORS.cyan];

for (let i = 0; i < PARTICLE_COUNT; i++) {
  const r = 25 + Math.random() * 20;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.random() * Math.PI;
  particlePositions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
  particlePositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
  particlePositions[i * 3 + 2] = r * Math.cos(phi);

  const col = accentPalette[Math.floor(Math.random() * accentPalette.length)];
  const brightness = 0.1 + Math.random() * 0.3;
  particleColors[i * 3]     = col.r * brightness;
  particleColors[i * 3 + 1] = col.g * brightness;
  particleColors[i * 3 + 2] = col.b * brightness;

  // Each particle drifts toward the center (data flowing in)
  const speed = 0.003 + Math.random() * 0.005;
  particleVelocities.push({
    dx: -particlePositions[i * 3]     * speed * 0.01,
    dy: -particlePositions[i * 3 + 1] * speed * 0.01,
    dz: -particlePositions[i * 3 + 2] * speed * 0.01,
  });
}

const particleGeo = new THREE.BufferGeometry();
particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
particleGeo.setAttribute('color',    new THREE.BufferAttribute(particleColors, 3));

const particleMat = new THREE.PointsMaterial({
  size: 0.08,
  vertexColors: true,
  transparent: true,
  opacity: 0.7,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  sizeAttenuation: true,
});

const particles = new THREE.Points(particleGeo, particleMat);
scene.add(particles);

// ── Ambient + directional light ──
scene.add(new THREE.AmbientLight(0x080810, 3));
const dirLight = new THREE.DirectionalLight(0xff6b35, 2);
dirLight.position.set(5, 5, 5);
scene.add(dirLight);

// ── Mouse tracking for parallax ──
let mouse = { x: 0, y: 0 };
let targetMouse = { x: 0, y: 0 };
document.addEventListener('mousemove', (e) => {
  targetMouse.x = (e.clientX / W() - 0.5) * 2;
  targetMouse.y = -(e.clientY / H() - 0.5) * 2;
});

// ── Resize handler ──
window.addEventListener('resize', () => {
  camera.aspect = W() / H();
  camera.updateProjectionMatrix();
  renderer.setSize(W(), H());
  composer.setSize(W(), H());
  bloomPass.resolution.set(W(), H());
});

// ── Scroll tracking ──
let scrollProgress = 0;
window.addEventListener('scroll', () => {
  scrollProgress = window.scrollY / (document.body.scrollHeight - window.innerHeight);
});

// ── Animation loop ──
let t = 0;
function animate() {
  requestAnimationFrame(animate);
  t += 0.008;

  // Smooth mouse lerp
  mouse.x += (targetMouse.x - mouse.x) * 0.05;
  mouse.y += (targetMouse.y - mouse.y) * 0.05;

  // Graph group: slow rotation + mouse parallax tilt
  graphGroup.rotation.y += 0.003;
  graphGroup.rotation.x = Math.sin(t * 0.4) * 0.06 + mouse.y * 0.08;
  graphGroup.rotation.z = mouse.x * 0.04;

  // Camera drift based on scroll & mouse
  camera.position.x += (mouse.x * 1.2 - camera.position.x) * 0.03;
  camera.position.y += (mouse.y * 0.8 - camera.position.y) * 0.03;
  camera.position.z = 18 + scrollProgress * 6; // pull back as user scrolls
  camera.lookAt(0, 0, 0);

  // Node pulse animation
  nodeObjects.forEach((n, i) => {
    const pulse = Math.sin(t * 1.2 + i * 0.7) * 0.15 + 0.85;
    n.mesh.material.emissiveIntensity = n.baseIntensity * pulse;
    n.glow.material.opacity = 0.04 + pulse * 0.04;
    n.mesh.rotation.x += 0.006;
    n.mesh.rotation.y += 0.004;
  });

  // Particle drift (toward center then reset)
  const pos = particleGeo.attributes.position.array;
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    pos[i * 3]     += particleVelocities[i].dx;
    pos[i * 3 + 1] += particleVelocities[i].dy;
    pos[i * 3 + 2] += particleVelocities[i].dz;

    // If particle gets too close to center, teleport it back to the edge
    const dist = Math.sqrt(
      pos[i * 3] ** 2 + pos[i * 3 + 1] ** 2 + pos[i * 3 + 2] ** 2
    );
    if (dist < 2) {
      const r = 25 + Math.random() * 20;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
    }
  }
  particleGeo.attributes.position.needsUpdate = true;

  // Bloom strength reacts to scroll section
  bloomPass.strength = 0.85 + Math.sin(t * 0.5) * 0.1;

  composer.render();
}
animate();

// ─────────────────────────────────────────────────────────────────────────────
// GSAP SCROLL ANIMATIONS
// ─────────────────────────────────────────────────────────────────────────────

const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;

if (gsap && ScrollTrigger) {
  gsap.registerPlugin(ScrollTrigger);

  // .reveal-up elements
  document.querySelectorAll('.reveal-up').forEach((el, i) => {
    ScrollTrigger.create({
      trigger: el,
      start: 'top 88%',
      onEnter: () => {
        gsap.to(el, {
          opacity: 1,
          y: 0,
          duration: 0.8,
          delay: i * 0.05,
          ease: 'power3.out',
        });
        el.classList.add('in-view');
      },
      once: true,
    });
  });

  // .reveal-card elements with staggered delay based on data-i
  document.querySelectorAll('.reveal-card').forEach((el) => {
    const delay = parseFloat(el.getAttribute('data-i') || '0') * 0.07;
    ScrollTrigger.create({
      trigger: el,
      start: 'top 90%',
      onEnter: () => {
        gsap.to(el, {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.6,
          delay,
          ease: 'back.out(1.2)',
        });
        el.classList.add('in-view');
      },
      once: true,
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TERMINAL ANIMATION
// ─────────────────────────────────────────────────────────────────────────────

const termLines = document.querySelectorAll('.tline:not(.show)');
let termStarted = false;

function startTerminal() {
  if (termStarted) return;
  termStarted = true;
  termLines.forEach((line) => {
    const delay = parseInt(line.getAttribute('data-delay') || '0');
    setTimeout(() => {
      line.classList.add('show');
    }, delay);
  });
}

// Start terminal when it enters viewport
const termObserver = new IntersectionObserver((entries) => {
  if (entries[0].isIntersecting) startTerminal();
}, { threshold: 0.2 });

const termEl = document.getElementById('terminal-output');
if (termEl) termObserver.observe(termEl);

// ─────────────────────────────────────────────────────────────────────────────
// CUSTOM CURSOR
// ─────────────────────────────────────────────────────────────────────────────

const cursor = document.getElementById('cursor');
const trail  = document.getElementById('cursor-trail');

if (cursor && trail) {
  let cx = 0, cy = 0;
  document.addEventListener('mousemove', (e) => {
    cx = e.clientX; cy = e.clientY;
    cursor.style.left = cx + 'px';
    cursor.style.top  = cy + 'px';
  });
  // Trail follows with CSS transition — set via style for smooth lag effect
  document.addEventListener('mousemove', (e) => {
    setTimeout(() => {
      trail.style.left = e.clientX + 'px';
      trail.style.top  = e.clientY + 'px';
    }, 40);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// COPY BUTTON
// ─────────────────────────────────────────────────────────────────────────────

const copyBtn = document.getElementById('copy-btn');
const installCmd = document.getElementById('install-cmd');

if (copyBtn && installCmd) {
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(installCmd.textContent.trim());
      copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`;
      setTimeout(() => {
        copyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;
      }, 1500);
    } catch {}
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SMOOTH SCROLL FOR NAV LINKS
// ─────────────────────────────────────────────────────────────────────────────

document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
  anchor.addEventListener('click', (e) => {
    const target = document.querySelector(anchor.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth' });
    }
  });
});

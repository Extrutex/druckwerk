// Druckwerk instant quote engine
// Parses STL / OBJ / 3MF fully client-side, renders a Three.js preview,
// estimates print time + price and drives the inquiry form.
// No file data leaves the browser until the user submits the inquiry form.

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Configuration — tune business numbers here.
  // ---------------------------------------------------------------------------

  // Build volume of the largest machine in the fleet (Voron 350), millimetres.
  const BUILD_VOLUME = { x: 350, y: 350, z: 300 };

  const MAX_FILE_MB = 50; // matches upload policy on 3d-windt.de
  const NETLIFY_ATTACH_LIMIT_MB = 8; // Netlify Forms file upload limit

  // Charged material rates (€/kg) already include handling and waste.
  // Densities in g/cm³. Technical data mirrors the 3D-WINDT material table.
  const MATERIALS = [
    {
      id: 'pla', name: 'PLA', category: 'Standard', density: 1.24, pricePerKg: 39,
      tensile: '50–70 MPa', uv: 'Gering', props: 'Steif, maßhaltig, einfach — ideal für Optik & Konzept',
      uses: 'Prototypen, Anschauungsmodelle, Lehren',
    },
    {
      id: 'petg', name: 'PETG', category: 'Standard-Tech', density: 1.27, pricePerKg: 42,
      tensile: '40–55 MPa', uv: 'Mittel', props: 'Zäher Allrounder, witterungsbeständig',
      uses: 'Funktionsbauteile, Halterungen, Außenbereich',
    },
    {
      id: 'abs', name: 'ABS', category: 'Technisch', density: 1.04, pricePerKg: 49,
      tensile: '30–45 MPa', uv: 'Gering', props: 'Schlagfest, hitzebeständig, gut nachbearbeitbar',
      uses: 'Gehäuse, Automotive, mechanische Belastung',
    },
    {
      id: 'asa', name: 'ASA', category: 'Technisch', density: 1.07, pricePerKg: 55,
      tensile: '35–50 MPa', uv: 'Exzellent', props: 'Wie ABS, aber extrem UV- & witterungsbeständig',
      uses: 'Außenbauteile, Verkleidungen, Marine',
    },
    {
      id: 'tpu', name: 'TPU', category: 'Spezial', density: 1.21, pricePerKg: 69,
      tensile: '20–40 MPa', uv: 'Gut', props: 'Elastisch, gummiartig, extrem abriebfest',
      uses: 'Dichtungen, Dämpfer, Schutzkappen',
    },
    {
      id: 'pa', name: 'PA (Nylon)', category: 'Engineering', density: 1.14, pricePerKg: 89,
      tensile: '60–85 MPa', uv: 'Gut', props: 'Extrem zäh, abriebfest, geringe Reibung',
      uses: 'Zahnräder, Lager, Funktionsbauteile',
    },
    {
      id: 'pc', name: 'PC (Polycarbonat)', category: 'Engineering', density: 1.20, pricePerKg: 89,
      tensile: '60–75 MPa', uv: 'Gut', props: 'Extrem schlagfest, hohe Temperaturbeständigkeit',
      uses: 'Schutzabdeckungen, hochbelastete Gehäuse',
    },
    {
      id: 'petcf', name: 'PET-CF', category: 'High-Performance', density: 1.29, pricePerKg: 119,
      tensile: '70–90 MPa', uv: 'Exzellent', props: 'Carbonfaserverstärkt: extrem steif, leicht, maßhaltig',
      uses: 'Leichtbau, Drohnen, Motorsport, Strukturteile',
    },
  ];

  // Effective average deposition rate (mm³/s) per layer height, including
  // travel/accel overhead on the CoreXY fleet.
  const QUALITIES = [
    { id: 'q010', label: '0,10 mm — Fein', layer: 0.1, flow: 4.5 },
    { id: 'q015', label: '0,15 mm — Detail', layer: 0.15, flow: 7 },
    { id: 'q020', label: '0,20 mm — Standard', layer: 0.2, flow: 10 },
    { id: 'q028', label: '0,28 mm — Schnell/Robust', layer: 0.28, flow: 14 },
  ];

  const INFILLS = [
    { id: 'i25', label: '25 % — Standard', fraction: 0.25 },
    { id: 'i50', label: '50 % — Verstärkt', fraction: 0.5 },
    { id: 'i75', label: '75 % — Hochfest', fraction: 0.75 },
    { id: 'i100', label: '100 % — Vollmaterial', fraction: 1.0 },
  ];

  const SPEEDS = [
    { id: 'eco', label: 'Eco', days: '7–9 Werktage', factor: 0.9 },
    { id: 'standard', label: 'Standard', days: '3–5 Werktage', factor: 1.0 },
    { id: 'express', label: 'Express', days: '1–2 Werktage', factor: 1.35 },
  ];

  const PRICING = {
    setupFee: 15,          // € per position: technical review, prep, QA
    machineRate: 7.5,      // € per machine hour
    heatupMinutes: 12,     // fixed machine overhead per job
    wallThickness: 1.2,    // mm, assumed shell for effective volume
    minOrder: 39,          // € minimum order value (net)
    vatNote: 'zzgl. USt., sofern anfallend',
    qtyDiscounts: [        // applied to unit price, not to setup fee
      { min: 100, discount: 0.30 },
      { min: 50, discount: 0.25 },
      { min: 25, discount: 0.18 },
      { min: 10, discount: 0.10 },
      { min: 5, discount: 0.05 },
    ],
  };

  const CONTACT = {
    email: 'support@3d-windt.de',
    phone: '+49 1512 5534623',
    company: '3D-Windt GbR',
  };

  // ---------------------------------------------------------------------------
  // Utilities
  // ---------------------------------------------------------------------------

  const $ = (id) => document.getElementById(id);
  const eur = (n) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })
    .format(Number.isFinite(n) ? n : 0);
  const fmt = (n, digits = 1) => new Intl.NumberFormat('de-DE', {
    maximumFractionDigits: digits,
  }).format(Number.isFinite(n) ? n : 0);

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // ---------------------------------------------------------------------------
  // Mesh parsing
  // ---------------------------------------------------------------------------

  // All parsers return { positions: Float32Array (n*9), triangles: n }

  function parseSTL(buffer) {
    const view = new DataView(buffer);
    if (buffer.byteLength < 84) throw new Error('Datei zu klein für STL.');
    const triCount = view.getUint32(80, true);
    const expected = 84 + triCount * 50;
    if (expected === buffer.byteLength) return parseBinarySTL(view, triCount);
    // Heuristic: ASCII STL starts with "solid" and is valid UTF-8 text.
    const head = new TextDecoder().decode(buffer.slice(0, 512)).trim().toLowerCase();
    if (head.startsWith('solid')) return parseAsciiSTL(buffer);
    // Some binary STLs have broken length fields; try binary anyway.
    if (triCount > 0 && expected <= buffer.byteLength) return parseBinarySTL(view, triCount);
    throw new Error('STL-Format nicht erkannt.');
  }

  function parseBinarySTL(view, triCount) {
    const positions = new Float32Array(triCount * 9);
    let offset = 84;
    for (let i = 0; i < triCount; i++) {
      offset += 12; // skip normal
      for (let j = 0; j < 9; j++) {
        positions[i * 9 + j] = view.getFloat32(offset, true);
        offset += 4;
      }
      offset += 2; // attribute byte count
    }
    return { positions, triangles: triCount };
  }

  function parseAsciiSTL(buffer) {
    const text = new TextDecoder().decode(buffer);
    const verts = [];
    const re = /vertex\s+([-\d.eE+]+)\s+([-\d.eE+]+)\s+([-\d.eE+]+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      verts.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
    }
    if (verts.length < 9 || verts.length % 9 !== 0) {
      throw new Error('ASCII-STL unvollständig.');
    }
    return { positions: new Float32Array(verts), triangles: verts.length / 9 };
  }

  function parseOBJ(buffer) {
    const text = new TextDecoder().decode(buffer);
    const v = [];
    const faces = [];
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (t.startsWith('v ')) {
        const p = t.split(/\s+/);
        v.push([parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])]);
      } else if (t.startsWith('f ')) {
        const idx = t.split(/\s+/).slice(1).map((tok) => {
          let i = parseInt(tok.split('/')[0], 10);
          if (i < 0) i = v.length + i + 1;
          return i - 1;
        });
        for (let i = 1; i < idx.length - 1; i++) faces.push([idx[0], idx[i], idx[i + 1]]);
      }
    }
    if (!faces.length) throw new Error('OBJ enthält keine Flächen.');
    const positions = new Float32Array(faces.length * 9);
    faces.forEach((f, i) => {
      for (let j = 0; j < 3; j++) {
        const p = v[f[j]];
        if (!p) throw new Error('OBJ-Index außerhalb des Bereichs.');
        positions.set(p, i * 9 + j * 3);
      }
    });
    return { positions, triangles: faces.length };
  }

  // Minimal ZIP reader (enough for 3MF): central directory + deflate-raw.
  async function unzipEntry(buffer, matcher) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    // Locate End Of Central Directory record.
    let eocd = -1;
    for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65558); i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('3MF/ZIP: Verzeichnis nicht gefunden.');
    const count = view.getUint16(eocd + 10, true);
    let ptr = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (view.getUint32(ptr, true) !== 0x02014b50) throw new Error('3MF/ZIP: defekter Eintrag.');
      const method = view.getUint16(ptr + 10, true);
      const compSize = view.getUint32(ptr + 20, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const localOffset = view.getUint32(ptr + 42, true);
      const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
      ptr += 46 + nameLen + extraLen + commentLen;
      if (!matcher(name)) continue;
      // Local file header: variable name/extra lengths.
      const lNameLen = view.getUint16(localOffset + 26, true);
      const lExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const raw = bytes.subarray(dataStart, dataStart + compSize);
      if (method === 0) return raw.slice().buffer;
      if (method === 8) {
        if (typeof DecompressionStream === 'undefined') {
          throw new Error('Dein Browser kann 3MF nicht entpacken — bitte STL hochladen.');
        }
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([raw]).stream().pipeThrough(ds);
        return await new Response(stream).arrayBuffer();
      }
      throw new Error('3MF/ZIP: nicht unterstützte Kompression.');
    }
    throw new Error('3MF: kein Modell in der Datei gefunden.');
  }

  const UNIT_TO_MM = {
    micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000,
  };

  async function parse3MF(buffer) {
    const xmlBuf = await unzipEntry(buffer, (name) => name.toLowerCase().endsWith('.model'));
    const xml = new DOMParser().parseFromString(new TextDecoder().decode(xmlBuf), 'application/xml');
    if (xml.querySelector('parsererror')) throw new Error('3MF: XML fehlerhaft.');
    const model = xml.querySelector('model');
    const scale = UNIT_TO_MM[(model && model.getAttribute('unit')) || 'millimeter'] || 1;
    const meshes = xml.querySelectorAll('object > mesh');
    if (!meshes.length) throw new Error('3MF enthält kein Netz (nur Verweise?).');
    const chunks = [];
    let triTotal = 0;
    meshes.forEach((mesh) => {
      const vs = [];
      mesh.querySelectorAll('vertices > vertex').forEach((vx) => {
        vs.push([
          parseFloat(vx.getAttribute('x')) * scale,
          parseFloat(vx.getAttribute('y')) * scale,
          parseFloat(vx.getAttribute('z')) * scale,
        ]);
      });
      const tris = mesh.querySelectorAll('triangles > triangle');
      const positions = new Float32Array(tris.length * 9);
      let i = 0;
      tris.forEach((tr) => {
        ['v1', 'v2', 'v3'].forEach((a, j) => {
          const p = vs[parseInt(tr.getAttribute(a), 10)];
          positions.set(p, i * 9 + j * 3);
        });
        i++;
      });
      triTotal += tris.length;
      chunks.push(positions);
    });
    const positions = new Float32Array(triTotal * 9);
    let off = 0;
    chunks.forEach((c) => { positions.set(c, off); off += c.length; });
    return { positions, triangles: triTotal };
  }

  // ---------------------------------------------------------------------------
  // Geometry analysis
  // ---------------------------------------------------------------------------

  function analyzeMesh(mesh) {
    const p = mesh.positions;
    let vol6 = 0;
    let area2 = 0;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < p.length; i += 9) {
      const ax = p[i], ay = p[i + 1], az = p[i + 2];
      const bx = p[i + 3], by = p[i + 4], bz = p[i + 5];
      const cx = p[i + 6], cy = p[i + 7], cz = p[i + 8];
      // Signed tetrahedron volume against origin.
      vol6 += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
      // Triangle area via cross product magnitude.
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      area2 += Math.sqrt(nx * nx + ny * ny + nz * nz);
      minX = Math.min(minX, ax, bx, cx); maxX = Math.max(maxX, ax, bx, cx);
      minY = Math.min(minY, ay, by, cy); maxY = Math.max(maxY, ay, by, cy);
      minZ = Math.min(minZ, az, bz, cz); maxZ = Math.max(maxZ, az, bz, cz);
    }
    const volumeMm3 = Math.abs(vol6) / 6;
    const areaMm2 = area2 / 2;
    const size = { x: maxX - minX, y: maxY - minY, z: maxZ - minZ };
    // Orientation-independent fit check: sorted part dims vs sorted build dims.
    const dims = [size.x, size.y, size.z].sort((a, b) => a - b);
    const build = [BUILD_VOLUME.x, BUILD_VOLUME.y, BUILD_VOLUME.z].sort((a, b) => a - b);
    const fits = dims.every((d, i) => d <= build[i]);
    return {
      volumeCm3: volumeMm3 / 1000,
      areaCm2: areaMm2 / 100,
      size,
      fits,
      triangles: mesh.triangles,
    };
  }

  // ---------------------------------------------------------------------------
  // Pricing
  // ---------------------------------------------------------------------------

  function computeQuote(analysis, opts) {
    const mat = MATERIALS.find((m) => m.id === opts.materialId) || MATERIALS[0];
    const quality = QUALITIES.find((q) => q.id === opts.qualityId) || QUALITIES[2];
    const infill = INFILLS.find((f) => f.id === opts.infillId) || INFILLS[0];
    const speed = SPEEDS.find((s) => s.id === opts.speedId) || SPEEDS[1];
    const qty = Math.max(1, Math.round(opts.qty || 1));

    const solidMm3 = analysis.volumeCm3 * 1000;
    const shellMm3 = Math.min(solidMm3, analysis.areaCm2 * 100 * PRICING.wallThickness);
    const effMm3 = Math.min(solidMm3, shellMm3 + (solidMm3 - shellMm3) * infill.fraction);

    const weightG = (effMm3 / 1000) * mat.density;
    const printHours = effMm3 / quality.flow / 3600 + PRICING.heatupMinutes / 60;

    const materialCost = (weightG / 1000) * mat.pricePerKg;
    const machineCost = printHours * PRICING.machineRate;

    let unit = (materialCost + machineCost) * speed.factor;
    const discount = PRICING.qtyDiscounts.find((d) => qty >= d.min);
    const discountPct = discount ? discount.discount : 0;
    unit *= 1 - discountPct;

    let total = unit * qty + PRICING.setupFee;
    const minApplied = total < PRICING.minOrder;
    if (minApplied) total = PRICING.minOrder;

    return {
      mat, quality, infill, speed, qty,
      weightG, printHours, materialCost, machineCost,
      unit, discountPct, setupFee: PRICING.setupFee,
      total, minApplied,
    };
  }

  // ---------------------------------------------------------------------------
  // Three.js viewer
  // ---------------------------------------------------------------------------

  let viewer = null;

  function initViewer(container) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf1f5f9);

    const camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
    camera.position.set(420, 320, 420);
    camera.up.set(0, 0, 1);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    container.appendChild(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x99a3b0, 0.9));
    const dir = new THREE.DirectionalLight(0xffffff, 0.7);
    dir.position.set(1, -1.5, 2);
    scene.add(dir);

    // Build plate + build volume of the Voron 350 fleet.
    const grid = new THREE.GridHelper(BUILD_VOLUME.x, 14, 0x94a3b8, 0xcbd5e1);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);
    const boxGeo = new THREE.BoxGeometry(BUILD_VOLUME.x, BUILD_VOLUME.y, BUILD_VOLUME.z);
    const boxEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(boxGeo),
      new THREE.LineBasicMaterial({ color: 0x0f766e, transparent: true, opacity: 0.35 }),
    );
    boxEdges.position.set(0, 0, BUILD_VOLUME.z / 2);
    scene.add(boxEdges);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(0, 0, 40);

    function resize() {
      const w = container.clientWidth;
      const h = container.clientHeight || 380;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    new ResizeObserver(resize).observe(container);
    resize();

    function animate() {
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    }
    animate();

    return { scene, camera, controls, mesh: null };
  }

  function showMesh(positions) {
    const container = $('quoteViewer');
    if (!container) return;
    if (!viewer) viewer = initViewer(container);
    if (viewer.mesh) {
      viewer.scene.remove(viewer.mesh);
      viewer.mesh.geometry.dispose();
      viewer.mesh.material.dispose();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const center = new THREE.Vector3();
    bb.getCenter(center);
    const material = new THREE.MeshStandardMaterial({
      color: 0x0f766e, metalness: 0.05, roughness: 0.55,
      flatShading: positions.length / 9 < 150000,
    });
    const mesh = new THREE.Mesh(geometry, material);
    // Center on plate, bottom on Z=0.
    mesh.position.set(-center.x, -center.y, -bb.min.z);
    viewer.scene.add(mesh);
    viewer.mesh = mesh;

    // Frame the part.
    const radius = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z);
    const dist = Math.max(220, radius * 2.1);
    viewer.camera.position.set(dist, -dist * 0.85, dist * 0.75);
    viewer.controls.target.set(0, 0, (bb.max.z - bb.min.z) / 2);
  }

  // ---------------------------------------------------------------------------
  // UI state + rendering
  // ---------------------------------------------------------------------------

  const state = {
    file: null,       // File object (for optional form attach)
    fileName: '',
    analysis: null,
    materialId: 'petg',
    qualityId: 'q020',
    infillId: 'i25',
    speedId: 'standard',
    qty: 1,
  };

  function renderMaterialCards() {
    const wrap = $('materialCards');
    if (!wrap) return;
    wrap.innerHTML = MATERIALS.map((m) => {
      const active = m.id === state.materialId ? ' active' : '';
      let priceLine = '';
      if (state.analysis) {
        const q = computeQuote(state.analysis, { ...state, materialId: m.id });
        priceLine = `<p class="mat-price">${eur(q.unit)} / Stück</p>`;
      }
      return `
        <button type="button" class="mat-card${active}" data-mat="${m.id}" role="radio" aria-checked="${active ? 'true' : 'false'}">
          <span class="mat-head"><strong>${esc(m.name)}</strong><span class="mat-cat">${esc(m.category)}</span></span>
          <span class="mat-meta">Zugfestigkeit ${esc(m.tensile)} · UV ${esc(m.uv)}</span>
          <span class="mat-props">${esc(m.props)}</span>
          ${priceLine}
        </button>`;
    }).join('');
    wrap.querySelectorAll('[data-mat]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.materialId = btn.dataset.mat;
        renderMaterialCards();
        renderQuote();
      });
    });
  }

  function renderAnalysis() {
    const box = $('analysisChips');
    if (!box || !state.analysis) return;
    const a = state.analysis;
    const fitChip = a.fits
      ? '<span class="chip chip-ok">✓ Passt in den Bauraum (350 × 350 × 300 mm)</span>'
      : '<span class="chip chip-warn">⚠ Größer als der Bauraum — Teilung/Anfrage nötig</span>';
    box.innerHTML = `
      <span class="chip">${esc(state.fileName)}</span>
      <span class="chip">${fmt(a.size.x, 1)} × ${fmt(a.size.y, 1)} × ${fmt(a.size.z, 1)} mm</span>
      <span class="chip">Volumen ${fmt(a.volumeCm3, 1)} cm³</span>
      <span class="chip">${new Intl.NumberFormat('de-DE').format(a.triangles)} Dreiecke</span>
      ${fitChip}`;
  }

  function renderQuote() {
    const box = $('quoteResult');
    if (!box) return;
    if (!state.analysis) {
      box.innerHTML = '<p class="calc-note">Lade ein Bauteil hoch, um den Richtpreis zu sehen.</p>';
      return;
    }
    const q = computeQuote(state.analysis, state);
    const speed = q.speed;
    const rows = [
      ['Material (' + esc(q.mat.name) + ', ~' + fmt(q.weightG, 0) + ' g)', eur(q.materialCost)],
      ['Maschinenzeit (~' + fmt(q.printHours, 1) + ' h)', eur(q.machineCost)],
    ];
    if (speed.factor !== 1) rows.push([`Lieferzeit ${esc(speed.label)} (${speed.factor > 1 ? '+' : ''}${Math.round((speed.factor - 1) * 100)} %)`, null]);
    if (q.discountPct > 0) rows.push([`Mengenrabatt ab ${q.qty} Stück`, `−${Math.round(q.discountPct * 100)} %`]);

    box.innerHTML = `
      <div class="calc-headline">
        <p class="calc-label">Richtpreis gesamt (${q.qty} ${q.qty === 1 ? 'Stück' : 'Stück'}, netto)</p>
        <p class="calc-price">${eur(q.total)}</p>
        <p class="quote-unit">${eur(q.unit)} / Stück · zzgl. einmalig ${eur(q.setupFee)} Rüst- & Prüfpauschale${q.minApplied ? ' · Mindestbestellwert ' + eur(PRICING.minOrder) : ''}</p>
      </div>
      <div class="calc-breakdown">
        ${rows.map(([l, v]) => `<div class="calc-row"><span>${l}</span><span>${v === null ? 'eingerechnet' : v}</span></div>`).join('')}
        <div class="calc-divider"></div>
        <div class="calc-row"><span>Lieferzeit</span><span>${esc(speed.days)}</span></div>
      </div>
      <p class="calc-note">Sofort-Richtpreis, ${PRICING.vatNote}. Verbindliches Angebot nach technischer
      Prüfung — Antwort in der Regel <strong>unter 24 h</strong> (werktags).</p>
      <div class="cta-stack">
        <a class="btn btn-primary" href="#anfrage" id="quoteToForm" data-track-cta="quote_to_form">Verbindliches Angebot anfordern</a>
        <button class="btn btn-secondary" type="button" id="quotePrint" data-track-cta="quote_print">Richtpreis als PDF</button>
      </div>`;

    const printBtn = $('quotePrint');
    if (printBtn) printBtn.addEventListener('click', () => printQuote(q));
    syncFormSummary(q);
  }

  function buildSummary(q) {
    const a = state.analysis;
    return [
      `Datei: ${state.fileName}`,
      `Maße: ${fmt(a.size.x, 1)} × ${fmt(a.size.y, 1)} × ${fmt(a.size.z, 1)} mm`,
      `Volumen: ${fmt(a.volumeCm3, 2)} cm³`,
      `Material: ${q.mat.name}`,
      `Schichthöhe: ${q.quality.label}`,
      `Füllung: ${q.infill.label}`,
      `Stückzahl: ${q.qty}`,
      `Lieferzeit: ${q.speed.label} (${q.speed.days})`,
      `Richtpreis: ${eur(q.total)} netto (${eur(q.unit)}/Stück + ${eur(q.setupFee)} Rüstpauschale)`,
    ].join('\n');
  }

  function syncFormSummary(q) {
    const summary = $('quoteSummaryField');
    if (summary) summary.value = buildSummary(q);
    const preview = $('quoteSummaryPreview');
    if (preview) preview.textContent = buildSummary(q);
    const mailto = $('quoteMailto');
    if (mailto) {
      mailto.href = 'mailto:' + CONTACT.email
        + '?subject=' + encodeURIComponent('Anfrage 3D-Druck: ' + state.fileName)
        + '&body=' + encodeURIComponent('Hallo 3D-WINDT Team,\n\nbitte um ein verbindliches Angebot:\n\n'
          + buildSummary(q) + '\n\n(Datei hänge ich dieser E-Mail an.)\n\nViele Grüße');
    }
  }

  function printQuote(q) {
    const node = $('printQuote');
    if (!node) return;
    const a = state.analysis;
    const today = new Date().toLocaleDateString('de-DE');
    node.innerHTML = `
      <div class="pq-head">
        <h1>Richtpreis – 3D-Druck</h1>
        <p>Datum: ${today} · Druckwerk / ${esc(CONTACT.company)}</p>
      </div>
      <table class="pq-table">
        <tbody>
          <tr><td>Bauteil</td><td>${esc(state.fileName)}</td></tr>
          <tr><td>Maße</td><td>${fmt(a.size.x, 1)} × ${fmt(a.size.y, 1)} × ${fmt(a.size.z, 1)} mm</td></tr>
          <tr><td>Material</td><td>${esc(q.mat.name)} (${esc(q.mat.category)})</td></tr>
          <tr><td>Schichthöhe / Füllung</td><td>${esc(q.quality.label)} / ${esc(q.infill.label)}</td></tr>
          <tr><td>Stückzahl</td><td>${q.qty}</td></tr>
          <tr><td>Lieferzeit</td><td>${esc(q.speed.label)} (${esc(q.speed.days)})</td></tr>
          <tr><td>Preis pro Stück (netto)</td><td>${eur(q.unit)}</td></tr>
          <tr><td>Rüst- & Prüfpauschale</td><td>${eur(q.setupFee)}</td></tr>
        </tbody>
        <tfoot>
          <tr><td>Richtpreis gesamt (netto)</td><td>${eur(q.total)}</td></tr>
        </tfoot>
      </table>
      <p class="pq-foot">Unverbindlicher Richtpreis, ${PRICING.vatNote}. Verbindliches Angebot nach technischer Prüfung.
      Kontakt: ${esc(CONTACT.email)} · ${esc(CONTACT.phone)}</p>`;
    node.setAttribute('aria-hidden', 'false');
    window.print();
  }

  // ---------------------------------------------------------------------------
  // File handling
  // ---------------------------------------------------------------------------

  async function handleFile(file) {
    const status = $('uploadStatus');
    const errBox = $('uploadError');
    if (errBox) errBox.textContent = '';
    if (!file) return;
    if (file.size > MAX_FILE_MB * 1024 * 1024) {
      if (errBox) errBox.textContent = `Datei größer als ${MAX_FILE_MB} MB — bitte per E-Mail an ${CONTACT.email} senden.`;
      return;
    }
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (['step', 'stp', 'iges', 'igs'].includes(ext)) {
      if (errBox) {
        errBox.textContent = 'STEP/IGES analysieren wir manuell — nutze das Anfrageformular unten oder sende die Datei an '
          + CONTACT.email + '. Für den Sofort-Richtpreis bitte STL, 3MF oder OBJ hochladen.';
      }
      state.file = file;
      state.fileName = file.name;
      const attach = $('quoteFileInput');
      if (attach && file.size <= NETLIFY_ATTACH_LIMIT_MB * 1024 * 1024) {
        const dt = new DataTransfer();
        dt.items.add(file);
        attach.files = dt.files;
      }
      return;
    }
    if (!['stl', 'obj', '3mf'].includes(ext)) {
      if (errBox) errBox.textContent = 'Format nicht unterstützt. Sofort-Analyse: STL, 3MF, OBJ. Manuell: STEP/STP.';
      return;
    }
    if (status) status.textContent = 'Analysiere ' + file.name + ' …';
    try {
      const buffer = await file.arrayBuffer();
      let mesh;
      if (ext === 'stl') mesh = parseSTL(buffer);
      else if (ext === 'obj') mesh = parseOBJ(buffer);
      else mesh = await parse3MF(buffer);
      applyMesh(mesh, file.name, file);
      if (status) status.textContent = '';
    } catch (e) {
      if (status) status.textContent = '';
      if (errBox) errBox.textContent = 'Analyse fehlgeschlagen: ' + (e && e.message ? e.message : 'Unbekannter Fehler')
        + ' — sende die Datei gern direkt an ' + CONTACT.email + '.';
    }
  }

  function applyMesh(mesh, name, file) {
    const analysis = analyzeMesh(mesh);
    if (!Number.isFinite(analysis.volumeCm3) || analysis.volumeCm3 <= 0.001) {
      const errBox = $('uploadError');
      if (errBox) errBox.textContent = 'Das Netz hat kein messbares Volumen (offene Flächen?). Bitte prüfen oder per E-Mail senden.';
      return;
    }
    state.analysis = analysis;
    state.fileName = name;
    state.file = file || null;

    const stage = $('quoteStage');
    if (stage) stage.hidden = false;
    showMesh(mesh.positions);
    renderAnalysis();
    renderMaterialCards();
    renderQuote();
    const attach = $('quoteFileInput');
    if (attach) {
      if (file && file.size <= NETLIFY_ATTACH_LIMIT_MB * 1024 * 1024) {
        const dt = new DataTransfer();
        dt.items.add(file);
        attach.files = dt.files;
      } else {
        attach.value = '';
      }
    }
    const stageEl = $('quoteStage');
    if (stageEl && typeof stageEl.scrollIntoView === 'function') {
      stageEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  // 20 mm calibration-cube style demo part (binary STL built in memory).
  function demoMesh() {
    const s = 20;
    const v = [
      [0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0],
      [0, 0, s], [s, 0, s], [s, s, s], [0, s, s],
    ];
    const faces = [
      [0, 2, 1], [0, 3, 2], // bottom
      [4, 5, 6], [4, 6, 7], // top
      [0, 1, 5], [0, 5, 4],
      [1, 2, 6], [1, 6, 5],
      [2, 3, 7], [2, 7, 6],
      [3, 0, 4], [3, 4, 7],
    ];
    const positions = new Float32Array(faces.length * 9);
    faces.forEach((f, i) => {
      for (let j = 0; j < 3; j++) positions.set(v[f[j]], i * 9 + j * 3);
    });
    return { positions, triangles: faces.length };
  }

  // ---------------------------------------------------------------------------
  // Wiring
  // ---------------------------------------------------------------------------

  function init() {
    const dropzone = $('dropzone');
    const fileInput = $('fileInput');
    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
    });
    ['dragenter', 'dragover'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    }));
    ['dragleave', 'drop'].forEach((ev) => dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    }));
    dropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      handleFile(file);
    });
    fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

    const demoBtn = $('demoPart');
    if (demoBtn) demoBtn.addEventListener('click', () => applyMesh(demoMesh(), 'beispiel-wuerfel-20mm.stl', null));

    // Option selects
    const qualitySel = $('qualitySelect');
    const infillSel = $('infillSelect');
    const qtyInput = $('qtyInput');
    if (qualitySel) {
      qualitySel.innerHTML = QUALITIES.map((q) => `<option value="${q.id}"${q.id === state.qualityId ? ' selected' : ''}>${q.label}</option>`).join('');
      qualitySel.addEventListener('change', () => { state.qualityId = qualitySel.value; renderMaterialCards(); renderQuote(); });
    }
    if (infillSel) {
      infillSel.innerHTML = INFILLS.map((f) => `<option value="${f.id}"${f.id === state.infillId ? ' selected' : ''}>${f.label}</option>`).join('');
      infillSel.addEventListener('change', () => { state.infillId = infillSel.value; renderMaterialCards(); renderQuote(); });
    }
    if (qtyInput) {
      qtyInput.addEventListener('input', () => { state.qty = parseInt(qtyInput.value, 10) || 1; renderMaterialCards(); renderQuote(); });
    }
    const speedWrap = $('speedOptions');
    if (speedWrap) {
      speedWrap.innerHTML = SPEEDS.map((s) => `
        <label class="speed-option${s.id === state.speedId ? ' active' : ''}">
          <input type="radio" name="speed" value="${s.id}"${s.id === state.speedId ? ' checked' : ''} />
          <strong>${s.label}</strong><span>${s.days}</span>
        </label>`).join('');
      speedWrap.querySelectorAll('input[name="speed"]').forEach((r) => {
        r.addEventListener('change', () => {
          state.speedId = r.value;
          speedWrap.querySelectorAll('.speed-option').forEach((l) => l.classList.toggle('active', l.querySelector('input').checked));
          renderMaterialCards();
          renderQuote();
        });
      });
    }

    renderMaterialCards();
    renderQuote();

    // Inquiry form: AJAX submit to Netlify Forms, redirect to /danke/.
    const form = $('quoteForm');
    const errNode = $('quoteFormError');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (errNode) errNode.textContent = '';
        const btn = form.querySelector('button[type="submit"]');
        if (btn) btn.disabled = true;
        try {
          const fd = new FormData(form);
          const fileEl = $('quoteFileInput');
          const f = fileEl && fileEl.files && fileEl.files[0];
          if (f && f.size > NETLIFY_ATTACH_LIMIT_MB * 1024 * 1024) {
            fd.delete('file');
            fd.set('file_note', `Datei ${f.name} > ${NETLIFY_ATTACH_LIMIT_MB} MB — wird per E-Mail nachgereicht.`);
          }
          const res = await fetch('/', { method: 'POST', body: fd });
          if (!res.ok) throw new Error('submit failed');
          window.location.href = '/danke/';
        } catch {
          if (errNode) {
            errNode.textContent = 'Senden fehlgeschlagen. Bitte direkt an ' + CONTACT.email + ' mailen — der Button „Anfrage per E-Mail" übernimmt alle Daten.';
          }
        } finally {
          if (btn) btn.disabled = false;
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

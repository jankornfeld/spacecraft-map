/// <reference lib="webworker" />

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("ascii", { fatal: false });
const utf8Decoder = new TextDecoder("utf-8", { fatal: false });

const FIXED_RANDOM_NUMBER = s("FixedRandomNumber\0");
const COMMON_ISLAND = s("CommonIsland\0");
const TERRAINS = s("Terrains\0");
const BOUNDS_SIZE_X = s("BoundsSizeX\0");
const BOUNDS_SIZE_Y = s("BoundsSizeY\0");
const WORLD_LOCATION = s("WorldLocation\0");

const RESOURCE_TOKENS = {
  resourceSpawnPointFamily: s("nameR5BLResourceSpawnPoint"),
  pickupResourceFamily: s("nameR5BLActor_PickupResource"),
  pickupResourceToken: s("PickupResource"),
  damageableFoliageFamily: s("nameR5BLActor_DamageableFoliage"),
  worldLocation: s("WorldLocation\0"),
  tomatoPickupResource: s("PickupResource_Tomato"),
  mushroomPickupResource: s("PickupResource_Mushroom"),
  tomatoSpawner: s("DA_ResSpawner_HL_Tomato"),
  mushroomSpawner: s("DA_ResSpawner_SW_Mushroom"),
  tomatoToken: s("Tomato"),
  mushroomToken: s("Mushroom"),
  tomatoFoliageType: s("FT_SP_Tomato"),
  mushroomFoliageType: s("FT_SP_Mushroom")
};

const SHA256_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
];

interface FileWrapper {
  name: string;
  size: number;
  readBytes: () => Promise<Uint8Array>;
}

interface EvidenceHit {
  fileName: string;
  offset: number;
  context: string[];
}

interface EvidenceSummary {
  tokenLabel: string;
  fileCount: number;
  totalHitCount: number;
  sampleFileNames: string[];
  sampleHits: EvidenceHit[];
}

function s(str: string): Uint8Array {
  return textEncoder.encode(str);
}

function u(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

function c(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function f(value: number): number {
  return Math.round(1e6 * value) / 1e6;
}

function m(bytes: Uint8Array, token: Uint8Array, startOffset: number): number {
  const limit = bytes.length - token.length;
  outer: for (let i = startOffset; i <= limit; i++) {
    for (let j = 0; j < token.length; j++) {
      if (bytes[i + j] !== token[j]) {
        continue outer;
      }
    }
    return i;
  }
  return -1;
}

function* h(bytes: Uint8Array, token: Uint8Array): Generator<number, void, unknown> {
  let offset = 0;
  while (offset < bytes.length) {
    const idx = m(bytes, token, offset);
    if (idx === -1) return;
    yield idx;
    offset = idx + 1;
  }
}

function p(bytes: Uint8Array, byte: number, start: number, end = bytes.length): number {
  for (let i = start; i < end; i++) {
    if (bytes[i] === byte) return i;
  }
  return -1;
}

function isSstFile(file: { name: string }): boolean {
  return file.name.toLowerCase().endsWith(".sst");
}

function isEvidenceFile(file: { name: string }): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".sst") || name.endsWith(".ldb") || name.endsWith(".log") || 
         name === "current" || name === "log" || name.startsWith("manifest-") || 
         name.startsWith("options-") || name.startsWith("log.old");
}

async function getCachedBytes(file: FileWrapper, cache: Map<FileWrapper, Uint8Array>): Promise<Uint8Array> {
  let bytes = cache.get(file);
  if (!bytes) {
    bytes = await file.readBytes();
    cache.set(file, bytes);
  }
  return bytes;
}

function getBoundsSizeVal(bytes: Uint8Array, token: Uint8Array): number | null {
  const idx = m(bytes, token, 0);
  if (idx === -1) return null;
  const start = idx + token.length;
  if (start + 4 > bytes.length) return null;
  return c(bytes, start);
}

function getAsciiStringsInContext(bytes: Uint8Array, start: number, length: number): string[] {
  const low = Math.max(0, start - 256);
  const high = Math.min(bytes.length, start + length + 256);
  const slice = bytes.subarray(low, high);
  
  const strings: string[] = [];
  let buffer = "";
  for (let i = 0; i < slice.length; i++) {
    const charCode = slice[i];
    if (charCode >= 32 && charCode <= 126) {
      buffer += String.fromCharCode(charCode);
      continue;
    }
    if (buffer.length >= 4) {
      strings.push(buffer);
    }
    buffer = "";
  }
  if (buffer.length >= 4) {
    strings.push(buffer);
  }
  return strings.slice(0, 20);
}

function extractWorldLocation(bytes: Uint8Array): { x: number; y: number; z: number } | null {
  const idx = m(bytes, WORLD_LOCATION, 0);
  if (idx === -1) return null;
  const start = idx + WORLD_LOCATION.length;
  if (start + 4 > bytes.length) return null;
  
  const length = c(bytes, start);
  const end = start + length;
  if (length < 4 || end > bytes.length) return null;
  
  const sub = bytes.subarray(start + 4, end);
  let offset = 0;
  let x: number | null = null;
  let y: number | null = null;
  let z: number | null = null;
  
  while (offset + 11 <= sub.length) {
    const type = sub[offset];
    offset += 1;
    const tokenEnd = p(sub, 0, offset, sub.length);
    if (tokenEnd === -1 || tokenEnd + 8 > sub.length) break;
    const name = u(sub.subarray(offset, tokenEnd));
    offset = tokenEnd + 1;
    
    if (type !== 1 || offset + 8 > sub.length) break;
    const val = new DataView(sub.buffer, sub.byteOffset + offset, 8).getFloat64(0, true);
    offset += 8;
    
    if (name === "X") x = val;
    else if (name === "Y") y = val;
    else if (name === "Z") z = val;
  }
  
  if (x === null || y === null || z === null) return null;
  return { x: f(x), y: f(y), z: f(z) };
}

function getTerrainPlacements(bytes: Uint8Array, offset: number): { slot: number; center: { x: number; y: number; z: number }; bounds: { width: number; height: number } }[] | null {
  const start = offset + TERRAINS.length;
  if (start + 4 > bytes.length) return null;
  
  const size = c(bytes, start);
  const dataStart = start + 4;
  const dataEnd = start + size;
  if (size < 4 || dataEnd > bytes.length) return null;
  
  const placements = [];
  let curr = dataStart;
  
  while (curr + 6 <= dataEnd) {
    while (curr < dataEnd && bytes[curr] === 0) {
      curr += 1;
    }
    if (curr + 6 > dataEnd || bytes[curr] !== 3) break;
    
    const tokenEnd = p(bytes, 0, curr + 1, dataEnd);
    if (tokenEnd === -1 || tokenEnd + 5 > dataEnd) break;
    
    const slotStr = u(bytes.subarray(curr + 1, tokenEnd));
    const structSize = c(bytes, tokenEnd + 1);
    const structStart = tokenEnd + 5;
    const structEnd = tokenEnd + 1 + structSize;
    if (structSize < 4 || structEnd > dataEnd) break;
    
    if (/^\d+$/.test(slotStr)) {
      const slot = Number(slotStr);
      const sub = bytes.subarray(structStart, structEnd);
      const sizeX = getBoundsSizeVal(sub, BOUNDS_SIZE_X);
      const sizeY = getBoundsSizeVal(sub, BOUNDS_SIZE_Y);
      const loc = extractWorldLocation(sub);
      
      if (sizeX !== null && sizeY !== null && loc !== null) {
        placements.push({
          slot,
          center: loc,
          bounds: { width: 36 * sizeX, height: 36 * sizeY }
        });
      }
    }
    curr = structEnd;
  }
  
  return placements.length ? placements.sort((a, b) => a.slot - b.slot) : null;
}

function rotateLeft(value: number, shift: number): number {
  return (value >>> shift) | (value << (32 - shift));
}

// Custom pure-JS SHA-256 implementation
function computeSha256(bytes: Uint8Array): string {
  const padded = new Uint8Array(64 * Math.ceil((bytes.length + 9) / 64));
  const w = new Uint32Array(64);
  padded.set(bytes);
  padded[bytes.length] = 128;
  
  const bitLen = 8 * bytes.length;
  const highBits = Math.floor(bitLen / 0x100000000);
  const lowBits = bitLen >>> 0;
  
  padded[padded.length - 8] = highBits >>> 24;
  padded[padded.length - 7] = highBits >>> 16;
  padded[padded.length - 6] = highBits >>> 8;
  padded[padded.length - 5] = highBits;
  padded[padded.length - 4] = lowBits >>> 24;
  padded[padded.length - 3] = lowBits >>> 16;
  padded[padded.length - 2] = lowBits >>> 8;
  padded[padded.length - 1] = lowBits;
  
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  
  for (let chunk = 0; chunk < padded.length; chunk += 64) {
    for (let i = 0; i < 16; i++) {
      const idx = chunk + 4 * i;
      w[i] = (padded[idx] << 24) | (padded[idx + 1] << 16) | (padded[idx + 2] << 8) | padded[idx + 3];
    }
    for (let i = 16; i < 64; i++) {
      const s0 = (rotateLeft(w[i - 15], 7) ^ rotateLeft(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
      const s1 = (rotateLeft(w[i - 2], 17) ^ rotateLeft(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    
    let a = h0, b = h1, c_val = h2, d = h3, e_val = h4, f_val = h5, g = h6, h_val = h7;
    
    for (let i = 0; i < 64; i++) {
      const s1 = (rotateLeft(e_val, 6) ^ rotateLeft(e_val, 11) ^ rotateLeft(e_val, 25)) >>> 0;
      const ch = ((e_val & f_val) ^ (~e_val & g)) >>> 0;
      const temp1 = (h_val + s1 + ch + SHA256_CONSTANTS[i] + w[i]) >>> 0;
      
      const s0 = (rotateLeft(a, 2) ^ rotateLeft(a, 13) ^ rotateLeft(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c_val) ^ (b & c_val)) >>> 0;
      const temp2 = (s0 + maj) >>> 0;
      
      h_val = g;
      g = f_val;
      f_val = e_val;
      e_val = (d + temp1) >>> 0;
      d = c_val;
      c_val = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c_val) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e_val) >>> 0;
    h5 = (h5 + f_val) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h_val) >>> 0;
  }
  
  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map(x => x.toString(16).padStart(8, "0"))
    .join("");
}

async function computeSha256Web(bytes: Uint8Array): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest("SHA-256", bytes as any);
    return Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return computeSha256(bytes);
}

async function generateLayoutFingerprint(files: { name: string; size: number; hash: string }[]): Promise<string> {
  const sortedStr = files
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name) || a.size - b.size || a.hash.localeCompare(b.hash))
    .map(f => `${f.name}\0${f.size}\0${f.hash}`)
    .join("\n");
  return computeSha256Web(s(sortedStr));
}

function formatEvidenceSummary(token: string, state: any): EvidenceSummary {
  const details = state[token];
  const fileNames = Array.from(details.fileNameSet) as string[];
  const sortedFileNames = fileNames.sort((a, b) => a.localeCompare(b)).slice(0, 5);
  return {
    tokenLabel: token,
    fileCount: details.fileNameSet.size,
    totalHitCount: details.totalHitCount,
    sampleFileNames: sortedFileNames,
    sampleHits: details.sampleHits
  };
}

async function processSstScanning(files: FileWrapper[], onProgress?: (p: any) => void) {
  const sortedFiles = files.slice().sort((a, b) => a.name.localeCompare(b.name));
  const sstFiles = sortedFiles.filter(isSstFile);
  const evidenceFiles = sortedFiles.filter(isEvidenceFile);
  
  const byteCache = new Map<FileWrapper, Uint8Array>();
  const fileHashes: { name: string; size: number; hash: string }[] = [];
  const seedHits: { value: number; hex: string; fileName: string; offset: number }[] = [];
  const worldPresets = new Map<string, number>();
  const placementsMap = new Map<string, { count: number; terrainPlacements: any[] }>();
  
  const evidenceState: Record<string, { totalHitCount: number; fileNameSet: Set<string>; sampleHits: EvidenceHit[] }> = {};
  for (const k of Object.keys(RESOURCE_TOKENS)) {
    evidenceState[k] = {
      totalHitCount: 0,
      fileNameSet: new Set<string>(),
      sampleHits: []
    };
  }

  if (sstFiles.length === 0) {
    throw new Error("Select the full world folder or drop one or more .sst files from it.");
  }

  // Phase 1: Hashing & Seed/Terrain placements extraction
  for (let i = 0; i < sstFiles.length; i++) {
    const file = sstFiles[i];
    if (onProgress) {
      onProgress({ phase: "hashing", fileIndex: i, fileCount: sstFiles.length, fileName: file.name });
    }
    
    const bytes = await getCachedBytes(file, byteCache);
    const hash = await computeSha256Web(bytes);
    fileHashes.push({ name: file.name, size: file.size, hash });
    
    if (onProgress) {
      onProgress({ phase: "parsing", fileIndex: i, fileCount: sstFiles.length, fileName: file.name });
    }

    // Extract seed
    for (const offset of h(bytes, FIXED_RANDOM_NUMBER)) {
      const valOffset = offset + FIXED_RANDOM_NUMBER.length;
      if (valOffset + 4 <= bytes.length) {
        const seedVal = c(bytes, valOffset);
        seedHits.push({
          value: seedVal,
          hex: `0x${seedVal.toString(16).toUpperCase().padStart(8, "0")}`,
          fileName: file.name,
          offset: valOffset
        });
      }
    }

    // Extract presets
    for (const offset of h(bytes, COMMON_ISLAND)) {
      const valOffset = offset + COMMON_ISLAND.length;
      if (valOffset + 4 <= bytes.length) {
        const len = c(bytes, valOffset);
        const textStart = valOffset + 4;
        const textEnd = textStart + len;
        if (len > 0 && len <= 512 && textEnd <= bytes.length) {
          const presetName = utf8Decoder.decode(bytes.subarray(textStart, textEnd)).replace(/\0+$/g, "");
          if (presetName.startsWith("/R5BusinessRules/CommonIslands/")) {
            worldPresets.set(presetName, (worldPresets.get(presetName) || 0) + 1);
          }
        }
      }
    }

    // Extract terrains
    for (const offset of h(bytes, TERRAINS)) {
      const placements = getTerrainPlacements(bytes, offset);
      if (placements && placements.length) {
        const key = JSON.stringify(placements.map(p => [p.slot, p.center.x, p.center.y, p.center.z, p.bounds.width, p.bounds.height]));
        const existing = placementsMap.get(key);
        if (existing) {
          existing.count += 1;
        } else {
          placementsMap.set(key, { count: 1, terrainPlacements: placements });
        }
      }
    }
  }

  // Phase 2: Evidence files scanning
  for (let i = 0; i < evidenceFiles.length; i++) {
    const file = evidenceFiles[i];
    if (onProgress) {
      onProgress({ phase: "evidence", fileIndex: i, fileCount: evidenceFiles.length, fileName: file.name });
    }
    
    const bytes = await getCachedBytes(file, byteCache);
    const fileName = file.name;
    
    for (const [key, tokenBytes] of Object.entries(RESOURCE_TOKENS)) {
      const targetState = evidenceState[key];
      for (const offset of h(bytes, tokenBytes)) {
        targetState.totalHitCount += 1;
        targetState.fileNameSet.add(fileName);
        if (targetState.sampleHits.length < 5) {
          targetState.sampleHits.push({
            fileName,
            offset,
            context: getAsciiStringsInContext(bytes, offset, tokenBytes.length)
          });
        }
      }
    }
  }

  const uniqueSeeds = Array.from(new Set(seedHits.map(s => s.value))).sort((a, b) => a - b);
  const activeSeed = uniqueSeeds.length === 1 ? String(uniqueSeeds[0]) : null;

  // Extract primary preset
  let primaryPreset: string | null = null;
  let maxCount = -1;
  for (const [preset, cnt] of worldPresets.entries()) {
    if (cnt > maxCount) {
      primaryPreset = preset;
      maxCount = cnt;
    }
  }

  // Extract primary placements
  let primaryPlacements: any[] = [];
  let maxPlacementCount = -1;
  for (const info of placementsMap.values()) {
    if (info.count > maxPlacementCount) {
      primaryPlacements = info.terrainPlacements;
      maxPlacementCount = info.count;
    }
  }

  const fingerprint = await generateLayoutFingerprint(fileHashes);

  if (!activeSeed) {
    throw new Error(uniqueSeeds.length > 1 ? "Found more than one seed. Select files from a single world folder." : "Couldn't find a world seed in those files.");
  }
  if (!primaryPlacements.length) {
    throw new Error("Couldn't derive terrain placement data from those files.");
  }

  const resourceEvidence: Record<string, EvidenceSummary> = {};
  for (const key of Object.keys(RESOURCE_TOKENS)) {
    resourceEvidence[key] = formatEvidenceSummary(key, evidenceState);
  }

  return {
    selectedFileCount: sortedFiles.length,
    seed: activeSeed,
    worldPreset: primaryPreset,
    layoutFingerprint: fingerprint,
    shortLayoutFingerprint: fingerprint.slice(0, 16),
    terrainPlacements: primaryPlacements,
    fileCount: sstFiles.length,
    scannedFileNames: sstFiles.map(f => f.name),
    evidenceFileCount: evidenceFiles.length,
    evidenceScannedFileNames: evidenceFiles.map(f => f.name),
    allSeeds: uniqueSeeds,
    seedHits,
    resourceEvidence
  };
}

// Listen for messages from parent
addEventListener('message', async (e: MessageEvent) => {
  if (e.data && e.data.type === "scan") {
    try {
      const files: FileWrapper[] = e.data.files.map((f: any) => ({
        name: f.name,
        size: f.size,
        readBytes: async () => new Uint8Array(await f.arrayBuffer())
      }));
      
      const result = await processSstScanning(files, (progress) => {
        postMessage({ type: "progress", progress });
      });
      
      postMessage({ type: "complete", result });
    } catch (err) {
      console.error("Runtime save scan failed in worker", err);
      postMessage({
        type: "error",
        error: err instanceof Error ? err.message : "Could not scan save files.",
        stack: err instanceof Error ? err.stack : undefined
      });
    }
  }
});

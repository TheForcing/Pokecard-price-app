import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const GITHUB_CONTENTS_API =
  'https://api.github.com/repos/PokemonTCG/pokemon-tcg-data/contents/cards/en';
const DEFAULT_COUNT = 50;
const DEFAULT_OUT_DIR = path.resolve(process.cwd(), '..', '..', 'tests', 'fixtures', 'hq-cards');
const MIN_BYTES = 500 * 1024;
const MAX_BYTES = 2 * 1024 * 1024;
const TARGET_LONG_EDGES = [1600, 1800, 2000];
const JPEG_QUALITIES = [92, 95, 98, 100];

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {
    count: DEFAULT_COUNT,
    outDir: DEFAULT_OUT_DIR,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (arg === '--count' && next) {
      result.count = Math.max(1, Number(next) || DEFAULT_COUNT);
      i += 1;
      continue;
    }
    if (arg === '--out' && next) {
      result.outDir = path.resolve(process.cwd(), next);
      i += 1;
      continue;
    }
  }

  return result;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'pokecard-price-app-fetcher',
    },
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${url}`);
  }
  return response.json();
}

async function fetchBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Image download failed: ${response.status} ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

function sanitizeName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

async function buildQualifiedImage(buffer) {
  const base = sharp(buffer).rotate();
  const meta = await base.metadata();
  if (!meta.width || !meta.height) return null;

  for (const longEdge of TARGET_LONG_EDGES) {
    const resized = base.resize({
      width: meta.width >= meta.height ? longEdge : undefined,
      height: meta.height > meta.width ? longEdge : undefined,
      fit: 'inside',
      withoutEnlargement: false,
      kernel: sharp.kernel.lanczos3,
    });

    for (const quality of JPEG_QUALITIES) {
      const out = await resized
        .clone()
        .jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
        .toBuffer();

      if (out.length < MIN_BYTES || out.length > MAX_BYTES) continue;
      const outMeta = await sharp(out).metadata();
      const w = outMeta.width ?? 0;
      const h = outMeta.height ?? 0;
      const long = Math.max(w, h);
      if (long < 1200 || long > 2000) continue;
      return { buffer: out, width: w, height: h, quality };
    }
  }

  return null;
}

async function run() {
  const { count, outDir } = parseArgs();
  await fs.mkdir(outDir, { recursive: true });

  const manifest = [];
  const seen = new Set();

  const filesPayload = await fetchJson(GITHUB_CONTENTS_API);
  const files = Array.isArray(filesPayload)
    ? filesPayload
        .filter((entry) => entry?.type === 'file' && String(entry?.name || '').endsWith('.json'))
        .map((entry) => ({ name: entry.name, downloadUrl: entry.download_url }))
    : [];

  for (const file of files) {
    if (manifest.length >= count) break;
    if (!file.downloadUrl) continue;

    try {
      const cardsPayload = await fetchJson(file.downloadUrl);
      const cards = Array.isArray(cardsPayload) ? cardsPayload : [];

      for (const card of cards) {
        if (manifest.length >= count) break;
        if (!card?.id || seen.has(card.id)) continue;
        const largeUrl = card?.images?.large;
        if (typeof largeUrl !== 'string' || !largeUrl) continue;

        seen.add(card.id);
        try {
          const source = await fetchBuffer(largeUrl);
          const qualified = await buildQualifiedImage(source);
          if (!qualified) continue;

          const safeName = sanitizeName(card.name || card.id) || card.id;
          const fileName = `${String(manifest.length + 1).padStart(2, '0')}-${safeName}-${card.id}.jpg`;
          const filePath = path.join(outDir, fileName);
          await fs.writeFile(filePath, qualified.buffer);

          manifest.push({
            fileName,
            cardId: card.id,
            name: card.name,
            sourceUrl: largeUrl,
            bytes: qualified.buffer.length,
            width: qualified.width,
            height: qualified.height,
            quality: qualified.quality,
          });
          console.log(
            `[${manifest.length}/${count}] ${fileName} (${qualified.width}x${qualified.height}, ${qualified.buffer.length} bytes)`,
          );
        } catch (error) {
          console.warn(`skip ${card?.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      console.warn(`skip set file ${file.name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const manifestPath = path.join(outDir, 'manifest.json');
  await fs.writeFile(manifestPath, `${JSON.stringify({ count: manifest.length, items: manifest }, null, 2)}\n`);
  console.log(`Saved ${manifest.length} images to ${outDir}`);
  if (manifest.length < count) {
    console.warn(`Requested ${count}, but only collected ${manifest.length} within constraints.`);
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

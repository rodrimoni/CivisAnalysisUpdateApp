#!/usr/bin/env node
/**
 * Freezes every theme in a motions.min directory that is not yet in
 * proposicoes_temas.json, so the next fetch reuses it instead of sending the
 * motion back to the (non-deterministic) classifier.
 *
 * Only appends: existing entries are never modified or removed. Motions still
 * "NO THEME" are skipped.
 *
 * Usage: npm run freeze-themes [-- <motions dir>] [-- --dry-run]   (default: ./motions.min)
 */
import { promises as fs } from 'fs';
import path from 'path';
import config from '../config.js';
import { readMotions, readThemesBase, themeKey, resolveDir } from './lib-motions.js';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const dir = resolveDir(args.find(a => !a.startsWith('--')), config.paths.motionsDir);

const base = await readThemesBase();
const frozen = new Set(base.map(t => themeKey(t.tipo, t.numero, t.ano)));
const source = path.relative(path.dirname(path.dirname(config.paths.themesFile)), dir);

const added = [];
for (const { motion: m } of await readMotions(dir)) {
  const key = themeKey(m.type, m.number, m.year);
  if (m.theme === 'NO THEME' || frozen.has(key)) continue;
  added.push({ tipo: m.type, numero: m.number, ano: m.year, temaPredito: [m.theme], _congeladoDe: source });
  frozen.add(key);
}

added.forEach(e => console.log(`  + ${e.tipo} ${e.numero}/${e.ano}: ${e.temaPredito[0]}`));

if (dryRun) {
  console.log(`\n[dry-run] ${added.length} temas seriam congelados (base: ${base.length} → ${base.length + added.length}).`);
} else if (added.length) {
  await fs.writeFile(config.paths.themesFile, JSON.stringify([...base, ...added], null, 2), 'utf8');
  console.log(`\n${added.length} temas congelados (base: ${base.length} → ${base.length + added.length}).`);
} else {
  console.log('Nada a congelar.');
}

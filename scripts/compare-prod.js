#!/usr/bin/env node
/**
 * Compares a freshly fetched dataset against what is in production
 * (CivisAnalysis2/data) before it is copied over. Fails when the new data
 * would lose or change something already published:
 *
 *   - a published motion missing from the new data
 *   - a published motion whose theme changed
 *   - a published motion with fewer roll calls than before
 *   - fewer roll calls or deputies overall
 *
 * Usage: npm run compare-prod [-- <new motions dir> <prod data dir>]
 *        defaults: ./motions.min  ../CivisAnalysis2/data
 * Exit code 1 on any regression.
 */
import { promises as fs } from 'fs';
import path from 'path';
import config from '../config.js';
import { readMotions, resolveDir } from './lib-motions.js';

const newDir = resolveDir(process.argv[2], config.paths.motionsDir);
const prodData = resolveDir(process.argv[3], path.join(path.dirname(config.paths.themesFile), '..', 'CivisAnalysis2', 'data'));
const newData = path.dirname(newDir);

const readJson = async p => JSON.parse(await fs.readFile(p, 'utf8'));
const byFile = list => new Map(list.map(({ file, motion }) => [file, motion]));

const prod = byFile(await readMotions(path.join(prodData, 'motions.min')));
const fresh = byFile(await readMotions(newDir));

const missing = [], themeChanged = [], fewerRollCalls = [];
let identical = 0;
for (const [file, p] of prod) {
  const n = fresh.get(file);
  if (!n) { missing.push(file); continue; }
  if (n.theme !== p.theme) themeChanged.push(`${file}: "${p.theme}" → "${n.theme}"`);
  else identical++;
  if ((n.rollCalls || []).length < (p.rollCalls || []).length) {
    fewerRollCalls.push(`${file}: ${p.rollCalls.length} → ${n.rollCalls.length}`);
  }
}
const added = [...fresh.keys()].filter(f => !prod.has(f));

const counts = {};
for (const name of ['arrayRollCalls.json', 'deputies.json']) {
  counts[name] = [(await readJson(path.join(prodData, name))).length, (await readJson(path.join(newData, name))).length];
}
const lastDate = async p => (await readJson(p)).reduce((max, r) => (r.datetime > max ? r.datetime : max), '');

console.log(`Produção: ${prodData}`);
console.log(`Novo:     ${newData}\n`);
console.log(`Motions:      ${prod.size} → ${fresh.size} (+${added.length} novas)`);
for (const [name, [a, b]] of Object.entries(counts)) console.log(`${name.padEnd(20)} ${a} → ${b}`);
console.log(`Última votação: ${await lastDate(path.join(prodData, 'arrayRollCalls.json'))} → ${await lastDate(path.join(newData, 'arrayRollCalls.json'))}\n`);

console.log(`Temas idênticos:              ${identical}`);
const report = (label, list) => {
  console.log(`${label.padEnd(30)}${list.length}`);
  list.slice(0, 50).forEach(x => console.log(`    ${x}`));
  if (list.length > 50) console.log(`    … e mais ${list.length - 50}`);
};
report('Temas alterados:', themeChanged);
report('Motions que sumiram:', missing);
report('Motions com menos votações:', fewerRollCalls);

// The app indexes deputies by ID (deputiesArray[deputyID]); a published ID must keep its deputy.
const prodDeputies = await readJson(path.join(prodData, 'deputies.json'));
const newDeputies = await readJson(path.join(newData, 'deputies.json'));
const renumbered = prodDeputies
  .filter(d => !newDeputies[d.deputyID] || newDeputies[d.deputyID].name !== d.name)
  .map(d => `#${d.deputyID} ${d.name} → ${newDeputies[d.deputyID] ? newDeputies[d.deputyID].name : '(ausente)'}`);
report('Deputados com ID trocado:', renumbered);
if (renumbered.length) console.log('    (rode npm run merge-prod)');

const shrank = Object.entries(counts).filter(([, [a, b]]) => b < a).map(([n]) => n);
const failed = themeChanged.length || missing.length || fewerRollCalls.length || shrank.length || renumbered.length;
if (shrank.length) console.log(`\n✗ Diminuiu: ${shrank.join(', ')}`);
console.log(failed ? '\n✗ NÃO copie para produção — corrija as regressões acima.' : '\n✓ Nada publicado foi perdido ou alterado.');
process.exit(failed ? 1 : 0);

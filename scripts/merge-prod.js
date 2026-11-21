#!/usr/bin/env node
/**
 * Merges a fresh fetch onto what is in production, so an update only ever adds.
 *
 * Why this exists — two things a raw fetch gets wrong:
 *
 *   1. deputyIDs are not stable. fetch-all-data.js numbers deputies in the order
 *      it first sees them, so any change upstream (one proposition fewer, one
 *      more) renumbers almost everyone. In Nov/2026, 3,010 of 3,168 IDs shifted.
 *      This keeps every production ID and appends new deputies after them.
 *
 *   2. The Chamber's old API silently drops propositions: in Nov/2026, 18 that
 *      are published (e.g. PL 4330/2004, PL 442/1991) left the yearly listings
 *      and ObterVotacaoProposicao answers 404 for them. Their votes are still
 *      historical fact, so production's copy is kept as-is.
 *
 * Rewrites, in place: deputies.json, arrayRollCalls.json, motions.min/.
 * Idempotent: running it twice gives the same result.
 *
 * Usage: npm run merge-prod [-- <prod data dir>]   (default: ../CivisAnalysis2/data)
 */
import { promises as fs } from 'fs';
import path from 'path';
import config from '../config.js';
import { readMotions, resolveDir } from './lib-motions.js';

const prodData = resolveDir(process.argv[2], path.join(path.dirname(config.paths.themesFile), '..', 'CivisAnalysis2', 'data'));
const readJson = async p => JSON.parse(await fs.readFile(p, 'utf8'));
const writeJson = (p, data) => fs.writeFile(p, JSON.stringify(data, null, 2), 'utf8');

// --- deputies: production IDs first, new deputies appended -----------------
const prodDeputies = await readJson(path.join(prodData, 'deputies.json'));
const freshDeputies = await readJson(config.paths.deputiesFile);

prodDeputies.forEach((d, i) => {
  if (d.deputyID !== i) throw new Error(`production deputies.json is not indexed by deputyID (position ${i})`);
});

const finalDeputies = prodDeputies.map(d => ({ ...d }));
const idByName = new Map(finalDeputies.map(d => [d.name, d.deputyID]));
const appended = [];
for (const d of [...freshDeputies].sort((a, b) => a.deputyID - b.deputyID)) {
  if (idByName.has(d.name)) continue;
  const deputy = { deputyID: finalDeputies.length, name: d.name, district: d.district };
  finalDeputies.push(deputy);
  idByName.set(deputy.name, deputy.deputyID);
  appended.push(deputy);
}
const freshToFinal = new Map(freshDeputies.map(d => [d.deputyID, idByName.get(d.name)]));

// --- motions: renumber fresh votes; keep production-only motions ------------
const fresh = await readMotions(config.paths.motionsDir);
const freshFiles = new Set(fresh.map(m => m.file));
let remapped = 0;
for (const { file, motion } of fresh) {
  for (const rc of motion.rollCalls || []) {
    for (const vote of rc.votes || []) {
      const id = freshToFinal.get(vote.deputyID);
      if (id === undefined) throw new Error(`${file}: deputyID ${vote.deputyID} is not in deputies.json`);
      if (id !== vote.deputyID) remapped++;
      vote.deputyID = id;
    }
  }
  await writeJson(path.join(config.paths.motionsDir, file), motion);
}

const kept = (await readMotions(path.join(prodData, 'motions.min'))).filter(m => !freshFiles.has(m.file));
for (const { file, motion } of kept) {
  await writeJson(path.join(config.paths.motionsDir, file), motion);
}

// --- roll calls: fresh ones plus the kept motions' production entries -------
const keptKeys = new Set(kept.map(({ motion: m }) => `${m.type}|${m.number}|${m.year}`));
const keptRollCalls = (await readJson(path.join(prodData, 'arrayRollCalls.json')))
  .filter(r => keptKeys.has(`${r.type}|${r.number}|${r.year}`));
const rollCalls = [...await readJson(config.paths.rollCallsFile), ...keptRollCalls]
  .sort((a, b) => new Date(a.datetime) - new Date(b.datetime));

const expected = kept.reduce((n, { motion }) => n + (motion.rollCalls || []).length, 0);
if (keptRollCalls.length !== expected) {
  throw new Error(`kept motions have ${expected} roll calls but production arrayRollCalls.json lists ${keptRollCalls.length}`);
}

await writeJson(config.paths.deputiesFile, finalDeputies);
await writeJson(config.paths.rollCallsFile, rollCalls);

console.log(`Deputados: ${prodDeputies.length} de produção (IDs mantidos) + ${appended.length} novos`);
appended.forEach(d => console.log(`  + #${d.deputyID} ${d.name} (${d.district})`));
console.log(`Votos renumerados para os IDs de produção: ${remapped}`);
console.log(`Proposições que a API não devolveu mais, mantidas de produção: ${kept.length}`);
kept.forEach(({ file, motion }) => console.log(`  = ${file} (${motion.rollCalls.length} votações)`));
console.log(`arrayRollCalls.json: ${rollCalls.length} (${keptRollCalls.length} vindas de produção)`);

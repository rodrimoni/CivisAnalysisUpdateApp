#!/usr/bin/env node
/**
 * Reports the theme state of a motions.min directory:
 *   - motions still "NO THEME" (need `npm run classify` or manual classification)
 *   - motions whose theme is not yet frozen in proposicoes_temas.json (need `npm run freeze-themes`)
 *
 * Usage: npm run check-themes [-- <motions dir>]   (default: ./motions.min)
 * Exit code 1 while anything is pending, so it can gate a release.
 */
import config from '../config.js';
import { readMotions, readThemesBase, themeKey, resolveDir } from './lib-motions.js';

const dir = resolveDir(process.argv[2], config.paths.motionsDir);
const motions = await readMotions(dir);
const frozen = new Set((await readThemesBase()).map(t => themeKey(t.tipo, t.numero, t.ano)));

const noTheme = motions.filter(({ motion }) => motion.theme === 'NO THEME');
const unfrozen = motions.filter(({ motion }) =>
  motion.theme !== 'NO THEME' && !frozen.has(themeKey(motion.type, motion.number, motion.year)));

console.log(`${dir}`);
console.log(`  ${motions.length} motions`);
console.log(`  ${noTheme.length} sem tema (NO THEME)`);
noTheme.forEach(({ motion: m }) => console.log(`    - ${m.type} ${m.number}/${m.year}: ${String(m.amendment || '').slice(0, 90)}`));
console.log(`  ${unfrozen.length} com tema ainda não congelado em proposicoes_temas.json`);

if (noTheme.length) console.log('\n→ Classifique as sem tema (npm run classify) e rode de novo.');
else if (unfrozen.length) console.log('\n→ Rode npm run freeze-themes.');
else console.log('\n✓ Todos os temas definidos e congelados.');

process.exit(noTheme.length || unfrozen.length ? 1 : 0);

// Shared helpers for the data-update check scripts (check/freeze/compare).
import { promises as fs } from 'fs';
import path from 'path';
import config from '../config.js';

export const themeKey = (tipo, numero, ano) => `${tipo}-${numero}-${ano}`;

/** Every motion in a motions.min directory, as { file, motion }. */
export async function readMotions(dir) {
  const files = (await fs.readdir(dir)).filter(f => f.endsWith('.json')).sort();
  return Promise.all(files.map(async file => ({
    file,
    motion: JSON.parse(await fs.readFile(path.join(dir, file), 'utf8'))
  })));
}

export async function readThemesBase() {
  return JSON.parse(await fs.readFile(config.paths.themesFile, 'utf8'));
}

/** Resolves a directory argument relative to where the command was run. */
export const resolveDir = (arg, fallback) => path.resolve(arg || fallback);

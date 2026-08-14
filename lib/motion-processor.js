import { promises as fs } from 'fs';
import path from 'path';
import config from '../config.js';
import { VOTO_TO_INTEGER, DEPUTY_NAME_CORRECTIONS, normalizePartyName, ensureMotionsDir } from './data-processors.js';

function normalizeDeputado(deputado) {
  return {
    ...deputado,
    UF: deputado.UF !== undefined ? String(deputado.UF).trim() : '',
    Nome: deputado.Nome !== undefined ? String(deputado.Nome).trim() : '',
    Partido: deputado.Partido !== undefined ? String(deputado.Partido).trim() : '',
    Voto: deputado.Voto !== undefined ? String(deputado.Voto).trim() : ''
  };
}

/**
 * The proposition's single theme, from the first available source:
 *
 *   1. temaPredito — a classifier's prediction, ranked by confidence
 *   2. tema        — the Chamber's own indexação, most-relevant first
 *   3. 'NO THEME'  — neither available; classify-themes.js fills these with an LLM
 *
 * The predictions were produced offline, before this repository, by BERT-derived
 * models fine-tuned on Brazilian legislative text. Which checkpoint produced
 * which row was never recorded and the models are no longer reachable, so
 * nothing here may depend on a particular one. The format is the only contract:
 * a ranked list, best first — which is all this function needs.
 *
 * Both sources are ordered, so the first entry is the intended answer and is
 * taken as-is. Handing a multi-value list to the LLM instead would override a
 * classification that already exists, and (being non-deterministic) would make
 * the same input yield different themes across runs.
 *
 * @param {Object} motion - a parsed proposition, possibly carrying temaPredito
 * @returns {string} one theme, or 'NO THEME'
 */
function pickTheme(motion) {
  const predicted = motion?.temaPredito;
  if (Array.isArray(predicted)) {
    if (predicted.length && String(predicted[0]).trim()) return String(predicted[0]).trim();
  } else if (predicted !== undefined && predicted !== null && String(predicted).trim()) {
    return String(predicted).split(';')[0].trim();
  }

  const indexacao = motion?.tema;
  if (indexacao !== undefined && indexacao !== null && String(indexacao).trim()) {
    const first = String(indexacao).split(';')[0].trim();
    if (first) return first;
  }

  return 'NO THEME';
}

/**
 * The label the Chamber uses for the government's block, which is not stable
 * over time: "GOV." until 2022, "Governo" from 2023 on, plus a couple of
 * one-off spellings. Nothing announces the change, so a lookup written against
 * either spelling silently reports zero coverage for the other era — which is
 * exactly the government's own position, the one entry worth comparing across
 * decades.
 */
const GOVERNMENT_SIGLA = /^(gov\.?|governo|apoio ao governo)$/i;
const GOVERNMENT_KEY = 'GOV.';

/**
 * Party-leader voting orientations declared before a roll call.
 *
 * The API returns <orientacaoBancada><bancada Sigla="X" orientacao="Y"/>…, which
 * the parser turns into { bancada: [{ Sigla, orientacao }, …] } (a bare object
 * when there is only one). The government's entry is the valuable one — it makes
 * "did the government's side prevail?" a direct comparison instead of an
 * inference from vote tallies, which cannot tell a defeat from a procedural win.
 *
 * Siglas are kept exactly as published (blocs like "PsbPtbPcdob" and "Minoria"
 * are official records, not party names to normalize). The government's block is
 * the one exception: its varying labels all collapse to "GOV." so that a single
 * lookup works across every legislature. Its published spelling carries no
 * information — only its position does.
 *
 * Coverage is ~2% before 1999 and 88% after, reaching 100% in the 57th.
 *
 * @param {Object} votacao - a parsed <Votacao> node
 * @returns {Object|null} { "PT": "Sim", "GOV.": "Sim", … } or null when absent
 */
function extractOrientations(votacao) {
  const raw = votacao.orientacaoBancada && votacao.orientacaoBancada.bancada;
  if (!raw) return null;

  const bancadas = Array.isArray(raw) ? raw : [raw];
  const orientations = {};

  for (const bancada of bancadas) {
    if (!bancada || bancada.Sigla === undefined) continue;
    const sigla = String(bancada.Sigla).trim();
    const orientacao = bancada.orientacao !== undefined ? String(bancada.orientacao).trim() : '';
    if (!sigla) continue;
    orientations[GOVERNMENT_SIGLA.test(sigla) ? GOVERNMENT_KEY : sigla] = orientacao;
  }

  return Object.keys(orientations).length ? orientations : null;
}

class MotionProcessor {
  constructor() {
    this.arrayMotions = [];
    this.arrayDeputies = [];
    this.arrayRollCalls = [];
    this.motionsMAP = {};
    this.motionsCount = -1;
    this.deputiesNAMES = {};
    this.phonebookIDcount = 0;
  }


  setMotion(motion) {
    if (!motion.tipo || !motion.numero || !motion.ano) {
      return null;
    }
    motion.tipo = motion.tipo.trim();
    motion.numero = motion.numero.trim();
    motion.ano = motion.ano.trim();
    motion.name = motion.tipo + motion.numero + motion.ano;

    if (this.motionsMAP[motion.name] === undefined) {
      const newMotion = {
        type: motion.tipo,
        number: motion.numero,
        year: motion.ano,
        date: motion.DataApresentacao,
        author: motion.Autor,
        amendment: motion.Ementa,
        tags: motion.Indexacao,
        status: motion.Situacao,
        theme: pickTheme(motion),
        rollCalls: []
      };

      this.motionsMAP[motion.name] = ++this.motionsCount;
      this.arrayMotions[this.motionsCount] = newMotion;
      return newMotion;
    }
    return this.arrayMotions[this.motionsMAP[motion.name]];
  }

  setDeputy(deputy) {
    deputy.district = deputy.UF.trim();
    deputy.name = deputy.Nome.trim().toUpperCase();

    // Correct misspelled names
    if (DEPUTY_NAME_CORRECTIONS[deputy.name] !== undefined) {
      deputy.name = DEPUTY_NAME_CORRECTIONS[deputy.name];
    }

    if (this.deputiesNAMES[deputy.name] === undefined) {
      const deputyID = this.phonebookIDcount++;
      const newDeputy = {
        deputyID: deputyID,
        name: deputy.name,
        district: deputy.district
      };

      this.deputiesNAMES[newDeputy.name] = deputyID;
      this.arrayDeputies.push(newDeputy);
    }
    return this.deputiesNAMES[deputy.name];
  }

  setRollCall(motion, motionRollCalls) {
    if (!motionRollCalls || !motionRollCalls.Votacoes || !motionRollCalls.Votacoes.Votacao) {
      return;
    }

    motionRollCalls.Votacoes.Votacao.forEach((votacao) => {
      const sigla = motionRollCalls.Sigla !== undefined ? String(motionRollCalls.Sigla).trim() : '';
      const ano = motionRollCalls.Ano !== undefined ? String(motionRollCalls.Ano).trim() : '';
      const numero = motionRollCalls.Numero !== undefined ? String(motionRollCalls.Numero).trim() : '';

      // datetimeRollCall - array of all rollCalls
      const newDateTimeRollCall = {
        type: sigla,
        year: ano,
        number: numero,
        datetime: votacao.datetime
      };
      this.arrayRollCalls.push(newDateTimeRollCall);

      // Complete RollCall Object - inserted on the motion
      const newRollCall = {
        datetime: votacao.datetime || null,
        obj: votacao.ObjVotacao !== undefined ? String(votacao.ObjVotacao).trim() : '',
        summary: votacao.Resumo !== undefined ? String(votacao.Resumo).trim() : '',
        orientations: extractOrientations(votacao),
        votes: []
      };

      if (votacao.votos && votacao.votos.Deputado) {
        const deputados = Array.isArray(votacao.votos.Deputado)
          ? votacao.votos.Deputado
          : [votacao.votos.Deputado];

        deputados.forEach((deputado) => {
          const normalizedDeputado = normalizeDeputado(deputado);
          const voto = normalizedDeputado.Voto;
          if (VOTO_TO_INTEGER[voto] !== undefined) {
            const deputyID = this.setDeputy(normalizedDeputado);
            const vote = {
              deputyID: deputyID,
              vote: VOTO_TO_INTEGER[voto],
              party: normalizePartyName(normalizedDeputado.Partido)
            };
            newRollCall.votes.push(vote);
          }
        });
      }

      motion.rollCalls.push(newRollCall);
    });
  }

  async saveDeputies() {
    const json = JSON.stringify(this.arrayDeputies, null, 2);
    await fs.writeFile(config.paths.deputiesFile, json, 'utf8');
    console.log(`Saved ${this.arrayDeputies.length} deputies to ${config.paths.deputiesFile}`);
  }

  async saveRollCallsArray() {
    // Convert datetime strings to Date objects and sort
    this.arrayRollCalls.forEach((d) => {
      d.datetime = new Date(d.datetime);
    });

    this.arrayRollCalls.sort((a, b) => a.datetime - b.datetime);

    const json = JSON.stringify(this.arrayRollCalls, null, 2);
    await fs.writeFile(config.paths.rollCallsFile, json, 'utf8');
    console.log(`Saved ${this.arrayRollCalls.length} roll calls to ${config.paths.rollCallsFile}`);
  }

  async saveMotions() {
    // Clear existing motions directory to start fresh
    try {
      const existingFiles = await fs.readdir(config.paths.motionsDir);
      for (const file of existingFiles) {
        if (file.endsWith('.json')) {
          await fs.unlink(path.join(config.paths.motionsDir, file));
        }
      }
      console.log(`Cleared ${existingFiles.length} existing motion files`);
    } catch (error) {
      // Directory might not exist yet, that's fine
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    await ensureMotionsDir();

    for (const motion of this.arrayMotions) {
      const filename = `${motion.type}${motion.number}${motion.year}.json`;
      const filepath = path.join(config.paths.motionsDir, filename);
      const json = JSON.stringify(motion, null, 2);
      await fs.writeFile(filepath, json, 'utf8');
      console.log(`Saved motion: ${filename}`);
    }
    console.log(`Saved ${this.arrayMotions.length} motions to ${config.paths.motionsDir}`);
  }

  getMotions() {
    return this.arrayMotions;
  }

  getDeputies() {
    return this.arrayDeputies;
  }

  getRollCalls() {
    return this.arrayRollCalls;
  }
}

export default MotionProcessor;


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
        theme: motion?.temaPredito || motion?.tema || 'NO THEME',
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


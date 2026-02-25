import { promises as fs } from 'fs';
import path from 'path';
import config from '../config.js';

// Vote type mapping
const VOTO_TO_INTEGER = {
    "Sim": 0,
    "Não": 1,
    "Abstenção": 2,
    "Obstrução": 3,
    "Art. 17": 4,
    "Branco": 5
};

// Deputy name corrections (misspellings)
const DEPUTY_NAME_CORRECTIONS = {
    'ANDRE VARGAS': 'ANDRÉ VARGAS',
    'JOSE STÉDILE': 'JOSÉ STÉDILE',
    'DUDIMAR PAXIUBA': 'DUDIMAR PAXIÚBA',
    'MARCIO REINALDO MOREIRA': 'MÁRCIO REINALDO MOREIRA',
    'FELIX MENDONÇA JÚNIOR': 'FÉLIX MENDONÇA JÚNIOR',
    'FABIO TRAD': 'FÁBIO TRAD',
    'JOÃO PAULO  LIMA': 'JOÃO PAULO LIMA',
    'JERONIMO GOERGEN': 'JERÔNIMO GOERGEN',
    'JAIRO ATAIDE': 'JAIRO ATAÍDE',
    'OSMAR  TERRA': 'OSMAR TERRA',
    'MARCIO MARINHO': 'MÁRCIO MARINHO',
    'LAERCIO OLIVEIRA': 'LAÉRCIO OLIVEIRA',
    'EMILIA FERNANDES': 'EMÍLIA FERNANDES',
    'SIBA MACHADO': 'SIBÁ MACHADO',
    'JOAO ANANIAS': 'JOÃO ANANIAS',
    'PADRE JOAO': 'PADRE JOÃO',
    'JOSE HUMBERTO': 'JOSÉ HUMBERTO',
    'ROGERIO CARVALHO': 'ROGÉRIO CARVALHO',
    'JOSÉ  C. STANGARLINI': 'JOSÉ C. STANGARLINI',
    'JOSÉ C STANGARLINI': 'JOSÉ C. STANGARLINI',
    'MANUELA DÁVILA': 'MANUELA D`ÁVILA',
    'CHICO DANGELO': 'CHICO D`ANGELO',
    'VANESSA  GRAZZIOTIN': 'VANESSA GRAZZIOTIN',
    'FRANCISCO TENORIO': 'FRANCISCO TENÓRIO',
    'CLAUDIO DIAZ': 'CLÁUDIO DIAZ',
    'DR. PAULO CESAR': 'DR. PAULO CÉSAR',
    'ANDRE ZACHAROW': 'ANDRÉ ZACHAROW',
    'ISAIAS SILVESTRE': 'ISAÍAS SILVESTRE',
    'LEO ALCÂNTARA': 'LÉO ALCÂNTARA',
    'CARLOS  MELLES': 'CARLOS MELLES',
    'DAVI ALVES SILVA JUNIOR': 'DAVI ALVES SILVA JÚNIOR',
    'WELINTON FAGUNDES': 'WELLINGTON FAGUNDES',
    'WELLINTON FAGUNDES': 'WELLINGTON FAGUNDES',
    'SERGIO CAIADO': 'SÉRGIO CAIADO',
    'TARCISIO ZIMMERMANN': 'TARCÍSIO ZIMMERMANN',
    'CLAUDIO RORATO': 'CLÁUDIO RORATO',
    'MARCIO BITTAR': 'MÁRCIO BITTAR',
};

// Party name corrections
function normalizePartyName(party) {
    const partyMap = {
        "Rede": "REDE",
        "Cidadania": "CIDADANIA",
        "Novo": "NOVO",
        "Republican": "Republicanos"
    };
    return partyMap[party] || party;
}

// Fix format for votacao proposicao data
function fixFormatObterVotacaoProposicao(json) {
    if (!json.proposicao) return json;

    // Normalize Sigla (handle both attribute and text content)
    if (json.proposicao.Sigla !== undefined) {
        json.proposicao.Sigla = String(json.proposicao.Sigla).trim();
    }

    // Normalize Ano and Numero if they exist
    if (json.proposicao.Ano !== undefined) {
        json.proposicao.Ano = String(json.proposicao.Ano).trim();
    }
    if (json.proposicao.Numero !== undefined) {
        json.proposicao.Numero = String(json.proposicao.Numero).trim();
    }

    // Fix object/array to array
    if (json.proposicao.Votacoes?.Votacao) {
        if (!Array.isArray(json.proposicao.Votacoes.Votacao)) {
            json.proposicao.Votacoes.Votacao = [json.proposicao.Votacoes.Votacao];
        }

        // Add datetime Date()
        for (const votacao of json.proposicao.Votacoes.Votacao) {
            const dataValue = votacao.Data;
            const horaValue = votacao.Hora;
            if (dataValue && horaValue) {
                const day_month_year = String(dataValue).match(/\d+/g);
                const hour_minutes = String(horaValue).match(/\d+/g);
                if (day_month_year?.length >= 3 && hour_minutes?.length >= 2) {
                    const year = Number(day_month_year[2]);
                    const month = Number(day_month_year[1]) - 1;
                    const day = Number(day_month_year[0]);
                    const hour = Number(hour_minutes[0]);
                    const minute = Number(hour_minutes[1]);
                    votacao.datetime = new Date(Date.UTC(year, month, day, hour, minute, 0, 0));
                }
            }
        }
    }
    return json;
}

// Parse proposition name to extract tipo, numero, ano
function parseProposicaoName(nomeProposicao) {
    const arr = nomeProposicao.match(/\w+/g);
    if (!arr || arr.length < 3) {
        throw new Error(`Invalid proposicao name format: ${nomeProposicao}`);
    }
    return {
        tipo: arr[0],
        numero: arr[1],
        ano: arr[2]
    };
}

// Normalize proposicao data - ensure tipo, numero, ano are strings
// With the new parser config, attributes merge directly, so no need to check @_ prefix
function normalizeProposicaoData(proposicao) {
    if (!proposicao) return proposicao;

    // Ensure these are strings (they might be numbers from parsing)
    if (proposicao.tipo !== undefined) {
        proposicao.tipo = String(proposicao.tipo);
    }
    if (proposicao.numero !== undefined) {
        proposicao.numero = String(proposicao.numero);
    }
    if (proposicao.ano !== undefined) {
        proposicao.ano = String(proposicao.ano);
    }

    return proposicao;
}

// Ensure motions directory exists
async function ensureMotionsDir() {
    try {
        await fs.mkdir(config.paths.motionsDir, { recursive: true });
    } catch (error) {
        if (error.code !== 'EEXIST') {
            throw error;
        }
    }
}

export {
    VOTO_TO_INTEGER,
    DEPUTY_NAME_CORRECTIONS,
    normalizePartyName,
    fixFormatObterVotacaoProposicao,
    parseProposicaoName,
    normalizeProposicaoData,
    ensureMotionsDir
};


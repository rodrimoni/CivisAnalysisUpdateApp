import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default {
    years: {
        begin: parseInt(process.env.YEAR_BEGIN || '1991'),
        end: parseInt(process.env.YEAR_END || '2025')
    },
    paths: {
        themesFile: path.join(__dirname, 'proposicoes_temas.json'),
        deputiesFile: path.join(__dirname, 'deputies.json'),
        rollCallsFile: path.join(__dirname, 'arrayRollCalls.json'),
        motionsDir: path.join(__dirname, 'motions.min')
    },
    api: {
        baseUrl: 'https://www.camara.leg.br/SitCamaraWS',
        concurrency: parseInt(process.env.API_CONCURRENCY || '1')
    },
    openai: {
        apiKey: process.env.OPENAI_API_KEY
    }
};


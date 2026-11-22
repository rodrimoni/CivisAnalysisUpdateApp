# CivisAnalysis Update App

A modern CLI tool for incrementally fetching data from the Brazilian Chamber of Deputies (Câmara dos Deputados) public API. All data is processed **in memory** - no database required!

> **Atualizando os dados de produção?** Siga [docs/ATUALIZACAO-DE-DADOS.md](docs/ATUALIZACAO-DE-DADOS.md). A saída bruta do fetch **não** pode ir direto para produção: o `merge-prod` mantém os IDs e o que a API perdeu, e o `compare-prod` barra qualquer regressão.

## Overview

This application fetches and processes data about legislative propositions, votes, and deputies from the Camara.gov.br API. It processes everything in memory and generates JSON files for further analysis.

## Features

- ✅ **No database required** - Everything processed in memory
- ✅ **Single command** - One script does it all
- ✅ Fetch propositions voted in plenary by year
- ✅ Fetch detailed proposition data
- ✅ Fetch voting data for propositions
- ✅ Add themes to propositions automatically
- ✅ Generate JSON files for analysis

## Prerequisites

- Node.js >= 14.0.0
- Internet connection (to access Camara.gov.br API)

**No MongoDB or database setup needed!** 🎉

## Installation

1. Clone the repository
2. Install dependencies:
```bash
npm install
```

3. (Optional) Create a `.env` file to customize settings:
```bash
YEAR_BEGIN=1991
YEAR_END=2026
API_CONCURRENCY=1
```

## Usage

### Simple - Run Everything

Just run one command to fetch and process all data:

```bash
npm start
# or
npm run fetch
```

This will:
1. Fetch propositions voted in plenary for each year
2. Fetch detailed information for each proposition
3. Fetch voting data for each proposition
4. Add themes from `proposicoes_temas.json` automatically
5. Generate all JSON files:
   - `deputies.json` - List of deputies
   - `arrayRollCalls.json` - Array of all roll calls
   - `motions.min/*.json` - Individual motion files

### Configuration

Edit `.env` file or `config.js` to customize:

- **YEAR_BEGIN**: Starting year (default: 1991)
- **YEAR_END**: Ending year (default: current year)
- **API_CONCURRENCY**: Number of concurrent API requests (default: 1)

## Project Structure

```
.
├── config.js                 # Configuration file
├── lib/
│   ├── api-client.js        # Camara API client
│   ├── data-processors.js   # Data processing utilities
│   └── motion-processor.js  # Motion processing logic
├── scripts/
│   ├── fetch-all-data.js    # Main script: full rebuild from the API
│   ├── merge-prod.js        # Keeps production deputyIDs + motions the API dropped
│   ├── check-themes.js      # Lists NO THEME / unfrozen themes
│   ├── classify-themes.js   # LLM classification of NO THEME motions
│   ├── freeze-themes.js     # Appends new themes to proposicoes_temas.json
│   └── compare-prod.js      # Fails if anything published would change
├── docs/ATUALIZACAO-DE-DADOS.md  # Update runbook
├── proposicoes_temas.json   # Themes data
└── package.json
```

## How It Works

1. **Fetches incrementally** - Processes one year at a time to manage memory
2. **Processes in memory** - All data kept in memory during processing
3. **Applies themes** - Automatically adds themes from `proposicoes_temas.json`
4. **Generates files** - Saves all JSON files at the end

## Output Files

- `deputies.json` - Complete list of all deputies
- `arrayRollCalls.json` - Chronologically sorted array of all roll calls
- `motions.min/` - Directory with individual JSON files for each motion (e.g., `PL12342024.json`)

## Notes

- The script processes data incrementally by year to manage memory efficiently
- API requests are rate-limited by default (concurrency: 1) to avoid overwhelming the API
- Progress is logged to the console during execution
- Errors for individual items don't stop the entire process
- Every run is a full rebuild: `deputies.json`, `arrayRollCalls.json` and `motions.min/` are overwritten (nothing is loaded from a previous run). Themes are preserved through `proposicoes_temas.json`

## Memory Considerations

The script processes data incrementally (by year) to keep memory usage reasonable. For very large datasets (many years), you can:

- Process fewer years at a time by adjusting `YEAR_BEGIN` and `YEAR_END`
- Reduce `API_CONCURRENCY` if you encounter memory issues
- The script will use memory proportional to the amount of data being processed

## Troubleshooting

**Out of memory?**
- Reduce the year range
- Set `API_CONCURRENCY=1` in `.env`

**API errors?**
- The script continues on errors - check the console output
- Some propositions may not have voting data available

**Missing themes?**
- Ensure `proposicoes_temas.json` exists and is properly formatted
- Themes are matched by `tipo-numero-ano` format

## License

ISC

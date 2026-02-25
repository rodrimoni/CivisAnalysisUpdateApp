#!/usr/bin/env node

import apiClient from '../lib/api-client.js';
import MotionProcessor from '../lib/motion-processor.js';
import config from '../config.js';
import { parseProposicaoName, fixFormatObterVotacaoProposicao, normalizeProposicaoData } from '../lib/data-processors.js';
import pLimit from 'p-limit';
import { promises as fs } from 'fs';
import { pathToFileURL } from 'url';

const limit = pLimit(config.api.concurrency);

// Load themes from file
async function loadThemes() {
  try {
    const themesData = await fs.readFile(config.paths.themesFile, 'utf8');
    const themes = JSON.parse(themesData);

    // Convert to map for faster lookup
    const themesMap = new Map();
    themes.forEach(theme => {
      const key = `${theme.tipo}-${theme.numero}-${theme.ano}`;
      const temaPreditoValue = Array.isArray(theme.temaPredito) ? theme.temaPredito[0] : theme.temaPredito;
      themesMap.set(key, temaPreditoValue);
    });

    return themesMap;
  } catch (error) {
    console.warn('⚠ Could not load themes file:', error.message);
    return new Map();
  }
}

// Gather propositions for a single year and add them to the global map
async function gatherPropositionsForYear(ano, uniqueProposicoesMap) {
  console.log(`\n📅 Gathering propositions for year ${ano}...`);

  try {
    console.log(`  Fetching propositions list for ${ano}...`);
    const proposicoesData = await apiClient.listarProposicoesVotadasEmPlenario(ano);

    if (!proposicoesData.proposicoes || !proposicoesData.proposicoes.proposicao) {
      console.log(`  ⚠ No propositions found for year ${ano}`);
      return { ano, total: 0, added: 0 };
    }

    const proposicoes = Array.isArray(proposicoesData.proposicoes.proposicao)
      ? proposicoesData.proposicoes.proposicao
      : [proposicoesData.proposicoes.proposicao];

    console.log(`  Found ${proposicoes.length} propositions (raw, may include duplicates)`);

    let added = 0;

    proposicoes.forEach((prop) => {
      const nome = (prop.nomeProposicao || '').trim();
      if (!nome) {
        console.warn('  ⚠ Encountered proposicao without nomeProposicao, skipping');
        return;
      }

      try {
        const parsed = parseProposicaoName(nome);
        const key = `${parsed.tipo}-${parsed.numero}-${parsed.ano}`;

        if (!uniqueProposicoesMap.has(key)) {
          uniqueProposicoesMap.set(key, {
            key,
            nomeProposicao: nome,
            tipo: parsed.tipo,
            numero: parsed.numero,
            ano: parsed.ano
          });
          added++;
        }
      } catch (error) {
        console.warn(`  ⚠ Could not parse proposicao name "${nome}": ${error.message}`);
      }
    });

    console.log(`  Added ${added} new unique propositions for year ${ano}`);
    return { ano, total: proposicoes.length, added };
  } catch (error) {
    console.error(`  ✗ Error gathering year ${ano}:`, error.message);
    return { ano, total: 0, added: 0, error: true };
  }
}

// Process a list of unique propositions (fetch details and votes once)
async function processUniquePropositions(processor, themesMap, uniqueProposicoes) {
  console.log(`\n🚀 Processing ${uniqueProposicoes.length} unique propositions...`);

  let completed = 0;
  const results = await Promise.all(
    uniqueProposicoes.map((prop) =>
      limit(async () => {
        const { tipo, numero, ano } = prop;
        try {
          console.log(`    📄 Fetching ${tipo} ${numero}/${ano}...`);

          // Fetch proposition details
          const proposicaoData = await apiClient.obterProposicao(tipo, numero, ano);

          if (!proposicaoData.proposicao) {
            console.log(`    ⚠ No proposicao data returned for ${tipo} ${numero}/${ano}`);
            return { success: false, error: 'No proposicao data returned' };
          }

          // Normalize proposicao data (convert @_tipo, @_numero, @_ano to tipo, numero, ano)
          normalizeProposicaoData(proposicaoData.proposicao);

          console.log(`    ✓ Fetched ${tipo} ${numero}/${ano} - tipo: ${proposicaoData.proposicao.tipo || 'missing'}, numero: ${proposicaoData.proposicao.numero || 'missing'}, ano: ${proposicaoData.proposicao.ano || 'missing'}`);

          if (proposicaoData.proposicao.tipo) {
            proposicaoData.proposicao.tipo = proposicaoData.proposicao.tipo.trim();
          }

          // Add theme if available
          const themeKey = `${tipo}-${numero}-${ano}`;
          if (themesMap.has(themeKey)) {
            proposicaoData.proposicao.temaPredito = themesMap.get(themeKey);
          }

          // Process motion
          const motion = processor.setMotion(proposicaoData.proposicao);

          if (motion) {
            console.log(`    ✓ Processed motion for ${tipo} ${numero}/${ano}`);

            // Fetch voting data
            try {
              const votacaoData = await apiClient.obterVotacaoProposicao(tipo, numero, ano);
              const fixedVotacaoData = fixFormatObterVotacaoProposicao(votacaoData);

              if (fixedVotacaoData.proposicao) {
                processor.setRollCall(motion, fixedVotacaoData.proposicao);
              }
            } catch (error) {
              console.log(`    ⚠ Could not fetch votes for ${tipo} ${numero} ${ano}: ${error.message}`);
            }

            completed++;
            if (completed % 50 === 0) {
              console.log(`    Progress: ${completed}/${uniqueProposicoes.length} propositions processed`);
            }
            return { success: true };
          } else {
            console.log(`    ⚠ Failed to create motion for ${tipo} ${numero}/${ano} - missing required fields`);
            return { success: false, error: 'Failed to create motion' };
          }
        } catch (error) {
          const propInfo = `${tipo} ${numero}/${ano}`;
          console.error(`    ✗ Error processing proposition ${propInfo}: ${error.message}`);
          if (error.stack) {
            console.error(`    Stack: ${error.stack.split('\n')[0]}`);
          }
          return { success: false, error: error.message };
        }
      })
    )
  );

  const processed = results.filter(r => r && r.success).length;
  const errors = results.filter(r => r && !r.success).length;

  console.log(`\n✅ Unique propositions processed: ${processed}, errors: ${errors}`);
  return { processed, errors };
}

async function main() {
  console.log('🚀 Starting data fetch and processing...');
  console.log(`📊 Years: ${config.years.begin} - ${config.years.end}`);
  console.log(`⚙️  Concurrency: ${config.api.concurrency}\n`);

  const processor = new MotionProcessor();

  try {
    // Start fresh - no existing data loaded
    console.log('🆕 Starting fresh - all data will be fetched from API\n');

    // Load themes
    console.log('📚 Loading themes...');
    const themesMap = await loadThemes();
    console.log(`   Loaded ${themesMap.size} themes\n`);

    // Gather propositions for each year first to avoid duplicates across years
    const uniqueProposicoesMap = new Map();
    const gatherStats = [];
    for (let ano = config.years.begin; ano <= config.years.end; ano++) {
      const result = await gatherPropositionsForYear(ano, uniqueProposicoesMap);
      gatherStats.push(result);
    }

    const uniqueProposicoes = Array.from(uniqueProposicoesMap.values());
    console.log(`\n📦 Total unique propositions gathered: ${uniqueProposicoes.length}\n`);

    // Process the unique propositions list
    const processingSummary = await processUniquePropositions(processor, themesMap, uniqueProposicoes);

    // Generate summary
    console.log('\n' + '='.repeat(50));
    console.log('📈 Summary');
    console.log('='.repeat(50));

    const totalProcessed = processingSummary.processed;
    const totalErrors = processingSummary.errors;
    const totalGathered = gatherStats.reduce((sum, r) => sum + (r?.total || 0), 0);
    const totalAdded = gatherStats.reduce((sum, r) => sum + (r?.added || 0), 0);

    console.log(`Total propositions fetched from API: ${totalGathered}`);
    console.log(`Unique propositions queued: ${totalAdded} (map size ${uniqueProposicoes.length})`);
    console.log(`Total motions processed: ${totalProcessed}`);
    console.log(`Total errors: ${totalErrors}`);
    console.log(`\nFinal counts:`);
    console.log(`  Motions: ${processor.getMotions().length}`);
    console.log(`  Deputies: ${processor.getDeputies().length}`);
    console.log(`  Roll calls: ${processor.getRollCalls().length}`);

    // Save all files
    console.log('\n💾 Saving files...');
    await processor.saveDeputies();
    await processor.saveRollCallsArray();
    await processor.saveMotions();

    console.log('\n✅ All done!');
  } catch (error) {
    console.error('\n❌ Fatal error:', error);
    process.exit(1);
  }
}

// Check if this file is being run directly
const isMainModule = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  main();
}

export { main };


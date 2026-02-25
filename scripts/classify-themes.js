import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';
import pLimit from 'p-limit';
import config from '../config.js';

const openai = new OpenAI({ apiKey: config.openai.apiKey });
const limit = pLimit(5);

const SYSTEM_PROMPT = `Você é um classificador de proposições legislativas brasileiras.
Sua tarefa é escolher EXATAMENTE UM tema — o mais relevante — para a proposição fornecida.
Analise a ementa e a indexação para determinar o tema principal.
Responda APENAS com JSON válido, sem markdown: {"theme": "...", "confidence": 0.85}
- theme: deve ser EXATAMENTE um dos temas da lista fornecida, copiado letra por letra.
- confidence: 0.0 a 1.0, seu grau de certeza.`;

async function main() {
    const motionsDir = config.paths.motionsDir;
    const files = fs.readdirSync(motionsDir).filter(f => f.endsWith('.json'));

    console.log(`Found ${files.length} motion files.`);

    // Collect all individual themes and identify motions to process
    const individualThemes = new Set();
    const toClassify = [];     // NO THEME
    const toNarrow = [];       // multiple themes (has ;)

    for (const file of files) {
        const filePath = path.join(motionsDir, file);
        const motion = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        if (motion.theme === 'NO THEME') {
            toClassify.push({ file, filePath, motion });
        } else {
            const parts = motion.theme.split(';').map(t => t.trim());
            parts.forEach(t => individualThemes.add(t));
            if (parts.length > 1) {
                toNarrow.push({ file, filePath, motion, currentThemes: parts });
            }
        }
    }

    const validThemes = [...individualThemes].sort();
    const themeList = validThemes.map((t, i) => `${i + 1}. ${t}`).join('\n');

    console.log(`\nIndividual themes (${validThemes.length}):`);
    validThemes.forEach(t => console.log(`  - ${t}`));
    console.log(`\nMotions to narrow (multi-theme): ${toNarrow.length}`);
    console.log(`Motions to classify (NO THEME): ${toClassify.length}`);
    console.log(`Total to process: ${toNarrow.length + toClassify.length}\n`);

    const auditLog = [];
    let processed = 0;
    let errors = 0;
    const total = toNarrow.length + toClassify.length;

    if (total === 0) {
        console.log('Nothing to process.');
        return;
    }

    // Process multi-theme motions: pick the most relevant one
    const narrowTasks = toNarrow.map(({ file, filePath, motion, currentThemes }) =>
        limit(async () => {
            try {
                const result = await narrowTheme(motion, currentThemes);
                if (result && currentThemes.includes(result.theme)) {
                    const previousTheme = motion.theme;
                    motion.theme = result.theme;
                    fs.writeFileSync(filePath, JSON.stringify(motion, null, 2));
                    auditLog.push({
                        file,
                        amendment: motion.amendment,
                        tags: motion.tags,
                        previousTheme,
                        newTheme: result.theme,
                        confidence: result.confidence,
                        action: 'narrowed',
                        timestamp: new Date().toISOString()
                    });
                    processed++;
                    logProgress(processed + errors, total, file, result.theme, result.confidence);
                } else {
                    errors++;
                    const returned = result ? result.theme : 'null';
                    console.error(`[${processed + errors}/${total}] ${file} -> invalid: "${returned}"`);
                }
            } catch (err) {
                errors++;
                console.error(`[${processed + errors}/${total}] ${file} -> ERROR: ${err.message}`);
            }
        })
    );

    // Process NO THEME motions: classify from scratch
    const classifyTasks = toClassify.map(({ file, filePath, motion }) =>
        limit(async () => {
            try {
                const result = await classifyMotion(motion, themeList, validThemes);
                if (result && validThemes.includes(result.theme)) {
                    motion.theme = result.theme;
                    fs.writeFileSync(filePath, JSON.stringify(motion, null, 2));
                    auditLog.push({
                        file,
                        amendment: motion.amendment,
                        tags: motion.tags,
                        previousTheme: 'NO THEME',
                        newTheme: result.theme,
                        confidence: result.confidence,
                        action: 'classified',
                        timestamp: new Date().toISOString()
                    });
                    processed++;
                    logProgress(processed + errors, total, file, result.theme, result.confidence);
                } else {
                    errors++;
                    const returned = result ? result.theme : 'null';
                    console.error(`[${processed + errors}/${total}] ${file} -> invalid: "${returned}"`);
                }
            } catch (err) {
                errors++;
                console.error(`[${processed + errors}/${total}] ${file} -> ERROR: ${err.message}`);
            }
        })
    );

    await Promise.all([...narrowTasks, ...classifyTasks]);

    // Write audit log
    const auditPath = path.join(path.dirname(motionsDir), 'theme-audit-log.json');
    fs.writeFileSync(auditPath, JSON.stringify(auditLog, null, 2));

    console.log(`\nDone! Processed: ${processed}, Errors: ${errors}`);
    console.log(`Audit log: ${auditPath}`);
}

function logProgress(current, total, file, theme, confidence) {
    console.log(`[${current}/${total}] ${file} -> ${theme} (${confidence})`);
}

async function narrowTheme(motion, currentThemes) {
    const options = currentThemes.map((t, i) => `${i + 1}. ${t}`).join('\n');

    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 100,
        temperature: 0,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
                role: 'user',
                content: `Esta proposição está classificada com múltiplos temas. Escolha o ÚNICO tema mais relevante entre as opções abaixo.

Opções:
${options}

Proposição:
- Ementa: ${motion.amendment}
- Indexação: ${motion.tags}`
            }
        ]
    });

    return parseResponse(response.choices[0].message.content);
}

async function classifyMotion(motion, themeList, validThemes) {
    const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 100,
        temperature: 0,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
                role: 'user',
                content: `Escolha o ÚNICO tema mais relevante da lista abaixo para esta proposição.

Temas válidos:
${themeList}

Proposição:
- Ementa: ${motion.amendment}
- Indexação: ${motion.tags}`
            }
        ]
    });

    return parseResponse(response.choices[0].message.content);
}

function parseResponse(text) {
    const trimmed = text.trim();
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
        theme: parsed.theme,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0
    };
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

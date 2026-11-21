# Atualização dos dados do VoteScope

Passo a passo para trazer votações novas da Câmara para o **CivisAnalysis2** sem
perder o que já foi publicado, principalmente os **temas** das proposições.

> Última atualização feita com este processo: **21/11/2026**, com dados até
> **12/11/2026** (2.175 proposições, 5.974 votações, 3.172 deputados).
> Atualize esta linha a cada rodada.

---

## Como funciona (leia antes)

```
API da Câmara (SitCamaraWS)
        │  npm start         (scripts/fetch-all-data.js, ~3 h)
        ▼
CivisAnalysisUpdateApp/
  deputies.json · arrayRollCalls.json · motions.min/*.json
        │  npm run merge-prod     (IDs de produção + o que a API perdeu)
        │  npm run check-themes / classify / freeze-themes
        │  npm run compare-prod   (barreira: nada publicado pode mudar)
        ▼  copiar
CivisAnalysis2/data/
        │  node scripts/generate-all.js  (PCA, W-NOMINATE, bundles…)
        ▼
site estático
```

### O fetch reconstrói tudo; o merge torna a atualização aditiva

O `fetch-all-data.js` **sempre reconstrói tudo do zero**, de `YEAR_BEGIN` até
`YEAR_END`. Ele sobrescreve `deputies.json` e `arrayRollCalls.json`, apaga
`motions.min/` e não lê nada da execução anterior. A saída bruta tem dois
problemas que **quebrariam produção** se fosse copiada direto:

1. **Os `deputyID` não são estáveis.** Eles são numerados na ordem em que cada
   deputado aparece, então qualquer mudança na API renumera quase todos. Em
   nov/2026, 3.010 dos 3.168 IDs mudaram. O app indexa por ID
   (`deputiesArray[deputyID]`).
2. **A API antiga perde proposições.** Em nov/2026, 18 proposições publicadas
   (entre elas o PL 4330/2004, terceirização, e o PL 442/1991, jogos de azar)
   sumiram das listagens anuais, e `ObterVotacaoProposicao` passou a responder
   404 para elas. As votações continuam sendo fato histórico.

O `npm run merge-prod` resolve os dois: mantém todos os IDs de produção
(deputados novos entram no fim) e preserva a cópia de produção das proposições
que a API não devolve mais. Ele pode rodar mais de uma vez sem mudar o
resultado.

Nunca rode só alguns anos para "completar" o que já existe: `YEAR_BEGIN` fica
sempre em 1991.

### O que é preservado: os temas

O que não pode mudar entre atualizações é o tema de cada proposição. Quando ele
muda, a série temporal por tema que já foi publicada muda junto. A proteção está
em `proposicoes_temas.json`, a **base congelada de temas**. O fetch consulta
essa base antes de qualquer outra fonte (`pickTheme` em
`lib/motion-processor.js`):

1. `temaPredito` da base congelada (BERTimbau, ou classificação já publicada);
2. `tema`, a indexação oficial da Câmara (o primeiro item);
3. `NO THEME`. Só estas vão para o classificador LLM.

O classificador LLM é **não-determinístico**: classificar de novo a mesma
proposição pode dar outro tema. Por isso, **todo tema novo precisa ser congelado
na base** (passo 5) antes do commit.

### Arquivos

| Arquivo | O que é | Quem escreve |
|---|---|---|
| `proposicoes_temas.json` | Base congelada de temas (**fonte da verdade**) | `npm run freeze-themes` |
| `theme-audit-log.json` | Procedência das classificações feitas por LLM | `classify-themes.js` (acrescenta) |
| `deputies.json`, `arrayRollCalls.json` | Saída do fetch, mesclada com produção | `fetch-all-data.js` + `merge-prod` |
| `motions.min/` | Uma proposição por arquivo (não versionado aqui) | `fetch-all-data.js` + `merge-prod` |
| `proposicoes.json`, `classified-motions.json` | Histórico de execuções antigas; nenhum script atual lê | — |

---

## Passo a passo

Os comandos partem da raiz `VoteScope/`.

### 0. Preparar

```bash
cd CivisAnalysisUpdateApp
git status            # precisa estar limpo
git checkout -b chore/atualiza-dados-$(date +%Y-%m)
npm install           # node_modules não é versionado
```

Faça o mesmo no `CivisAnalysis2` (branch novo, árvore limpa). O git é o backup:
os dados de produção estão versionados em `CivisAnalysis2/data/`.

### 1. Configurar o intervalo de anos

Crie (ou edite) `CivisAnalysisUpdateApp/.env`:

```bash
YEAR_BEGIN=1991
YEAR_END=2026          # ⚠ o ano ATUAL
API_CONCURRENCY=1
# OPENAI_API_KEY=sk-...  (só se for usar o passo 4)
```

> Sem `YEAR_END`, o padrão é o ano atual. Defina o valor explicitamente mesmo
> assim e confira a linha `📊 Years: …` no início da saída.

`YEAR_BEGIN` fica sempre em 1991, porque a reconstrução é completa.

### 2. Buscar os dados

```bash
npm start 2>&1 | tee fetch.log
```

A rodada leva cerca de **3 horas**: são umas 2.200 proposições, uma requisição
por vez. Se aparecer `✗ Error gathering year`, a API caiu durante a listagem de
um ano inteiro. Nesse caso, rode de novo depois.

É normal aparecerem umas 40 linhas `✗ Error processing proposition … 400`,
quase todas de `REQ`: a API nunca serviu essas proposições, e nenhuma delas
está em produção.

### 2b. Mesclar com produção

```bash
npm run merge-prod
```

O comando lista os deputados novos, quantos votos foram renumerados e quais
proposições foram mantidas de produção. Rode **antes** dos passos de tema, para
que as proposições mantidas também passem pela checagem.

### 3. Ver quais proposições ficaram sem tema

```bash
npm run check-themes
```

O comando lista as que ficaram `NO THEME` e quantas têm tema ainda não
congelado. O código de saída é 1 enquanto houver pendências. Se não houver
nenhuma sem tema, pule para o passo 5.

### 4. Classificar as que ficaram sem tema

```bash
npm run classify
```

- Precisa de `OPENAI_API_KEY` no `.env` (modelo `gpt-4o-mini`). Em ago/2026 a
  conta estava **sem créditos**.
- Regra: **um tema só**, obrigatoriamente um dos temas que já existem no
  dataset.
- O script **acrescenta** as entradas ao `theme-audit-log.json` e preserva as
  das rodadas anteriores.
- **Sem a API**, dá para classificar numa sessão do Claude Code com a mesma
  regra, como foi feito em ago/2026 (veja o commit `f136d7b`). Requerimento de
  urgência herda o tema da proposição que acelera, quando ela já está
  classificada; nos outros casos vale a ementa. Edite o `theme` do arquivo em
  `motions.min/` e registre a procedência no `theme-audit-log.json`.

### 5. Congelar os temas novos (obrigatório)

```bash
npm run freeze-themes -- --dry-run   # mostra o que seria acrescentado
npm run freeze-themes
npm run check-themes                 # agora precisa sair com ✓
```

O comando grava em `proposicoes_temas.json` todo tema de `motions.min/` que
ainda não está na base, marcado com `_congeladoDe`. Ele só **acrescenta**:
entradas existentes nunca são alteradas. Assim, a próxima atualização
reaproveita o tema em vez de classificar de novo.

Também entram aqui as proposições cujo tema veio da indexação da Câmara
(fonte 2). Isso não altera nenhum tema (o valor é o mesmo) e protege contra
mudanças futuras na indexação.

### 6. Conferir contra a produção

```bash
npm run compare-prod
```

O comando compara `motions.min/`, `deputies.json` e `arrayRollCalls.json` com
`../CivisAnalysis2/data/` e falha (código 1) quando algo publicado seria
perdido: uma proposição que sumiu, um tema que mudou, uma proposição com menos
votações ou um total menor de votações ou deputados. O resultado esperado é
`✓ Nada publicado foi perdido ou alterado.`

O comando também falha se algum deputado publicado mudou de ID. Se isso
acontecer, o passo 2b não foi rodado.

Se falhar, **não copie**. Se um tema mudou, corrija a entrada na base, rode o
fetch de novo e repita a conferência. Se sumiram dados, provavelmente a API
falhou em algum ano: veja o `fetch.log`.

O `compare-prod` não compara o conteúdo dos votos. Em nov/2026, uma checagem
voto a voto confirmou que as 5.965 votações publicadas eram idênticas nos dados
novos (voto, partido e orientação). Só mudaram `status` e `tags` de algumas
proposições, que a Câmara atualiza com o andamento delas.

### 7. Levar os dados para o CivisAnalysis2

```bash
cd ../CivisAnalysis2
cp ../CivisAnalysisUpdateApp/deputies.json ../CivisAnalysisUpdateApp/arrayRollCalls.json data/
rm data/motions.min/*.json && cp ../CivisAnalysisUpdateApp/motions.min/*.json data/motions.min/
```

Os três arquivos vão sempre juntos, porque os `deputyID` do `motions.min/`
apontam para o `deputies.json`.

### 8. Regerar os derivados e testar

```bash
node scripts/generate-all.js   # PCA, W-NOMINATE, traces, extent, nodes, bundles
npm test                       # veja a nota abaixo sobre verify-derived-layers
npm run dev                    # http://localhost:3000, confira a timeline e um ano novo
```

Os geradores são determinísticos: com os mesmos dados, o resultado é igual
byte a byte, exceto o `generatedAt` do `data/bundles/manifest.json`. Toda
diferença no `git diff` vem, portanto, dos dados novos. O passo leva cerca de
20 minutos, quase todos no W-NOMINATE.

`npm test` encadeia os testes com `&&` e para no primeiro que falha. O
`verify-derived-layers.js` é **intermitente**: depende do tempo da simulação do
force layout no jsdom. Em nov/2026, ele falhou uma vez na `main` sem nenhuma
mudança e passou em 4 de 4 execuções com os dados novos. Se falhar, rode de
novo antes de suspeitar dos dados. Para ver todos os resultados, rode cada
`scripts/verify-*.js` separadamente.

Os geradores descobrem o último ano sozinhos, a partir de `arrayRollCalls.json`
(`scripts/ending-year.js`). **O app não descobre.** Confira
`javascripts/congress-definitions.js`:

- `endingYear` precisa ser igual ao último ano dos dados;
- **a partir de 2027** é preciso acrescentar a **58ª legislatura** em
  `legislatures` (1/2/2027 a 31/1/2031), o novo mandato presidencial em
  `presidents` (a partir de 1/1/2027) e a eleição de 2026 em `elections`. Sem
  isso, as votações de 2027 ficam fora de qualquer período.

### 9. Commit e deploy

> ⚠ **Push na `main` do CivisAnalysis2 faz deploy automático para produção**
> (`.github/workflows/deploy.yml`, com `rsync --delete`). Trabalhe sempre em
> branch e só faça merge depois de conferir o site com `npm run dev`.

Os dois repositórios vão em PRs separados:

- **CivisAnalysisUpdateApp:** `proposicoes_temas.json`, `theme-audit-log.json`,
  `deputies.json`, `arrayRollCalls.json` (o `motions.min/` é ignorado pelo git).
- **CivisAnalysis2:** `data/` e o que mais o `generate-all.js` alterou em
  `javascripts/`.

No fim, atualize a linha "Última atualização" no topo deste documento.

---

## Checklist rápido

- [ ] Branches novos e árvores limpas nos dois repositórios
- [ ] `.env` com `YEAR_END` = ano atual (confira `📊 Years` na saída)
- [ ] `npm run merge-prod`
- [ ] `npm run freeze-themes` e depois `npm run check-themes` com ✓
- [ ] `npm run compare-prod` com ✓
- [ ] Três arquivos copiados juntos para `CivisAnalysis2/data/`
- [ ] `generate-all.js` + testes passando (o `verify-derived-layers` pode precisar de nova execução)
- [ ] `git diff` dos derivados restrito aos anos/períodos com dados novos
- [ ] Site conferido com `npm run dev` antes do merge na `main`, que faz o deploy
- [ ] `congress-definitions.js` em dia (ano, legislatura, presidente)

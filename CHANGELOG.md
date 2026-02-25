# Changelog

## Version 2.0.0 - In-Memory Processing

### Major Changes

**Removed MongoDB dependency** - All data is now processed in memory!

### What Changed

- ✅ **Removed MongoDB** - No database needed, everything processes in memory
- ✅ **Unified script** - Single script (`fetch-all-data.js`) replaces all previous scripts
- ✅ **Simpler usage** - Just run `npm start` to do everything
- ✅ **Faster** - No database I/O overhead
- ✅ **Easier setup** - No MongoDB connection string needed

### Migration

**Old way (with MongoDB):**
```bash
npm run listar-proposicoes
npm run obter-proposicoes
npm run obter-votacoes
npm run adicionar-temas
npm run generate-json
```

**New way (in-memory):**
```bash
npm start
```

That's it! One command does everything.

### Removed Dependencies

- `mongodb` - No longer needed

### Removed Files

All legacy code has been removed:
- Old Express.js files (`app.js`, `routes/camara.js`, `views/index.ejs`)
- Old MongoDB-based scripts (all scripts except `fetch-all-data.js`)
- MongoDB database module (`lib/database.js`)
- Empty directories (`routes/`, `views/`)

### Benefits

1. **Simpler** - No database setup required
2. **Faster** - Direct processing, no I/O overhead
3. **Easier** - One command instead of five
4. **Same output** - Generates the same JSON files

## Version 1.0.0 - Initial Refactor

- Converted from Express.js to CLI scripts
- Modernized dependencies
- Improved code organization


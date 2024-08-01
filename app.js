/* CivisAnalysis Update Server */

var express = require('express');
var camara = require('./routes/camara');
//var camaraClient = require('./routes/camaraClient');
var http = require('http');
var path = require('path');
var fs = require('fs')

// TODO: chunk years or use axios with async
var app = express();
var db;
const begin = 1991;
const end = 2024;

const MongoClient = require('mongodb').MongoClient;
const uri = "mongodb+srv://rodrimoni:ROiKPohmOPut2WYk@civisanalysisdb.rgysv.mongodb.net/?retryWrites=true&w=majority&appName=CivisAnalysisDB";


// all environments
app.set('port', process.env.PORT || 3000);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Load themes from JSON file
const themesFilePath = path.join(__dirname, 'proposicoes_temas.json');
let themes;


MongoClient.connect(uri, { useNewUrlParser: true }, (err, client) => {
	if (err) return console.log(err);  
	db = client.db("CivisAnalysis");
	
	var years = [];
	for (i = begin; i < end+1; i++)
	{
		years.push(i);
	}

	try {
		const themesData = fs.readFileSync(themesFilePath, 'utf8');
		themes = JSON.parse(themesData);
		console.log('Themes loaded successfully');
	} catch (err) {
		console.error('Error loading themes from file:', err);
		themes = {}; // Fallback to an empty object if file read fails
	}

	// functions to update DB... HTTP GET from camara.gov --------------------------------------
	app.get('/obterTodasProposicoes', camara.obterTodasProposicoes(db, years));
	app.get('/obterTodasVotacoesProposicoes', camara.obterTodasVotacoesProposicoes(db, years));
	app.get('/listarTodasProposicoesVotadasEmPlenario', camara.listarTodasProposicoesVotadasEmPlenario(db, years));
	app.get('/adicionarTemasParaProposicoes', camara.adicionarTemasParaProposicoes(db, themes));
	app.get('/generateJsonFiles', camara.generateJsonFiles(db))
	
	
	// CREATE SERVER :3000
  	app.listen(app.get('port'), function(){
		console.log('Express server listening on port ' + app.get('port'));
	});
});

app.use(express.json({limit: '10mb'}));

app.route('/') //setado a rota, e abaixo as ações a serem tomadas dentro desta rota
	.get(function(req, res) {
		res.render('index.ejs')
	})

/*
* GET camara resources and save to DB
* NOTE: this functions will make a GET to camara.gov and update the mongo db.
*/

// XML -> JSON parser -----------------------
var xml2js     = require('xml2js');
xml2js.defaults['0.2'].explicitArray = false;
xml2js.defaults['0.2'].mergeAttrs    = true;
// ------------------------------------------

var Promise = require('bluebird')
var rp = require('request-promise')
var fs = require('fs')
var levenshtein = require('fast-levenshtein');

exports.obterDeputados = function(db){ 
return function(req, res){
	request.post('https://www.camara.leg.br/SitCamaraWS/Deputados.asmx/ObterDeputados?', 
	{}, 
	(err, result, body) => {
			if (err) {
				console.error(error)
				return
			}
			console.log(`statusCode: ${result.statusCode}`)
			xml2js.parseString(body, function(err,json){ 
				if (err) {
					console.error(error)
					return
				}
				db.collection('obterDeputados').insertOne(json, function(err, result){
					res.json(
						(err === null) ? json : { msg: err.message }
					);
				});
			})
		})
	};	
};

function fixFormatObterVotacaoProposicao(json){
	//FIX the proposicao.tipo => sometimes with whitespaces++
	json.proposicao.Sigla = json.proposicao.Sigla.trim(); 
  
	// fix the object/array to array
	if(!isArray(json.proposicao.Votacoes.Votacao)){
	  json.proposicao.Votacoes.Votacao = [ json.proposicao.Votacoes.Votacao ];
	}
  
	// ADD datetime Date()
	for (var i = 0; i < json.proposicao.Votacoes.Votacao.length; i++) {
	  var day_month_year = json.proposicao.Votacoes.Votacao[i].Data.match(/\d+/g);
	  var hour_minutes = json.proposicao.Votacoes.Votacao[i].Hora.match(/\d+/g);
	  json.proposicao.Votacoes.Votacao[i].datetime = 
		new Date(day_month_year[2], day_month_year[1]-1, day_month_year[0], hour_minutes[0], hour_minutes[1], 0, 0);
	};
	return json;
}     

// check is the Object is an Arrayroposicoes2012
function isArray(obj) {
	return Object.prototype.toString.call(obj) === '[object Array]';
}

exports.listarTodasProposicoesVotadasEmPlenario = function(db, anos){
	return function(req, res) {
		var promises = anos.map(function (ano){
			return listarProposicoesVotadasEmPlenario(db, ano);
		})

		Promise.all(promises).then(function(results){
			res.send(results.join("<br/>"));
		});
	}
}

// Get the list of all 'articles' voted in plenary (representatives chamber = camara dos deputados)
function listarProposicoesVotadasEmPlenario (db, ano){
	var reqCamara = {
		url: 'https://www.camara.leg.br/SitCamaraWS/Proposicoes.asmx/ListarProposicoesVotadasEmPlenario?ano='+ano+'&tipo=',
		json: false
	};

	return rp(reqCamara)
		.then(function(body){
			xml2js.parseString(body, function(err,json){ 
				if (err) {
					console.error(error)
					return
				}
				db.collection('listarProposicoesVotadasEmPlenario').updateOne({ano:ano}, {$set: {ano:ano,data:json}},{upsert:true});
			})
			return "Ano " + ano + " carregado com sucesso!"
		})
		.catch(function(err){
            console.log('Não foi possivel carregar as proposições' , err);
            throw err;
		});
	}; 


exports.obterTodasProposicoes = function(db, anos)
{
	return function(req, res) {
		var promises = anos.map(function (ano){
			return obterProposicoesPorAno(db, ano);
		})

		Promise.all(promises).then(function(results){
			res.end("Proposicoes carregadas " + successfulYears);
		});
	}
}

exports.obterTodasVotacoesProposicoes = function(db, anos)
{
	return function(req, res) {
		var promises = anos.map(function (ano){
			return obterVotacoesProposicoesPorAno(db, ano);
		})

		Promise.all(promises).then(function(results){
			res.end("Proposicoes carregadas " + successfulYears);
		});
	}
}

exports.generateJsonFiles = function (db)
{
	return function (req, res) {
		db.collection('obterProposicaoVerificador').find()
		.toArray()
		.then(motionsDetails => {
			var promises = motionsDetails.map(function(motion,i)
			{ 
				motion = setMotion(motion.proposicao)
				return db.collection('obterVotacaoProposicao').findOne({'proposicao.Sigla':motion.type,'proposicao.Numero':motion.number,'proposicao.Ano':motion.year})
					.then(motionRollCalls => {
						console.log((i*100/1254).toFixed(2) + "% complete setting roll call " + motion.type + motion.number + motion.year)
						setRollCall(motion, motionRollCalls.proposicao)
					})
					.catch(err => {
						console.log('Could not load DB votacao proposicao: ' + motion.type + " " + motion.number + " " + motion.year + " Erro: " + err)
					}) 
			})
			Promise.all(promises).then( () => {
				console.log("saving deputies");
				saveDeputiesToFILE();
				console.log("saving roll Calls array");
				saveRollCallsArray();
				console.log("saving motion files");
				saveMotionsWithDelay();
				res.end("fim")
			})
			.catch(error => {
				console.log(error);
			})
		})
		.catch(err => {
			console.log('Could not load DB listAllMotions/ Erro: ' + err);
		})
	}
}

var successfulYears = [];

function obterProposicoesPorAno (db, ano)
{
	return new Promise ((resolve, reject) => {
		db.collection('listarProposicoesVotadasEmPlenario')
			.findOne({ano: ano})
			.then(function(resultado){
				console.log("Inicio");
				var proposicoes = resultado.data.proposicoes.proposicao;
				
				Promise.map(proposicoes, function(prop){
					var arr = prop.nomeProposicao.match(/\w+/g);
					var tipo = arr[0];
					var numero = arr[1];
					var ano	= arr[2];
					return obterUmaProposicao(db, tipo, numero, ano);
				},{concurrency: 1})
					.then(function(){
						console.log("Fim ano " + ano);
						successfulYears.push(ano);
						resolve();
					})
					.catch(function(err){
						console.log('\x1b[31m%s\x1b[0m', 'Promise falhou: '+ err);
						reject();
					})
			}).catch(function(err){
				console.log("\x1b[31m%s\x1b[0m", "Erro: " + err + " Não foi possível carregar as proposicoes do o ano " + ano +"");
			})
		})
}

function obterUmaProposicao (db, tipo, numero, ano){
	var reqCamara = {
		url: 'https://www.camara.leg.br/SitCamaraWS/Proposicoes.asmx/ObterProposicao?tipo='+tipo+'&numero='+numero+'&ano='+ano,
		json: false,
		agentOptions: {
			socksHost: 'localhost', // Defaults to 'localhost'.
			socksPort: 3000 // Defaults to 1080.
		}
	};

	return rp(reqCamara)
		.then(function(body){
			salvarUmaProposição(db, body, tipo, numero, ano);
		})
		.catch(function(err){
			console.log("\x1b[31m%s\x1b[0m", 'Não foi possível carregar a motion '+ tipo + ' ' + numero + ' ' + ano + " erro: " + err);
		})
}

function salvarUmaProposição(db, body, tipo, numero, ano)
{
	xml2js.parseString(body, (err, json) => {
		if (err) console.log(err);
		json.proposicao.tipo = json.proposicao.tipo.trim();
		db.collection('obterProposicaoVerificador')
			.updateOne({'proposicao.tipo':tipo,'proposicao.numero':numero,'proposicao.ano':ano}, 
			{$set: json},
			{upsert:true})
			.then(() => {
				console.log('Motion ' + tipo + ' ' + numero + ' ' + ano + " carregada com sucesso!")
			}); 
	})

}

function obterVotacoesProposicoesPorAno (db, ano)
{
	return new Promise ((resolve, reject) => {
		db.collection('listarProposicoesVotadasEmPlenario')
			.findOne({ano: ano})
			.then(function(resultado){
				console.log("Inicio");
				var proposicoes = resultado.data.proposicoes.proposicao;
				
				Promise.map(proposicoes, function(prop){
					var arr = prop.nomeProposicao.match(/\w+/g);
					var tipo = arr[0];
					var numero = arr[1];
					var ano	= arr[2];
					return obterUmaVotacaoProposicao(db, tipo, numero, ano);
				},{concurrency: 1})
					.then(function(){
						console.log("Fim ano " + ano);
						successfulYears.push(ano);
						resolve();
					})
					.catch(function(err){
						console.log('\x1b[31m%s\x1b[0m', 'Promise falhou: '+ err);
						reject();
					})
			}).catch(function(err){
				console.log("\x1b[31m%s\x1b[0m", "Erro: " + err + " Não foi possível carregar as votacoes do o ano " + ano +"");
			})
		})
}

function obterUmaVotacaoProposicao (db, tipo, numero, ano){
	var reqCamara = {
		url: 'https://www.camara.leg.br/SitCamaraWS/Proposicoes.asmx/ObterVotacaoProposicao?tipo='+tipo+'&numero='+numero+'&ano='+ano,
		json: false,
		agentOptions: {
			socksHost: 'localhost', // Defaults to 'localhost'.
			socksPort: 3000 // Defaults to 1080.
		}
	};

	return rp(reqCamara)
		.then(function(body){
			salvarUmaVotacaoProposição(db, body, tipo, numero, ano);
		})
		.catch(function(err){
			console.log("\x1b[31m%s\x1b[0m", 'Não foi possível carregar a votacao motion '+ tipo + ' ' + numero + ' ' + ano + " erro: " + err);
		})
}

function salvarUmaVotacaoProposição(db, body, tipo, numero, ano)
{
	xml2js.parseString(body, function(err,json){ 
		// fix and add variables
		json = fixFormatObterVotacaoProposicao(json);
		// add the datetimeRollCallsMotion entry reference to the motion 
		for (var i = 0; i < json.proposicao.Votacoes.Votacao.length; i++) {
		  db.collection('datetimeRollCallsMotion')
			.updateOne(
				{'datetime':json.proposicao.Votacoes.Votacao[i].datetime,'tipo':tipo,'numero':numero,'ano':ano}, //query
				{$set: {'datetime':json.proposicao.Votacoes.Votacao[i].datetime,'tipo':tipo,'numero':numero,'ano':ano}}, //insert/update
				{upsert:true},                                                                                   // param
				function(err, result){ if(err != null){console.log(err)} }                                      // callback
			); 
		  
		};           

		// add to the collection of motionRollCalls and return the json;
		db.collection('obterVotacaoProposicao')
		  .updateOne({'proposicao.Sigla':tipo,'proposicao.Numero':numero,'proposicao.Ano':ano},      //query
				   {$set:json},                                                                          //insert/update
				   {upsert:true},                                                                 // param
				   function(err, result){  console.log((err === null) ? json : { msg: err })}  // callback
		  ); 
	})          
}

var arrayMotions = [];
var arrayDeputies  = [];
var arrayRollCalls = [];

var motionsMAP	 = {};
var motionsCount = -1;

function setMotion(motion){
	motion.tipo = motion.tipo.trim()
	motion.numero = motion.numero.trim()
	motion.ano = motion.ano.trim()
	motion.name = motion.tipo+motion.numero+motion.ano;
	if(motionsMAP[motion.name] === undefined){
		var newMotion = {}
		newMotion.type = motion.tipo;
		newMotion.number = motion.numero;
		newMotion.year = motion.ano;
		newMotion.date = motion.DataApresentacao;
		newMotion.author = motion.Autor;
		newMotion.amendment = motion.Ementa;
		newMotion.tags = motion.Indexacao;
		newMotion.status = motion.Situacao;
		newMotion.rollCalls = [];

		motionsMAP[motion.name] = motionsCount++;
		arrayMotions[motionsCount]= newMotion;

		return newMotion;
	}
}


function loadOldDeputies()
{
	var rawData = fs.readFileSync('deputies.json');  
	arrayDeputies = JSON.parse(rawData);
	arrayDeputies.map((elem ,i )=> {
		deputiesNAMES[elem.name]= i;
	})
	phonebookIDcount = Object.keys(deputiesNAMES).length;
}


var deputiesNAMES = {};
var phonebookIDcount = 0;
function setDeputy(deputy){
		deputy.district = deputy.UF.trim();
		deputy.name    = deputy.Nome.trim().toUpperCase();
		// correct misspelled 
		if( dict[deputy.name] !== undefined) deputy.name = dict[deputy.name];

		if(deputiesNAMES[deputy.name] === undefined) {

			var newDeputy = {};
			newDeputy.name = deputy.name;
			newDeputy.district = deputy.district;

			deputiesNAMES[newDeputy.name] = phonebookIDcount++; 
			arrayDeputies.push(newDeputy);
		}
		return deputiesNAMES[deputy.name];
}

function setRollCall(motion, motionRollCalls){
	if (motionRollCalls.Votacoes != null) {
		if (motionRollCalls.Votacoes.Votacao != null) {
			motionRollCalls.Votacoes.Votacao.forEach( function(votacao){
				if (votacao.datetime.getFullYear() < 2019) // limit data until 2018
				{
					// datetimeRollCall - array of all rollCalls
					var newDateTimeRollCall = {};
					newDateTimeRollCall.type = motionRollCalls.Sigla.trim();
					newDateTimeRollCall.year = motionRollCalls.Ano.trim();
					newDateTimeRollCall.number = motionRollCalls.Numero.trim();
					newDateTimeRollCall.datetime = votacao.datetime;
					arrayRollCalls.push(newDateTimeRollCall);

					// complete RollCall Object - inserted on the motion
					var newRollCall = {}
					newRollCall.datetime = votacao.datetime;
					newRollCall.obj = votacao.ObjVotacao ;
					newRollCall.summary = votacao.Resumo ;

					newRollCall.votes = [];
					//console.log(newRollCall)

					if(votacao.votos != undefined){
						votacao.votos.Deputado.forEach(function(deputado){
							if (votoToInteger[deputado.Voto.trim()] !== undefined)
							{
								var deputyID = setDeputy(deputado);
								var vote = {};
								vote.deputyID = deputyID;
								vote.vote     = votoToInteger[deputado.Voto.trim()];
								vote.party    = deputado.Partido.trim();
								newRollCall.votes.push(vote)
							}
						})
					}
					motion.rollCalls.push(newRollCall);
				} 
			})

		};
	};
}

var votoToInteger = {"Sim":0,"Não":1,"Abstenção":2,"Obstrução":3,"Art. 17":4,"Branco":5};

// call the callback and wait millis to return 
function sleep(millis, callback){
	setTimeout(
		function (){ callback() }
		, millis
	);
}

const util = require('util')

// for an given array, save each entry using the filename - getName(entry)
// is set to wait one second to save each item ( sleep(1000) )
function saveEntriesOfArray( array, getName){
	array.map((elem) => {
		console.log("writing the motion: " + getName(elem))
		var json = JSON.stringify(elem)
		fs.writeFileSync('./motions.min/' + getName(elem) + '.json', json, 'utf8');
	})
}

function saveMotionsWithDelay(){
	saveEntriesOfArray(arrayMotions, function(motion){ return motion.type + motion.number + motion.year; }, 0)
}
function saveDeputiesToFILE()
{
	var json = JSON.stringify(arrayDeputies);
	fs.writeFileSync('deputies.json', json, 'utf8');
}
function saveRollCallsArray(){
	arrayRollCalls.forEach( function (d) {
		d.datetime = new Date( d.datetime )
	});

	arrayRollCalls.sort(function(a,b){
		// Turn your strings into dates, and then subtract them
		// to get a value that is either negative, positive, or zero.
		return a.datetime - b.datetime;
	});
	var json = JSON.stringify(arrayRollCalls);
	fs.writeFileSync('arrayRollCalls.json', json, 'utf8');
}

var dict= { // found with Levenshtein Distance levDist() - misspelling deputies names
	'ANDRE VARGAS':'ANDRÉ VARGAS',
	'JOSE STÉDILE':'JOSÉ STÉDILE', 
	'DUDIMAR PAXIUBA':'DUDIMAR PAXIÚBA', 
	'MARCIO REINALDO MOREIRA':'MÁRCIO REINALDO MOREIRA', 
	'FELIX MENDONÇA JÚNIOR':'FÉLIX MENDONÇA JÚNIOR', 
	'FABIO TRAD':'FÁBIO TRAD', 
	'JOÃO PAULO  LIMA':'JOÃO PAULO LIMA', 
	'JERONIMO GOERGEN':'JERÔNIMO GOERGEN', 
	'JAIRO ATAIDE':'JAIRO ATAÍDE',
	'OSMAR  TERRA':'OSMAR TERRA', 
	'MARCIO MARINHO':'MÁRCIO MARINHO',
	'LAERCIO OLIVEIRA':'LAÉRCIO OLIVEIRA',
	'EMILIA FERNANDES':'EMÍLIA FERNANDES',
	'SIBA MACHADO':'SIBÁ MACHADO', 
	'JOAO ANANIAS':'JOÃO ANANIAS',
	'PADRE JOAO':'PADRE JOÃO',
	'JOSE HUMBERTO':'JOSÉ HUMBERTO',
	'ROGERIO CARVALHO':'ROGÉRIO CARVALHO',
	'JOSÉ  C. STANGARLINI':'JOSÉ C. STANGARLINI',
	'JOSÉ C STANGARLINI':'JOSÉ C. STANGARLINI', 
	'MANUELA DÁVILA':'MANUELA D`ÁVILA', 
	'CHICO DANGELO':'CHICO D`ANGELO', 
	'VANESSA  GRAZZIOTIN':'VANESSA GRAZZIOTIN', 
	'FRANCISCO TENORIO':'FRANCISCO TENÓRIO', 
	'CLAUDIO DIAZ':'CLÁUDIO DIAZ',
	'DR. PAULO CESAR':'DR. PAULO CÉSAR', 
	'ANDRE ZACHAROW':'ANDRÉ ZACHAROW',
	'ISAIAS SILVESTRE':'ISAÍAS SILVESTRE', 
	'LEO ALCÂNTARA':'LÉO ALCÂNTARA', 
	'CARLOS  MELLES':'CARLOS MELLES', 
	'DAVI ALVES SILVA JUNIOR':'DAVI ALVES SILVA JÚNIOR', 
	'WELINTON FAGUNDES':'WELLINGTON FAGUNDES',
	'WELLINTON FAGUNDES':'WELLINGTON FAGUNDES',
	'SERGIO CAIADO':'SÉRGIO CAIADO', 
	'TARCISIO ZIMMERMANN':'TARCÍSIO ZIMMERMANN',
	'CLAUDIO RORATO':'CLÁUDIO RORATO', 
	'MARCIO BITTAR':'MÁRCIO BITTAR', 
}
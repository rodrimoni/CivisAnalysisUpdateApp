
/*
* GET camara resources and save to DB
* NOTE: this functions will make a GET to camara.gov and update the mongo db.
*
* Run "Carregar todas proposições votadas"
* Run "Obter todas proposições"
* Run "Obter todas votações proposições"
* Run "Obter arquivos JSON"
*/

// XML -> JSON parser -----------------------
var xml2js     = require('xml2js');
var https = require('https');
const axios = require('axios');
xml2js.defaults['0.2'].explicitArray = false;
xml2js.defaults['0.2'].mergeAttrs    = true;
// ------------------------------------------

var Promise = require('bluebird')
var fs = require('fs')
//var levenshtein = require('fast-levenshtein');

const api = axios.create({
	baseURL: "https://www.camara.leg.br/SitCamaraWS/Proposicoes.asmx",
	timeout: 60000, //optional
	httpsAgent: new https.Agent({ keepAlive: true }),
	headers: {'Content-Type':'application/xml'}
  });

function fixFormatObterVotacaoProposicao(json){
	//FIX the proposicao.tipo => sometimes with whitespaces++
	json.proposicao.Sigla = json.proposicao.Sigla.trim(); 
  
	// fix the object/array to array
	if(!Array.isArray(json.proposicao.Votacoes.Votacao)){
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
		anos.map(function(ano) {
			listarProposicoesVotadasEmPlenario(db, ano);
		})

		res.send("Finalizado!");
	}
}

// Get the list of all 'articles' voted in plenary (representatives chamber = camara dos deputados)
async function listarProposicoesVotadasEmPlenario (db, ano){
	try {	
		const response = await axios.get('https://www.camara.leg.br/SitCamaraWS/Proposicoes.asmx/ListarProposicoesVotadasEmPlenario?ano='+ano+'&tipo=');
		xml2js.parseString(response.data, function(err,json){ 
			if (err) {
				console.error(err)
				return
			}
			db.collection('listarProposicoesVotadasEmPlenario').updateOne({ano:ano}, {$set: {ano:ano,data:json}},{upsert:true});
		})
		return "Ano " + ano + " carregado com sucesso!"
	  } catch (error) {
		console.log('Não foi possivel carregar as proposições' , error);
		throw error;
	  }
} 

var successfulYears = [];

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

function obterProposicoesPorAno (db, ano)
{
	return new Promise ((resolve, reject) => {
		db.collection('listarProposicoesVotadasEmPlenario')
			.findOne({ano: ano})
			.then(function(resultado){
				console.log("Inicio");
				var proposicoes = resultado.data.proposicoes.proposicao;
				
				Promise.map(proposicoes, function(prop){
					var codProposicao = prop.codProposicao;
					return obterUmaProposicao(db, codProposicao);
				},{concurrency: 3})
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

function obterUmaProposicao (db, codProposicao) {
	return new Promise((resolve, reject) => {
		axios.get('https://www.camara.leg.br/SitCamaraWS/Proposicoes.asmx/ObterProposicaoPorID?IdProp='+codProposicao)
			.then(function (response) {
				salvarUmaProposição(db, response.data);
				resolve();
			})
			.catch(function(error) {
				console.log("\x1b[31m%s\x1b[0m", 'Não foi possível carregar a motion codProposicao: '+ codProposicao + " erro: " + error);
				reject();
			})
	})
}

function salvarUmaProposição(db, body)
{
	xml2js.parseString(body, (err, json) => {
		if (err) console.log(err);
		json.proposicao.tipo = json.proposicao.tipo.trim();
		db.collection('obterProposicaoVerificador')
			.updateOne({'proposicao.idProposicao':json.proposicao.idProposicao}, 
			{$set: json},
			{upsert:true})
			.then(() => {
				console.log('Motion ' + json.proposicao.tipo + ' ' + json.proposicao.numero + ' ' + json.proposicao.ano + " carregada com sucesso!")
			}); 
	})

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

function obterVotacoesProposicoesPorAno (db, ano)
{
	return new Promise ((resolve, reject) => {
		db.collection('obterProposicaoVerificador')
			.find({"proposicao.ano": ano.toString()})
			.toArray()
			.then(function(resultado){
				console.log("Inicio");
				var proposicoes = resultado;
				
				Promise.map(proposicoes, function(prop){
					var arr = prop.proposicao.nomeProposicao.match(/\w+/g);
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
	return new Promise((resolve, reject) => {
		api.get('ObterVotacaoProposicao?tipo='+tipo+'&numero='+numero+'&ano='+ano)
			.then(function (response) {
				salvarUmaVotacaoProposição(db, response.data, tipo, numero, ano);
				resolve();
			})
			.catch(function(error) {
				console.log("\x1b[31m%s\x1b[0m", 'Não foi possível carregar a votacao motion '+ tipo + ' ' + numero + ' ' + ano + " erro: " + error);
				reject();
			})
	})
}

function salvarUmaVotacaoProposição(db, body, tipo, numero, ano)
{
	xml2js.parseString(body, function(err,json){ 
		// fix and add variables
		json = fixFormatObterVotacaoProposicao(json);
		// add the datetimeRollCallsMotion entry reference to the motion 
		/*for (var i = 0; i < json.proposicao.Votacoes.Votacao.length; i++) {
		  db.collection('datetimeRollCallsMotion')
			.updateOne(
				{'datetime':json.proposicao.Votacoes.Votacao[i].datetime,'tipo':tipo,'numero':numero,'ano':ano}, //query
				{$set: {'datetime':json.proposicao.Votacoes.Votacao[i].datetime,'tipo':tipo,'numero':numero,'ano':ano}}, //insert/update
				{upsert:true}                                                                             // param
			)
			.then(() => {
				console.log('Votacao ' + tipo + ' ' + numero + ' ' + ano + " carregada com sucesso!")
			}); 		  
		};      */

		// add to the collection of motionRollCalls and return the json;
		db.collection('obterVotacaoProposicao')
		  .updateOne({'proposicao.Sigla':tipo,'proposicao.Numero':numero,'proposicao.Ano':ano},      //query
				   {$set:json},                                                                          //insert/update
				   {upsert:true},                                                                 // param
				   function(err, result){
						if (err !== null) 
							console.log({ msg: err })
						else
							console.log('Votacao ' + tipo + ' ' + numero + ' ' + ano + " carregada com sucesso!");
					}
		  )
	})          
}
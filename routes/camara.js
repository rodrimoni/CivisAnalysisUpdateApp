
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
var rp = require('request-promise');

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


//
// INSERT in the new entries => datetime = new Date(year, month, day, hours, minutes, seconds, milliseconds);
//http://www.camara.leg.br/SitCamaraWS/Proposicoes.asmx/ObterVotacaoProposicao?tipo=PL&numero=1992&ano=2007
//
exports.obterVotacaoProposicao = function(db){
return function(req, res){
	var ano = req.params.ano;
	var tipo = req.params.tipo;
	var numero = req.params.numero;
	
	request.get('http://www.camara.leg.br/SitCamaraWS/Proposicoes.asmx/ObterVotacaoProposicao?tipo='+tipo+'&numero='+numero+'&ano='+ano,
	{}, (err, result, body) => { 
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

				// fix and add variables
				json = fixFormatObterVotacaoProposicao(json);

				// add the datetimeRollCallsMotion entry reference to the motion 
				for (var i = 0; i < json.proposicao.Votacoes.Votacao.length; i++) {
					db.collection('datetimeRollCallsMotion')
					.update({'datetime':json.proposicao.Votacoes.Votacao[i].datetime,'tipo':tipo,'numero':numero,'ano':ano}, //query
							{'datetime':json.proposicao.Votacoes.Votacao[i].datetime,'tipo':tipo,'numero':numero,'ano':ano}, //insert/update
							{upsert:true},                                                                                   // param
							function(err, result){ if(err != null){console.log(err)} }                                      // callback
					); 
					
				};           

				// add to the collection of motionRollCalls and return the json;
				db.collection('obterVotacaoProposicao')
					.update({'proposicao.Sigla':tipo,'proposicao.Numero':numero,'proposicao.Ano':ano},      //query
							json,                                                                          //insert/update
							{upsert:true},                                                                 // param
							function(err, result){  res.json(  (err === null) ? json : { msg: err }  )  }  // callback
					); 
		})          
	}) // requestify
};  
};
  
exports.obterProposicao = function(db){
return function(req, res){
	var ano = req.params.ano;
	var tipo = req.params.tipo;
	var numero = req.params.numero;
	request.get('http://www.camara.leg.br/SitCamaraWS/Proposicoes.asmx/ObterProposicao?tipo='+tipo+'&numero='+numero+'&ano='+ano,
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
				//FIX the proposicao.tipo => sometimes with whitespaces++
				//console.log(json.proposicao.tipo);
				json.proposicao.tipo = json.proposicao.tipo.trim();

				db.collection('obterProposicao')
					.update({'proposicao.tipo':tipo,'proposicao.numero':numero,'proposicao.ano':ano}, json,{upsert:true}, function(err, result){
					res.json(
						(err === null) ? json : { msg: err }
					);
				});
		})
	});
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

exports.getMotionRollCallsInYear = function(db)
{
	return function(req, res) {
		var ano = parseInt(req.params.ano);

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
					return obterUmaProposicao(tipo, numero, ano);
				},{concurrency: 20})
					.then(function(){
						console.log("Fim");
						res.end("Fim");
					})
					.catch(function(err){
						console.log('\x1b[31m%s\x1b[0m', 'Promise falhou: '+ err);
					})
			}).catch(function(err){
				console.log("\x1b[31m%s\x1b[0m", "Erro: " + err + " Não foi possível carregar as proposicoes do o ano " + ano +"");
			})
	}
}

function obterUmaProposicao (tipo, numero, ano){
	var reqCamara = {
		url: 'https://www.camara.leg.br/SitCamaraWS/Proposicoes.asmx/ObterProposicao?tipo='+tipo+'&numero='+numero+'&ano='+ano,
		json: false,
	};

	return rp(reqCamara)
		.then(function(body){
			console.log('Motion ' + tipo + ' ' + numero + ' ' + ano + " carregada com sucesso!")
		})
		.catch(function(err){
			console.log("\x1b[31m%s\x1b[0m", 'Não foi possível carregar a motion '+ tipo + ' ' + numero + ' ' + ano);
		})
}
/*	request.get('http://www.camara.leg.br/SitCamaraWS/Proposicoes.asmx/ObterProposicao?tipo='+tipo+'&numero='+numero+'&ano='+ano,
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
				//FIX the proposicao.tipo => sometimes with whitespaces++
				//console.log(json.proposicao.tipo);
				json.proposicao.tipo = json.proposicao.tipo.trim();

				db.collection('obterProposicao')
					.update({'proposicao.tipo':tipo,'proposicao.numero':numero,'proposicao.ano':ano}, json,{upsert:true}, function(err, result){
					res.json(
						(err === null) ? json : { msg: err }
					);
				});
		})
	});
};  */
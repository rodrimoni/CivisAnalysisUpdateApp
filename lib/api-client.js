import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import config from '../config.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '', // Merge attributes directly into object properties
  attributesGroupName: false, // Don't group attributes separately
  textNodeName: '#text',
  parseAttributeValue: true,
  parseNodeValue: true,
  trimValues: true,
  parseTrueNumberOnly: false,
  arrayMode: false,
  alwaysCreateTextNode: false // Only create #text if there are mixed content
});

class CamaraApiClient {
  constructor() {
    this.baseUrl = config.api.baseUrl;
  }

  async requestXml(url) {
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'CivisAnalysis/1.0',
          'Accept': 'application/xml, text/xml, */*'
        },
        timeout: 30000
      });
      return response.data;
    } catch (error) {
      console.error(`API request failed for ${url}:`, error.message);
      throw error;
    }
  }

  async parseXml(xmlString) {
    try {
      const result = parser.parse(xmlString);
      return result;
    } catch (error) {
      console.error('XML parsing error:', error.message);
      throw error;
    }
  }

  async listarProposicoesVotadasEmPlenario(ano) {
    const url = `${this.baseUrl}/Proposicoes.asmx/ListarProposicoesVotadasEmPlenario?ano=${ano}&tipo=`;
    const xml = await this.requestXml(url);
    return await this.parseXml(xml);
  }

  async obterProposicao(tipo, numero, ano) {
    const url = `${this.baseUrl}/Proposicoes.asmx/ObterProposicao?tipo=${tipo}&numero=${numero}&ano=${ano}`;
    const xml = await this.requestXml(url);
    return await this.parseXml(xml);
  }

  async obterVotacaoProposicao(tipo, numero, ano) {
    const url = `${this.baseUrl}/Proposicoes.asmx/ObterVotacaoProposicao?tipo=${tipo}&numero=${numero}&ano=${ano}`;
    const xml = await this.requestXml(url);
    return await this.parseXml(xml);
  }
}

export default new CamaraApiClient();


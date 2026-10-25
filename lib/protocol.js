'use strict';
const mqtt = require('mqtt');
const { EventEmitter } = require('events');

const IDS = Object.freeze({
  room: 5050, roomTarget: 5075, roomOffset: 1946, mode: 1088,
  outdoor: 5032, supply: 5741, return: 5476,
  hotWater: 5039, hotWaterTarget: 5038, hotWaterSetting: 1082,
  hygieneMode: 1144, hygieneDay: 1732, hygieneTime: 1087,
  hygieneStatus: 5803, hygieneActive: 1135, hygieneWarning: 8227,
  pumpDate: 5230, pumpTime: 5229, forecastStart: 5240,
  forecastTemp: 5203, forecastCode: 5207, forecastRain: 5212,
  forecastWind: 5216, forecastDirection: 5239,
});
const POLL_IDS = Object.values(IDS);

function validateHost(host) {
  if (typeof host !== 'string' || !/^[a-zA-Z0-9.-]{1,253}$/.test(host) || host.includes('..')) throw new Error('Ongeldig IP-adres of hostnaam');
  return host;
}
function raw(hex, signed = false) {
  if (typeof hex !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(hex)) return null;
  const number = parseInt(hex, 16), bits = hex.length * 4;
  return signed && number >= 2 ** (bits - 1) ? number - 2 ** bits : number;
}
function scalar(hex, decimals = 0, signed = false) {
  const value = raw(hex, signed);
  return value === null ? null : value / 10 ** decimals;
}
function encode(value, bytes = 2) {
  if (!Number.isInteger(value) || value < -(2 ** (bytes * 8 - 1)) || value >= 2 ** (bytes * 8)) throw new RangeError('Waarde buiten toegestaan bereik');
  return (value < 0 ? 2 ** (bytes * 8) + value : value).toString(16).padStart(bytes * 2, '0').toUpperCase();
}
function decodeClockTime(hex) {
  if (!/^[0-9a-f]{6}$/i.test(hex || '')) return null;
  const [second, minute, hour] = hex.match(/../g).map(x => parseInt(x, 16));
  return hour < 24 && minute < 60 && second < 60 ? { hour, minute, second } : null;
}
function encodeClockTime(hour, minute, second = 0) {
  if (![hour, minute, second].every(Number.isInteger) || hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) throw new RangeError('Ongeldige tijd');
  return `${encode(second, 1)}${encode(minute, 1)}${encode(hour, 1)}`;
}
function decodeArray(hex) {
  if (typeof hex !== 'string' || hex.length !== 144 || !/^[0-9a-f]+$/i.test(hex)) return null;
  return hex.match(/../g).reverse().map(byte => parseInt(byte, 16));
}
function decodePumpDate(dateHex, timeHex) {
  if (!/^[0-9a-f]{12}$/i.test(dateHex || '') || !/^[0-9a-f]{6}$/i.test(timeHex || '')) return null;
  const [day, month, year] = [dateHex.slice(0, 4), dateHex.slice(4, 8), dateHex.slice(8, 12)].map(x => parseInt(x, 16));
  const { second, minute, hour } = decodeClockTime(timeHex) || {};
  if (year < 2020 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(year, month - 1, day, hour, minute, second);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}
function forecast(values, now) {
  const start = raw(values[IDS.forecastStart]);
  const temp = decodeArray(values[IDS.forecastTemp]);
  const code = decodeArray(values[IDS.forecastCode]);
  const rain = decodeArray(values[IDS.forecastRain]);
  const wind = decodeArray(values[IDS.forecastWind]);
  if (start === null || start > 167 || !temp || !code || !rain || !wind || !(now instanceof Date)) return [];
  const currentWeekHour = ((now.getDay() + 6) % 7) * 24 + now.getHours();
  const age = (currentWeekHour - start + 168) % 168;
  const first = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() - age);
  return temp.map((v, index) => ({ time: new Date(first.getTime() + index * 3600000), temperature: v / 2,
    code: code[index], rain: rain[index] / 20, wind: wind[index] / 10 * 3.6 }))
    .filter(item => item.time >= new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours()) && item.time <= new Date(now.getTime() + 72 * 3600000));
}
function fetchText(url, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const req = require('http').get(url, { timeout }, response => {
      if (response.statusCode !== 200) { response.resume(); reject(new Error(`HTTP ${response.statusCode}`)); return; }
      let data = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { data += chunk; if (data.length > 3_000_000) req.destroy(new Error('Antwoord te groot')); });
      response.on('end', () => resolve(data));
    });
    req.on('timeout', () => req.destroy(new Error('Controller reageert niet')));
    req.on('error', reject);
  });
}
async function identify(host) {
  validateHost(host);
  const [script, uc] = await Promise.all([fetchText(`http://${host}/js/smt.min.js`), fetchText(`http://${host}/cgi-bin/ucresponse.cgi`)]);
  const password = [...script.matchAll(/global\.MQTT_PASSWORD\s*=\s*"([^"]+)"/g)].find(match => match[1].length > 8)?.[1];
  const version = script.match(/global\.SMT_VERSION\s*=\s*['"](\d+)\.(\d+)['"]/);
  const deviceId = uc.slice(64, 76).trim();
  if (!password || !version || !/^[a-z0-9]{12}$/i.test(deviceId)) throw new Error('Geen ondersteunde REMKO Smart-Control Touch gevonden');
  return { host, password, topic: `V${version[1].padStart(2, '0')}P${version[2].padStart(2, '0')}/SMTID`, deviceId };
}
class RemkoConnection extends EventEmitter {
  constructor(identity) { super(); this.identity = identity; this.values = {}; this.lastWrite = 0; this.pending = new Set(); this.connected = false; }
  connect() {
    const { host, password, topic } = this.identity;
    this.clientId = `SMT${String(Math.floor(Math.random() * 256)).padStart(3, '0')}I0000000000000000`;
    this.client = mqtt.connect(`ws://${host}:9001/mqtt`, { protocolVersion: 4, protocolId: 'MQTT', clientId: this.clientId,
      username: '0000000000000000', password, reconnectPeriod: 3000, connectTimeout: 12000, clean: true });
    this.client.on('message', (channel, payload) => {
      if (channel !== `${topic}/HOST2CLIENT`) return;
      try {
        const message = JSON.parse(payload.toString());
        if (!message.values || typeof message.values !== 'object') return;
        Object.assign(this.values, message.values);
        if (Number.isFinite(Number(message.LASTWRITE))) this.lastWrite = Number(message.LASTWRITE);
        this.emit('values', this.values);
        for (const pending of [...this.pending]) pending();
      } catch (error) { this.emit('error', error); }
    });
    this.client.on('connect', () => {
      this.connected = true;
      this.client.subscribe(`${topic}/HOST2CLIENT`, { qos: 1 }, error => {
        if (error) this.emit('error', error); else this.poll().catch(e => this.emit('error', e));
      });
      this.emit('connect');
    });
    this.client.on('close', () => { this.connected = false; this.emit('disconnect'); });
    this.client.on('error', error => this.emit('error', error));
  }
  request(ids = POLL_IDS, values = {}) {
    if (!this.connected) return Promise.reject(new Error('Geen verbinding met REMKO-controller'));
    const payload = { FORCE_RESPONSE: true, values, query_list: ids, CLIENT_ID: this.clientId,
      LASTWRITE: this.lastWrite, SMT_USER: 0, ISTOUCH: false, DEVID: this.identity.deviceId };
    return new Promise((resolve, reject) => this.client.publish(`${this.identity.topic}/CLIENT2HOST`, JSON.stringify(payload), { qos: 1 }, error => error ? reject(error) : resolve()));
  }
  async poll() { await this.request(); }
  async write(id, hex) {
    await this.request(POLL_IDS, { [id]: hex });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(check); reject(new Error(`Geen bevestiging voor parameter ${id}`)); }, 12000);
      const check = () => { if (this.values[id]?.toUpperCase() === hex.toUpperCase()) { clearTimeout(timer); this.pending.delete(check); resolve(); } };
      this.pending.add(check); check();
    });
  }
  async close() { this.connected = false; this.client?.end(true); }
}
module.exports = { IDS, POLL_IDS, validateHost, raw, scalar, encode, decodeClockTime, encodeClockTime, decodeArray, decodePumpDate, forecast, identify, RemkoConnection };

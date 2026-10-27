'use strict';
const Homey = require('homey');
const { IDS, scalar, raw, encode, decodeClockTime, encodeClockTime, decodePumpDate, forecast, identify, RemkoConnection } = require('../../lib/protocol');

const MODE_TO_RAW = { auto: 1, heat: 2, cool: 4 };
const RAW_TO_MODE = { 1: 'auto', 2: 'heat', 4: 'cool' };
const HYGIENE_TO_RAW = { off: 0, static: 1, dynamic: 2 };
const RAW_TO_HYGIENE = { 0: 'off', 1: 'static', 2: 'dynamic' };
const DAYS = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'];
const OPERATING_STATES = ['unknown', 'fault', 'defrost', 'defrost_buffer', 'hot_water', 'buffer', 'heating', 'cooling', 'pool', 'circulation', 'standby', 'screed_drying', 'frost_protection', 'test', 'blocked', 'hygiene', 'silent'];

module.exports = class RemkoDevice extends Homey.Device {
  async onInit() {
    if (!this.hasCapability('operating_state')) await this.addCapability('operating_state');
    this.registerCapabilityListener('target_temperature', value => this.setRoomTemperature({ temperature: value }));
    this.registerCapabilityListener('thermostat_mode', value => this.setClimateMode({ mode: value }));
    this.registerCapabilityListener('hygiene_mode', value => this.setHygieneMode({ mode: value }));
    this.onValues = values => this.updateFromValues(values).catch(error => this.error(error));
    await this.openConnection().catch(error => this.setUnavailable(error.message));
    this.pollTimer = this.homey.setInterval(() => {
      if (!this.connection && !this.reconnecting) {
        this.reconnecting = true;
        this.openConnection().catch(error => this.setUnavailable(error.message)).finally(() => { this.reconnecting = false; });
      } else if (this.connection?.connected) this.connection.poll().catch(error => this.error(error));
    }, 30000);
    this.boostTimer = this.homey.setInterval(() => this.restoreExpiredBoost().catch(error => this.error(error)), 60000);
  }
  async openConnection() {
    const identity = await identify(this.getSetting('host'));
    this.connection = new RemkoConnection(identity);
    this.connection.on('values', this.onValues);
    this.connection.on('connect', () => this.setAvailable().catch(error => this.error(error)));
    this.connection.on('disconnect', () => this.setUnavailable('REMKO-controller niet bereikbaar').catch(error => this.error(error)));
    this.connection.on('error', error => this.error(error));
    this.connection.connect();
  }
  async onSettings({ newSettings, changedKeys }) {
    if (changedKeys.includes('host')) {
      const identity = await identify(newSettings.host);
      await this.connection?.close();
      this.connection = new RemkoConnection(identity);
      this.connection.on('values', this.onValues);
      this.connection.on('connect', () => this.setAvailable().catch(error => this.error(error)));
      this.connection.on('disconnect', () => this.setUnavailable('REMKO-controller niet bereikbaar').catch(error => this.error(error)));
      this.connection.on('error', error => this.error(error));
      this.connection.connect();
    }
  }
  async onDeleted() {
    this.homey.clearInterval(this.pollTimer);
    this.homey.clearInterval(this.boostTimer);
    await this.connection?.close();
  }
  current(id, decimals = 0, signed = false) { return scalar(this.connection?.values[id], decimals, signed); }
  requireCurrent(id, decimals = 0, signed = false) {
    const value = this.current(id, decimals, signed);
    if (value === null) throw new Error('Actuele REMKO-gegevens ontbreken; wacht op synchronisatie');
    return value;
  }
  async setCap(name, value) {
    if (value !== null && value !== undefined && this.getCapabilityValue(name) !== value) await this.setCapabilityValue(name, value);
  }
  async updateFromValues(values) {
    const temps = [
      ['measure_temperature', IDS.room], ['target_temperature', IDS.roomTarget],
      ['measure_temperature.outdoor', IDS.outdoor], ['measure_temperature.supply', IDS.supply],
      ['measure_temperature.return', IDS.return], ['measure_temperature.hot_water', IDS.hotWater],
      ['measure_temperature.hot_water_target', IDS.hotWaterTarget],
    ];
    for (const [cap, id] of temps) {
      const value = scalar(values[id], 1, true);
      if (value !== null && value > -60 && value < 150) await this.setCap(cap, value);
    }
    const mode = RAW_TO_MODE[raw(values[IDS.mode])];
    if (mode) await this.setCap('thermostat_mode', mode);
    const operatingState = raw(values[IDS.operatingState]);
    if (operatingState !== null) await this.setCap('operating_state', OPERATING_STATES[operatingState] || 'unknown');
    const hygiene = RAW_TO_HYGIENE[raw(values[IDS.hygieneMode])];
    if (hygiene) await this.setCap('hygiene_mode', hygiene);
    const active = raw(values[IDS.hygieneStatus]) === 1 || raw(values[IDS.hygieneActive]) === 1;
    const prior = this.getStoreValue('hygieneStartedAt');
    if (active && !prior) await this.setStoreValue('hygieneStartedAt', new Date().toISOString());
    if (!active && prior) {
      await this.setStoreValue('hygieneLastObservedEnd', new Date().toISOString());
      await this.unsetStoreValue('hygieneStartedAt');
    }
    await this.setCap('hygiene_status', active ? 'active' : 'idle');
    await this.setCap('last_hygiene_cycle', this.getStoreValue('hygieneLastObservedEnd') || 'Onbekend');
    const day = raw(values[IDS.hygieneDay]);
    const time = values[IDS.hygieneTime];
    const clock = decodeClockTime(time);
    if (day !== null && day <= 6 && clock) {
      await this.setCap('hygiene_schedule', `${DAYS[day]} ${String(clock.hour).padStart(2, '0')}:${String(clock.minute).padStart(2, '0')}`);
    }
    const boost = this.getStoreValue('boost');
    await this.setCap('boost_active', !!boost);
    const pumpNow = decodePumpDate(values[IDS.pumpDate], values[IDS.pumpTime]);
    const entries = forecast(values, pumpNow || new Date());
    if (entries.length) {
      const tomorrow = new Date((pumpNow || new Date()).getFullYear(), (pumpNow || new Date()).getMonth(), (pumpNow || new Date()).getDate() + 1);
      const today = entries.filter(item => item.time < tomorrow);
      if (today.length) await this.setCap('forecast_today', `${Math.min(...today.map(x => x.temperature))}–${Math.max(...today.map(x => x.temperature))} °C, ${today.reduce((a, x) => a + x.rain, 0).toFixed(1)} mm`);
    }
    await this.restoreExpiredBoost();
    await this.restoreScheduledHygiene(active);
  }
  async setRoomTemperature({ temperature }) {
    if (!Number.isFinite(temperature) || temperature < 15 || temperature > 30 || Math.round(temperature * 2) !== temperature * 2) throw new RangeError('Kies 15–30 °C in stappen van 0,5 °C');
    const target = this.requireCurrent(IDS.roomTarget, 1, true);
    const offset = this.requireCurrent(IDS.roomOffset, 1, true);
    const newOffset = Math.round((offset + temperature - target) * 10);
    if (newOffset < -100 || newOffset > 100 || newOffset % 5) throw new RangeError('Gewenste temperatuur valt buiten het REMKO-bereik');
    await this.connection.write(IDS.roomOffset, encode(newOffset));
    for (let attempt = 0; attempt < 20; attempt++) {
      if (this.current(IDS.roomTarget, 1, true) === temperature) return true;
      await this.connection.poll();
      await new Promise(resolve => setTimeout(resolve, 400));
    }
    throw new Error('REMKO bevestigde de gewenste kamertemperatuur niet');
  }
  async setClimateMode({ mode }) {
    if (!MODE_TO_RAW[mode]) throw new RangeError('Ongeldige klimaatmodus');
    await this.connection.write(IDS.mode, encode(MODE_TO_RAW[mode], 1));
  }
  async setHygieneMode({ mode }) {
    if (!(mode in HYGIENE_TO_RAW)) throw new RangeError('Ongeldige reinigingsmodus');
    await this.connection.write(IDS.hygieneMode, encode(HYGIENE_TO_RAW[mode], 1));
  }
  async setHygieneSchedule({ day, hour, minute }) {
    day = Number(day);
    if (!Number.isInteger(day) || day < 0 || day > 6 || !Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) throw new RangeError('Ongeldige dag of tijd');
    await this.connection.write(IDS.hygieneDay, encode(day, 1));
    await this.connection.write(IDS.hygieneTime, encodeClockTime(hour, minute));
  }
  async startHygieneCycle() {
    if (this.getStoreValue('hygieneOverride')) throw new Error('Er is al een reinigingsstart gepland');
    if (this.requireCurrent(IDS.hygieneMode) !== 1) throw new Error('Zet de reinigingsmodus eerst op Gepland');
    if (this.requireCurrent(IDS.hygieneStatus) === 1) throw new Error('Reinigingscyclus is al actief');
    if (this.getStoreValue('boost')) await this.stopSolarBoost();
    const oldDay = this.requireCurrent(IDS.hygieneDay);
    const oldTime = this.connection.values[IDS.hygieneTime];
    const pumpNow = decodePumpDate(this.connection.values[IDS.pumpDate], this.connection.values[IDS.pumpTime]);
    if (!pumpNow || !/^[0-9A-F]{6}$/i.test(oldTime || '')) throw new Error('Actuele controllerklok of planning ontbreekt');
    const start = new Date(pumpNow.getTime() + 2 * 60000);
    const day = (start.getDay() + 6) % 7;
    const time = encodeClockTime(start.getHours(), start.getMinutes());
    const override = { oldDay, oldTime, day, time, expiresAt: Date.now() + 7 * 60000, observedStart: false, arming: true };
    await this.setStoreValue('hygieneOverride', override);
    try {
      await this.connection.write(IDS.hygieneDay, encode(day, 1));
      await this.connection.write(IDS.hygieneTime, time);
      await this.setStoreValue('hygieneOverride', { ...override, arming: false });
      return true;
    } catch (error) {
      await this.restoreScheduledHygiene(false, true);
      throw error;
    }
  }
  async restoreScheduledHygiene(active, force = false) {
    const state = this.getStoreValue('hygieneOverride');
    if (!state || this.hygieneRestoring) return;
    if (state.arming && !force && Date.now() < state.expiresAt) return;
    const currentDay = this.current(IDS.hygieneDay);
    const currentTime = this.connection.values[IDS.hygieneTime];
    if (!force && currentDay !== null && currentTime && (currentDay !== state.day || currentTime.toUpperCase() !== state.time)) {
      if (currentDay !== state.oldDay || currentTime.toUpperCase() !== state.oldTime) {
        await this.unsetStoreValue('hygieneOverride');
        return;
      }
    }
    if (active && !state.observedStart) {
      await this.setStoreValue('hygieneOverride', { ...state, observedStart: true });
      return;
    }
    if (!force && (active || (!state.observedStart && Date.now() < state.expiresAt))) return;
    this.hygieneRestoring = true;
    try {
      await this.connection.write(IDS.hygieneDay, encode(state.oldDay, 1));
      await this.connection.write(IDS.hygieneTime, state.oldTime);
      await this.unsetStoreValue('hygieneOverride');
    } finally { this.hygieneRestoring = false; }
  }
  async startSolarBoost() {
    if (this.getStoreValue('boost')) return true;
    if (this.getStoreValue('hygieneOverride')) throw new Error('Reinigingscyclus staat gepland');
    if (this.current(IDS.hygieneStatus) === 1) throw new Error('Reinigingscyclus is actief');
    const original = this.requireCurrent(IDS.hotWaterSetting, 1, true);
    const target = this.getSetting('boost_target');
    if (target <= original) throw new Error('Extra laaddoel moet hoger zijn dan de huidige bufferinstelling');
    const until = Date.now() + this.getSetting('boost_minutes') * 60000;
    await this.setStoreValue('boost', { original, target, until });
    try { await this.connection.write(IDS.hotWaterSetting, encode(Math.round(target * 10))); }
    catch (error) { await this.unsetStoreValue('boost'); throw error; }
    await this.setCap('boost_active', true);
    return true;
  }
  async stopSolarBoost() {
    const boost = this.getStoreValue('boost');
    if (!boost) return true;
    const current = this.requireCurrent(IDS.hotWaterSetting, 1, true);
    if (current === boost.target) await this.connection.write(IDS.hotWaterSetting, encode(Math.round(boost.original * 10)));
    await this.unsetStoreValue('boost');
    await this.setCap('boost_active', false);
    return true;
  }
  async restoreExpiredBoost() {
    const boost = this.getStoreValue('boost');
    if (boost && Date.now() >= boost.until && this.connection?.connected) await this.stopSolarBoost();
  }
  isHygieneOlderThan(days) {
    const last = this.getStoreValue('hygieneLastObservedEnd');
    return !!last && Date.now() - new Date(last).getTime() >= days * 86400000;
  }
  getStatusTokens() {
    return { room: this.requireCurrent(IDS.room, 1, true), target: this.requireCurrent(IDS.roomTarget, 1, true),
      outside: this.requireCurrent(IDS.outdoor, 1, true), supply: this.requireCurrent(IDS.supply, 1, true),
      return: this.requireCurrent(IDS.return, 1, true), hot_water: this.requireCurrent(IDS.hotWater, 1, true) };
  }
  getHygieneTokens() {
    return { last_cycle: this.getStoreValue('hygieneLastObservedEnd') || '',
      active: this.current(IDS.hygieneStatus) === 1, mode: this.getCapabilityValue('hygiene_mode') || 'unknown',
      schedule: this.getCapabilityValue('hygiene_schedule') || '' };
  }
  getWeatherTokens() {
    const values = this.connection?.values || {};
    const now = decodePumpDate(values[IDS.pumpDate], values[IDS.pumpTime]) || new Date();
    const entries = forecast(values, now);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const today = entries.filter(item => item.time < end);
    if (!today.length) throw new Error('Geen actuele REMKO-verwachting voor vandaag');
    return { outside: this.requireCurrent(IDS.outdoor, 1, true), min: Math.min(...today.map(x => x.temperature)),
      max: Math.max(...today.map(x => x.temperature)), rain: Number(today.reduce((a, x) => a + x.rain, 0).toFixed(1)),
      hours: today.length, sunny_hours: today.filter(x => x.code === 0 || x.code === 1).length };
  }
};

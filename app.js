'use strict';
const Homey = require('homey');

module.exports = class RemkoApp extends Homey.App {
  async onInit() {
    const action = (name, method) => this.homey.flow.getActionCard(name).registerRunListener(async args => args.device[method](args));
    action('set_room_temperature', 'setRoomTemperature');
    action('set_climate_mode', 'setClimateMode');
    action('set_hygiene_mode', 'setHygieneMode');
    action('set_hygiene_schedule', 'setHygieneSchedule');
    action('start_hygiene_cycle', 'startHygieneCycle');
    action('start_solar_boost', 'startSolarBoost');
    action('stop_solar_boost', 'stopSolarBoost');
    action('get_status', 'getStatusTokens');
    action('get_weather', 'getWeatherTokens');
    action('get_hygiene', 'getHygieneTokens');
    this.homey.flow.getConditionCard('hygiene_older_than').registerRunListener(async args => args.device.isHygieneOlderThan(args.days));
    this.homey.flow.getConditionCard('solar_boost_active').registerRunListener(async args => args.device.getCapabilityValue('boost_active') === true);
    this.homey.flow.getConditionCard('sunny_hours_at_least').registerRunListener(async args => args.device.getWeatherTokens().sunny_hours >= args.hours);
  }
};

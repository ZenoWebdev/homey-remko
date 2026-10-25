'use strict';
const Homey = require('homey');
const { identify, validateHost } = require('../../lib/protocol');

module.exports = class RemkoDriver extends Homey.Driver {
  async onPair(session) {
    let host;
    session.setHandler('set_host', async value => {
      host = validateHost(value);
      await identify(host);
      return true;
    });
    session.setHandler('list_devices', async () => {
      if (!host) throw new Error('Vul eerst het adres van de controller in');
      const identity = await identify(host);
      return [{ name: 'REMKO Smart-Control Touch', data: { id: identity.deviceId }, settings: { host } }];
    });
  }
};

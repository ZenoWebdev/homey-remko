'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { raw, scalar, encode, decodeClockTime, encodeClockTime, decodePumpDate, forecast, IDS, validateHost } = require('../lib/protocol');

test('REMKO scalar values and signed offsets', () => {
  assert.equal(scalar('00C8', 1), 20);
  assert.equal(scalar('FFF6', 1, true), -1);
  assert.equal(encode(-10), 'FFF6');
  assert.equal(encode(495), '01EF');
  assert.equal(raw('02'), 2);
});

test('controller date and time use three words and three bytes', () => {
  const date = decodePumpDate('0019000A07EA', '1E230A');
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 9);
  assert.equal(date.getDate(), 25);
  assert.equal(date.getHours(), 10);
  assert.equal(date.getMinutes(), 35);
  assert.equal(decodePumpDate('bad', '1E230A'), null);
});

test('hygiene schedule time uses second-minute-hour wire order', () => {
  assert.deepEqual(decodeClockTime('00000D'), { hour: 13, minute: 0, second: 0 });
  assert.equal(encodeClockTime(13, 0), '00000D');
  assert.equal(encodeClockTime(9, 45), '002D09');
});

test('Sunday forecast excludes Friday and Saturday entries', () => {
  const now = new Date(2026, 9, 25, 10, 35);
  const array = Array(72).fill(24).reverse().map(x => x.toString(16).padStart(2, '0')).join('');
  const values = {
    [IDS.forecastStart]: '6A',
    [IDS.forecastTemp]: array,
    [IDS.forecastCode]: array,
    [IDS.forecastRain]: array,
    [IDS.forecastWind]: array,
  };
  const entries = forecast(values, now);
  assert.ok(entries.length > 0 && entries.length < 72);
  assert.equal(entries[0].time.getDay(), 0);
  assert.equal(entries[0].time.getHours(), 10);
  assert.equal(entries[0].temperature, 12);
  assert.ok(entries.every(entry => entry.time >= new Date(2026, 9, 25, 10)));
});

test('host accepts a local address and rejects URL syntax', () => {
  assert.equal(validateHost('192.168.0.249'), '192.168.0.249');
  assert.throws(() => validateHost('http://192.168.0.249'));
});

// What a game plugin can use. Built-in games and plugins get the same object: either `require('../../server/sdk')` or,
// for plugins, a factory `module.exports = (sdk) => ({ ... })` that the loader calls with it.
//
// Plugins are trusted code: they run inside the server with full access. Only install plugins you trust.
const { GameBase } = require('./game-base');
const { shuffle, clean } = require('../util');
const { config, bands } = require('../config');
const content = require('../content');
const profiles = require('../profiles');
const records = require('../records');
const minigames = require('./minigames');

module.exports = {
  version: 1,
  GameBase,
  shuffle, // shuffle(array) returns a shuffled copy
  clean, // clean(text, maxLength) trims, collapses spaces and masks bad words in player text
  bands, // the configured bands: bands.tierName(bandId) is 'easy', 'medium' or 'hard'; bands.list()
  content, // the loaded content packs: questions, prompts, words, scramble, literacy
  profiles, // saved profiles and mini-game scores
  records, // group records
  minigames, // the loaded mini-games: { byId, list }
  settings: { brand: config.brand, profilesEnabled: !!config.profiles.enabled },
  log: (...args) => console.log('[game]', ...args),
};

const path = require('path');
const semver = require('semver');
const rjson = require('relaxed-json');
const { fs, log, util } = require('vortex-api');

const { GAME_ID } = require('./common');

// The global file holds current gameversion information
//  we're going to use this to compare against a mod's expected
//  gameversion and inform users of possible incompatibility.
//  (The global file is located in the game's StreamedAssets/Default path)
//  *** U6 BACKWARDS COMPATIBILITY ***
const GLOBAL_FILE = 'global.json';

// The global file has been renamed to Game.json in update 7.
//  going to temporarily keep Global.json for backwards compatibility.
const GAME_FILE = 'game.json';

async function getJSONElement(filePath, element) {
  return fs.readFileAsync(filePath, { encoding: 'utf-8' })
    .then(data => {
      try {
        const modData = rjson.parse(util.deBOM(data));
        const elementData = util.getSafe(modData, [element], undefined);
        return elementData !== undefined
          ? Promise.resolve(elementData)
          : Promise.reject(new util.DataInvalid(`"${element}" JSON element is missing`));
      } catch (err) {
        return ((err.message.indexOf('Unexpected end of JSON input') !== -1)
             || (err.name.indexOf('SyntaxError') !== -1))
          ? Promise.reject(new util.DataInvalid('Invalid manifest.json file'))
          : Promise.reject(err);
      }
    });
}

async function getModName(manifestFilePath, element, ext) {
  let modName = await getJSONElement(manifestFilePath, element);

  if (modName === undefined) {
    throw new util.DataInvalid(`"${element}" JSON element is missing`);
  }

  if (!util.isFilenameValid(modName)) {
    throw new util.DataInvalid(
      "Mod name invalid. Starting with game version 8.4, mod names have to be valid file names.");
  }

  return (ext !== undefined)
    ? path.basename(modName, ext)
    : modName;
}

async function findGameConfig(discoveryPath) {
  const findConfig = (searchPath) => fs.readdirAsync(searchPath)
    .catch(err => {
      return ['ENOENT', 'ENOTFOUND'].includes(err.code)
        ? Promise.resolve([])
        : Promise.reject(err);
    })
    .then(entries => {
      const configFile = entries.find(file => (file.toLowerCase() === GAME_FILE)
        || (file.toLowerCase() === GLOBAL_FILE));
      return (configFile !== undefined)
        ? Promise.resolve(path.join(searchPath, configFile))
        : Promise.reject(new util.NotFound('Missing game.json config file.'));
    });
  const basePath = path.join(discoveryPath, streamingAssetsPath(), 'Default');
  return findConfig(path.join(basePath, 'Bas'))
    .catch(err => findConfig(basePath));
}

async function getGameVersion(discoveryPath) {
  const configFile = await findGameConfig(discoveryPath);
  let gameVersion = await getJSONElement(configFile, 'gameVersion');
  return gameVersion.toString().replace(',', '.');
}

async function getMinModVersion(discoveryPath) {
  const configFile = await findGameConfig(discoveryPath);
  try {
    const version = await getJSONElement(configFile, 'minModVersion');
    return { version, majorOnly: false };
  } catch (err) {
    if (err.message.indexOf('JSON element is missing') !== -1) {
      const version = await getJSONElement(configFile, 'gameVersion');
      return { version, majorOnly: true };
    } else {
      throw err;
    }
  }
}

async function checkModGameVersion(destination, minModVersion, modFile) {
  const coercedMin = semver.coerce(minModVersion.version);
  const minVersion = minModVersion.majorOnly
    ? coercedMin.major + '.x'
    : `>=${coercedMin.version}`;
  try {
    let modVersion = await getJSONElement(path.join(destination, modFile), 'GameVersion');
    modVersion = modVersion.toString().replace(',', '.');
    const coercedMod = semver.coerce(modVersion.toString());
    if (coercedMod === null) {
      return Promise.reject(new util.DataInvalid('Mod manifest has an invalid GameVersion element'));
    }

    return Promise.resolve({
      match: semver.satisfies(coercedMod.version, minVersion),
      modVersion: coercedMod.version,
      globalVersion: coercedMin.version,
    });
  } catch (err) {
    return Promise.reject(err);
  }
}

function getDiscoveryPath(api) {
  const store = api.store;
  const state = store.getState();
  const discovery = util.getSafe(state, ['settings', 'gameMode', 'discovered', GAME_ID], undefined);
  if ((discovery === undefined) || (discovery.path === undefined)) {
    // should never happen and if it does it will cause errors elsewhere as well
    log('error', 'bladeandsorcery was not discovered');
    return undefined;
  }

  return discovery.path;
}

function streamingAssetsPath() {
  return path.join('BladeAndSorcery_Data', 'StreamingAssets');
}

function isOfficialModType(modType) {
  return ['bas-legacy-modtype', 'bas-official-modtype'].includes(modType)
}

module.exports = {
  getModName,
  getJSONElement,
  getGameVersion,
  getMinModVersion,
  getDiscoveryPath,

  checkModGameVersion,
  isOfficialModType,
  streamingAssetsPath,
}
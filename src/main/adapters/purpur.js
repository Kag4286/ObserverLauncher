const { json } = require('../http.js');

async function resolve(version) {
  const project = await json('https://api.purpurmc.org/v2/purpur');
  const targetVersion = version || project.versions[project.versions.length - 1];
  const url = `https://api.purpurmc.org/v2/purpur/${encodeURIComponent(targetVersion)}/latest/download`;
  return { url, name: `purpur-${targetVersion}.jar`, version: targetVersion };
}

module.exports = { resolve };

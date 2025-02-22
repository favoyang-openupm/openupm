// Packages util.
const fs = require("fs");
const parseGitHubUrl = require("parse-github-url");
const path = require("path");
const util = require("util");
const spdx = require("spdx-license-list");
const yaml = require("js-yaml");

const readFile = util.promisify(fs.readFile);
const readdir = util.promisify(fs.readdir);

// Paths.
const dataDir = path.resolve(__dirname, "../../data");
const packagesDir = path.resolve(dataDir, "packages");

// Load topics.
const loadTopics = async function() {
  try {
    let absPath = path.resolve(dataDir, "topics.yml");
    return yaml.safeLoad(await readFile(absPath, "utf8"));
  } catch (e) {
    console.error(e);
    return [];
  }
};

// Load package by name.
const loadPackage = async function(name) {
  try {
    let absPath = path.resolve(packagesDir, name + ".yml");
    return preparePackage(yaml.safeLoad(await readFile(absPath, "utf8")));
  } catch (e) {
    console.error(e);
    return null;
  }
};

// Load package by name (sync version).
const loadPackageSync = function(name) {
  try {
    let absPath = path.resolve(packagesDir, name + ".yml");
    return preparePackage(yaml.safeLoad(fs.readFileSync(absPath, "utf8")));
  } catch (e) {
    console.error(e);
    return null;
  }
};

// Load package names.
const loadPackageNames = async function() {
  let files = await readdir(packagesDir);
  // Find paths with *.ya?ml ext.
  return files
    .filter(p => (p.match(/.*\.(ya?ml)$/) || [])[1] !== undefined)
    .map(p => p.replace(/\.ya?ml$/, ""));
};

// Get clean repo url.
const cleanRepoUrl = function(url, format) {
  if (!format) format = "https";
  let ghUrl = parseGitHubUrl(url);
  if (format == "git") return `git@${ghUrl.host}:${ghUrl.repo}.git`;
  else if (format == "https") return `https://${ghUrl.host}/${ghUrl.repo}`;
  else throw new Error("format should be either https or git.");
};

// Prepare package object, add or fix necessary properties.
const preparePackage = function(doc) {
  let ghUrl = parseGitHubUrl(doc.repoUrl);
  doc.repo = ghUrl.repo;
  doc.owner = ghUrl.owner;
  doc.ownerUrl = "https://" + ghUrl.hostname + "/" + ghUrl.owner;
  if (doc.hunter) {
    doc.hunterUrl = "https://" + ghUrl.hostname + "/" + doc.hunter;
  } else {
    doc.hunter = "anonymous";
    doc.hunterUrl = null;
  }
  if (doc.licenseSpdxId) {
    doc.licenseName = spdx[doc.licenseSpdxId]["name"];
  }
  return doc;
};

module.exports = {
  cleanRepoUrl,
  loadTopics,
  loadPackage,
  loadPackageSync,
  loadPackageNames
};

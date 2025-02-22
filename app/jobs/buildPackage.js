// Build package job
// Fetches package releases from git remote, then add necessary build-release jobs.
const config = require("config");

const { Release } = require("../models/release");
const {
  ReleaseState,
  ReleaseReason,
  RetryableReleaseReason
} = require("../models/common");
const { queues, addJob } = require("../queues/core");
const { cleanRepoUrl, loadPackage } = require("../utils/package");
const { gitListRemoteTags } = require("../utils/git");
const { semverRe, getVersionFromTag } = require("../utils/semver");
const logger = require("../utils/log")(module);

// Build package with given name.
const buildPackage = async function(name) {
  // Load package yaml file.
  logger.info(`[pkg=${name}] load yaml file`);
  let pkg = await loadPackage(name);
  // Get remote tags.
  logger.info(`[pkg=${name}] get remote tags`);
  let remoteTags = await gitListRemoteTags(cleanRepoUrl(pkg.repoUrl, "git"));
  remoteTags = filterRemoteTags(remoteTags);
  remoteTags.reverse();
  // Update release records.
  logger.info(`[pkg=${name}] update release records`);
  let releases = await updateReleaseRecords(pkg.name, remoteTags);
  // Add necessary build release jobs.
  logger.info(`[pkg=${name}] add release jobs`);
  await addReleaseJobs(releases);
};

// Filter remote tags for semantic versioning and duplication.
const filterRemoteTags = function(remoteTags) {
  // Filter semver tag.
  let tags = remoteTags.filter(x => semverRe.test(x.tag));
  // Remove duplications.
  // If tag "x.y.z" and "vx.y.z" both exist, keep the first one.
  let versionSet = new Set();
  let cleanTags = [];
  for (const element of tags) {
    let version = getVersionFromTag(element.tag);
    if (!versionSet.has(version)) {
      versionSet.add(version);
      cleanTags.push(element);
    }
  }
  return cleanTags;
};

// Update release records for given remoteTags.
const updateReleaseRecords = async function(packageName, remoteTags) {
  let releases = [];
  for (let remoteTag of remoteTags) {
    let version = getVersionFromTag(remoteTag.tag);
    let release = await Release.fetchOne({ packageName, version });
    if (!release) {
      let record = {
        packageName,
        version,
        commit: remoteTag.commit,
        tag: remoteTag.tag
      };
      release = await Release.create(record);
    }
    releases.push(release);
  }
  return releases;
};

// Add build release jobs for given release records.
const addReleaseJobs = async function(releases) {
  let queue = queues.main.emitter;
  let i = 0;
  for (let release of releases) {
    let reason = ReleaseReason.get(release.reason);
    let jobId = config.jobs.buildRelease.key + ":" + release.id;
    let job = await queue.getJob(jobId);
    // Clean complete failed job to continue
    if (queue.isJobFailedCompletely(job)) {
      await queue.removeJob(job.id);
      logger.info(
        `[releaseId=${release.id}] cleaned complete failed job ${release.packageName}@${release.version}`
      );
      job = null;
    }
    // Skip creating release job if,
    // - job already exists.
    // - release already succeeded.
    // - release failed and no need to retry.
    if (
      job ||
      release.state == ReleaseState.Succeeded ||
      (release.state == ReleaseReason.Failed &&
        !RetryableReleaseReason.includes(reason))
    )
      continue;
    // Generate release job.
    var dt = new Date();
    dt.setSeconds(dt.getSeconds() + config.jobs.buildRelease.delay * i);
    job = await addJob({
      jobId,
      jobConfig: config.jobs.buildRelease,
      delay: i == 0 ? 0 : dt
    });
    i += 1;
  }
};

module.exports = { buildPackage };

if (require.main === module) {
  let program = require("../utils/commander");
  let packageName = null;
  program
    .arguments("<name>")
    .action(name => {
      packageName = name;
    })
    .requiredArgs(1)
    .parse(process.argv)
    .run(buildPackage, packageName);
}

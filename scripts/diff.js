#!/usr/bin/env node
// Copyright 2019 Google LLC. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
// =============================================================================

const {exec} = require('./test-util');
const shell = require('shelljs');
const {readdirSync, statSync, writeFileSync} = require('fs');
const {join} = require('path');
const fs = require('fs');

const filesWhitelistToTriggerBuild = [
  'cloudbuild.yml', 'package.json', 'tsconfig.json', 'tslint.json',
  'scripts/diff.js', 'scripts/run-build.sh'
];

const CLONE_MASTER_PATH = 'clone-master';
const CLONE_CURRENT_PATH = 'clone-current';

const dirs = readdirSync('.').filter(f => {
  return f !== 'node_modules' && f !== '.git' && statSync(f).isDirectory();
});

console.log('REPO NAME', process.env['REPO_NAME']);
let commitSha = process.env['COMMIT_SHA'];
let branchName = process.env['BRANCH_NAME'];
// If commit sha or branch name are null we are running this locally and are in
// a git repository.
if (commitSha == null) {
  commitSha = exec(`git rev-parse HEAD`).stdout.trim();
}
if (branchName == null) {
  branchName = exec(`git rev-parse --abbrev-ref HEAD`).stdout.trim();
}
console.log('commitSha: ', commitSha);
console.log('branchName: ', branchName);

// We cannot do --depth=1 or --single-branch here because we need multiple
// branches at older commits.
// exec(`git clone https://github.com/tensorflow/tfjs ${CLONE_CURRENT_PATH}`);

// // Get the merge base from the current commit and master.
// shell.cd(CLONE_CURRENT_PATH);
// exec(`git checkout ${branchName}`);
// const mergeBase = exec(`git merge-base master ${branchName}`).stdout.trim();
// const res = shell.exec(`git checkout ${commitSha}`);
// let CURRENT_DIFF_PATH = CLONE_CURRENT_PATH;
// if (res.code !== 0) {
//   console.log(`${commitSha} does not exist. PR coming from a fork.`);

//   // Since we're coming from a fork we can't clone the fork so we'll diff
//   // against what's checked out locally.
//   CURRENT_DIFF_PATH = '.';
// }
// shell.cd('..');


// We cannot do --depth=1 here because we need to check out an old merge base.
// We cannot do --single-branch here because we need multiple branches.
exec(
    `git clone ` +
    `https://github.com/tensorflow/tfjs ${CLONE_MASTER_PATH}`);

shell.cd(CLONE_MASTER_PATH);
exec(`git checkout ${branchName}`);
const mergeBase = exec(`git merge-base master ${branchName}`).stdout.trim();
exec(`git fetch origin ${mergeBase}`);
exec(`git checkout ${mergeBase}`);
shell.cd('..');

console.log('mergeBase: ', mergeBase);

let triggerAllBuilds = false;
let whitelistDiffOutput = [];
filesWhitelistToTriggerBuild.forEach(fileToTriggerBuild => {
  const diffOutput = diff(fileToTriggerBuild);
  if (diffOutput !== '') {
    console.log(fileToTriggerBuild, 'has changed. Triggering all builds.');
    triggerAllBuilds = true;
    whitelistDiffOutput.push(diffOutput);
  }
});

// Break up the console for readability.
console.log();

let triggeredBuilds = [];
dirs.forEach(dir => {
  shell.rm(`${dir}/diff`);
  const diffOutput = diff(`${dir}/`);
  if (diffOutput !== '') {
    console.log(`${dir} has modified files.`);
  } else {
    console.log(`No modified files found in ${dir}`);
  }

  const shouldDiff = diffOutput !== '' || triggerAllBuilds;
  if (shouldDiff) {
    const diffContents = whitelistDiffOutput.join('\n') + '\n' + diffOutput;
    writeFileSync(join(dir, 'diff'), diffContents);
    triggeredBuilds.push(dir);
  }
});

// Break up the console for readability.
console.log();

// Filter the triggered builds to log by whether a cloudbuild.yml file
// exists for that directory.
triggeredBuilds = triggeredBuilds.filter(
    triggeredBuild => fs.existsSync(triggeredBuild + '/cloudbuild.yml'));
console.log('Triggering builds for ', triggeredBuilds.join(', '));

function diff(fileOrDirName) {
  const diffCmd = `diff -rq ` +
      `${CLONE_MASTER_PATH}/${fileOrDirName} ` +
      `${fileOrDirName}`;
  return exec(diffCmd, {silent: true}, true).stdout.trim();
}

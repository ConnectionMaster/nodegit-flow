module.exports = (NodeGit, { constants, utils }, { Config }) => {
  /**
   * All of this class' functions are attached to `NodeGit.Flow` or a `Flow` instance object
   * @class
   */
  class Release {
    constructor(repo) {
      this.repo = repo;
    }

    /**
     * Starts a git flow "release"
     * @async
     * @param {Object}  repo            The repository to start a release in
     * @param {String}  releaseVersion  The version of the release to start
     * @param {Object}  options         Options for start release
     * @return {Branch}   The nodegit branch for the release
     */
    static startRelease(repo, releaseVersion, options = {}) {
      const {
        postCheckoutHook  = () => {},
        sha
      } = options;

      if (!repo) {
        return Promise.reject(new Error(constants.ErrorMessage.REPO_REQUIRED));
      }

      if (!releaseVersion) {
        return Promise.reject(new Error('Release version is required'));
      }

      let releaseBranchName;
      let releaseBranch;

      return Config.getConfig(repo)
        .then((config) => {
          const releasePrefix = config['gitflow.prefix.release'];
          const developBranchName = config['gitflow.branch.develop'];
          releaseBranchName = releasePrefix + releaseVersion;

          // If we have a sha look that up instead of the develop branch
          if (sha) {
            return NodeGit.Commit.lookup(repo, sha);
          }

          return NodeGit.Branch.lookup(
            repo,
            developBranchName,
            NodeGit.Branch.BRANCH.LOCAL
          )
            .then((developBranch) => NodeGit.Commit.lookup(repo, developBranch.target()));
        })
        .then((startingCommit) => repo.createBranch(releaseBranchName, startingCommit))
        .then((_releaseBranch) => {
          releaseBranch = _releaseBranch;
          return repo.head()
          .then((headRef) => {
            return repo.checkoutBranch(releaseBranch)
            .then(() => repo.head())
            .then(newHeadRef => postCheckoutHook(
              headRef.target().toString(),
              newHeadRef.target().toString()
            ));
          })
        })
        .then(() => releaseBranch);
    }

    /**
     * Finishes a git flow "release"
     * @async
     * @param {Object}  repo            The repository to finish a release in
     * @param {String}  releaseVersion  The version of the release to finish
     * @param {Object}  options         Options for finish release
     * @return {Commit}   The commit created by finishing the release
     */
    static finishRelease(repo, releaseVersion, options = {}) {
      const {
        keepBranch,
        message,
        processMergeMessageCallback,
        beforeMergeCallback = () => {},
        postDevelopMergeCallback = () => {},
        postMasterMergeCallback = () => {},
        postCheckoutHook = () => {},
        signingCallback,
        onlyMaster = false,
      } = options;

      if (!repo) {
        return Promise.reject(new Error('Repo is required'));
      }

      if (!releaseVersion) {
        return Promise.reject(new Error('Release name is required'));
      }

      let developBranchName;
      let releaseBranchName;
      let masterBranchName;
      let developBranch;
      let releaseBranch;
      let masterBranch;
      let cancelDevelopMerge;
      let cancelMasterMerge;
      let developCommit;
      let releaseCommit;
      let masterCommit;
      let mergeCommit;
      let versionPrefix;
      return Config.getConfig(repo)
        .then((config) => {
          developBranchName = config['gitflow.branch.develop'];
          releaseBranchName = config['gitflow.prefix.release'] + releaseVersion;
          masterBranchName = config['gitflow.branch.master'];
          versionPrefix = config['gitflow.prefix.versiontag'];

          // Get the develop, master, and release branch
          return Promise.all(
            [developBranchName, releaseBranchName, masterBranchName]
              .map((branchName) => NodeGit.Branch.lookup(repo, branchName, NodeGit.Branch.BRANCH.LOCAL))
          );
        })
        .then((branches) => {
          developBranch = branches[0];
          releaseBranch = branches[1];
          masterBranch = branches[2];

          // Get the commits that the develop, master, and release branches point to
          return Promise.all(branches.map((branch) => repo.getCommit(branch.target())));
        })
        .then((commits) => {
          developCommit = commits[0];
          releaseCommit = commits[1];
          masterCommit = commits[2];

          // If either develop or master point to the same commit as the release branch cancel
          // their respective merge
          cancelDevelopMerge = onlyMaster || developCommit.id().toString() === releaseCommit.id().toString();
          cancelMasterMerge = masterCommit.id().toString() === releaseCommit.id().toString();

          // Merge release into develop
          if (!cancelDevelopMerge) {
            return Promise.resolve(beforeMergeCallback(developBranchName, releaseBranchName))
              .then(() => utils.Repo.merge(developBranch, releaseBranch, repo, processMergeMessageCallback, signingCallback))
              .then(utils.InjectIntermediateCallback(postDevelopMergeCallback));
          }
          return Promise.resolve();
        })
        .then((_mergeCommit) => {
          mergeCommit = _mergeCommit;

          const tagName = versionPrefix + releaseVersion;
          // Merge the release branch into master
          if (!cancelMasterMerge) {
            return Promise.resolve(beforeMergeCallback(masterBranchName, releaseBranchName))
              .then(() => utils.Repo.merge(masterBranch, releaseBranch, repo, processMergeMessageCallback, signingCallback))
              .then(utils.InjectIntermediateCallback(postMasterMergeCallback))
              .then((oid) => utils.Tag.create(oid, tagName, message, repo));
          }

          const masterOid = NodeGit.Oid.fromString(masterCommit.id().toString());
          return utils.Tag.create(masterOid, tagName, message, repo);
        })
        .then(() => {
          if (keepBranch) {
            return Promise.resolve();
          }

          return utils.Repo.safelyDeleteBranch(repo, releaseBranchName, masterBranchName, postCheckoutHook);
        })
        .then(() => mergeCommit);
    }

    /**
     * Starts a git flow "release"
     * @async
     * @param {String}  releaseVersion  The version of the release to start
     * @param {Object}  options         Options for start release
     * @return {Branch}   The nodegit branch for the release
     */
    startRelease() {
      return Release.startRelease(this.repo, ...arguments);
    }

    /**
     * Finishes a git flow "release"
     * @async
     * @param {String}  releaseVersion  The version of the release to finish
     * @param {Object}  options         Options for finish release
     * @return {Commit}   The commit created by finishing the release
     */
    finishRelease() {
      return Release.finishRelease(this.repo, ...arguments);
    }
  }

  return Release;
};

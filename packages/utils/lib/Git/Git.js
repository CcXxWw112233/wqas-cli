const fs = require('fs');
const path = require('path');
const fse = require('fs-extra');
const SimpleGit = require('simple-git');
const userHome = require('user-home');
const semver = require('semver');
const log = require('../log');
const inquirer = require('../inquirer');
const terminalLink = require('../terminalLink');
const spinner = require('../spinner');
const Github = require('./Github');
const Gitee = require('./Gitee');
const CloudBuild = require('../Build/CloudBuild');
const { readFile, writeFile } = require('../file');
const ComponentRequest = require('./ComponentRequest');
const getOSSFile = require('../Build/getOSSFile');
const get = require('lodash/get');
const axios = require('axios');

const DEFAULT_CLI_HOME = '.imooc-cli';
const GIT_ROOT_DIR = '.git';
const GIT_SERVER_FILE = '.git_server';
const GIT_TOKEN_FILE = '.git_token';
const GIT_LOGIN_FILE = '.git_login';
const GIT_OWN_FILE = '.git_own';
const GIT_PUBLISH_FILE = '.git_publish';
const GIT_IGNORE_FILE = '.gitignore';
const REPO_OWNER_USER = 'user'; // 用户仓库
const REPO_OWNER_ORG = 'org'; // 组织仓库

const GITHUB = 'github';
const GITEE = 'gitee';

const VERSION_RELEASE = 'release';
const VERSION_DEVELOP = 'dev';
const COMPONENT_FILE = '.componentrc';

const TEMPLATE_TEMP_DIR = 'oss';

const GIT_SERVER_TYPE = [ {
  name: 'Github',
  value: GITHUB,
}, {
  name: 'Gitee(码云)',
  value: GITEE,
} ];

const GIT_OWNER_TYPE = [ {
  name: '个人',
  value: REPO_OWNER_USER,
}, {
  name: '组织',
  value: REPO_OWNER_ORG,
} ];

const GIT_OWNER_TYPE_ONLY = [ {
  name: '个人',
  value: REPO_OWNER_USER,
} ];

const GIT_PUBLISH_TYPE = [ {
  name: 'OSS',
  value: 'oss',
} ];

function createGitServer(gitServer) {
  if (gitServer === GITHUB) {
    return new Github();
  } else if (gitServer === GITEE) {
    return new Gitee();
  }
  return null;
}

/**
 * Git 操作基类
 */
class Git {
  /**
   * 构造函数
   *
   * @param dir git 仓库本地目录
   * @param name git 仓库名称
   * @param version git 分支号
   * @param cliHome 缓存根目录
   * @param refreshToken 是否强制刷新token数据
   * @param refreshOwner 是否强制刷新own数据
   * @param refreshServer 是否强制刷新git远程仓库类型
   * @param prod 是否为正式发布，正式发布后会建立tag删除开发分支
   * @param sshUser 远程服务器用户名
   * @param sshIp 远程服务器IP
   * @param sshPath 远程服务器路径
   */
  constructor({ dir, name, version }, {
    cliHome, refreshToken, refreshOwner, refreshServer,
    sshUser, sshIp, sshPath, prod, keepCache, cnpm, buildCmd,
  }) {
    this.git = SimpleGit(dir);
    this.name = name;
    this.version = version;
    this.dir = dir; // 仓库本地路径
    this.owner = REPO_OWNER_USER; // owner 信息
    this.login = null; // 当前登录用户信息
    this.repo = null; // git 仓库
    this.homePath = cliHome; // 用户缓存主目录
    this.refreshToken = refreshToken; // 强制刷新 token
    this.refreshOwner = refreshOwner; // 强制刷新 owner
    this.refreshServer = refreshServer; // 强制刷新 git 远程仓库类型
    this.sshUser = sshUser;
    this.sshIp = sshIp;
    this.sshPath = sshPath;
    this.gitServer = null; // 默认远程 git 服务
    this.prod = prod; // 是否为正式发布
    this.keepCache = keepCache; // 是否保留服务端缓存（用于调试bug）
    this.cnpm = cnpm; // 是否使用cnpm
    this.buildCmd = buildCmd; // 手动指定build命令
  }

  // 核心业务逻辑，提交代码前的准备工作
  prepare = async () => {
    this.checkHomePath();
    await this.checkGitServer();
    await this.checkGitToken();
    await this.checkUserAndOrgs();
    await this.checkGitOwner();
    await this.checkRepo();
    await this.checkGitIgnore();
    await this.checkComponent();
    await this.init();
  };

  // 检查缓存主目录
  checkHomePath = () => {
    if (!this.homePath) {
      if (process.env.CLI_HOME) {
        this.homePath = path.resolve(userHome, process.env.CLI_HOME);
      } else {
        this.homePath = path.resolve(userHome, DEFAULT_CLI_HOME);
      }
    }
    log.verbose('home', this.homePath);
    fse.ensureDirSync(this.homePath);
    if (!fs.existsSync(this.homePath)) {
      throw new Error('用户主目录获取失败！');
    }
  };

  // 创建缓存目录
  createPath = (file) => {
    const rootDir = path.resolve(this.homePath, GIT_ROOT_DIR);
    const filePath = path.resolve(rootDir, file);
    fse.ensureDirSync(rootDir);
    return filePath;
  };

  // 选择远程 git 平台
  checkGitServer = async () => {
    const gitServerPath = this.createPath(GIT_SERVER_FILE);
    let gitServer = readFile(gitServerPath);
    if (!gitServer || this.refreshServer) {
      gitServer = await inquirer({
        type: 'list',
        choices: GIT_SERVER_TYPE,
        message: '请选择您想要托管的Git平台',
      });
      writeFile(gitServerPath, gitServer);
      log.success('git server写入成功', `${gitServer} -> ${gitServerPath}`);
    } else {
      log.success('git server获取成功', gitServer);
    }
    this.gitServer = createGitServer(gitServer);
  };

  // 检查 git API 必须的 token
  checkGitToken = async () => {
    const tokenPath = this.createPath(GIT_TOKEN_FILE);
    let token = readFile(tokenPath);
    if (!token || this.refreshToken) {
      log.notice(this.gitServer.type + ' token未生成', '请先生成 ' + this.gitServer.type + ' token，' + terminalLink('链接', this.gitServer.getTokenHelpUrl()));
      token = await inquirer({
        type: 'password',
        message: '请将token复制到这里',
        defaultValue: '',
      });
      writeFile(tokenPath, token);
      log.success('token 写入成功', `${token} -> ${tokenPath}`);
    } else {
      log.verbose('token', token);
      log.success('token 获取成功', tokenPath);
    }
    this.token = token;
    this.gitServer.setToken(token);
  };

  // 获取用户和组织信息
  checkUserAndOrgs = async () => {
    this.user = await this.gitServer.getUser();
    this.orgs = await this.gitServer.getOrgs();
    if (!this.user) {
      throw new Error('用户或组织信息获取失败');
    }
    log.success(this.gitServer.type + ' 用户和组织信息获取成功');
  };

  // 检查 git owner 是否选择
  checkGitOwner = async () => {
    const ownerPath = this.createPath(GIT_OWN_FILE);
    const loginPath = this.createPath(GIT_LOGIN_FILE);
    let owner = readFile(ownerPath);
    let login = readFile(loginPath);
    if (!owner || !login || this.refreshOwner) {
      log.notice(this.gitServer.type + ' owner 未生成，先选择 owner');
      owner = await inquirer({
        type: 'list',
        choices: this.orgs.length > 0 ? GIT_OWNER_TYPE : GIT_OWNER_TYPE_ONLY,
        message: '请选择远程仓库类型',
      });
      if (owner === REPO_OWNER_USER) {
        login = this.user.login;
      } else {
        login = await inquirer({
          type: 'list',
          choices: this.orgs.map(item => ({
            name: item.login,
            value: item.login,
          })),
          message: '请选择',
        });
      }
      writeFile(ownerPath, owner);
      writeFile(loginPath, login);
      log.success('git owner写入成功', `${owner} -> ${ownerPath}`);
      log.success('git login写入成功', `${login} -> ${loginPath}`);
    } else {
      log.success('git owner 获取成功', owner);
      log.success('git login 获取成功', login);
    }
    this.owner = owner;
    this.login = login;
  };

  // 检查远程仓库
  checkRepo = async () => {
    let repo = await this.gitServer.getRepo(this.login, this.name);
    if (!repo) {
      let spinnerStart = spinner('开始创建远程仓库...');
      try {
        if (this.owner === REPO_OWNER_USER) {
          repo = await this.gitServer.createRepo(this.name);
        } else {
          repo = await this.gitServer.createOrgRepo(this.name, this.login);
        }
      } finally {
        spinnerStart.stop(true);
      }
      if (repo) {
        log.success('远程仓库创建成功');
      } else {
        throw new Error('远程仓库创建失败');
      }
    }
    log.success('远程仓库信息获取成功');
    this.repo = repo;
  };

  // 检查 .gitignore
  checkGitIgnore = async () => {
    const gitIgnore = path.resolve(this.dir, GIT_IGNORE_FILE);
    if (!fs.existsSync(gitIgnore)) {
      if (this.isComponent()) {
        writeFile(gitIgnore, `.DS_Store
node_modules


# local env files
.env.local
.env.*.local

# Log files
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# Editor directories and files
.idea
.vscode
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?`);
        log.success('自动写入 .gitignore 文件');
      } else {
        writeFile(gitIgnore, `.DS_Store
node_modules
/dist


# local env files
.env.local
.env.*.local

# Log files
npm-debug.log*
yarn-debug.log*
yarn-error.log*
pnpm-debug.log*

# Editor directories and files
.idea
.vscode
*.suo
*.ntvs*
*.njsproj
*.sln
*.sw?`);
        log.success('自动写入 .gitignore 文件');
      }
    }
  };

  // 检查 component
  checkComponent = async () => {
    let componentFile = this.isComponent();
    // 只有 component 才启动该逻辑
    if (componentFile) {
      log.notice('开始检查 build 结果');
      require('child_process').execSync('npm run build', {
        cwd: this.dir,
      });
      const buildPath = path.resolve(this.dir, componentFile.buildPath);
      if (!fs.existsSync(buildPath)) {
        throw new Error(`构建结果：${buildPath} 不存在！`);
      }
      const pkg = this.getPackageJson();
      if (!pkg.files || !pkg.files.includes(componentFile.buildPath)) {
        throw new Error(`package.json 中 files 属性未添加构建结果目录：[${componentFile.buildPath}]，请在 package.json 中手动添加！`);
      }
      log.notice('build 结果检查通过');
    }
  };

  // 初始化
  init = async () => {
    if (await this.getRemote()) {
      return true;
    }
    await this.initAndAddRemote();
    await this.initCommit();
  };

  getRemote = async () => {
    const gitPath = path.resolve(this.dir, GIT_ROOT_DIR);
    this.remote = this.gitServer.getRemote(this.login, this.name);
    if (fs.existsSync(gitPath)) {
      log.success('git 已完成初始化');
      return true;
    }
  };

  initAndAddRemote = async () => {
    log.notice('执行 git 初始化');
    await this.git.init(this.dir);
    log.notice('添加 git remote');
    const remotes = await this.git.getRemotes();
    log.verbose('git remotes', remotes);
    if (!remotes.find(item => item.name === 'origin')) {
      await this.git.addRemote('origin', this.remote);
    }
  };

  initCommit = async () => {
    await this.checkConflicted();
    await this.checkNotCommitted();
    if (await this.checkRemoteMaster()) {
      log.notice('远程存在 master 分支，强制合并');
      await this.pullRemoteRepo('master', { '--allow-unrelated-histories': null });
    } else {
      await this.pushRemoteRepo('master');
    }
  };

  checkRemoteMaster = async () => {
    return (await this.git.listRemote([ '--refs' ])).indexOf('refs/heads/master') >= 0;
  };

  checkConflicted = async () => {
    log.notice('代码冲突检查');
    const status = await this.git.status();
    if (status.conflicted.length > 0) {
      throw new Error('当前代码存在冲突，请手动处理合并后再试！');
    }
    log.success('代码检查通过');
  };

  checkNotCommitted = async () => {
    const status = await this.git.status();
    if (status.not_added.length > 0 ||
      status.created.length > 0 ||
      status.deleted.length > 0 ||
      status.modified.length > 0 ||
      status.renamed.length > 0) {
      log.verbose('status', status);
      await this.git.add(status.not_added);
      await this.git.add(status.created);
      await this.git.add(status.deleted);
      await this.git.add(status.modified);
      await this.git.add(status.renamed);
      let message;
      while (!message) {
        message = await inquirer({
          type: 'text',
          message: '请输入 commit 信息：',
          defaultValue: '',
        });
      }
      await this.git.commit(message);
      log.success('本地 commit 提交成功');
    }
  };

  pullRemoteRepo = async (branchName, options = {}) => {
    log.notice(`同步远程 ${branchName} 分支代码`);
    await this.git.pull('origin', branchName, options).catch(err => {
      if (err.message.indexOf('Permission denied (publickey)') >= 0) {
        throw new Error(`请获取本地 ssh publickey 并配置到：${this.gitServer.getSSHKeysUrl()}，配置方法：${this.gitServer.getSSHKeysHelpUrl()}`);
      } else if (err.message.indexOf('Couldn\'t find remote ref ' + branchName) >= 0) {
        log.notice('获取远程 [' + branchName + '] 分支失败');
      } else {
        log.error(err.message);
      }
      log.error('请重新执行 imooc-cli publish，如仍然报错请尝试删除 .git 目录后重试');
      process.exit(0);
    });
  };

  pushRemoteRepo = async (branchName) => {
    log.notice(`推送代码至远程 ${branchName} 分支`);
    await this.git.push('origin', branchName);
    log.success('推送代码成功');
  };

  getCorrectVersion = async () => {
    log.notice('获取代码分支');
    const remoteBranchList = await this.getRemoteBranchList(VERSION_RELEASE);
    let releaseVersion = null;
    if (remoteBranchList && remoteBranchList.length > 0) {
      // 获取最近的线上版本
      releaseVersion = remoteBranchList[0];
    }
    const devVersion = this.version;
    if (!releaseVersion) {
      this.branch = `${VERSION_DEVELOP}/${devVersion}`;
    } else if (semver.gt(this.version, releaseVersion)) {
      log.info('当前版本大于线上最新版本', `${devVersion} >= ${releaseVersion}`);
      this.branch = `${VERSION_DEVELOP}/${devVersion}`;
    } else {
      log.notice('当前线上版本大于或等于本地版本', `${releaseVersion} >= ${devVersion}`);
      const incType = await inquirer({
        type: 'list',
        choices: [ {
          name: `小版本（${releaseVersion} -> ${semver.inc(releaseVersion, 'patch')}）`,
          value: 'patch',
        }, {
          name: `中版本（${releaseVersion} -> ${semver.inc(releaseVersion, 'minor')}）`,
          value: 'minor',
        }, {
          name: `大版本（${releaseVersion} -> ${semver.inc(releaseVersion, 'major')}）`,
          value: 'major',
        } ],
        defaultValue: 'patch',
        message: '自动升级版本，请选择升级版本类型',
      });
      const incVersion = semver.inc(releaseVersion, incType);
      this.branch = `${VERSION_DEVELOP}/${incVersion}`;
      this.version = incVersion;
      this.syncVersionToPackageJson();
    }
    log.success(`代码分支获取成功 ${this.branch}`);
  };

  syncVersionToPackageJson = () => {
    const pkg = fse.readJsonSync(`${this.dir}/package.json`);
    if (pkg && pkg.version !== this.version) {
      pkg.version = this.version;
      fse.writeJsonSync(`${this.dir}/package.json`, pkg, { spaces: 2 });
    }
  };

  getRemoteBranchList = async (type) => {
    // git ls-remote --refs
    const remoteList = await this.git.listRemote([ '--refs' ]);
    let reg;
    if (type === VERSION_RELEASE) {
      reg = /.+?refs\/tags\/release\/(\d+\.\d+\.\d+)/g;
    } else {
      reg = /.+?refs\/heads\/dev\/(\d+\.\d+\.\d+)/g;
    }
    return remoteList.split('\n').map(remote => {
      const match = reg.exec(remote);
      reg.lastIndex = 0;
      if (match && semver.valid(match[1])) {
        return match[1];
      }
    }).filter(_ => _).sort((a, b) => {
      if (semver.lte(b, a)) {
        if (a === b) return 0;
        return -1;
      }
      return 1;
    });
  };

  checkoutBranch = async (branch) => {
    const localBranchList = await this.git.branchLocal();
    if (localBranchList.all.indexOf(branch) >= 0) {
      await this.git.checkout(branch);
    } else {
      await this.git.checkoutLocalBranch(branch);
    }
    log.success(`分支切换到${branch}`);
  };

  checkStash = async () => {
    log.notice('检查 stash 记录');
    const stashList = await this.git.stashList();
    if (stashList.all.length > 0) {
      await this.git.stash([ 'pop' ]);
      log.success('stash pop 成功');
    }
  };

  pullRemoteMasterAndBranch = async () => {
    log.notice(`合并 [master] -> [${this.branch}]`);
    await this.pullRemoteRepo('master');
    log.success('合并远程 [master] 分支内容成功');
    await this.checkConflicted();
    log.notice('检查远程分支');
    const remoteBranchList = await this.getRemoteBranchList();
    if (remoteBranchList.indexOf(this.version) >= 0) {
      log.notice(`合并 [${this.branch}] -> [${this.branch}]`);
      await this.pullRemoteRepo(this.branch);
      log.success(`合并远程 [${this.branch}] 分支内容成功`);
      await this.checkConflicted();
    } else {
      log.success(`不存在远程分支 [${this.branch}]`);
    }
  };

  // 提交代码
  commit = async () => {
    await this.getCorrectVersion();
    await this.checkStash();
    await this.checkConflicted();
    await this.checkNotCommitted();
    await this.checkoutBranch(this.branch);
    await this.pullRemoteMasterAndBranch();
    await this.pushRemoteRepo(this.branch);
  };

  // 发布前自动检查
  prePublish = async () => {
    log.notice('开始执行发布前自动检查任务');
    // 代码检查
    this.checkProject();
    // build 检查
    log.success('自动检查通过');
  };

  // 获取项目package.json文件
  getPackageJson = () => {
    const pkgPath = path.resolve(this.dir, 'package.json');
    if (!fs.existsSync(pkgPath)) {
      throw new Error('package.json 不存在！');
    }
    return fse.readJsonSync(pkgPath);
  };

  // build结果检查
  checkProject = () => {
    log.notice('开始检查代码结构');
    const pkg = this.getPackageJson();
    if (!pkg.scripts || !Object.keys(pkg.scripts).includes('build')) {
      throw new Error('build命令不存在！');
    }
    log.success('代码结构检查通过');
    log.notice('开始检查 build 结果');
    if (this.buildCmd) {
      require('child_process').execSync(this.buildCmd, {
        cwd: this.dir,
      });
    } else {
      require('child_process').execSync('npm run build', {
        cwd: this.dir,
      });
    }
    log.notice('build 结果检查通过');
  };

  // 判断是否为组件
  isComponent = () => {
    const componentFilePath = path.resolve(this.dir, COMPONENT_FILE);
    return fs.existsSync(componentFilePath) && fse.readJsonSync(componentFilePath);
  };

  // 将组件信息保存至数据库
  saveComponentToDB = async () => {
    log.notice('上传组件信息至OSS+写入数据库');
    const componentFile = this.isComponent();
    const componentExamplePath = path.resolve(this.dir, componentFile.examplePath);
    let dirs = fs.readdirSync(componentExamplePath);
    dirs = dirs.filter(dir => dir.match(/^index(\d)*.html$/));
    componentFile.exampleList = dirs;
    const data = await ComponentRequest.createComponent({
      component: componentFile,
      git: {
        type: this.gitServer.type,
        remote: this.remote,
        version: this.version,
        branch: this.branch,
        login: this.login,
        owner: this.owner,
        repo: this.repo,
      },
    });
    if (!data) {
      throw new Error('上传组件失败');
    }
    log.notice('保存组件信息成功');
    log.notice('上传预览页面至OSS');
    log.success('上传预览页面至OSS');
  };

  // 发布组件至NPM
  uploadComponentToNpm = async () => {
    if (this.isComponent()) {
      log.notice('开始发布 npm');
      require('child_process').execSync('npm publish', {
        cwd: this.dir,
      });
      log.notice('npm 发布成功');
    }
  };

  // 发布HTML模板代码
  uploadTemplate = async () => {
    if (this.sshUser && this.sshPath && this.sshIp) {
      log.notice('开始下载模板文件');
      const ossTemplateFile = await getOSSFile({
        type: this.prod ? 'prod' : 'dev',
        name: `${this.name}/index.html`,
      });
      log.verbose('ossTemplateFile', ossTemplateFile);
      const templateFileUrl = get(ossTemplateFile, 'data[0].url');
      log.verbose('templateFileUrl', templateFileUrl);
      const response = await axios.get(templateFileUrl);
      if (response.data) {
        const ossTempDir = path.resolve(this.homePath, TEMPLATE_TEMP_DIR, `${this.name}@${this.version}`);
        if (!fs.existsSync(ossTempDir)) {
          fse.mkdirpSync(ossTempDir);
        } else {
          fse.emptyDirSync(ossTempDir);
        }
        const templateFilePath = path.resolve(ossTempDir, 'index.html');
        fse.createFileSync(templateFilePath);
        fs.writeFileSync(templateFilePath, response.data);
        log.success('模板文件下载成功', templateFilePath);
        log.notice('开始上传模板文件至服务器');
        const uploadCmd = `scp -r ${templateFilePath} ${this.sshUser}@${this.sshIp}:${this.sshPath}`;
        log.verbose('uploadCmd', uploadCmd);
        const ret = require('child_process').execSync(uploadCmd);
        console.log(ret.toString());
        log.success('模板文件上传成功');
        fse.emptyDirSync(ossTempDir);
      }
    }
  };

  // 测试/正式发布
  publish = async () => {
    let buildRet = false;
    if (this.isComponent()) {
      log.notice('开始发布组件');
      await this.saveComponentToDB();
    } else {
      await this.prePublish();
      log.notice('开始发布');
      const gitPublishTypePath = this.createPath(GIT_PUBLISH_FILE);
      let gitPublishType = readFile(gitPublishTypePath);
      if (!gitPublishType) {
        gitPublishType = await inquirer({
          type: 'list',
          choices: GIT_PUBLISH_TYPE,
          message: '请选择您想要上传代码的平台',
        });
        writeFile(gitPublishTypePath, gitPublishType);
        log.success('git publish类型写入成功', `${gitPublishType} -> ${gitPublishTypePath}`);
      } else {
        log.success('git publish类型获取成功', gitPublishType);
      }
      const cloudBuild = new CloudBuild(this, gitPublishType, {
        prod: !!this.prod,
        keepCache: !!this.keepCache,
        cnpm: !!this.cnpm,
        buildCmd: this.buildCmd,
      });
      await cloudBuild.prepare();
      await cloudBuild.init();
      buildRet = await cloudBuild.build();
      if (buildRet) {
        await this.uploadTemplate();
      }
    }
    if (this.prod && buildRet) {
      await this.uploadComponentToNpm();
      await this.checkTag(); // 打tag
      await this.checkoutBranch('master'); // 切换分支到master
      await this.mergeBranchToMaster(); // 将代码合并到master
      await this.pushRemoteRepo('master'); // 将代码推送到远程master
      await this.deleteLocalBranch(); // 删除本地分支
      await this.deleteRemoteBranch(); // 删除远程分支
    }
    if (buildRet) {
      log.success('发布成功');
    } else {
      log.success('发布失败');
    }
    return buildRet;
  };

  checkTag = async () => {
    log.notice('获取远程 tag 列表');
    const tag = `${VERSION_RELEASE}/${this.version}`;
    const tagList = await this.getRemoteBranchList(VERSION_RELEASE);
    if (tagList.includes(this.version)) {
      log.success('远程 tag 已存在', tag);
      await this.git.push([ 'origin', `:refs/tags/${tag}` ]);
      log.success('远程 tag 已删除', tag);
    }
    const localTagList = await this.git.tags();
    if (localTagList.all.includes(tag)) {
      log.success('本地 tag 已存在', tag);
      await this.git.tag([ '-d', tag ]);
      log.success('本地 tag 已删除', tag);
    }
    await this.git.addTag(tag);
    log.success('本地 tag 创建成功', tag);
    await this.git.pushTags('origin');
    log.success('远程 tag 推送成功', tag);
  };

  mergeBranchToMaster = async () => {
    log.notice('开始合并代码', `[${this.branch}] -> [master]`);
    await this.git.mergeFromTo(this.branch, 'master');
    log.success('代码合并成功', `[${this.branch}] -> [master]`);
  };

  deleteLocalBranch = async () => {
    log.notice('开始删除本地分支', this.branch);
    await this.git.deleteLocalBranch(this.branch);
    log.success('删除本地分支成功', this.branch);
  };

  deleteRemoteBranch = async () => {
    log.notice('开始删除远程分支', this.branch);
    await this.git.push([ 'origin', '--delete', this.branch ]);
    log.success('删除远程分支成功', this.branch);
  };
}

module.exports = Git;

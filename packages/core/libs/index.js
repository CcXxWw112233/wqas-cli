const fs = require('fs');
const path = require('path');
const fse = require('fs-extra');
const program = require('commander');
const colors = require('colors/safe');
const userHome = require('user-home');
const semver = require('semver');
const { log, npm, Package, exec, locale } = require('@imooc-cli/utils');
const packageConfig = require('../package');

const {
  LOWEST_NODE_VERSION,
  DEFAULT_CLI_HOME,
  NPM_NAME,
  DEPENDENCIES_PATH,
} = require('../libs/const');

module.exports = cli;

let args;
let config;

async function cli() {
  try {
    await prepare();
    registerCommand();
  } catch (e) {
    log.error(e.message);
  }
}

function registerCommand() {
  program.version(packageConfig.version).usage('<command> [options]');

  program
    .command('learn')
    .description('访问课程链接')
    .action(() => {
      log.success('欢迎学习', '慕课网前端架构师课程');
      log.success('课程链接', 'https://coding.imooc.com/class/445.html');
      log.success('课程介绍', '小宇宙燃烧吧');
      log.success('作者介绍', 'Sam@2020');
    });

  program
    .command('init [type]')
    .description('项目初始化')
    .option('--packagePath <packagePath>', '手动指定init包路径')
    .option('--force', '覆盖当前路径文件（谨慎使用）')
    .action(async (type, { packagePath, force }) => {
      const packageName = '@imooc-cli/init';
      const packageVersion = '1.0.0';
      await execCommand({ packagePath, packageName, packageVersion }, { type, force });
    });

  program
    .command('publish')
    .description('项目发布')
    .option('--packagePath <packagePath>', '手动指定publish包路径')
    .option('--refreshToken', '强制更新git token信息')
    .option('--refreshOwner', '强制更新git owner信息')
    .option('--refreshServer', '强制更新git server信息')
    .option('--force', '强制更新所有缓存信息')
    .option('--prod', '正式发布')
    .option('--keepCache', '保留缓存')
    .option('--cnpm', '使用cnpm')
    .option('--buildCmd <buildCmd>', '手动指定build命令')
    .option('--sshUser <sshUser>', '模板服务端用户名')
    .option('--sshIp <sshIp>', '模板服务器IP或域名')
    .option('--sshPath <sshPath>', '模板服务器上传路径')
    .action(async ({
                     packagePath,
                     refreshToken,
                     refreshOwner,
                     refreshServer,
                     force,
                     prod,
                     sshUser,
                     sshIp,
                     sshPath,
                     keepCache,
                     cnpm,
                     buildCmd,
                   }) => {
      const packageName = '@imooc-cli/publish';
      const packageVersion = '1.0.0';
      if (force) {
        refreshToken = true;
        refreshOwner = true;
        refreshServer = true;
      }
      await execCommand({ packagePath, packageName, packageVersion }, {
        refreshToken,
        refreshOwner,
        refreshServer,
        prod,
        sshUser,
        sshIp,
        sshPath,
        keepCache,
        cnpm,
        buildCmd,
      });
    });

  program
    .command('replace')
    .description('作业网站优化')
    .option('--packagePath <packagePath>', '手动指定replace包路径')
    .option('--region <region>', 'oss region')
    .option('--bucket <bucket>', 'oss bucket')
    .option('--ossAccessKey <ossAccessKey>', 'oss accessKey')
    .option('--ossSecretKey <ossSecretKey>', 'oss secretKey')
    .action(async ({ packagePath, region, bucket, ossAccessKey, ossSecretKey }) => {
      const packageName = '@imooc-cli/replace';
      const packageVersion = '1.0.0';
      await execCommand({ packagePath, packageName, packageVersion }, { region, bucket, ossAccessKey, ossSecretKey });
    });

  program
    .command('clean')
    .description('清空缓存文件')
    .option('-a, --all', '清空全部')
    .option('-d, --dep', '清空依赖文件')
    .action((options) => {
      log.notice('开始清空缓存文件');
      if (options.all) {
        cleanAll();
      } else if (options.dep) {
        const depPath = path.resolve(config.cliHome, DEPENDENCIES_PATH);
        if (fs.existsSync(depPath)) {
          fse.emptyDirSync(depPath);
          log.success('清空依赖文件成功', depPath);
        } else {
          log.success('文件夹不存在', depPath);
        }
      } else {
        cleanAll();
      }
    });

  program
    .option('--debug', '打开调试模式')
    .parse(process.argv);

  if (args._.length < 1) {
    program.outputHelp();
    console.log();
  }
}

async function execCommand({ packagePath, packageName, packageVersion }, extraOptions) {
  let rootFile;
  try {
    if (packagePath) {
      const execPackage = new Package({
        targetPath: packagePath,
        storePath: packagePath,
        name: packageName,
        version: packageVersion,
      });
      rootFile = execPackage.getRootFilePath(true);
    } else {
      const { cliHome } = config;
      const packageDir = `${DEPENDENCIES_PATH}`;
      const targetPath = path.resolve(cliHome, packageDir);
      const storePath = path.resolve(targetPath, 'node_modules');
      const initPackage = new Package({
        targetPath,
        storePath,
        name: packageName,
        version: packageVersion,
      });
      if (await initPackage.exists()) {
        await initPackage.update();
      } else {
        await initPackage.install();
      }
      rootFile = initPackage.getRootFilePath();
    }
    const _config = Object.assign({}, config, extraOptions, {
      debug: args.debug,
    });
    if (fs.existsSync(rootFile)) {
      const code = `require('${rootFile}')(${JSON.stringify(_config)})`;
      const p = exec('node', ['-e', code], { 'stdio': 'inherit' });
      p.on('error', e => {
        log.verbose('命令执行失败:', e);
        handleError(e);
        process.exit(1);
      });
      p.on('exit', c => {
        log.verbose('命令执行成功:', c);
        process.exit(c);
      });
    } else {
      throw new Error('入口文件不存在，请重试！');
    }
  } catch (e) {
    log.error(e.message);
  }
}

function handleError(e) {
  if (args.debug) {
    log.error('Error:', e.stack);
  } else {
    log.error('Error:', e.message);
  }
  process.exit(1);
}

function cleanAll() {
  if (fs.existsSync(config.cliHome)) {
    fse.emptyDirSync(config.cliHome);
    log.success('清空全部缓存文件成功', config.cliHome);
  } else {
    log.success('文件夹不存在', config.cliHome);
  }
}

async function prepare() {
  checkPkgVersion(); // 检查当前运行版本
  checkNodeVersion(); // 检查 node 版本
  checkRoot(); // 检查是否为 root 启动
  checkUserHome(); // 检查用户主目录
  checkInputArgs(); // 检查用户输入参数
  checkEnv(); // 检查环境变量
  await checkGlobalUpdate(); // 检查工具是否需要更新
}

async function checkGlobalUpdate() {
  log.verbose('检查 imooc-cli 最新版本');
  const currentVersion = packageConfig.version;
  const lastVersion = await npm.getNpmLatestSemverVersion(NPM_NAME, currentVersion);
  if (lastVersion && semver.gt(lastVersion, currentVersion)) {
    log.warn(colors.yellow(`请手动更新 ${NPM_NAME}，当前版本：${packageConfig.version}，最新版本：${lastVersion}
                更新命令： npm install -g ${NPM_NAME}`));
  }
}

function checkEnv() {
  log.verbose('开始检查环境变量');
  const dotenv = require('dotenv');
  dotenv.config({
    path: path.resolve(userHome, '.env'),
  });
  config = createCliConfig(); // 准备基础配置
  log.verbose('环境变量', config);
}

function createCliConfig() {
  const cliConfig = {
    home: userHome,
  };
  if (process.env.CLI_HOME) {
    cliConfig['cliHome'] = path.join(userHome, process.env.CLI_HOME);
  } else {
    cliConfig['cliHome'] = path.join(userHome, DEFAULT_CLI_HOME);
  }
  return cliConfig;
}

function checkInputArgs() {
  log.verbose('开始校验输入参数');
  const minimist = require('minimist');
  args = minimist(process.argv.slice(2)); // 解析查询参数
  checkArgs(args); // 校验参数
  log.verbose('输入参数', args);
}

function checkArgs(args) {
  if (args.debug) {
    process.env.LOG_LEVEL = 'verbose';
  } else {
    process.env.LOG_LEVEL = 'info';
  }
  log.level = process.env.LOG_LEVEL;
}

function checkUserHome() {
  if (!userHome || !fs.existsSync(userHome)) {
    throw new Error(colors.red('当前登录用户主目录不存在！'));
  }
}

function checkRoot() {
  const rootCheck = require('root-check');
  rootCheck(colors.red('请避免使用 root 账户启动本应用'));
}

function checkNodeVersion() {
  const semver = require('semver');
  if (!semver.gte(process.version, LOWEST_NODE_VERSION)) {
    throw new Error(colors.red(`imooc-cli 需要安装 v${LOWEST_NODE_VERSION} 以上版本的 Node.js`));
  }
}

function checkPkgVersion() {
  log.notice('cli', packageConfig.version);
  log.success(locale.welcome);
}

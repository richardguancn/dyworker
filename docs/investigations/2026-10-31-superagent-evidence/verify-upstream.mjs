// Run from the DYWorker checkout after cloning the fixed upstream revision into a temporary directory.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const require = createRequire(new URL('../../../package.json', import.meta.url));
const ts = require('typescript');
const source = process.argv[2];
if (!source) throw new Error('请提供固定版本的上游仓库目录');
const revision = spawnSync('git', ['-C', source, 'rev-parse', 'HEAD'], {encoding:'utf8'});
if (revision.status !== 0 || revision.stdout.trim() !== '6337fc823ce20251c8de8085948165c81aaa701e') {
  throw new Error('上游版本不符合本次调研版本');
}
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'dyworker-superagent-verify-'));
fs.writeFileSync(path.join(output,'package.json'), JSON.stringify({name:'dsh-superagent',type:'module'}));
const project = fileURLToPath(new URL('../../../', import.meta.url));
fs.symlinkSync(path.join(project,'node_modules'),path.join(output,'node_modules'),'dir');
for (const name of ['skills','prompts','locale']) fs.symlinkSync(path.resolve(source,name),path.join(output,name),'dir');
const input = path.resolve(source,'src');
function convert(directory) {
  for (const entry of fs.readdirSync(directory,{withFileTypes:true})) {
    const file=path.join(directory,entry.name);
    if(entry.isDirectory()){convert(file);continue;}
    if(!file.endsWith('.ts')||file.endsWith('.d.ts'))continue;
    const target=path.join(output,'src',path.relative(input,file).replace(/\.ts$/,'.js'));
    fs.mkdirSync(path.dirname(target),{recursive:true});
    const result=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}});
    fs.writeFileSync(target,result.outputText.replace(/(from\s+['"]|import\s*\(\s*['"])([^'"]+)\.ts(['"])/g,'$1$2.js$3'));
  }
}
convert(input);
fs.copyFileSync(new URL('./research.test.mjs',import.meta.url),path.join(output,'research.test.mjs'));
console.log(`临时验证目录：${output}`);
const result=spawnSync(process.execPath,['--test',path.join(output,'research.test.mjs')],{stdio:'inherit'});
process.exitCode=result.status??1;

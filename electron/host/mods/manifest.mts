import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

export const MOD_EVENTS = ['session.start','session.end','turn.start','turn.complete','tool.call','command.run','ui.render','ui.press','ui.input','ui.select'];
export const MOD_METHODS = ['plugin.name','plugin.root','session.id','session.cwd','session.usage','session.version',
  'ui.resolve','ui.invalidate','ui.open','ui.close','ui.panes','ui.status','ui.log','ui.toast','command.register',
  'store.get','store.set','store.delete','store.keys','clock.now','clock.after','clock.every','clock.sleep'];
export const MOD_ELEMENTS = ['Box','Text','Button','Input','Select','Markdown'];
const inside = (root,file) => {const relative=path.relative(root,file);return !relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
export async function readMod(directory: string) {
  const root = await fs.realpath(directory);
  const read = async (file: string) => { const actual=await fs.realpath(path.resolve(root,file));
    if(!inside(root,actual))throw new Error('模组文件指向安装目录之外');
    const stat=await fs.stat(actual);if(!stat.isFile()||stat.size>1024*1024)throw new Error('模组文件过大或不是普通文件');
    return fs.readFile(actual,'utf8');};
  const manifest=JSON.parse(await read('.claude-plugin/plugin.json'));
  if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(manifest.name)||typeof manifest.version!=='string'||!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(manifest.version))throw new Error('模组名称或版本不正确');
  if(manifest.hooks&&typeof manifest.hooks!=='string')throw new Error('当前仅支持独立 hooks 配置文件');
  const hooksFile=path.relative(root,path.resolve(root,manifest.hooks||'hooks/hooks.json'));
  if(!inside(root,path.resolve(root,hooksFile)))throw new Error('模组配置越出安装目录');
  const hooks=JSON.parse(await read(hooksFile));
  if(!Array.isArray(hooks.modules)||hooks.modules.length!==1||typeof hooks.modules[0]!=='string')throw new Error('模组必须声明一个代码入口');
  if(hooks.hooks&&Object.keys(hooks.hooks).length)throw new Error('此模组还包含尚未支持的外部脚本规则');
  const modules:any={}, events=new Set<string>(),methods=new Set<string>();const errors:string[]=[];
  const load=async(file:string)=>{
    const actual=await fs.realpath(file);if(!inside(root,actual))throw new Error('模组导入越出安装目录');
    const key=path.relative(root,actual);if(modules[key])return key;
    if(!/\.(?:[cm]?[jt]s|[jt]sx)$/.test(key))throw new Error('模组代码扩展名不支持');
    const source=await read(key),ast=ts.createSourceFile(key,source,ts.ScriptTarget.Latest,true,/tsx$/.test(key)?ts.ScriptKind.TSX:/jsx$/.test(key)?ts.ScriptKind.JSX:/[cm]?ts$/.test(key)?ts.ScriptKind.TS:ts.ScriptKind.JS);
    if(Object.keys(modules).length>=100)throw new Error('模组导入的文件过多');
    const imports:any={};modules[key]={imports,code:''};
    const inspect=(node:any)=>{
      if(ts.isCallExpression(node)){
        if(node.expression.kind===ts.SyntaxKind.ImportKeyword)errors.push('不支持动态导入');
        if(ts.isIdentifier(node.expression)&&node.expression.text==='on'){
          const name=node.arguments[0];if(name&&ts.isStringLiteral(name)){events.add(name.text);if(!MOD_EVENTS.includes(name.text))errors.push(`暂不支持事件 ${name.text}`);}
          else errors.push('事件名称必须明确写出');
          if(name&&ts.isStringLiteral(name)&&name.text==='ui.render'&&node.arguments[1]&&ts.isObjectLiteralExpression(node.arguments[1])){
            for(const member of node.arguments[1].properties){if(ts.isPropertyAssignment(member)&&(ts.isIdentifier(member.name)||ts.isStringLiteral(member.name))&&member.name.text==='component'&&ts.isStringLiteral(member.initializer)&&!['AbovePrompt','Pane'].includes(member.initializer.text))errors.push(`暂不支持显示位置 ${member.initializer.text}`);}
          }
        }
      }
      if(ts.isVariableDeclaration(node)&&node.initializer&&ts.isObjectBindingPattern(node.name)){
        const init=ts.isAwaitExpression(node.initializer)?node.initializer.expression:node.initializer;
        if(init&&ts.isCallExpression(init)&&init.expression.getText(ast)==='$.ui.resolve')for(const item of node.name.elements){const binding=item.propertyName||item.name;const name=ts.isIdentifier(binding)||ts.isStringLiteral(binding)?binding.text:'';if(!MOD_ELEMENTS.includes(name))errors.push(`暂不支持界面元素 ${name}`);}
      }
      if(ts.isPropertyAccessExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&ts.isIdentifier(node.expression.expression)&&node.expression.expression.text==='$'){
        const method=`${node.expression.name.text}.${node.name.text}`;methods.add(method);if(!MOD_METHODS.includes(method))errors.push(`暂不支持能力 ${method}`);
      }
      if(ts.isElementAccessExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='$')errors.push('不支持动态选择模组能力');
      if(ts.isPropertyAccessExpression(node)&&['constructor','__proto__'].includes(node.name.text))errors.push('不支持读取运行环境内部对象');
      if(ts.isIdentifier(node)&&['require','process','Buffer','globalThis','eval','Function','fetch','setTimeout','setInterval','AbortController','AbortSignal','TextEncoder','TextDecoder','URL','URLSearchParams'].includes(node.text))errors.push(`不提供全局能力 ${node.text}`);
      ts.forEachChild(node,inspect);
    };inspect(ast);
    for(const statement of ast.statements){
      const moduleSpecifier=(ts.isImportDeclaration(statement)||ts.isExportDeclaration(statement))?statement.moduleSpecifier:null;
      if(!moduleSpecifier||!ts.isStringLiteral(moduleSpecifier))continue;
      if(ts.isImportDeclaration(statement)&&statement.importClause?.isTypeOnly)continue;
      const spec=moduleSpecifier.text;
      if(spec==='claude-code'){
        const bindings=(statement as any).importClause?.namedBindings;
        if(bindings?.elements?.some(item=>!item.isTypeOnly))errors.push('此模组需要尚未支持的响应式状态辅助函数');
        imports[spec]=null;continue;
      }
      if(!spec.startsWith('.'))throw new Error(`只允许导入模组自身文件：${spec}`);
      const base=path.resolve(path.dirname(actual),spec);let target:string;
      for(const candidate of [base,...['.ts','.tsx','.js','.mjs','.mts','.jsx'].map(ext=>base+ext)]){try{if((await fs.stat(candidate)).isFile()){target=candidate;break;}}catch{}}
      if(!target)throw new Error(`导入文件不存在：${spec}`);
      imports[spec]=await load(target);
    }
    const compiled=ts.transpileModule(source,{fileName:key.replace(/\.[^.]+$/,/[jt]sx$/.test(key)?'.tsx':'.ts'),compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,jsxFactory:'h',jsxFragmentFactory:'Fragment'},reportDiagnostics:true});
    if(compiled.diagnostics?.some(d=>d.category===ts.DiagnosticCategory.Error))throw new Error('模组代码无法编译');
    modules[key].code=compiled.outputText;return key;
  };
  const entry=await load(path.resolve(root,path.dirname(hooksFile),hooks.modules[0]));
  const defaults:any={};for(const [key,field] of Object.entries(manifest.userConfig||{}) as any){if(field.default!==undefined)defaults[key]=field.default;}
  return {root,manifest,hooksFile,entry,modules,defaults,events:[...events],methods:[...methods],errors:[...new Set(errors)]};
}
export function modOptions(mod:any,options:any={}){
  if(!options||typeof options!=='object'||Array.isArray(options))throw new Error('模组设置必须是对象');
  const result={...mod.defaults,...options};
  for(const [key,field] of Object.entries(mod.manifest.userConfig||{}) as any){const value=result[key];
    if(field.required&&value===undefined)throw new Error(`缺少设置：${key}`);
    if(value!==undefined&&['string','number','boolean'].includes(field.type)&&typeof value!==field.type)throw new Error(`设置 ${key} 的类型不正确`);
  }return result;
}

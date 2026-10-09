import ts from "typescript";
import fs from "node:fs";
const file="src/App.tsx";
const src=fs.readFileSync(file,"utf8");
const sf=ts.createSourceFile(file,src,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const names=[];
(function walk(n){
  if(ts.isFunctionDeclaration(n)&&n.name) names.push([n.name.text, sf.getLineAndCharacterOfPosition(n.getStart(sf)).line+1, sf.getLineAndCharacterOfPosition(n.end).line+1]);
  ts.forEachChild(n,walk);
})(sf);
const app=names.find(n=>n[0]==="App");
console.log("App 声明:", JSON.stringify(app));
console.log("App 行数:", app[2]-app[1]+1);
console.log("\n全部顶层函数组件（行数降序前 20）:");
names.sort((a,b)=>(b[2]-b[1])-(a[2]-a[1]));
names.slice(0,20).forEach(n=>console.log(`  ${String(n[2]-n[1]+1).padStart(5)} 行  ${n[0]}  (${n[1]}-${n[2]})`));
console.log("\n函数总数:", names.length);
console.log("渲染体最厚的组件总行数（前20合计）:", names.slice(0,20).reduce((s,n)=>s+(n[2]-n[1]+1),0));

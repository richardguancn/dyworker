import ts from "typescript";
import fs from "node:fs";

const file = "src/App.tsx";
const src = fs.readFileSync(file, "utf8");
const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function findFn(name) {
  let out = null;
  (function walk(n) {
    if (ts.isFunctionDeclaration(n) && n.name?.text === name) out = n;
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer &&
        (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) out = n.initializer;
    if (!out) ts.forEachChild(n, walk);
  })(sf);
  return out;
}

const fn = findFn("App");
const body = fn.body;
console.log("=== App 直接拥有的 hook 调用统计（仅顶层语句）===");
const hooks = {};
const bigCalls = {};        // 顶层执行的昂贵调用
let topLevelStatements = 0;

const HOOKS = new Set(["useState","useEffect","useMemo","useCallback","useRef","useLayoutEffect",
  "useDeferredValue","useTransition","useId","useReducer","useContext","useSyncExternalStore"]);

// 记录每个节点是否位于顶层（不在任何嵌套函数内）
const nestedFnKinds = new Set();
function isFunctionLike(n){ return ts.isFunctionDeclaration(n)||ts.isFunctionExpression(n)||ts.isArrowFunction(n)||ts.isMethodDeclaration(n)||ts.isGetAccessor(n)||ts.isSetAccessor(n); }

for (const st of body.statements) {
  topLevelStatements++;
  // 顶层语句里的 hook 调用（表达式语句 / 变量声明初始化）
  (function walkTop(n, depth) {
    if (isFunctionLike(n) && ts.isArrowFunction(n)) {
      // hook 回调本身不计；但要区分 useMemo(()=>..) 的调用是顶层的
    }
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if (ts.isIdentifier(e)) {
        if (HOOKS.has(e.text)) hooks[e.text] = (hooks[e.text]||0)+1;
        // 顶层非 hook 的昂贵调用
        if (!HOOKS.has(e.text) && depth === 0) {
          bigCalls[e.text] = (bigCalls[e.text]||0)+1;
        }
      }
    }
    // 不深入嵌套函数体（那些不是每次渲染都跑）
    if (isFunctionLike(n)) return;
    ts.forEachChild(n, c => walkTop(c, depth));
  })(st, 0);
}
console.log("App 顶层语句数（每次渲染都会执行）:", topLevelStatements);
console.log(JSON.stringify(hooks, null, 2));
console.log("\n=== 顶层直接执行的具名调用（非 hook，每次渲染都跑）===");
Object.entries(bigCalls).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${k}  x${v}`));

// 顶层语句里出现的数组方法（每次渲染都跑，未被 memo 包裹）
console.log("\n=== 顶层语句中每渲染执行的数组/对象操作 ===");
const METHODS = new Set(["map","filter","sort","find","slice","some","every","reduce","flatMap","concat","includes","indexOf","Set","Map","parse","stringify","join","split","replace","match","test"]);
const counts = {};
for (const st of body.statements) {
  (function walkTop(n) {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      let name = null;
      if (ts.isPropertyAccessExpression(e)) name = e.name.text;
      else if (ts.isIdentifier(e) && (e.text==="Set"||e.text==="Map")) name = e.text;
      if (name && METHODS.has(name)) counts[name] = (counts[name]||0)+1;
    }
    if (isFunctionLike(n)) return;
    ts.forEachChild(n, walkTop);
  })(st);
}
Object.entries(counts).sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>console.log(`  ${k}  x${v}`));

// JSX 中每渲染新建的 props
console.log("\n=== JSX 中重建的 props ===");
let inlineObj=0, inlineArr=0, inlineFn=0, totalJsxAttrs=0;
const ret = body.statements.find(s => ts.isReturnStatement(s) && s.expression);
(function walkJsx(n){
  if (ts.isJsxAttribute(n) && n.initializer && ts.isJsxExpression(n.initializer) && n.initializer.expression) {
    totalJsxAttrs++;
    const x = n.initializer.expression;
    if (ts.isArrowFunction(x) || ts.isFunctionExpression(x)) inlineFn++;
    else if (ts.isObjectLiteralExpression(x)) inlineObj++;
    else if (ts.isArrayLiteralExpression(x)) inlineArr++;
  }
  ts.forEachChild(n, walkJsx);
})(ret ? ret.expression : sf);
console.log(`  JSX 属性总数: ${totalJsxAttrs}`);
console.log(`  内联箭头函数: ${inlineFn}`);
console.log(`  内联对象字面量: ${inlineObj}`);
console.log(`  内联数组字面量: ${inlineArr}`);

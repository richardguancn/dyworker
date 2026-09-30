// 渐进类型迁移期的全局宽限（后续收紧并删除本文件）：
// 1) 业务代码普遍在 Error 实例上附加网络层字段（cause.code/status/address 等），
//    迁移完成前允许任意属性访问；
// 2) ChildProcess/Session 等宿主对象上挂业务标记（__dyworkerProcessGroup 等）。
interface Error {
  [key: string]: any;
}

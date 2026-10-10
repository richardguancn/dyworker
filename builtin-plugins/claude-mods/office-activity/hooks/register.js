// Copyright 2026 DYWorker contributors. MIT License.
let calls=0,completed=0;
export function register(on){
  on('session.start',async($,e,next)=>{await $.command.register({name:'activity',description:'查看本次会话的任务活动'});return next(e);});
  on('tool.call',async($,e,next)=>{const result=await next(e);if(!result?.deny&&!result?.isError)calls++;return result;});
  on('turn.complete',async($,e,next)=>{if(!e.isAborted)completed++;return next(e);});
  on('command.run',{command:'activity'},async($)=>{await $.ui.open({id:'activity',title:'任务活动'});return {};});
  on('ui.render',{component:'Pane'},($,e,next)=>{
    if((e.id||e.props?.id)!=='activity')return next(e);
    const {Box,Text,Button}=$.ui.resolve(e);
    return Box({flexDirection:'column',gap:1,children:[Text({children:`本次会话完成 ${completed} 轮任务，调用 ${calls} 次操作。`}),Button({key:'clear',label:'清空操作计数',onPress:()=>{calls=0;$.ui.invalidate('ui.render');}})]});
  });
}

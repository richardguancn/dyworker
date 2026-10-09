export const inject=['connection','commands','agents','attachments','fileUploads'];
export function apply(ctx){
 ctx.commands.register({name:'check-attachments',description:'读取实际提交附件',input:{hint:'实际附件',attachments:true},handler:async invocation=>{
   const items=[];
   for(const part of invocation.attachments){
     if(part.type==='file'){let chunks=[];for await(const chunk of ctx.attachments.readFileStream(part.attachment))chunks.push(Buffer.from(chunk));items.push({type:'file',name:part.attachment.name,bytes:Buffer.concat(chunks).length,text:Buffer.concat(chunks).toString('utf8')});}
     else if(part.type==='image'){const bytes=await ctx.attachments.readImage(part.attachment);items.push({type:'image',name:part.attachment.name,bytes:bytes.data.length,mediaType:part.attachment.mediaType});}
   }
   return {kind:invocation.rawInput.includes('fail')?'error':'success',text:JSON.stringify({sessionId:invocation.agent.id,items})};
 }});
 ctx.connection.fetch.register({path:'/api/command-attachment-fixture/execute',methods:['POST'],fetch:async req=>{
  const data=await req.json();const agent=ctx.agents.get(data.sessionId);if(!agent)return Response.json({error:'没有真实所属任务'},{status:400});
  if(data.args.includes('wait'))await new Promise(resolve=>setTimeout(resolve,30000));
  const result=await ctx.commands.execute(agent,'/check-attachments '+data.args,data.attachments,req.signal);
  return Response.json(result.result);
 }});
}

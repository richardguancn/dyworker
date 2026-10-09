// 从已验证记录生成平台发布文件；此脚本只导出，不上传或发布。
import fs from 'node:fs/promises';
import {PLUGIN_CATALOG,CATALOG_SNAPSHOT_DATE} from '../electron/host/verified-plugin-catalog.ts';
const manifest={schemaVersion:1,revision:`verified-${CATALOG_SNAPSHOT_DATE}`,publishedAt:`${CATALOG_SNAPSHOT_DATE}T00:00:00Z`,
  plugins:PLUGIN_CATALOG.map(plugin=>({...plugin,verified:true,status:'published'}))};
const body=JSON.stringify(manifest,null,2)+'\n';
if(process.argv[2])await fs.writeFile(process.argv[2],body);
else process.stdout.write(body);

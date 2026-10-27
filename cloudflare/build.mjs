import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
const here=path.dirname(fileURLToPath(import.meta.url));
const upstream=path.resolve(here,'../node_modules/korean-law-mcp/build/lib');
const substitutions=new Map([
    [path.join(upstream,'cache.js'),path.join(here,'law-worker-cache.js')],
    [path.join(upstream,'law-url-config.js'),path.join(here,'law-worker-config.js')]
]);
await build({
    absWorkingDir:here,entryPoints:['worker.js'],outfile:'.build/worker.js',bundle:true,minify:true,
    format:'esm',platform:'neutral',target:'es2022',conditions:['workerd','worker','browser'],mainFields:['module','main'],
    external:['cloudflare:workers','node:*',...builtinModules],
    alias:{kordoc:path.join(here,'law-worker-kordoc.js')},
    plugins:[{name:'법률-모듈-Workers-호환',setup(build){
        build.onResolve({filter:/(?:cache|law-url-config)\.js$/},args=>{
            const resolved=path.resolve(args.resolveDir,args.path);
            const substitute=substitutions.get(resolved);
            return substitute?{path:substitute}:undefined;
        });
        // 동적 import 를 정적 import 로 바꿉니다. esbuild 는 동적 import 대상과 그 의존(zod)을 지연 초기화로 감싸는데,
        // zod 4.4+ 의 순환 import 가 그 순서에서 깨져 Worker 시작 때 「e is not a constructor」로 죽습니다(4.15.14 배포 실패).
        build.onLoad({filter:/korean-law-mcp[\\/]build[\\/]tools[\\/]precedents\.js$/},async args=>{
            const source=await readFile(args.path,'utf8');
            const target='await import("./precedent-evidence.js")';
            if(!source.includes(target)) throw new Error('precedents.js 의 동적 import 모양이 바뀌었습니다. build.mjs 를 확인하세요.');
            return {contents:'import * as __precedentEvidence from "./precedent-evidence.js";\n'+source.replace(target,'__precedentEvidence'),loader:'js'};
        });
    }}],
    logLevel:'info'
});
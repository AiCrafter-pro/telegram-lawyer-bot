import { build } from 'esbuild';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
    }}],
    logLevel:'info'
});
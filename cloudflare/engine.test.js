import test from 'node:test';
import assert from 'node:assert/strict';
import { processCloudQuery,compactHistory,validatePublicUrl } from './engine.js';
const env={OPENAI_API_KEY:'test-openai',LAW_OC:'test-law',TELEGRAM_BOT_TOKEN:'test-telegram',OPENAI_MODEL:'gpt-5.6-terra'};
const list=async()=>[{name:'search_law',description:'법령 검색',inputSchema:{type:'object',properties:{query:{type:'string'}}}}];
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const message=text=>({output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]});

test('법률 검색 결과를 GPT에 전달하고 대화에는 원본 파일이나 인증키를 남기지 않는다',async()=>{
    const requests=[]; let count=0;
    const result=await processCloudQuery({userMessage:'민법 확인',session:null},env,{
        getLawTools:list,
        callLawTool:async(name,args)=>{assert.equal(name,'search_law');assert.equal(args.query,'민법');return {content:[{type:'text',text:'민법 원문 자료'}]};},
        fetch:async(url,options)=>{assert.equal(url,'https://api.openai.com/v1/responses');requests.push(JSON.parse(options.body));return count++===0?json({output:[{type:'function_call',name:'search_law',call_id:'call_1',arguments:'{"query":"민법"}'}]}):json(message('민법 자료를 확인했습니다.'));}
    });
    assert.equal(result.text,'민법 자료를 확인했습니다.');
    assert.equal(requests[0].store,false);
    assert.equal(requests[0].tool_choice,'required');
    assert.ok(requests[1].input.some(item=>item.type==='function_call_output' && item.call_id==='call_1' && item.output.includes('민법 원문 자료')));
    assert.equal(result.session.history.length,2);
    assert.ok(!JSON.stringify(result.session).includes('test-openai'));
});

test('법률 검색이 실패하면 모델이 생성한 법률 단정을 사용자에게 전달하지 않는다',async()=>{
    let count=0;
    const result=await processCloudQuery({userMessage:'보증금 법률 상담'},env,{
        getLawTools:list,callLawTool:async()=>({isError:true,content:[{type:'text',text:'조회 장애'}]}),
        fetch:async()=>count++===0?json({output:[{type:'function_call',name:'search_law',call_id:'call_2',arguments:'{}'}]}):json(message('반드시 승소합니다.'))
    });
    assert.match(result.text,/조회.*완료하지 못해/);
    assert.ok(!result.text.includes('승소'));
});

test('대화 저장 크기를 제한하고 잘못된 역할 및 바이너리 내용을 제외한다',()=>{
    const original=Array.from({length:30},(_,i)=>({role:i%2?'assistant':'user',content:'가'.repeat(16000)}));
    original.push({role:'system',content:'숨겨진 지침'},{role:'user',content:[{type:'input_image',image_url:'data:secret'}]});
    const history=compactHistory(original);
    assert.ok(new TextEncoder().encode(JSON.stringify(history)).length<=90*1024);
    assert.equal(history[0].role,'user');
    assert.ok(!JSON.stringify(history).includes('data:secret'));
});

test('Worker의 웹 도구는 자격증명·내부 호스트·IP 직접 접속을 거절한다',()=>{
    for(const url of ['http://127.0.0.1','http://0x7f000001','http://[::1]','http://169.254.169.254','https://localhost','https://a.internal','https://user:pass@example.com','file:///etc/passwd']) assert.throws(()=>validatePublicUrl(url));
    assert.equal(validatePublicUrl('https://www.law.go.kr/').hostname,'www.law.go.kr');
});

test('과대 파일은 다운로드와 GPT 요청 전에 거절한다',async()=>{
    let fetched=false;
    await assert.rejects(processCloudQuery({files:[{fileId:'f',mimeType:'application/pdf',fileSize:5*1024*1024}]},env,{getLawTools:list,fetch:async()=>{fetched=true;throw Error();}}),/4MB/);
    assert.equal(fetched,false);
});
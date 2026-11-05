'use strict';
const http=require('node:http'), fs=require('node:fs'), path=require('node:path'), crypto=require('node:crypto');
const {Pool}=require('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:4,idleTimeoutMillis:10000});
const names=['VY','THƯ','LIỄU','HIỀN'];
const page=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
function reply(res,status,obj,type='application/json; charset=utf-8'){
 res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
 res.end(typeof obj==='string'?obj:JSON.stringify(obj));
}
async function getStatus(res){
 const r=await pool.query('SELECT candidate,votes FROM ballot_totals');
 const completed=r.rows.reduce((n,x)=>n+Number(x.votes),0)/2;
 const finished=completed>=5;
 const data={completed,capacity:5,finished};
 if(finished)data.results=names.map(name=>({name,votes:Number(r.rows.find(x=>x.candidate===name)?.votes||0)}));
 reply(res,200,data);
}
async function doVote(req,res){
 let raw='';
 for await(const chunk of req){raw+=chunk.toString('utf8');if(raw.length>2048){reply(res,413,{error:'Yêu cầu quá lớn.'});return;}}
 let data;
 try{data=JSON.parse(raw)}catch{reply(res,400,{error:'Dữ liệu không hợp lệ.'});return}
 const token=typeof data.code==='string'?data.code.trim().toUpperCase():'';
 const picks=data.choices;
 if(!/^[A-Z0-9]{12}$/.test(token)){reply(res,400,{error:'Mã tham gia không hợp lệ.'});return}
 if(!Array.isArray(picks)||picks.length!==2||new Set(picks).size!==2||!picks.every(x=>names.includes(x))){reply(res,400,{error:'Phải chọn đúng 2 ứng cử viên khác nhau.'});return}
 const hash=crypto.createHash('sha256').update(token).digest('hex');
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const r=await c.query('SELECT used_at FROM ballot_tokens WHERE token_hash=$1 FOR UPDATE',[hash]);
  if(!r.rowCount){await c.query('ROLLBACK');reply(res,403,{error:'Mã tham gia không hợp lệ.'});return}
  if(r.rows[0].used_at){await c.query('ROLLBACK');reply(res,409,{error:'Mã này đã được sử dụng.'});return}
  await c.query('UPDATE ballot_tokens SET used_at=NOW() WHERE token_hash=$1',[hash]);
  await c.query('UPDATE ballot_totals SET votes=votes+1 WHERE candidate=ANY($1::text[])',[picks]);
  await c.query('COMMIT');
  reply(res,200,{success:true,message:'Phiếu đã được ghi nhận.'});
 }catch(e){try{await c.query('ROLLBACK')}catch{}console.error('Ballot transaction error');reply(res,500,{error:'Chưa thể ghi nhận phiếu. Hãy thử lại.'});}
 finally{c.release()}
}
http.createServer(async(req,res)=>{
 try{
  if(req.method==='GET'&&req.url==='/'){reply(res,200,page,'text/html; charset=utf-8');return}
  if(req.method==='GET'&&req.url==='/api/status'){await getStatus(res);return}
  if(req.method==='POST'&&req.url==='/api/vote'){await doVote(req,res);return}
  if(req.method==='GET'&&req.url==='/health'){reply(res,200,{ok:true});return}
  reply(res,404,{error:'Không tìm thấy trang.'});
 }catch(e){console.error('Server error');reply(res,500,{error:'Lỗi truy cập dữ liệu.'})}
}).listen(Number(process.env.PORT||10000),'0.0.0.0',()=>console.log('Ballot service ready'));
